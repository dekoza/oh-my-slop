import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CLAUDE_RESOURCE_CLASS } from "../config/profiles.mjs";
import { createWorkerAdapter } from "./adapter.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { lifecycleOperations } from "./lifecycle.mjs";
import { ensureClaudePlugin, readPluginManifest } from "./plugin.mjs";
import {
	flagNames,
	harnessVersion,
	memoizedPreflight,
	parseJson,
	probeFinding,
	proveProfileFlags,
	runIn,
	unreachableRuntime,
} from "./probe.mjs";
import * as realTransport from "./transports.mjs";
import { readClaudeConfigState, untrustedProjects } from "./trust.mjs";

/**
 * The Claude half of §6.1's adapter: plugin directory, strict validation, and
 * the stream-json control protocol live here and nowhere else.
 *
 * §6.2's layer 2 is three steps, in order, all against the §6.3 plugin built
 * from the pinned revision:
 *
 * 1. `claude plugin validate --strict` — the generator's output, held to the
 *    loader's own strict schema;
 * 2. `claude --plugin-dir <dir> plugin details` — the expected-vs-actual
 *    component diff, because the loader drops mis-nested skills **silently**
 *    and only the registered count betrays it;
 * 3. the authoritative **`initialize` control-request over stream-json** —
 *    the session's structured `commands` array, `<plugin>:<skill>` records for
 *    the closure, at zero model cost. This is the production path, executed.
 *
 * **The capacity probe folds into the same request** (§6.2, §9.7): the
 * initialize response carries the model inventory, and `claude-code` is a
 * cloud-shaped class — nothing observes a `max_instances`, so it stays
 * declared-only and the probe's success is its reachability.
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The flags only the probe carries — the stream-json IO mode its `initialize`
 * control-request needs. Everything else a probe session runs under is the
 * worker binding itself, by construction below: a flag added to one side and
 * not the other is #160's defect, a probe proving a session no worker runs in.
 */
export const CLAUDE_PROBE_ONLY_FLAGS = Object.freeze([
	"--input-format",
	"stream-json",
	"--output-format",
	"stream-json",
	"--print",
	"--verbose",
]);

/**
 * §6.8's discovery fence — load-bearing isolation, the Claude counterpart of
 * pi's `--no-skills`.
 *
 * A Claude session registers the project-level `.claude/skills` and
 * `.claude/commands` its **cwd** ships, and a controller-owned
 * `CLAUDE_CONFIG_DIR` does not fence them: measured live on Claude Code 2.1.233
 * in a scratch project holding only `.claude/skills/leaktest/SKILL.md`, an
 * `initialize` control-request under an *empty* isolated config dir answered 44
 * commands including a bare `leaktest` (#163). A worker's cwd is the attempt
 * worktree — the operator's repository at the pinned commit — so on any target
 * repository shipping project skills, every worker would load skills from
 * outside the pinned package root.
 *
 * `--setting-sources user` drops the `project` and `local` sources: the same
 * request answered 43 commands with no `leaktest` and no project command, while
 * the §6.3 plugin's `<plugin>:<skill>` records, the injected `--settings` file,
 * and `--permission-mode` were all untouched (measured together, same binary).
 */
export const CLAUDE_DISCOVERY_FENCE = Object.freeze(["--setting-sources", "user"]);

/**
 * The production flag set — what every Claude **worker** session is launched
 * with, and therefore what the probe must prove.
 *
 * `--plugin-dir` is the closure's only delivery channel: the controller-owned
 * config environment has no installed plugins, so a session launched without
 * it has no skill natively invocable — measured live, `plugin list` under the
 * worker's exact binding answered "No plugins installed" (#160), while the
 * prompt told every worker to invoke `<plugin>:<skill>`.
 *
 * `sessionArgs` is §6.8's binding — the controller-owned `--settings` file and
 * the posture's `--permission-mode`.
 *
 * @param {string} pluginDir the §6.3 plugin directory
 * @param {ReadonlyArray<string>} [sessionArgs]
 * @param {{ fenced?: boolean }} [options] `fenced: false` builds the one session
 *   the factory deliberately runs **without** the discovery fence: the control
 *   side of the probe's fence proof, which must see the planted canary or the
 *   fenced session's silence means nothing. No worker is ever launched with it.
 * @returns {string[]}
 */
