/**
 * Capacity and scheduling refusals (§9).
 *
 * None of these is a config-load failure, and that is why they are not
 * `FactoryConfigError`s: the config is well-formed and the run has started. They
 * are what the scheduler raises **before any work**, against a particular ticket
 * or a particular slot, so the run continues and the report names what it could
 * not do.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const CAPACITY_ERROR_REASONS = Object.freeze([
	/**
	 * §11.5's second-level conflict: one ticket matching two rules for one role.
	 * The loader answers the static half with no ticket in hand; this half needs
	 * one, and there is no positional first-match to fall back on.
	 */
	"routing-ambiguous",
	/**
	 * A class no active-routing profile reaches, asked for a slot. §11.6 makes an
	 * unsized active class a load error, so reaching here means the caller and the
	 * plan disagree about what is in play.
	 */
	"resource-class-unknown",
]);

export class FactoryCapacityError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of CAPACITY_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (ticket, class, role)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!CAPACITY_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown capacity error reason "${reason}".`);
		}
		this.name = "FactoryCapacityError";
		this.reason = reason;
		this.details = details;
	}
}
