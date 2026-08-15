/**
 * Effect refusals (§4.5). Like the store's, every one of them stops the caller:
 * an effect the factory cannot name, cannot probe, or cannot tell apart from a
 * conflicting one is never issued and never settled by reasoning (§14.1).
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const EFFECT_ERROR_REASONS = Object.freeze([
	/** A key segment outside §4.5's grammar — bad phase, charset, or operand. */
	"effect-key-invalid",
	/** An operation the probe catalogue does not declare (§4.5). */
	"effect-kind-unknown",
	/** An effect kind offered for registration with no probe (§14.3). */
	"effect-kind-without-probe",
	/** A read offered as an effect; reads get observation cursors (§4.5). */
	"read-is-not-an-effect",
	/** An actor slot that is neither the controller nor an operator verb (§4.5). */
	"effect-actor-invalid",
	/** A fencing generation that is not a generation at all — a caller's bug. */
	"effect-generation-invalid",
	/** A payload that cannot be canonically serialised, and so cannot be digested. */
	"effect-payload-invalid",
	/** The same key requested or resolved with a different payload (§4.5). */
	"effect-payload-conflict",
	/** A resolution arriving under a superseded fencing generation (§14.5). */
	"effect-superseded-generation",
	/** A resolution for a key that was never requested (§14.1). */
	"effect-unrequested",
]);

export class FactoryEffectError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of EFFECT_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (key, operation, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!EFFECT_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown effect error reason "${reason}".`);
		}
		this.name = "FactoryEffectError";
		this.reason = reason;
		this.details = details;
	}
}
