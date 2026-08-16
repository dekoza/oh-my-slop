/**
 * Worker-adapter refusals (§6.1, §6.2). Every one of them is an automation
 * failure by classification: the worker never ran, or must not run, because the
 * factory could not prove what it would be running.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const WORKER_ERROR_REASONS = Object.freeze([
	/** A role tuple missing one of §6.1's five slots, or carrying junk in one. */
	"role-invalid",
	/** An adapter constructed without one of the four operations, or with extras. */
	"adapter-invalid",
	/**
	 * §6.8's one predicate, fail closed: a required skill that is shadowed,
	 * duplicated, disabled, or missing. One typed failure for all four, and the
	 * diagnostic names the offending source. (Live-probe misses are findings on
	 * the `runtime-probe` check — `probe.mjs`'s vocabulary — until #107's
	 * attempt path turns them into attempt outcomes.)
	 */
	"skill-conflict",
	/** §6.3's generator refused, or produced a tree strict validation rejects. */
	"plugin-build-failed",
	/**
	 * §11.7: a per-attempt recheck whose recomputed handshake digest differs from
	 * the run's pin. A failure, never a new pin.
	 */
	"handshake-drift",
	/** A recheck asked of a run that never pinned a handshake at preflight. */
	"handshake-unpinned",
	/**
	 * §11.7: the observed resolved model id changed between attempts within one
	 * run — the audited split-brain in slow motion.
	 */
	"model-drift",
	/**
	 * §6.4–§6.6's launch, wait, and cancel are #107's slice. The seam exists and
	 * refuses loudly rather than half-running a worker nothing can harvest.
	 */
	"worker-lifecycle-unbuilt",
	/**
	 * §6.8: a posture nothing dispatches to, or a per-run deny that is not a
	 * permission rule at all. Both are refusals rather than defaults, because the
	 * permissive answer is the one a default would reach for.
	 */
	"permission-invalid",
	/**
	 * §14.17: an override that would re-enable what the deny floor denies. The
	 * floor is never subtractable, so this is a refusal and never a merge.
	 */
	"deny-floor-subtracted",
	/**
	 * §6.8: the controller-owned config environment could not be built, or a
	 * declared promotion — the worker-context file, an extension — is not there.
	 * A worker inheriting the operator's config instead is the failure this
	 * refusal exists to prevent.
	 */
	"config-environment-invalid",
	// §6.8's trust misses are **not** here: an unproven pre-trust is observed by
	// the live probe, so it belongs to `probe.mjs`'s finding vocabulary, exactly
	// as the shadowing predicate's live half does. One reason, one home.
]);

export class FactoryWorkerError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of WORKER_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (at, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!WORKER_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown worker error reason "${reason}".`);
		}
		this.name = "FactoryWorkerError";
		this.reason = reason;
		this.details = details;
	}
}