export function claudeWorkerArguments(pluginDir, sessionArgs = [], { fenced = true } = {}) {
	return ["--plugin-dir", pluginDir, ...(fenced ? CLAUDE_DISCOVERY_FENCE : []), ...sessionArgs];
}

/**
 * The probe's flag set: the worker binding, plus the probe-only IO flags, plus
 * **nothing** — composed from `claudeWorkerArguments` so the two cannot
 * diverge (§6.2's "the probe must use the production flag set").
 *
 * The session flags ride the probe deliberately: the permission mode is also
 * written into the settings file, and passing it here is what makes the
 * installed binary *accept or reject* the spelling before a pane depends on it.
 *
 * @param {string} pluginDir
 * @param {ReadonlyArray<string>} [sessionArgs]
 * @param {{ fenced?: boolean }} [options]
 * @returns {string[]}
 */
export function claudeProbeArguments(pluginDir, sessionArgs = [], options = {}) {
	return [...claudeWorkerArguments(pluginDir, sessionArgs, options), ...CLAUDE_PROBE_ONLY_FLAGS];
}

/**
 * The profile's own contribution to a pane's argv — §11.4's `model` plus the
 * optional `effort`, where omission means "don't pass the flag".
 *
 * Exported because two callers must agree on it **by construction** rather than
 * by care (#164, which is #160 one argument set down): the launch appends it to
 * the worker binding, and §6.2's spelling proof hands the very same argv to the
 * installed binary before a pane depends on it.
 *
 * @param {{ model: string, effort?: string }} profile
 * @returns {string[]}
 */
export function claudeProfileArguments(profile) {
	const args = ["--model", profile.model];
	if (profile.effort !== undefined) args.push("--effort", profile.effort);
	return args;
}

/**
 * The argv §6.2's flag-spelling proof runs for one profile: **the argv a pane
 * receives**, plus the probe-only IO flags and nothing else. The profile's flags
 * sit where the launch puts them — after the worker binding — so what the
 * installed binary parses here is what it will parse there.
 *
 * @param {string} pluginDir
 * @param {ReadonlyArray<string>} sessionArgs
 * @param {{ model: string, effort?: string }} profile
 * @returns {string[]}
 */
export function claudeSpellingArguments(pluginDir, sessionArgs, profile) {
	return [
		...claudeWorkerArguments(pluginDir, sessionArgs),
		...claudeProfileArguments(profile),
		...CLAUDE_PROBE_ONLY_FLAGS,
	];
}

/**
 * One live probe of the Claude runtime — role-independent, memoized by the
 * adapter per pinned revision.
 *
 * @param {object} input
 * @param {string} input.packageRoot the handshake's canonical root
 * @param {ReadonlyArray<string>} input.expectedSkills every skill the pinned
 *   revision ships — the component diff's expectation
 * @param {number | null} input.declaredSize `concurrency.resources["claude-code"]`
 * @param {string} input.cacheRoot the store directory holding the plugin cache
 * @param {string} input.packageRev the pinned tree digest — the plugin cache key
 * @param {{ env?: object, sessionArgs?: ReadonlyArray<string>, cwd?: string, configDir?: string }} [input.session]
 *   §6.8's controller-owned binding: `CLAUDE_CONFIG_DIR`, the posture's flags, and
 *   the directory a worker pane runs in
 * @param {object} [input.transport]
 * @param {string} [input.binary]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Readonly<object>>} the runtime observation, findings included
 */
