/**
 * Run refusals (§3.1, §10.4). Every one of them happens **before** a run exists
 * or **instead of** starting a second one, so none of them is an end reason:
 * §10.3's seven describe runs that ran, and a refusal here means none did.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const RUN_ERROR_REASONS = Object.freeze([
	/** No scope on the line, and no orphaned run to re-enter (§3.1, §10.4). */
	"scope-required",
	/** A scope argument that is not a tracker issue number (§3.1). */
	"scope-invalid",
	/**
	 * A scope offered to a run that already has one. Membership is immutable for
	 * a run's life (§3.1), so widening it is a new run's job, never this one's.
	 */
	"scope-immutable",
	/**
	 * A live run whose scope does not contain the tickets asked for (§10.4). The
	 * refusal names the live run, because "start refused" without it leaves the
	 * operator with nothing to look at.
	 */
	"run-out-of-scope",
	/**
	 * Membership that cannot be decided from durable state alone — a ticket
	 * offered against a live parent-scoped run, whose `Part of #N` contract is a
	 * tracker read. Fail closed: §10.4's answer for a member it cannot place is
	 * the refusal, never the optimistic "it is probably in scope".
	 */
	"scope-unresolvable",
	/**
	 * A parent-scoped selector that resolved to **no member** (#181). §3.1's
	 * membership is the literal first body line `Part of #N` on label-found
	 * candidates, and a parent nothing declares is a scope a run could only
	 * report as drained — the plausible zero §11.2 refuses everywhere else. A
	 * parent whose members are all closed is not empty: that scope drains.
	 */
	"scope-empty",
]);

/**
 * Which refusals are the operator's *line* being wrong rather than the
 * repository's *state* being somebody else's.
 *
 * §10.3 reserves exit `1` for usage and config-load failure — both of which
 * happen before a run exists and therefore have no end reason — while a refusal
 * about state that belongs to another controller sits deliberately outside the
 * end-reason range. The split lives here, beside the closed set it splits, so a
 * reason added later is classified where it is declared rather than by whichever
 * call site happens to notice.
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function isUsageRefusal(reason) {
	return reason === "scope-required" || reason === "scope-invalid";
}

export class FactoryRunError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of RUN_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (run, scope, expected)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!RUN_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown run error reason "${reason}".`);
		}
		this.name = "FactoryRunError";
		this.reason = reason;
		this.details = details;
	}
}
