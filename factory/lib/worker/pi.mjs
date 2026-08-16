import { createWorkerAdapter, unbuiltLifecycleOperations } from "./adapter.mjs";
import { containsPath, realpathOrNull } from "./closure.mjs";
import { harnessVersion, memoizedPreflight, parseJson, probeFinding, unreachableRuntime } from "./probe.mjs";
import * as realTransport from "./transports.mjs";

/**
 * The pi half of §6.1's adapter: every pi difference — RPC mode, skill flags,
 * provider-derived resource classes — lives here and nowhere else.
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

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * §6.2's production flag set, plus the two flags that make the session
 * disposable: RPC mode and no persisted session.
 *
 * @param {ReadonlyArray<string>} skillsRoots
 * @returns {string[]}
 */
export function piProbeArguments(skillsRoots) {
	return ["--mode", "rpc", "--no-session", "--no-skills", ...skillsRoots.flatMap((root) => ["--skill", root])];
}

/**
 * One live probe of the pi runtime — role-independent, so the adapter runs it
 * once per pinned revision and proves each role's closure against the same
 * session (§6.2's "one request").
 *
 * @param {object} input
 * @param {ReadonlyArray<string>} input.skillsRoots the handshake's skills-root participants
 * @param {ReadonlyArray<{ name: string, model: string }>} input.profiles the pi
 *   profiles the active routing reaches
 * @param {Record<string, number>} input.declaredResources `concurrency.resources`
 * @param {ReadonlyArray<string>} input.requiredClasses the pi classes those profiles derive
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
	requiredClasses,
	transport = {},
	binary = "pi",
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const io = { ...realTransport, ...transport };
	const failures = [];

	const version = await harnessVersion(io, { label: "pi", binary, timeoutMs }, failures);
	if (version === null) return observation({ ok: false, version, failures });

	const session = await rpcAnswers(io, { binary, skillsRoots, timeoutMs }, failures);
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

	const classes = {};
	for (const className of [...requiredClasses].sort()) {
		classes[className] = await observeClass(io, {
			className,
			models,
			declared: declaredResources[className] ?? null,
			timeoutMs,
			failures,
		});
	}

	return observation({ ok: failures.length === 0, version, failures, skillCommands, models, classes });
}

/**
 * The role-level half of layer 2: is every closure member natively invocable
 * in the probed session, from the pinned root and nowhere else? §6.2 rules the
 * alternatives out by name — no prose hints, no global symlinks, no
 * model-driven package discovery — so a miss here is a miss, never a fallback.
 *
 * @param {Readonly<object>} probed what `probePiRuntime` observed
 * @param {ReadonlyArray<string>} closure the role's computed closure
 * @param {{ skillsRoots: ReadonlyArray<string> }} pin
 * @returns {ReadonlyArray<object>} findings
 */
export function provePiClosure(probed, closure, { skillsRoots }) {
	const roots = skillsRoots.map((root) => realpathOrNull(root));
	const findings = [];

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
 * operations are #107's and refuse loudly until it lands.
 *
 * @param {object} context everything `probePiRuntime` takes, minus the closure
 * @returns {Readonly<object>} the adapter
 */
export function createPiAdapter(context) {
	return createWorkerAdapter({
		kind: "pi",
		operations: {
			preflight: memoizedPreflight({
				kind: "pi",
				probe: () => probePiRuntime(context),
				prove: (runtime, closure) => provePiClosure(runtime, closure, context),
			}),
			...unbuiltLifecycleOperations("pi"),
		},
	});
}

// ── The probe's pieces ───────────────────────────────────────────────────────

async function rpcAnswers(io, { binary, skillsRoots, timeoutMs }, failures) {
	let session;
	try {
		session = await io.lineSession({
			binary,
			args: piProbeArguments(skillsRoots),
			input: RPC_REQUESTS.map((request) => JSON.stringify(request)),
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
 * §9.7's capacity observation for one class: the endpoint from the inventory,
 * `max_instances` from the endpoint's own `/props`. A class whose endpoint
 * answers without the router fact — a cloud provider — has nothing to observe
 * and stays declared-only; a class whose endpoint does not answer at all is
 * the named preflight failure, never capacity 0.
 */
async function observeClass(io, { className, models, declared, timeoutMs, failures }) {
	const inventory = models.filter((model) => model.provider === className);
	const record = (fields) =>
		Object.freeze({ class: className, declared, models: Object.freeze(inventory.map((model) => model.id)), ...fields });

	if (inventory.length === 0) {
		failures.push(
			probeFinding(
				"class-unreachable",
				`Resource class "${className}" is required by the active routing, and the live pi session's inventory has ` +
					`no ${className}/… model, so there is no endpoint to reach. The fix is to install or enable the ` +
					`provider's models in pi, or to route away from it — continuing as capacity 0 would drain a run that did ` +
					`nothing (§9.7).`,
				{ class: className, endpoint: null },
			),
		);
		return record({ endpoint: null, reachable: false, max_instances: null });
	}

	const endpoint = inventory.find((model) => model.endpoint !== null)?.endpoint ?? null;
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
		classes: Object.freeze(classes),
	});
}

