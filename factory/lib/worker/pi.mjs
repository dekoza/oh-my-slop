import { providerOf, resourceClassOf } from "../config/profiles.mjs";
import { createWorkerAdapter } from "./adapter.mjs";
import { containsPath, realpathOrNull } from "./closure.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { lifecycleOperations } from "./lifecycle.mjs";
import {
	flagNames,
	harnessVersion,
	memoizedPreflight,
	parseJson,
	probeFinding,
	proveProfileFlags,
	unreachableRuntime,
} from "./probe.mjs";
import * as realTransport from "./transports.mjs";

/**
 * The pi half of §6.1's adapter: every pi difference — RPC mode, skill flags,
 * the model catalogue a resource class is observed through — lives here and
 * nowhere else.
 *
 * §6.2's layer 2 is **a disposable RPC session with the exact production skill
 * flags** (`--no-skills --skill <root>`), required to answer `skill:<name>`
 * command records for the whole closure. The probe executes the production
 * loading path rather than inspecting registration — the audited Pi bridge
 * passed installation and discovery while behaviourally dead, which is the
 * failure this session exists to make impossible.
 *
 * **The capacity probe folds into the same probe pass** (§6.2, §9.7): the
 * session's own model inventory names each provider's endpoint, and one
 * request to that endpoint yields `max_instances` — so "is the runtime up" and
 * "how many slots does it really have" cannot come from two places that
 * disagree.
 */

/** The RPC requests one disposable session answers. Both verified live. */
const RPC_REQUESTS = Object.freeze([{ type: "get_commands" }, { type: "get_available_models" }]);

/**
 * The one of those requests §6.2's flag-spelling proof asks (#164) — **found by
 * name, not by position**, so the constant above stays free to be reordered. Its
 * answer is used only as proof that the argv parsed, so what it carries is never
 * read; it is this request because the probe already asks it, at no model cost.
 */
const SPELLING_REQUEST = RPC_REQUESTS.find((request) => request.type === "get_commands");

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The two flags only the probe carries — RPC mode and no persisted session,
 * what makes it disposable. Everything else a probe session runs under is the
 * worker binding itself, by construction below: a flag added to one side and
 * not the other is #160's defect, a probe proving a session no worker runs in.
 */
export const PI_PROBE_ONLY_FLAGS = Object.freeze(["--mode", "rpc", "--no-session"]);

/**
 * §6.8's trust approval, carried on every pi session (#178).
 *
 * The pre-trust store settles the **project trust** question ahead of the pane,
 * and this flag settles it again on the command line, for the same reason
 * §6.8's permission mode rides both the settings file and the flag: a store the
 * harness keys differently than the factory mirrored is a store that reads back
 * as no decision, and no decision is the dialog. Belt and suspenders over an
 * interstitial, where the cost of the belt is one argument and the cost of the
 * missing suspenders is a pane hung on a keypress nobody will supply.
 *
 * It resolves trust **for the run**, which is exactly the scope a worker
 * session has: an attempt worktree holds the operator's own repository at a
 * pinned commit, so §6.8's "auto-trust weakens nothing" is the same sentence
 * here as it is at the store.
 */
export const PI_TRUST_APPROVAL = Object.freeze(["--approve"]);

/**
 * §6.2's production flag set — what every pi **worker** session is launched
 * with, and therefore what the probe must prove.
 *
 * `--no-skills` is load-bearing isolation, not tidiness: pi's default
 * discovery reaches roots `PI_CODING_AGENT_DIR` does not fence — measured
 * live, a worker session with discovery on loaded four of the operator's
 * personal skills from `~/.agents/skills` while loading none of the pinned 65
 * (#160). Suppressing discovery and passing the pinned roots explicitly is
 * §6.8's "skills reach a worker only from the pinned package root", enforced.
 *
 * `sessionArgs` is §6.8's binding — the posture's tool list and the run's
 * declared extension promotions.
 *
 * @param {ReadonlyArray<string>} skillsRoots the pinned skills roots — never empty
 * @param {ReadonlyArray<string>} [sessionArgs]
 * @returns {string[]}
 */
