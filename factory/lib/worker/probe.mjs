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