export async function probeClaudeRuntime({
	packageRoot,
	packageRev,
	cacheRoot,
	expectedSkills,
	declaredSize = null,
	session: binding = {},
	transport = {},
	binary = "claude",
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const io = { ...realTransport, ...transport };
	const failures = [];
	const where = { env: binding.env, cwd: binding.cwd };

	const version = await harnessVersion(io, { label: "Claude", binary, timeoutMs, where }, failures);
	if (version === null) return observation({ ok: false, version, failures, declaredSize, binary });

	// §6.3: built by the package's generator, cached per revision, immutable.
	let plugin;
	try {
		plugin = await ensureClaudePlugin({ packageRoot, treeDigest: packageRev, cacheRoot, runCommand: io.runCommand });
	} catch (error) {
		if (!(error instanceof FactoryWorkerError)) throw error;
		failures.push(probeFinding("plugin-invalid", error.message, { reason: error.reason, ...error.details }));
		return observation({ ok: false, version, failures, declaredSize, binary });
	}

	await strictValidation(io, { binary, plugin, where, timeoutMs }, failures);
	await componentDiff(io, { binary, plugin, expectedSkills, where, timeoutMs }, failures);

	// Planted before the production session runs, so the very session that proves
	// the closure is the session that proves nothing leaked into it (#163).
	const canary = plantDiscoveryCanary(where.cwd, failures);
	let initialized;
	let fenceProven = false;
	try {
		initialized = await initializeProbe(
			io,
			{ binary, plugin, sessionArgs: binding.sessionArgs ?? [], where, timeoutMs },
			failures,
		);
		fenceProven = await proveDiscoveryFence(
			io,
			{ binary, plugin, sessionArgs: binding.sessionArgs ?? [], where, timeoutMs, canary, registered: initialized },
			failures,
		);
	} finally {
		canary?.remove();
	}
	assertNothingUntrusted(binding.configDir, failures);
	const commands = initialized?.commands ?? Object.freeze([]);
	const models = initialized?.models ?? Object.freeze([]);

	return observation({
		ok: failures.length === 0,
		version,
		failures,
		plugin,
		commands,
		models,
		// The fence and its proof, as a fact the run records: a green probe that
		// says nothing about the fence leaves an operator unable to tell whether
		// the proof ran at all (§6.8's "enforced, not promised").
		discovery: Object.freeze({
			fence: CLAUDE_DISCOVERY_FENCE,
			canary: canary?.name ?? null,
			proven: fenceProven,
		}),
		reachable: initialized !== null,
		declaredSize,
		binary,
	});
}

/**
 * §6.2's flag-spelling proof for the Claude runtime: **one `initialize`
 * control-request per distinct profile**, over that profile's own launch argv
 * (#164).
 *
 * This is deliberately *not* folded into `probeClaudeRuntime`. That probe is
 * role- and profile-independent and memoized once per pinned revision — §6.2's
 * "one request" — while profiles vary per role *and* per routing rule, so
 * exercising each profile inside it would change the probe's **cardinality**
 * rather than its argv. The two cardinalities stay separate and stated: one
 * probe per revision, one spelling session per distinct profile.
 *
 * The `initialize` control-request is the request because it is the one the
 * probe already asks and costs no model call (§6.2); its answer is only being
 * used as proof that the argv parsed, so what it carries is not read here.
 *
 * @param {object} input
 * @param {ReadonlyArray<{ name: string, model: string, effort?: string }>} input.profiles
 *   the distinct Claude profiles the active routing can dispatch
 * @param {string} input.pluginDir the §6.3 plugin directory the probe proved
 * @param {{ env?: object, sessionArgs?: ReadonlyArray<string>, cwd?: string }} [input.session]
 * @param {object} [input.transport]
 * @param {string} [input.binary]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Readonly<object>>} `{ kind, binary, checked, findings }`
 */
export async function proveClaudeProfileFlags({
	profiles,
	pluginDir,
	session: binding = {},
	transport = {},
	binary = "claude",
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	return proveProfileFlags(
		{ ...realTransport, ...transport },
		{
			kind: "claude",
			label: "Claude",
			binary,
			sessions: profiles.map((profile) => {
				const requestId = `factory-spelling-${profile.name}`;
				return {
					profile,
					flags: flagNames(claudeProfileArguments(profile)),
					args: claudeSpellingArguments(pluginDir, binding.sessionArgs ?? [], profile),
					input: [
						JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } }),
					],
					answered: (parsed) => parsed?.type === "control_response" && parsed.response?.request_id === requestId,
				};
			}),
			where: { env: binding.env, cwd: binding.cwd },
			timeoutMs,
		},
	);
}

/**
 * The role-level half: every closure member must appear as a
 * `<plugin>:<skill>` command in the initialize response's `commands` array —
 * registration on the production path, not an inspection of the tree.
 *
 * @param {Readonly<object>} probed what `probeClaudeRuntime` observed
 * @param {ReadonlyArray<string>} closure
 * @returns {ReadonlyArray<object>} findings
 */
