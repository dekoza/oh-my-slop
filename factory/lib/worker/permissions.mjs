import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.8's permission bindings: what a worker of each posture is allowed to do,
 * in the exact shape each runtime accepts.
 *
 * **Posture, not profile.** §11.4 removed `permissionMode` from author control
 * precisely so a profile declaring `dontAsk` could not later be bound to a
 * reviewer and silently defeat the read-only guarantee the mutation attestation
 * rests on. Permissions therefore derive from the **role** at dispatch, and the
 * role's posture is what reaches this module.
 *
 * **Allow-by-default with explicit denies.** Full bypass is rejected and a
 * strict allowlist is a reliability trap: an allowlist that misses one command
 * does not fail safe, it hangs a pane on an approval nobody is watching — the
 * proven #64 failure. The builder therefore gets broad tool-family allows plus
 * the deny floor, and the mode that never prompts.
 *
 * **`acceptEdits` and `plan` are unusable**, and not as a matter of taste:
 * `acceptEdits` still prompts for Bash, while plan mode writes through the
 * reviewer's deliberately absent `Write` tool and then asks for approval via
 * `ExitPlanMode`. Unattended workers therefore use one non-interactive mode;
 * posture still determines which tools that mode can reach.
 */

/** The two postures a role can be dispatched under (§6.8, §8.4). */
export const WORKER_POSTURES = Object.freeze({ builder: "builder", reviewer: "reviewer" });

/**
 * The permission modes this factory will pass, and no others. `acceptEdits`
 * (prompts for Bash), `plan` (writes a plan and asks for approval), and
 * `bypassPermissions` (§6.8 rejects full bypass) are absent by construction —
 * posture controls the tool set, never whether an unattended worker can prompt.
 */
const POSTURE_MODES = Object.freeze({ [WORKER_POSTURES.builder]: "dontAsk", [WORKER_POSTURES.reviewer]: "dontAsk" });

/**
 * The scheduler-only verbs no worker may run (§6.8). Deliberately small: the
 * floor guards the verbs that would let a worker act as the controller, and
 * §7's controller-only integration gate guards the outcome. No broad network
 * denies in v1.
 */
const DENIED_VERBS = Object.freeze(["git push", "tea", "gh"]);

/**
 * The tools a reviewer must not hold. Denied in settings **and** withheld on
 * the command line: belt and suspenders, with §8.4's before/after attestation
 * as the authoritative guard behind both.
 */
const REVIEWER_DENIED_TOOLS = Object.freeze(["Edit", "Write", "NotebookEdit"]);

/**
 * The tool families a builder may use without being asked. Families, never
 * `Tool(command)` rules: a per-command allowlist is the strict allowlist §6.8
 * rejects, and `tests/node/factory_worker_permissions.test.mjs` holds the
 * distinction by asserting no rule here carries an argument.
 */
const BUILDER_ALLOWED_TOOLS = Object.freeze([
	"Bash",
	"Edit",
	"Glob",
	"Grep",
	"NotebookEdit",
	"Read",
	"Task",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
	"Write",
]);

/**
 * The families a **reviewer** keeps, allowed just as broadly.
 *
 * A reviewer with an empty allow list is not a stricter reviewer; it is a
 * reviewer with a prompt path back, in a pane nobody is watching — the exact
 * failure this section exists to close, on the posture that would otherwise be
 * the only one without broad allows. §6.8 protects the pi reviewer's `bash` by
 * name for the same reason: `git diff` and `git log` are how a review happens.
 */
const REVIEWER_ALLOWED_TOOLS = Object.freeze(
	BUILDER_ALLOWED_TOOLS.filter((tool) => !REVIEWER_DENIED_TOOLS.includes(tool)),
);

/**
 * A permission rule as both runtimes' matchers spell one: a tool name, with an
 * optional parenthesised argument. The shape is the mechanism that makes the
 * floor un-subtractable — `!Bash(git push:*)`, `-Bash(tea:*)`, and any other
 * inverted spelling fail to parse rather than quietly removing a rule.
 */
const RULE_SHAPE = /^[A-Z][A-Za-z0-9_]*(\(.+\))?$/;

/**
 * The deny floor, mechanical and override-proof (§6.8, §14.17).
 *
 * Each verb is spelled every way Claude's matcher has accepted, because the
 * floor's whole job is to hold when something else changes: a matcher that
 * stops honouring one prefix form must not silently unlock `git push`. Extra
 * spellings cost nothing — deny is evaluated before allow, and a rule that
 * matches nothing denies nothing.
 */
export const DENY_FLOOR = Object.freeze(
	DENIED_VERBS.flatMap((verb) => [`Bash(${verb})`, `Bash(${verb}:*)`, `Bash(${verb}*)`]),
);

/**
 * §6.8's contract sentence for the worker, stated once here and rendered by
 * #107's per-role prompt template. There are **no mid-attempt approvals**: a
 * denial is information, and pane-level live approval is interactive takeover.
 */
export const NO_MID_ATTEMPT_APPROVALS =
	"A denied tool call is information, not a request: there are no mid-attempt approvals. Adapt within the " +
	"permissions you hold, or end the attempt by writing a needs-human outbox whose reason class is " +
	"risky-action-required, naming the exact action and why it was needed. Nobody is watching this pane for a prompt.";

/** §6.8's v1 concession about pi, recorded loudly wherever a pi profile is in play. */
export const PI_GATING_CAVEAT =
	"pi has no command-level permission system, so a pi worker's deny floor is prompt plus withheld tools plus " +
	"§7's controller-only integration gate — not an enforced rule. Accepted for v1; a pi bash-guard extension is " +
	"the v2 hardening candidate.";

