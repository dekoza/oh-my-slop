/**
 * The check runner's refusals (§8.2, §8.3).
 *
 * There is deliberately one, because **a check's own outcome is never one of
 * them**: a red suite, a suite that will not start, and a suite that hangs are
 * all *results* the runner classifies and hands back (§8.2's fault attribution),
 * and so is a baseline with no base to run at — §14.14 needs that reported red,
 * not thrown. What is left is a caller asking for something the specification
 * does not offer.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const CHECK_ERROR_REASONS = Object.freeze([
	/**
	 * A selection outside `required | all`. §8.2 rules out per-surface targeting
	 * — "which area did this touch" is exactly the inference that goes wrong
	 * silently — so the selector is closed and a third value is a refusal.
	 */
	"check-selection-unknown",
]);

export class FactoryCheckError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of CHECK_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!CHECK_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown check error reason "${reason}".`);
		}
		this.name = "FactoryCheckError";
		this.reason = reason;
		this.details = details;
	}
}
