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
	 * §8.10: the table does not hold the answer being asked of it — a
	 * `(phase, outcome)` pair outside its declared domains, or a row asked for a
	 * disposition when its action is not `dispose`. The table is total over those
	 * domains, so either way this names a caller asking a question that was never
	 * possible, and never a gap to be defaulted through.
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
	 * §8.1's pipeline is walked whole, and an executor that cannot answer for its
	 * phase is a composition bug rather than an unbuilt slice. Two shapes of the
	 * same bug: **no executor supplied at all**, and one supplied that answered at
	 * the wrong level — §8.4's review resolving its axes' *attempt* outcomes is
	 * the fan-out's, so an executor handing one back to the walk has crossed §8.8's
	 * two levels. It is a separate reason from `not-yet-implemented` because the
	 * two need opposite things: one waits for a ticket, the other for a line at the
	 * call site — and a slice landing moves a phase from the first to the second.
	 */
	"phase-unwired",
	/**
	 * §14.18: a reason class in neither §8.8 list. The rule maps *classes* to
	 * dispositions, so a class it has never heard of has no disposition — and
	 * guessing one is exactly the accident the rule exists to prevent.
	 */
	"reason-class-unknown",
	/**
	 * §8.10's last row: two different results committed under one semantic key —
	 * `(run, ticket, phase, attempt)`, §2.1's stage identity plus the attempt it
	 * was resolved under. The identical case is idempotent and returns the
	 * committed result; this is the other one, and it routes to `failed` /
	 * automation rather than picking a winner.
	 */
	"stage-result-conflict",
	/**
	 * §8.5: a retry tier asked for without the fact that tier depends on — a
	 * fresh-retry with no routing to consult or no freshly pinned base to branch
	 * from — or a tier that is not one of the two. It is a refusal rather than a
	 * default because every plausible default here is a guess with a defence:
	 * §11.5 makes declaring `freshRetry` mandatory precisely so nothing falls back
	 * to `implement`, and §7.2 pins the base by fetching immediately before the
	 * branch is created rather than by reusing the last one anybody saw.
	 */
	"retry-unplannable",
	/**
	 * §8.6: the retry §8.10's row calls for would spend a budget this ticket
	 * execution has already spent.
	 *
	 * **It is the one refusal in this list that is an answer**, and the walk turns
	 * it straight back into one: `failed` with the controller-derived reason class
	 * §8.8 names, carried on the details so the settlement is read off the refusal
	 * rather than re-derived. It is a throw and not a returned verdict because it
	 * has to cross a seam that has no return channel for it — §8.4's fan-out
	 * decides an axis's retries *inside* the phase executor, and an executor's only
	 * ways out are a phase result and a throw. Making it a result would mean
	 * inventing a `review` outcome for "the automation budget ran out", which is a
	 * budget fact wearing a phase result's clothes.
	 */
	"budget-exhausted",
	/**
	 * §8.4: the fan-out cannot run the review it was asked for — a routing that
	 * names a number of profiles other than one per axis, or an axis attempt whose
	 * §8.10 row is neither a verdict, a disposition, nor a retry. Both are the
	 * shape of the review being wrong rather than a review coming back badly; a
	 * review that comes back badly is `rejected`, which is an answer.
	 */
	"review-unroutable",
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
