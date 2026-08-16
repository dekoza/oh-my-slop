import { BUDGET_KINDS, PHASE_REVIEW, STAGE_ACTIONS } from "../domain/vocabulary.mjs";
import { runStream } from "../state/events.mjs";
import { dispositionForReasonClass } from "./dispositions.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { routeOutcome } from "./table.mjs";

/**
 * §8.6's budgets: **counted per ticket, never reset within a run.**
 *
 * **Nothing here increments.** The spend is a *count* of the stage resolutions
 * that charged each budget, read back from the journal — so there is no counter
 * to keep in step with the attempts it counts, and §8.6's stated failure mode,
 * `job-pipeline`'s `replanCount` incremented forever and compared to nothing, is
 * not something this module can express. Every read is a count and a bound in
 * one expression (§14 has no number for it; §8.6 states it outright).
 *
 * Deriving rather than carrying also settles the re-entry question for free. A
 * controller that died between resolving a failing stage and minting the attempt
 * its tier called for reads the same count back on restart, grants the same
 * retry, and finds the attempt already minted — the spend does not move, because
 * the record it is derived from did not.
 */

/**
 * §8.10's Action column, mapped onto §11.6's `budgets` keys.
 *
 * Three actions charge, and each charges exactly one declared number. The map is
 * the whole relationship between the table and the config block, spelled once:
 * a fourth retry action would have to name the budget it spends here or spend
 * nothing at all, which is the property that makes an unbounded retry
 * unconstructible rather than merely unwritten.
 *
 * §8.10's fourth column (`row.budget`, a `BUDGET_KINDS` member) is coarser — it
 * says *product* or *automation*, which is what §8.6's "automation failures
 * never consume the product budget" is about. **Which** product number a tier
 * spends is the tier's own, and §11.6 declares the two separately because §8.6
 * grants them separately: *1 repair + 1 fresh-retry*.
 */
export const BUDGET_KEY_FOR_ACTION = Object.freeze({
	[STAGE_ACTIONS.repair]: "repair",
	[STAGE_ACTIONS.freshRetry]: "freshRetry",
	[STAGE_ACTIONS.retry]: "automation",
});

/** The three declared numbers, in one order, so a spend and a bound line up. */
export const BUDGET_KEYS = Object.freeze(Object.values(BUDGET_KEY_FOR_ACTION));

/**
 * What this ticket execution has spent, by §11.6's key.
 *
 * The unit is a **stage resolution**, not an attempt: §8.10's fourth column is a
 * property of the resolution that routed to a tier, and an attempt that a tier
 * never got to mint — a controller that died first — has spent nothing. Reading
 * the resolutions rather than the attempts is also what keeps a reviewer axis's
 * retries on the automation budget without the review fan-out having to report
 * them separately (§8.4, §8.6).
 *
 * Ordering does not matter to a count, but the read is the journal's own
 * sequence anyway (§14.37): the walk that wrote these may have been a previous
 * controller's, and a clock sort would put a polled fact ahead of the attempt
 * that explains it.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number }} where
 * @returns {Readonly<{ repair: number, freshRetry: number, automation: number }>}
 */
export function budgetSpend(store, { run, ticket }) {
	const spend = Object.fromEntries(BUDGET_KEYS.map((key) => [key, 0]));

	for (const record of store.readEvents({ stream: runStream(run), kind: "stage.resolved" })) {
		if (record.ticket !== ticket) continue;
		const key = BUDGET_KEY_FOR_ACTION[record.payload.action];
		if (key !== undefined) spend[key] += 1;
	}

	return Object.freeze(spend);
}

/**
 * Grant the retry §8.10's row calls for, or refuse it — **as one count compared
 * to one bound**.
 *
 * It is asked **after** the failing stage is resolved, which is what makes the
 * comparison `spent <= declared` rather than `spent < declared`: the resolution
 * that routed here is itself the charge, so the first failure under a budget of
 * 1 reads a spend of 1 and is granted, and the second reads 2 and is not. Asking
 * before the resolution would need a counter to remember the charge across the
 * append, which is the thing this module exists not to have.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {Readonly<{ repair: number, freshRetry: number, automation: number }>} context.budgets
 *   §11.6's validated block
 * @param {Readonly<object>} context.row §8.10's row whose action is being taken
 * @returns {Readonly<{ key: string, kind: string, spent: number, declared: number }>}
 * @throws {FactoryPipelineError} `budget-exhausted` — carrying §8.8's exhaustion
 *   on its details, so the caller settles the ticket execution from the refusal
 *   rather than re-deriving it · `outcome-unmapped` · `retry-unplannable`
 */