export function piWorkerArguments(skillsRoots, sessionArgs = []) {
	return [
		"--no-skills",
		...PI_TRUST_APPROVAL,
		...skillsRoots.flatMap((root) => ["--skill", root]),
		...sessionArgs,
	];
}

/**
 * The probe's flag set: the worker binding, plus the probe-only flags, plus
 * **nothing** — composed from `piWorkerArguments` so the two cannot diverge.
 * A probe run under different flags proves a session nobody will launch.
 *
 * @param {ReadonlyArray<string>} skillsRoots
 * @param {ReadonlyArray<string>} [sessionArgs]
 * @returns {string[]}
 */
export function piProbeArguments(skillsRoots, sessionArgs = []) {
	return [...PI_PROBE_ONLY_FLAGS, ...piWorkerArguments(skillsRoots, sessionArgs)];
}

/**
 * The profile's own contribution to a pane's argv — §11.4's `model` plus the
 * optional `thinking`, where omission means "don't pass the flag".
 *
 * Exported because two callers must agree on it **by construction** rather than
 * by care (#164, which is #160 one argument set down): the launch appends it to
 * the worker binding, and §6.2's spelling proof hands the very same argv to the
 * installed binary before a pane depends on it.
 *
 * @param {{ model: string, thinking?: string }} profile
 * @returns {string[]}
 */
export function piProfileArguments(profile) {
	const args = ["--model", profile.model];
	if (profile.thinking !== undefined) args.push("--thinking", profile.thinking);
	return args;
}

/**
 * The argv §6.2's flag-spelling proof runs for one profile: **the argv a pane
 * receives**, plus the probe-only flags and nothing else. The profile's flags
 * sit where the launch puts them — after the worker binding — so what the
 * installed binary parses here is what it will parse there.
 *
 * @param {ReadonlyArray<string>} skillsRoots
 * @param {ReadonlyArray<string>} sessionArgs
 * @param {{ model: string, thinking?: string }} profile
 * @returns {string[]}
 */
export function piSpellingArguments(skillsRoots, sessionArgs, profile) {
	return [...piProbeArguments(skillsRoots, sessionArgs), ...piProfileArguments(profile)];
}

/**
 * One live probe of the pi runtime — role-independent, so the adapter runs it
 * once per pinned revision and proves each role's closure against the same
 * session (§6.2's "one request").
 *
 * @param {object} input
 * @param {ReadonlyArray<string>} input.skillsRoots the handshake's skills-root participants
 * @param {ReadonlyArray<{ name: string, model: string, endpoint?: { url: string } }>} input.profiles
 *   the pi profiles the active routing reaches, which are also what the classes
 *   this probe must observe are derived from (#209)
 * @param {Record<string, number>} input.declaredResources `concurrency.resources`
 * @param {{ env?: object, sessionArgs?: ReadonlyArray<string>, cwd?: string }} [input.session]
 *   §6.8's controller-owned binding: the config-directory variable, the posture's
 *   flags, and the directory a worker pane runs in
 * @param {object} [input.transport] overrides for the real IO, so a test drives
 *   every verdict without a harness on the machine
 * @param {string} [input.binary]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Readonly<object>>} the runtime observation, findings included
 */