export function proveClaudeClosure(probed, closure) {
	const pluginName = probed.plugin?.manifest.name ?? null;
	const registered = new Set(probed.commands);
	const findings = [];

	for (const name of closure) {
		const command = `${pluginName}:${name}`;
		if (pluginName !== null && registered.has(command)) continue;
		findings.push(
			probeFinding(
				"skill-not-invocable",
				`/${command} is not in the initialize control-request's commands array — native invocation is unprovable, ` +
					`and no degraded prose-loading mode exists (§6.2).`,
				{ skill: name, command },
			),
		);
	}

	return Object.freeze(findings);
}

/**
 * §6.1's adapter for the Claude runtime.
 *
 * The one thing the lifecycle needs from *this* runtime is the agent kind Herdr
 * starts. The §6.3 plugin's manifest name — which `prompt.mjs` turns into
 * `/oh-my-slop:<skill>` — is deliberately **not** bound here: it is observed by
 * the probe, so it travels with the attempt from whoever holds the preflight
 * result, rather than being a second copy of a name the generator owns.
 *
 * @param {object} context everything `probeClaudeRuntime` takes except the revision,
 *   which arrives per call as §6.1's `package_rev` — plus, for a context that
 *   launches, `pluginDir`: the §6.3 plugin directory the probe proved, off the
 *   preflight's runtime observation, so the session a worker gets is the session
 *   the probe ran rather than a second computation of it
 * @returns {Readonly<object>} the adapter
 */
export function createClaudeAdapter(context) {
	const lifecycle = lifecycleOperations({ runtime: "claude", agentKind: "claude" }, context.launch ?? {});
	return createWorkerAdapter({
		kind: "claude",
		operations: {
			preflight: memoizedPreflight({
				kind: "claude",
				probe: (packageRev) => probeClaudeRuntime({ ...context, packageRev }),
				prove: proveClaudeClosure,
			}),
			// Claude's model and effort flags stay behind the runtime-neutral launch
			// operation; the production composer never branches on their spelling.
			// The plugin flag enters here too, from the dir the probe proved: the
			// launch and the probe share one binding (#160). Reading the manifest
			// back first turns a cache wiped since preflight into a typed failure
			// before a pane exists, never a worker that quietly has no skills.
			launch: async (attempt) => {
				const pluginDir = requireProvenPlugin(context.pluginDir);
				readPluginManifest(pluginDir);
				return lifecycle.launch({
					...attempt,
					sessionArgs: [
						...claudeWorkerArguments(pluginDir, attempt.sessionArgs ?? []),
						...claudeProfileArguments(attempt.profile),
					],
					startupTimeoutMs: attempt.profile.startupTimeoutMs ?? null,
				});
			},
			awaitCompletion: lifecycle.awaitCompletion,
			cancel: lifecycle.cancel,
		},
	});
}

/**
 * A launch with no proven plugin directory would start a worker with no skill
 * natively invocable — a session that quietly reads files instead of invoking
 * its closure, which is #160's forbidden outcome. Typed, before a pane exists,
 * so the attempt never spends (§6.2, §6.3).
 */
function requireProvenPlugin(pluginDir) {
	if (typeof pluginDir === "string" && pluginDir !== "") return pluginDir;
	throw new FactoryWorkerError(
		"worker-launch-failed",
		"A Claude worker launch was asked for with no proven §6.3 plugin directory, so no skill in its closure could " +
			"reach the session — the worker would run without its discipline rather than fail (§6.2, #160).",
		{ at: "pluginDir", found: pluginDir ?? null },
	);
}

// ── The probe's three steps ──────────────────────────────────────────────────

async function strictValidation(io, { binary, plugin, where, timeoutMs }, failures) {
	const answer = await io.runCommand(binary, ["plugin", "validate", "--strict", plugin.dir], {
		timeout: timeoutMs,
		...runIn(where),
	});
	if (answer.status === 0) return;

	failures.push(
		probeFinding(
			"plugin-invalid",
			`\`${binary} plugin validate --strict\` refused the built plugin at ${plugin.dir} (exit ${answer.status}): ` +
				`${(answer.stderr || answer.stdout).trim().split("\n").at(-1) ?? "(no output)"} (§6.3).`,
			{ dir: plugin.dir, status: answer.status },
		),
	);
}

/**
 * The expected-vs-actual diff over `plugin details`. The expectation is every
 * skill the pinned revision ships — the generator flattens them all — because
 * the loader's failure mode is a silently smaller inventory, and only a count
 * compared against the shipped count betrays it (§6.3).
 */