export function requireBudget(store, { run, ticket, budgets, row }) {
	const key = chargedKey(row);
	const declared = budgets?.[key];
	if (!Number.isInteger(declared)) {
		throw new FactoryPipelineError(
			"retry-unplannable",
			`§11.6 declares budgets.${key} as an integer, and this caller passed ${JSON.stringify(declared ?? null)}. A ` +
				"retry granted against a number nobody declared is exactly §8.6's foreclosed counter: incremented forever " +
				"and compared to nothing.",
			{ at: "budget", key, found: declared ?? null },
		);
	}

	const spent = budgetSpend(store, { run, ticket })[key];
	if (spent <= declared) return Object.freeze({ key, kind: row.budget, spent, declared });

	const exhausted = exhaustionOf(row);
	throw new FactoryPipelineError(
		"budget-exhausted",
		`Ticket ${ticket} has charged budgets.${key} ${spent} times against the ${declared} §11.6 declares, so §8.10 ` +
			`settles it as ${exhausted.disposition} / ${exhausted.reason_class} (§8.6, §8.8). The budget is counted per ` +
			"ticket and never reset within a run; it resets between runs, and nothing here re-arms it.",
		{ at: "budget", run, ticket, key, spent, declared, ...exhausted },
	);
}

/**
 * §8.8's exhaustion for a row: **the disposition a spent budget settles into.**
 *
 * Two of §8.10's rows name their own class — `verify × unrunnable` becomes
 * `check-unrunnable`, `integrate × rebase-conflict` becomes `rebase-conflict` —
 * and the rest fall to the phase-less row for the budget they charged. Reading
 * the override off `row.exhausted` rather than listing the two here is what
 * keeps §8.10 the one place either is declared.
 *
 * **The fault is the budget kind that ran out**, and it is the field §8.6's
 * circuit breaker reads: a ticket execution that exhausted the *product* budget
 * is a verdict about the work — five of those is a productive run — while one
 * that exhausted the *automation* budget is a broken host. Deriving the breaker
 * from the class list instead would make every class added later a silent vote
 * on whether the run should stop.
 *
 * @param {Readonly<object>} row §8.10's row
 * @returns {Readonly<{ outcome: string, disposition: string, reason_class: string, fault: string }>}
 * @throws {FactoryPipelineError} `outcome-unmapped`
 */
export function exhaustionOf(row) {
	const kind = row?.budget;
	if (!Object.hasOwn(EXHAUSTED_OUTCOMES, kind ?? "")) {
		throw unbudgeted(row, "consumes no budget, so there is none to exhaust");
	}

	const outcome = EXHAUSTED_OUTCOMES[kind];
	const reasonClass = row.exhausted?.reasonClass ?? outcome;

	return Object.freeze({
		outcome,
		// §14.18's rule, from its one home: a controller-derived class fails. Every
		// class reachable here is controller-derived by construction — a worker
		// cannot see a counter, let alone claim it ran out (§6.6, §8.8).
		disposition: dispositionForReasonClass(reasonClass),
		reason_class: reasonClass,
		fault: kind,
	});
}

/**
 * §8.4's `automationRetry` seam, backed by this module.
 *
 * The fan-out decides an axis's retries itself — it is the only thing that knows
 * an axis attempt from a builder's — but **it does not get its own budget.** The
 * seam exists so the fan-out can ask, and this is the answer, from the same
 * count `walkStages` reads: an axis's retries and a builder's are one ticket
 * execution's automation spend, and two places counting it would eventually
 * grant a ticket more retries than either thought it had.
 *
 * It refuses by throwing, which is the seam's contract (§8.4): the fan-out does
 * not branch on a return value, and the walk turns the refusal into §8.6's
 * disposition wherever it surfaces from.
 *
 * @param {object} store an open store
 * @param {{ run: string, ticket: number, budgets: Readonly<object> }} context
 * @returns {(request: { outcome: string }) => Promise<void>}
 */
export function automationRetryFor(store, { run, ticket, budgets }) {
	return async ({ outcome }) => {
		// §8.10's row, re-read from the outcome rather than taken off the request:
		// the seam is handed a budget *kind*, and the exhaustion a refusal has to
		// carry is the row's own — `review` has no `exhausted` override today, and
		// a seam that could not see one would silently outrank the table the day it
		// grows one.
		requireBudget(store, { run, ticket, budgets, row: routeOutcome(PHASE_REVIEW, outcome) });
	};
}

/** §8.10's two phase-less exhaustion rows, by the budget kind each answers for. */
const EXHAUSTED_OUTCOMES = Object.freeze({
	[BUDGET_KINDS.repair]: "repair-budget-exhausted",
	[BUDGET_KINDS.automation]: "automation-budget-exhausted",
});

/** Which declared number this row's action spends. */
function chargedKey(row) {
	const key = BUDGET_KEY_FOR_ACTION[row?.action];
	if (key === undefined) {
		throw unbudgeted(
			row,
			`is not one of the three actions that spend (${Object.keys(BUDGET_KEY_FOR_ACTION).join(", ")})`,
		);
	}

	return key;
}

/**
 * A row asked about a budget it does not have. `outcome-unmapped` for the same
 * reason `dispositionOf` raises it on a non-`dispose` row: the table is total
 * over its declared domains, so this is a caller asking a question that was
 * never possible rather than a gap to default through.
 */
function unbudgeted(row, complaint) {
	return new FactoryPipelineError(
		"outcome-unmapped",
		`§8.10 routes ${row?.phase ?? "no phase"} × ${row?.outcome} to ${row?.action}, which ${complaint}.`,
		{ at: "budget", phase: row?.phase ?? null, outcome: row?.outcome ?? null, action: row?.action ?? null },
	);
}