export async function probePiRuntime({
	skillsRoots,
	profiles,
	declaredResources,
	session: binding = {},
	transport = {},
	binary = "pi",
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const io = { ...realTransport, ...transport };
	const failures = [];
	const where = { env: binding.env, cwd: binding.cwd };

	const version = await harnessVersion(io, { label: "pi", binary, timeoutMs, where }, failures);
	if (version === null) return observation({ ok: false, version, failures });

	const session = await rpcAnswers(
		io,
		{ binary, skillsRoots, sessionArgs: binding.sessionArgs ?? [], where, timeoutMs },
		failures,
	);
	if (session === null) return observation({ ok: false, version, failures });

	const skillCommands = commandRecords(session.get("get_commands"));
	const models = modelInventory(session.get("get_available_models"));

	for (const profile of profiles) {
		const [provider, ...id] = profile.model.split("/");
		if (!models.some((entry) => entry.provider === provider && entry.id === id.join("/"))) {
			failures.push(
				probeFinding(
					"model-unavailable",
					`Profile "${profile.name}" declares ${profile.model}, and the live pi session's model inventory has no ` +
						`such model. §11.5 re-asserts a declared model against the observed runtime; the fix is to install or ` +
						`enable it in pi (\`pi update\` or the ${provider} provider's config), or to declare a model that exists.`,
					{ profile: profile.name, model: profile.model, class: provider },
				),
			);
		}
	}

	const required = requiredClasses(profiles);
	const classes = {};
	for (const className of [...required.keys()].sort()) {
		classes[className] = await observeClass(io, {
			className,
			...required.get(className),
			models,
			declared: declaredResources[className] ?? null,
			timeoutMs,
			failures,
		});
	}

	return observation({ ok: failures.length === 0, version, failures, skillCommands, models, classes });
}

/**
 * §6.2's flag-spelling proof for the pi runtime: **one disposable session per
 * distinct profile**, over that profile's own launch argv (#164).
 *
 * This is deliberately *not* folded into `probePiRuntime`. That probe is role-
 * and profile-independent and memoized once per pinned revision — §6.2's "one
 * request" — while profiles vary per role *and* per routing rule, so exercising
 * each profile inside it would change the probe's **cardinality** rather than
 * its argv. The two cardinalities stay separate and stated: one probe per
 * revision, one spelling session per distinct profile.
 *
 * The request it asks is `SPELLING_REQUEST` above, with the reasoning beside it.
 *
 * @param {object} input
 * @param {ReadonlyArray<{ name: string, model: string, thinking?: string }>} input.profiles
 *   the distinct pi profiles the active routing can dispatch
 * @param {ReadonlyArray<string>} input.skillsRoots the pinned roots the probe proved
 * @param {{ env?: object, sessionArgs?: ReadonlyArray<string>, cwd?: string }} [input.session]
 * @param {object} [input.transport]
 * @param {string} [input.binary]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Readonly<object>>} `{ kind, binary, checked, findings }`
 */
export async function provePiProfileFlags({
	profiles,
	skillsRoots,
	session: binding = {},
	transport = {},
	binary = "pi",
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const request = SPELLING_REQUEST;

	return proveProfileFlags(
		{ ...realTransport, ...transport },
		{
			kind: "pi",
			label: "pi",
			binary,
			sessions: profiles.map((profile) => ({
				profile,
				flags: flagNames(piProfileArguments(profile)),
				args: piSpellingArguments(skillsRoots, binding.sessionArgs ?? [], profile),
				input: [JSON.stringify(request)],
				answered: (parsed) =>
					parsed?.type === "response" && parsed.command === request.type && parsed.success === true,
			})),
			where: { env: binding.env, cwd: binding.cwd },
			timeoutMs,
		},
	);
}

/**
 * The role-level half of layer 2: is every closure member natively invocable
 * in the probed session, from the pinned root and nowhere else? §6.2 rules the
 * alternatives out by name — no prose hints, no global symlinks, no
 * model-driven package discovery — so a miss here is a miss, never a fallback.
 *
 * The converse is judged too: **no** skill in the session may come from outside
 * the pinned root, whether the closure names it or not.
 *
 * @param {Readonly<object>} probed what `probePiRuntime` observed
 * @param {ReadonlyArray<string>} closure the role's computed closure
 * @param {{ skillsRoots: ReadonlyArray<string> }} pin
 * @returns {ReadonlyArray<object>} findings
 */
export function provePiClosure(probed, closure, { skillsRoots }) {
	const roots = skillsRoots.map((root) => realpathOrNull(root));
	const findings = [];

	// §6.8's limit on capability promotion, enforced rather than promised: a
	// declared extension may add tools and providers, and may not add skills.
	// Every command record in the session is judged, not only the closure's,
	// because a skill the closure never names is exactly the one nobody would
	// notice arriving from outside the pinned revision.
	for (const [name, source] of Object.entries(probed.skillCommands)) {
		if (closure.includes(name)) continue;
		const resolved = source === null ? null : realpathOrNull(source);
		if (resolved !== null && roots.some((root) => root !== null && containsPath(root, resolved))) continue;

		findings.push(
			probeFinding(
				"skill-shadowed",
				`skill:${name} resolved to ${source ?? "(no source path)"}, outside the pinned skills root. Skills reach a ` +
					`worker only from the pinned package: a promoted extension may add tools and providers, never a skill (§6.8).`,
				{ skill: name, source, roots: skillsRoots },
			),
		);
	}

	for (const name of closure) {
		const source = probed.skillCommands[name];
		if (source === undefined) {
			findings.push(
				probeFinding(
					"skill-not-invocable",
					`skill:${name} has no command record in the disposable RPC session over the production flags — native ` +
						`invocation is unprovable, and no degraded prose-loading mode exists (§6.2).`,
					{ skill: name, command: `skill:${name}` },
				),
			);
			continue;
		}

		const resolved = source === null ? null : realpathOrNull(source);
		if (resolved === null || !roots.some((root) => root !== null && containsPath(root, resolved))) {
			findings.push(
				probeFinding(
					"skill-shadowed",
					`skill:${name} resolved to ${source ?? "(no source path)"}, outside the pinned skills root — a shadowed ` +
						`skill is §6.8's one typed failure, and this is the offending source.`,
					{ skill: name, source, roots: skillsRoots },
				),
			);
		}
	}

	return Object.freeze(findings);
}

/**
 * §6.1's adapter for the pi runtime. `preflight` is layer 2, memoized per
 * pinned revision so the disposable session is one session; the lifecycle
 * operations are §6.4–§6.6's, bound to pi's own agent kind.
 *
 * @param {object} context everything `probePiRuntime` takes, minus the closure,
 *   plus the launch defaults (`herdr`, `socket`, `timeoutMs`) when the builder
 *   has them
 * @returns {Readonly<object>} the adapter
 */
export function createPiAdapter(context) {
	const lifecycle = lifecycleOperations({ runtime: "pi", agentKind: "pi" }, context.launch ?? {});
	return createWorkerAdapter({
		kind: "pi",
		operations: {
			preflight: memoizedPreflight({
				kind: "pi",
				probe: () => probePiRuntime(context),
				prove: (runtime, closure) => provePiClosure(runtime, closure, context),
			}),
			// Profile flags are a pi runtime difference and therefore enter through
			// this adapter's launch operation, never through the pipeline composer.
			// The skill flags enter here too, from the same `skillsRoots` the probe
			// proved: the launch and the probe share one binding (#160), and the
			// worker binding plus the profile is everything a pane's argv carries.
			launch: async (attempt) =>
				lifecycle.launch({
					...attempt,
					sessionArgs: [
						...piWorkerArguments(requirePinnedRoots(context.skillsRoots), attempt.sessionArgs ?? []),
						...piProfileArguments(attempt.profile),
					],
					startupTimeoutMs: attempt.profile.startupTimeoutMs ?? null,
				}),
			awaitCompletion: lifecycle.awaitCompletion,
			cancel: lifecycle.cancel,
		},
	});
}

/**
 * A launch with no pinned skills root would start a worker whose `--no-skills`
 * left it nothing to invoke — a session that quietly reads files instead of
 * invoking its closure, which is #160's forbidden outcome. Typed, before a
 * pane exists, so the attempt never spends (§6.2).
 */
function requirePinnedRoots(skillsRoots) {
	if (Array.isArray(skillsRoots) && skillsRoots.length > 0) return skillsRoots;
	throw new FactoryWorkerError(
		"worker-launch-failed",
		"A pi worker launch was asked for with no pinned skills roots, so no skill in its closure could reach the " +
			"session — the worker would run without its discipline rather than fail (§6.2, #160).",
		{ at: "skillsRoots", found: skillsRoots ?? null },
	);
}

// ── The probe's pieces ───────────────────────────────────────────────────────

async function rpcAnswers(io, { binary, skillsRoots, sessionArgs, where, timeoutMs }, failures) {
	let session;
	try {
		session = await io.lineSession({
			binary,
			args: piProbeArguments(skillsRoots, sessionArgs),
			input: RPC_REQUESTS.map((request) => JSON.stringify(request)),
			env: where.env,
			cwd: where.cwd,
			timeoutMs,
		});
	} catch (error) {
		failures.push(unreachableRuntime("pi", binary, error.message));
		return null;
	}

	const answers = new Map();
	for (const line of session.lines) {
		const parsed = parseJson(line);
		if (parsed?.type === "response" && parsed.success === true) answers.set(parsed.command, parsed.data);
	}

	for (const request of RPC_REQUESTS) {
		if (answers.has(request.type)) continue;
		failures.push(
			unreachableRuntime(
				"pi",
				binary,
				session.timedOut
					? `the disposable RPC session did not answer ${request.type} within ${timeoutMs}ms`
					: `the disposable RPC session exited ${session.status} without answering ${request.type}` +
							(session.stderr.trim() === "" ? "" : `: ${session.stderr.trim().split("\n").at(-1)}`),
			),
		);
		return null;
	}

	return answers;
}

function commandRecords(data) {
	const records = {};
	for (const command of data?.commands ?? []) {
		if (command?.source !== "skill" || typeof command.name !== "string") continue;
		if (!command.name.startsWith("skill:")) continue;
		records[command.name.slice("skill:".length)] =
			command.sourceInfo?.path ?? command.sourceInfo?.baseDir ?? null;
	}
	return Object.freeze(records);
}

function modelInventory(data) {
	return Object.freeze(
		(data?.models ?? [])
			.filter((model) => typeof model?.id === "string" && typeof model?.provider === "string")
			.map((model) =>
				Object.freeze({
					id: model.id,
					provider: model.provider,
					endpoint: typeof model.baseUrl === "string" ? model.baseUrl : null,
				}),
			),
	);
}

/**
 * The classes the probe must observe, and what each one is observed **with**.
 *
 * A class name no longer implies a provider (#209), so both come from the
 * profiles rather than from the name: the provider segments say which models in
 * the session's one catalogue belong to the class, and a bound profile's own
 * address is what `/props` is asked of. Derived here, from the same profiles
 * §11.5's model check reads, because a caller-supplied class list would be a
 * second derivation of `resourceClassOf` free to disagree with the loader's.
 *
 * @param {ReadonlyArray<{ name: string, model: string, endpoint?: { url: string } }>} profiles
 * @returns {Map<string, { providers: Set<string>, declaredEndpoint: string | null }>}
 */
function requiredClasses(profiles) {
	const required = new Map();
	for (const profile of profiles) {
		const className = resourceClassOf({ ...profile, kind: "pi" });
		if (!required.has(className)) {
			required.set(className, { providers: new Set(), declaredEndpoint: profile.endpoint?.url ?? null });
		}
		required.get(className).providers.add(providerOf(profile.model));
	}

	return required;
}

/**
 * §9.7's capacity observation for one class: the endpoint the profile bound or,
 * for a class nothing bound, the one pi's inventory names; `max_instances` from
 * that endpoint's own `/props`. A class whose endpoint answers without the
 * router fact — a cloud provider — has nothing to observe and stays
 * declared-only; a class whose endpoint does not answer at all is the named
 * preflight failure, never capacity 0.
 *
 * The inventory is the probe session's single catalogue, so for a bound class it
 * proves the **provider** is installed rather than what that machine holds; the
 * machine itself is what the `/props` call answers for.
 */
async function observeClass(io, { className, providers, declaredEndpoint, models, declared, timeoutMs, failures }) {
	const inventory = models.filter((model) => providers.has(model.provider));
	const record = (fields) =>
		Object.freeze({ class: className, declared, models: Object.freeze(inventory.map((model) => model.id)), ...fields });

	if (inventory.length === 0) {
		failures.push(
			probeFinding(
				"class-unreachable",
				`Resource class "${className}" is required by the active routing, and the live pi session's inventory has ` +
					`no model from ${[...providers].sort().join(", ")}, so there is no endpoint to reach. The fix is to ` +
					`install or enable the provider's models in pi, or to route away from it — continuing as capacity 0 ` +
					`would drain a run that did nothing (§9.7).`,
				{ class: className, endpoint: null },
			),
		);
		return record({ endpoint: null, reachable: false, max_instances: null });
	}

	// A bound endpoint is the address by construction — it is what the class *is*
	// (#209) and what the pane will talk to, so pi's catalogue cannot answer for it.
	const endpoint = declaredEndpoint ?? inventory.find((model) => model.endpoint !== null)?.endpoint ?? null;
	if (endpoint === null) {
		failures.push(
			probeFinding(
				"class-unreachable",
				`Resource class "${className}" names no endpoint in pi's inventory, so its capacity cannot be observed and ` +
					`its reachability cannot be proven (§9.7). The fix is the provider's baseUrl in pi's model catalog.`,
				{ class: className, endpoint: null },
			),
		);
		return record({ endpoint: null, reachable: false, max_instances: null });
	}

	let answer;
	try {
		answer = await io.httpGet(`${new URL(endpoint).origin}/props`, { timeoutMs });
	} catch (error) {
		failures.push(
			probeFinding(
				"class-unreachable",
				`Resource class "${className}" is required and nothing answers at ${endpoint} (${error.message}). Start ` +
					`the model endpoint (or fix the provider's baseUrl), then start the run again — treating this as ` +
					`capacity 0 would produce a green-looking run that did nothing (§9.7).`,
				{ class: className, endpoint },
			),
		);
		return record({ endpoint, reachable: false, max_instances: null });
	}

	// Any HTTP answer proves the endpoint is up. The router fact is optional —
	// a provider without `/props` is a cloud-shaped class, declared-only.
	const props = answer.status >= 200 && answer.status < 300 ? parseJson(answer.body) : null;
	const observed = Number.isInteger(props?.max_instances) ? props.max_instances : null;

	if (observed !== null && declared !== null && declared > observed) {
		failures.push(
			probeFinding(
				"capacity-exceeded",
				`concurrency.resources.${className} declares ${declared} slots while ${endpoint} observes ` +
					`max_instances ${observed}. A silent clamp would run a capacity that does not exist; the declared size ` +
					`must come down to ${observed}, or the endpoint must grow (§9.7).`,
				{ class: className, endpoint, declared, observed },
			),
		);
	}

	return record({ endpoint, reachable: true, max_instances: observed });
}

function observation({ ok, version, failures, skillCommands = {}, models = [], classes = {} }) {
	return Object.freeze({
		kind: "pi",
		ok,
		version,
		failures: Object.freeze([...failures]),
		skillCommands,
		models,
		// Runtime-neutral launch observation: the composer asks one map whatever
		// harness produced it; pi's exact selector resolves to itself.
		resolvedModels: Object.freeze(
			Object.fromEntries(models.map((model) => [`${model.provider}/${model.id}`, `${model.provider}/${model.id}`])),
		),
		classes: Object.freeze(classes),
	});
}