async function componentDiff(io, { binary, plugin, expectedSkills, where, timeoutMs }, failures) {
	const name = plugin.manifest.name;
	const answer = await io.runCommand(binary, ["--plugin-dir", plugin.dir, "plugin", "details", name], {
		timeout: timeoutMs,
		...runIn(where),
	});

	const inventory = answer.status === 0 ? parseSkillInventory(answer.stdout) : null;
	if (inventory === null) {
		failures.push(
			probeFinding(
				"plugin-component-diff",
				`\`${binary} plugin details ${name}\` answered no readable component inventory (exit ${answer.status}), so ` +
					`the expected-vs-actual diff cannot be taken (§6.2).`,
				{ plugin: name, status: answer.status },
			),
		);
		return;
	}

	const actual = new Set(inventory.skills);
	const missing = expectedSkills.filter((skill) => !actual.has(skill));
	const surplus = inventory.skills.filter((skill) => !expectedSkills.includes(skill));

	if (missing.length === 0 && surplus.length === 0 && inventory.count === expectedSkills.length) return;

	failures.push(
		probeFinding(
			"plugin-component-diff",
			`The plugin registers ${inventory.count} skills while the pinned revision ships ${expectedSkills.length}` +
				(missing.length === 0 ? "" : `; missing: ${missing.join(", ")}`) +
				(surplus.length === 0 ? "" : `; unexpected: ${surplus.join(", ")}`) +
				". The loader drops mis-nested skills silently, so a smaller inventory is the only symptom (§6.3).",
			{ plugin: name, expected: expectedSkills.length, registered: inventory.count, missing, surplus },
		),
	);
}

async function initializeProbe(io, { binary, plugin, sessionArgs, where, timeoutMs }, failures) {
	const answered = await initializeSession(io, {
		binary,
		args: claudeProbeArguments(plugin.dir, sessionArgs),
		where,
		timeoutMs,
	});
	if (answered.error === undefined) return answered;

	failures.push(unreachableRuntime("Claude", binary, answered.error));
	return null;
}

/**
 * One `initialize` control-request over stream-json, as a result rather than a
 * verdict: `{ commands, models }`, or `{ error }` naming what the session did
 * instead of answering. Two callers judge that differently — an unanswered
 * production probe is an unreachable runtime, an unanswered *control* session is
 * an unproven fence — and neither judgement belongs to the transport.
 */
async function initializeSession(io, { binary, args, where, timeoutMs }) {
	const requestId = `factory-preflight-${Date.now().toString(36)}`;
	let session;
	try {
		session = await io.lineSession({
			binary,
			args,
			input: [JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } })],
			env: where.env,
			cwd: where.cwd,
			timeoutMs,
		});
	} catch (error) {
		return { error: error.message };
	}

	for (const line of session.lines) {
		const parsed = parseJson(line);
		if (parsed?.type !== "control_response" || parsed.response?.request_id !== requestId) continue;

		const inner = parsed.response.response ?? {};
		return {
			commands: Object.freeze(
				(inner.commands ?? []).map((command) => command?.name).filter((name) => typeof name === "string"),
			),
			models: Object.freeze(
				(inner.models ?? [])
					.filter((model) => typeof model?.value === "string")
					.map((model) =>
						Object.freeze({ value: model.value, resolved: model.resolvedModel ?? null }),
					),
			),
		};
	}

	return {
		error: session.timedOut
			? `the initialize control-request over stream-json got no control_response within ${timeoutMs}ms`
			: `the initialize control-request over stream-json got no control_response (exit ${session.status})` +
					(session.stderr.trim() === "" ? "" : `: ${session.stderr.trim().split("\n").at(-1)}`),
	};
}

// ── §6.8's discovery fence, proven from both sides (#163) ───────────────────

/**
 * The canary project skill the probe plants in its own cwd, and its body. Not
 * exported: what leaves this module is the *observed* name, on the finding and
 * on the recorded `discovery` fact, never a constant a caller could match on.
 */
const CLAUDE_DISCOVERY_CANARY = "factory-discovery-canary";

const CANARY_SKILL =
	`---\nname: ${CLAUDE_DISCOVERY_CANARY}\ndescription: Canary — the factory's preflight plants this to prove that a ` +
	`worker session registers no skill from its working directory.\n---\n\n` +
	`The factory controller writes this file into the directory it probes Claude in, and removes it again when the probe ` +
	`ends. If a session ever registers it, project-level skill discovery reached that session and §6.8's "skills reach a ` +
	`worker only from the pinned package root" is false. Nothing invokes it.\n`;

