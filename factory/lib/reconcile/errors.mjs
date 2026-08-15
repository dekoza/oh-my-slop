/**
 * Reconciliation refusals (§5.3, §5.4).
 *
 * Every one of them stops the caller rather than degrading into a guess: the
 * whole point of this subsystem is that an unresolved effect is settled by
 * re-probing and never by reasoning (§14.1), so a probe answer the engine cannot
 * read is a refusal, not a default.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const RECONCILE_ERROR_REASONS = Object.freeze([
	/** A conclusion outside §5.4's closed four-member set. */
	"conclusion-unknown",
	/** An evidence basis with no entries — refused at construction (§14.2). */
	"evidence-empty",
	/** An evidence source outside §5.4's closed set. */
	"evidence-source-unknown",
	/**
	 * `journal-intent` offered as evidence (§14.2). It gets its own reason
	 * because it is the one non-member the specification names: the journal
	 * records intent and never establishes an external fact.
	 */
	"evidence-journal-intent",
	/** A probe implementation registered against a read §4.5 does not declare. */
	"probe-call-unknown",
	/** A second implementation offered for a probe call that already has one. */
	"probe-already-registered",
	/** A probe answer the engine cannot read as an answer about the world. */
	"probe-answer-invalid",
	/**
	 * A settle-mode reconcile handed a store with no write path. `doctor` opens
	 * the read-only handle, and this is what stops a caller from asking that
	 * handle to settle anything (§14.24).
	 */
	"reconcile-read-only",
	/**
	 * A settle-mode reconcile with no fencing generation to stamp its
	 * resolutions with. The caller's bug, and its own reason: reporting it as a
	 * superseded generation would tell the operator another controller had taken
	 * the repository over (§4.6).
	 */
	"reconcile-generation-required",
]);

export class FactoryReconcileError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of RECONCILE_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!RECONCILE_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown reconcile error reason "${reason}".`);
		}
		this.name = "FactoryReconcileError";
		this.reason = reason;
		this.details = details;
	}
}
