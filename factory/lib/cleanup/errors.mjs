/**
 * Cleanup refusals (§12.8, §14.25).
 *
 * Every one of them stops the verb before anything is deleted, which is the
 * whole shape of a plan-then-execute pair: the moment cleanup is unsure what it
 * is about to remove, it removes nothing. There is no reason in this list that
 * a flag can turn off — **there is no `--force`** (§14.26).
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const CLEANUP_ERROR_REASONS = Object.freeze([
	/** A `--kind` outside §12.8's whitelist. */
	"cleanup-kind-unknown",
	/**
	 * §14.25: the re-derived plan does not match the digest the operator was
	 * handed, so the world moved between reviewing and executing. **Staleness is
	 * decided by digest equality, never by a clock** — a TTL either expires a
	 * still-correct plan or blesses a stale one (§10.5).
	 */
	"cleanup-plan-stale",
	/** `cleanup-execute` was given no plan digest to check against. */
	"cleanup-digest-required",
	/** Another controller holds the lease `cleanup-execute` must have (§14.25). */
	"cleanup-lease-held",
]);

export class FactoryCleanupError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of CLEANUP_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (at, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!CLEANUP_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown cleanup error reason "${reason}".`);
		}
		this.name = "FactoryCleanupError";
		this.reason = reason;
		this.details = details;
	}
}