/**
 * Plant the canary in the directory the probe runs in.
 *
 * The probe's cwd is the factory-private clone — a bare repository, where a
 * planted `.claude/skills/<name>` is discovered exactly as it is in a plain
 * directory (measured on Claude Code 2.1.233).
 *
 * **The write is not a §4.5 effect**, on the same ground as the plugin cache it
 * sits beside: it is factory infrastructure inside the controller's own store,
 * scoped to one probe, removed by that probe, and idempotent under re-entry —
 * there is no outside-world state a later run could find in an unknown
 * condition, which is what an effect's requested/resolved pair exists to settle.
 *
 * A binding with no usable cwd is a different matter: the session would inherit
 * the controller's own directory, which is the operator's repository. Nothing is
 * planted there — the factory does not write into a tree it does not own — and
 * the fence is then **unproven**, which is a finding rather than a quiet pass.
 * (`preflight.mjs` always supplies one, so this guards a caller that does not.)
 *
 * @returns {{ name: string, dir: string, remove: () => void } | null}
 */
function plantDiscoveryCanary(cwd, failures) {
	if (typeof cwd !== "string" || cwd === "") {
		failures.push(
			probeFinding(
				"discovery-fence-unproven",
				`The probe was given no working directory to plant the discovery canary in, so it cannot show that a project ` +
					`skill in a worker's own working directory stays out of its session — and planting one in the directory ` +
					`the controller itself runs in would write into the operator's repository. §6.8's limit is enforced, not ` +
					`promised, so an unprovable fence is a failure now rather than a worker reading someone else's skills later.`,
				{ canary: CLAUDE_DISCOVERY_CANARY, at: null, fence: [...CLAUDE_DISCOVERY_FENCE] },
			),
		);
		return null;
	}

	const skills = join(cwd, ".claude", "skills");
	const dir = join(skills, CLAUDE_DISCOVERY_CANARY);
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), CANARY_SKILL, "utf8");
	} catch (error) {
		failures.push(
			probeFinding(
				"discovery-fence-unproven",
				`The discovery canary could not be planted at ${dir} (${error.message}), so this probe cannot show that a ` +
					`project skill in a worker's own working directory stays out of its session. §6.8's limit is enforced, not ` +
					`promised, so an unprovable fence is a failure now rather than a worker reading someone else's skills later.`,
				{ canary: CLAUDE_DISCOVERY_CANARY, at: dir, fence: [...CLAUDE_DISCOVERY_FENCE] },
			),
		);
		return null;
	}

	return {
		name: CLAUDE_DISCOVERY_CANARY,
		dir,
		// Total by construction, and deliberately so: this runs in the probe's
		// `finally`, where a throw would replace the probe's verdict with an
		// exception about tidying up. A canary that outlives its probe is fenced
		// out of every session anyway, and the next run plants the same file over
		// it.
		remove: () => {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				return;
			}
			// Only the directories the planting made: `rmdir` refuses a non-empty
			// one, so a `.claude` that was already there is left exactly as it was.
			for (const parent of [skills, join(cwd, ".claude")]) {
				try {
					rmdirSync(parent);
				} catch {
					break;
				}
			}
		},
	};
}

/**
 * §6.8's fence, proven against the session a worker actually runs — both sides.
 *
 * The **fenced** side is the production probe itself: the canary sitting in its
 * cwd must not appear among the commands it registered. The **control** side is
 * one deliberately unfenced session, the same binding minus
 * `CLAUDE_DISCOVERY_FENCE`, which must register it — otherwise the fenced
 * session's silence is not evidence of a fence but of a probe that could not
 * have seen the leak, which is #160's defect in a new place.
 *
 * @returns {Promise<boolean>} whether the fence was proven — false both when it
 *   was broken and when nothing could be proven either way
 */
