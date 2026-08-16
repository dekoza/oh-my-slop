/**
 * Stage-machine refusals (§8.10).
 *
 * **A phase result is a value, never a throw.** `failed`, `predicate-failed`,
 * `rejected` and the rest are answers the table routes, and raising on them
 * would make the pipeline's ordinary business indistinguishable from its
 * breakage. What is here is the set of things that mean *the machine cannot
 * answer at all*: a pair the table does not map, a row whose behaviour this
 * package has not built, a reason class nothing can file, and two results
 * disagreeing under one semantic key.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const PIPELINE_ERROR_REASONS = Object.freeze([
	/**
	 * §8.10: a `(phase, outcome)` pair outside the table's declared domains. The
	 * table is total, so this names a caller asking a question that was never
	 * possible — never a gap to be defaulted through.
	 */
	"outcome-unmapped",
	/**
	 * A row the table declares and this package does not yet wire. It is a typed
	 * refusal rather than a fallthrough because the plausible fallthrough — carry
	 * on to the next phase — is how an unbuilt repair tier turns a failing attempt
	 * into a publication. The details name the ticket that wires it and the § it
	 * comes from, the way every other unbuilt seam in this package does.
	 */
	"not-yet-implemented",
	/**
	 * §14.18: a reason class in neither §8.8 list. The rule maps *classes* to
	 * dispositions, so a class it has never heard of has no disposition — and
	 * guessing one is exactly the accident the rule exists to prevent.
	 */
	"reason-class-unknown",
	/**
	 * §8.10's last row: two different results committed under one semantic key —
	 * `(run, ticket, phase)`, §2.1's stage identity. The identical case is
	 * idempotent and returns the committed result; this is the other one, and it
	 * routes to `failed` / automation rather than picking a winner.
	 */
	"stage-result-conflict",
]);

export class FactoryPipelineError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of PIPELINE_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (at, phase, outcome)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!PIPELINE_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown pipeline error reason "${reason}".`);
		}
		this.name = "FactoryPipelineError";
		this.reason = reason;
		this.details = details;
	}
}