/**
 * The effective deny list for one session: the floor, then the run's declared
 * additions (§6.8's "per-run overrides may *add* denies, never subtract").
 *
 * Subtraction has no expression here — the only channel is this list, and every
 * entry is appended — so the guarantee is structural rather than checked. What
 * *is* checked is the two ways a caller could try to smuggle one in: a rule
 * whose shape inverts it, and an allow list naming something the floor denies.
 *
 * @param {ReadonlyArray<string>} declared the run's declared extra denies
 * @param {{ allow?: ReadonlyArray<string> }} [context] an allow list to cross-check
 * @returns {ReadonlyArray<string>} floor ∪ declared, de-duplicated, floor first
 * @throws {FactoryWorkerError} `permission-invalid` · `deny-floor-subtracted`
 */
export function mergeDenies(declared = [], { allow = [] } = {}) {
	for (const rule of declared) {
		if (typeof rule !== "string" || !RULE_SHAPE.test(rule)) {
			throw refuse(
				"permission-invalid",
				`${JSON.stringify(rule ?? null)} is not a permission rule. A per-run override may only add denies of the ` +
					`form Tool or Tool(argument); an inverted or prefixed spelling is a subtraction, and there is no channel for one.`,
				{ at: "worker.denies", found: rule ?? null },
			);
		}
	}

	for (const rule of allow) {
		if (!DENY_FLOOR.includes(rule)) continue;
		throw refuse(
			"deny-floor-subtracted",
			`An override allows ${rule}, which the deny floor denies. Per-run overrides may add denies and never subtract ` +
				`one (§6.8, §14.17); the floor guards the scheduler-only verbs and is not reachable from configuration.`,
			{ at: "worker.denies", found: rule },
		);
	}

	const merged = [...DENY_FLOOR, ...declared];
	const effective = Object.freeze([...new Set(merged)]);

	// A post-condition, not a check: it can only fail if the lines above stopped
	// starting from the floor, which is exactly the edit worth failing loudly on.
	for (const rule of DENY_FLOOR) {
		if (effective.includes(rule)) continue;
		throw refuse("deny-floor-subtracted", `The deny floor lost ${rule} while merging per-run overrides (§14.17).`, {
			at: "worker.denies",
			found: rule,
		});
	}

	return effective;
}

/**
 * The settings document injected per session via `--settings` (§6.8).
 *
 * It carries the permissions and nothing else: this file is the worker's whole
 * user-level settings surface, so anything else written here would be policy
 * arriving through a channel no operator reads.
 *
 * @param {{ posture: string, extraDenies?: ReadonlyArray<string> }} binding
 * @returns {object} the settings document, ready to serialize
 */
export function claudeSettingsDocument({ posture, extraDenies = [] }) {
	const mode = requireMode(posture);
	const allow = posture === WORKER_POSTURES.builder ? [...BUILDER_ALLOWED_TOOLS] : [...REVIEWER_ALLOWED_TOOLS];
	// The document's own allow list is what the cross-check reads: the day one of
	// those families is narrowed into a `Tool(argument)` rule, a rule that names
	// something the floor denies is refused here rather than shipped.
	const denies = mergeDenies(extraDenies, { allow });

	return {
		permissions: {
			defaultMode: mode,
			allow,
			deny: posture === WORKER_POSTURES.builder ? [...denies] : [...denies, ...REVIEWER_DENIED_TOOLS],
		},
	};
}

/**
 * The Claude flags for one session: the controller-owned settings file, the
 * posture's non-interactive mode, and — for a reviewer — the edit tools withheld
 * on the command line as well as in the file.
 *
 * The mode rides the flag *and* the file deliberately. The file is what §6.8
 * names, and the flag is what a `--print` probe proves the installed binary
 * accepts; a mode only the file carried would be ignored silently by a harness
 * that renamed it.
 *
 * @param {{ posture: string, settingsPath: string }} binding
 * @returns {string[]}
 */
export function claudeSessionArguments({ posture, settingsPath }) {
	const mode = requireMode(posture);

	return [
		"--settings",
		settingsPath,
		"--permission-mode",
		mode,
		...(posture === WORKER_POSTURES.reviewer ? ["--disallowedTools", REVIEWER_DENIED_TOOLS.join(",")] : []),
	];
}

/**
 * The pi flags for one session — **tool lists only**, because that is pi's
 * whole permission surface (§6.8).
 *
 * The builder passes nothing: pi's defaults are already allow-by-default, and a
 * `--tools` list would be the strict allowlist §6.8 rejects *and* would silently
 * withhold every extension-provided tool. The reviewer excludes `edit` and
 * `write` and keeps `bash`, which `git diff` and `git log` need.
 *
 * @param {{ posture: string }} binding
 * @returns {string[]}
 */
export function piSessionArguments({ posture }) {
	requireMode(posture);
	return posture === WORKER_POSTURES.reviewer ? ["--exclude-tools", "edit,write"] : [];
}

function requireMode(posture) {
	const mode = POSTURE_MODES[posture];
	if (mode !== undefined) return mode;

	throw refuse(
		"permission-invalid",
		`"${posture}" is not a worker posture. Permissions derive from the role at dispatch (§11.4), and the two ` +
			`postures are ${Object.values(WORKER_POSTURES).join(" and ")}; acceptEdits and full bypass are not reachable ` +
			`from here at all.`,
		{ at: "posture", found: posture ?? null, expected: Object.values(WORKER_POSTURES).join("|") },
	);
}

function refuse(reason, sentence, details) {
	return new FactoryWorkerError(reason, sentence, details);
}