async function proveDiscoveryFence(io, { binary, plugin, sessionArgs, where, timeoutMs, canary, registered }, failures) {
	if (canary === null || registered === null) return false;

	if (registered.commands.includes(canary.name)) {
		failures.push(
			probeFinding(
				"skill-shadowed",
				`The probed session registered ${canary.name}, a skill planted in its own working directory at ${canary.dir} ` +
					`and not in the pinned package. Skills reach a worker only from the pinned package root (§6.8), and ` +
					`\`${CLAUDE_DISCOVERY_FENCE.join(" ")}\` did not fence project discovery on this harness ` +
					`(${binary}) — so a worker in a repository shipping .claude/skills/ would run the repository's skills.`,
				{ skill: canary.name, source: canary.dir, fence: [...CLAUDE_DISCOVERY_FENCE] },
			),
		);
		return false;
	}

	const control = await initializeSession(io, {
		binary,
		args: claudeProbeArguments(plugin.dir, sessionArgs, { fenced: false }),
		where,
		timeoutMs,
	});

	if (control.error === undefined && control.commands.includes(canary.name)) return true;

	failures.push(
		probeFinding(
			"discovery-fence-unproven",
			`The control session — the worker binding without \`${CLAUDE_DISCOVERY_FENCE.join(" ")}\` — did not register ` +
				`the canary project skill at ${canary.dir}` +
				(control.error === undefined ? "" : ` (${control.error})`) +
				`, so the fenced session registering none of it proves nothing: this probe cannot show it would notice a ` +
				`project skill reaching a worker. The fence is therefore unproven rather than proven (§6.2, §6.8).`,
			{ canary: canary.name, at: canary.dir, fence: [...CLAUDE_DISCOVERY_FENCE] },
		),
	);
	return false;
}

/**
 * §6.8's standing assertion over the controller-owned config state: **no
 * project recorded in it is one nobody trusted.**
 *
 * The trust check pre-trusted the keys the controller derived; this catches a
 * key the derivation did not anticipate — Claude keys a linked worktree by the
 * *repository*, which is not the obvious answer — before a pane wedges on a
 * dialog nobody is watching.
 *
 * Two honest limits, both measured rather than assumed:
 *
 * - A `--print` probe never meets the dialog (the help text: it is skipped in
 *   non-interactive mode), so this is a state assertion, never an observation
 *   of the dialog's absence. The interactive pane's safety rests on the state.
 * - A session whose cwd is a bare repository or a plain directory records **no**
 *   project at all, so on a given run this may have nothing to judge. What it
 *   then guards is the accumulated state: an unexpected key a *previous*
 *   session left is caught by the next run's preflight rather than never.
 */
function assertNothingUntrusted(configDir, failures) {
	if (configDir === undefined) return;

	const untrusted = untrustedProjects(readClaudeConfigState(configDir));
	if (untrusted.length === 0) return;

	failures.push(
		probeFinding(
			"trust-not-established",
			`The probed session recorded ${untrusted.join(", ")} as a project with no accepted trust dialog, and the ` +
				`controller had pre-trusted a different key. An interactive worker pane in that project would sit on the ` +
				`trust dialog until it timed out, so this is an automation failure now rather than a hang later (§6.8).`,
			{ untrusted: [...untrusted], config_dir: configDir },
		),
	);
}

/** The one line of `plugin details` this probe reads: `Skills (N)  a, b, c`. */
function parseSkillInventory(stdout) {
	const match = /^\s*Skills \((\d+)\)\s*(.*)$/m.exec(stdout);
	if (match === null) return null;
	return {
		count: Number(match[1]),
		skills: match[2]
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name !== ""),
	};
}

function observation({
	ok,
	version,
	failures,
	plugin = null,
	commands = Object.freeze([]),
	models = Object.freeze([]),
	discovery = null,
	reachable = false,
	declaredSize,
	binary,
}) {
	return Object.freeze({
		kind: "claude",
		ok,
		version,
		failures: Object.freeze([...failures]),
		plugin,
		commands,
		models,
		discovery,
		resolvedModels: Object.freeze(Object.fromEntries(models.map((model) => [model.value, model.resolved]))),
		// §9.7: a cloud class has nothing to observe and stays declared-only, so
		// `max_instances` is null by construction and reachability is the probe's
		// own success — one request, no second place to disagree.
		classes: Object.freeze({
			[CLAUDE_RESOURCE_CLASS]: Object.freeze({
				class: CLAUDE_RESOURCE_CLASS,
				endpoint: binary,
				reachable,
				max_instances: null,
				declared: declaredSize,
				models: Object.freeze(models.map((model) => model.value)),
			}),
		}),
	});
}

