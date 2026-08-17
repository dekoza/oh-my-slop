/**
 * What §6.2's live per-runtime probe can find wrong, as data.
 *
 * Findings rather than exceptions, in the handshake's pattern: preflight
 * records them as a red `runtime-probe` check, and the attempt path turns them
 * into the automation failure. The set is closed so a `--json` consumer can
 * branch on a reason.
 */
export const PROBE_FINDING_REASONS = Object.freeze([
	/** The harness itself could not be spoken to at all (§11.7). */
	"runtime-unreachable",
	/**
	 * §6.2: a closure member with no native command record on the production
	 * path. Unprovable native invocation, and there is no degraded
	 * prose-loading mode to fall back to.
	 */
	"skill-not-invocable",
	/**
	 * A command record that exists but resolves outside the pinned skills root —
	 * §6.8's shadowing, observed live rather than statically.
	 */
	"skill-shadowed",
	/**
	 * §6.8's discovery fence, unproven rather than broken: the probe's control
	 * session — the worker binding with the fence taken out — did not register
	 * the canary project skill the probe planted, so the fenced session's silence
	 * is no evidence. A probe that could not have seen the leak proves nothing
	 * about its absence (§6.2).
	 */
	"discovery-fence-unproven",
	/** A declared model the probed runtime's inventory does not carry. */
	"model-unavailable",
	/**
	 * §9.7: a required resource class nothing answers for. Named with the class,
	 * the endpoint, and the fix — never treated as capacity 0 and continued.
	 */
	"class-unreachable",
	/** §9.7: a declared size exceeding an observed `max_instances`, both named. */
	"capacity-exceeded",
	/** §6.3: the built plugin failed strict validation, or could not be built. */
	"plugin-invalid",
	/** §6.2: the expected-vs-actual component diff over `plugin details`. */
	"plugin-component-diff",
	/**
	 * §6.8: the probed session recorded a project the controller had not
	 * pre-trusted. In an interactive pane that project is a trust dialog, and a
	 * pane sitting on one is indistinguishable from a worker thinking.
	 */
	"trust-not-established",
]);

/**
 * @param {string} reason one of PROBE_FINDING_REASONS
 * @param {string} message operator-facing sentence naming what is wrong and the fix
 * @param {Record<string, unknown>} [details] JSON-safe structured fields
 * @returns {Readonly<object>}
 */
export function probeFinding(reason, message, details = {}) {
	if (!PROBE_FINDING_REASONS.includes(reason)) {
		throw new Error(`Unknown probe finding reason "${reason}".`);
	}
	return Object.freeze({ reason, message, ...details });
}

/** §11.7's unprobeable-runtime finding, worded once for every harness. */
export function unreachableRuntime(label, binary, sentence) {
	return probeFinding(
		"runtime-unreachable",
		`The ${label} runtime could not be probed: ${sentence}. §11.7 makes an unprobeable runtime an automation ` +
			`failure before first claim; the fix is a working \`${binary}\` on PATH.`,
		{ binary },
	);
}

/**
 * §11.7's live-probed harness version — the first thing either probe asks,
 * because every later step shells the same binary.
 *
 * @returns {Promise<string | null>} the version, or null with the failure recorded
 */
export async function harnessVersion(io, { label, binary, timeoutMs, where = {} }, failures) {
	try {
		const answer = await io.runCommand(binary, ["--version"], { timeout: timeoutMs, ...runIn(where) });
		if (answer.status === 0) return answer.stdout.trim();
		failures.push(unreachableRuntime(label, binary, `\`${binary} --version\` exited ${answer.status}`));
	} catch (error) {
		failures.push(unreachableRuntime(label, binary, error.message));
	}
	return null;
}

/**
 * §6.8's binding as `child_process` options, with the absent halves dropped.
 *
 * Dropping rather than passing `undefined` is what keeps a probe with no
 * binding — a test's, or a caller that has none — inheriting this process's own
 * environment instead of being handed an empty one.
 *
 * @param {{ env?: object, cwd?: string }} where
 * @returns {{ env?: object, cwd?: string }}
 */
export function runIn({ env, cwd } = {}) {
	return { ...(env === undefined ? {} : { env }), ...(cwd === undefined ? {} : { cwd }) };
}

/** A line of harness output, or null — a probe judges shapes, it never throws on one. */
export function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * The §6.1 preflight operation both runtime adapters share: one probe per
 * pinned revision (§6.2's "one request"), then each role's closure proven
 * against that same observation.
 *
 * @param {{ probe: (packageRev: string) => Promise<object>,
 *           prove: (runtime: object, closure: ReadonlyArray<string>) => ReadonlyArray<object>,
 *           kind: string }} runtime
 * @returns {(role: object, packageRev: string) => Promise<Readonly<object>>}
 */
export function memoizedPreflight({ kind, probe, prove }) {
	let probed = null;

	return async (role, packageRev) => {
		if (probed === null || probed.packageRev !== packageRev) {
			probed = { packageRev, answer: probe(packageRev) };
		}
		const runtime = await probed.answer;
		const findings = runtime.ok ? [...runtime.failures, ...prove(runtime, role.closure ?? [])] : [...runtime.failures];

		return Object.freeze({
			kind,
			role: role.name,
			packageRev,
			ok: findings.length === 0,
			findings: Object.freeze(findings),
			runtime,
		});
	};
}
