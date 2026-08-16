import {
	ANOMALY_WROTE_BUT_HUNG,
	BUDGET_KINDS,
	EVIDENCE_TRUST,
	PHASE_HARVEST,
	PHASE_IMPLEMENT,
	PHASE_INTEGRATE,
	PHASE_OUTCOME_DOMAINS,
	PHASE_REVIEW,
	PHASE_VERIFY,
	STAGE_ACTIONS,
} from "../domain/vocabulary.mjs";
import { FactoryPipelineError } from "./errors.mjs";

/**
 * §8.10's mapping table, as **one declared data structure**.
 *
 * It is declared **whole** — the review and integrate rows included, though
 * nothing wires them until #112 and #113 — because the alternative is five
 * tickets each adding the rows it happened to need, and a table assembled that
 * way has no moment at which anyone can ask whether it is total. What a later
 * slice adds is the *wiring* behind a row's action, never a row.
 *
 * **Every cell of §8.10 is a field here, and nothing else is.** The phrases the
 * published table carries in its Action column — "check output presented as
 * fact", "findings in the untrusted block", "from the new base tip", "no
 * retry" — are §8.5's trust framing and §8.10's stated properties, so they are
 * carried as fields rather than dropped into a comment that the code cannot
 * read back.
 *
 * **`paused` and `failed` are never table properties** (§14.18). A row names the
 * *reason class* it files under, and `dispositions.mjs` turns that into a
 * disposition by the rule — so a reason class added later cannot be filed to the
 * wrong disposition by a row that forgot to say. The two dispositions that carry
 * no reason class at all, `published` and `released`, are the row's own.
 */

/**
 * §8.10's last four rows, which name no phase. They are in the same table
 * because they are answers to the same question — *given this outcome, what
 * happens* — and a second structure for them is a second place to forget.
 *
 * It lives here rather than in the vocabulary because it is the table's own
 * shape — the absence of a phase — and never a word any record carries.
 */
export const TABLE_WIDE = null;

const row = ({
	phase,
	outcome,
	action,
	to = null,
	budget = null,
	disposition = null,
	reasonClass = null,
	fault = null,
	exhausted = null,
	evidence = null,
	anomaly = null,
	retryable = true,
}) =>
	Object.freeze({
		phase,
		outcome,
		action,
		to,
		budget,
		disposition,
		reasonClass,
		fault,
		exhausted,
		evidence,
		anomaly,
		retryable,
	});

export const OUTCOME_TABLE = Object.freeze([
	// ── implement: no phase result of its own — its result is its attempt's (§8.1)
	row({ phase: PHASE_IMPLEMENT, outcome: "completed", action: STAGE_ACTIONS.advance, to: PHASE_HARVEST }),
	row({ phase: PHASE_IMPLEMENT, outcome: "needs-human", action: STAGE_ACTIONS.dispose }),
	row({
		phase: PHASE_IMPLEMENT,
		outcome: "worker-failed",
		action: STAGE_ACTIONS.repair,
		budget: BUDGET_KINDS.repair,
		evidence: EVIDENCE_TRUST.untrusted,
	}),
	// The three fresh-retry rows below consume the **repair** budget though every
	// one of them is a controller-derived outcome: §8.6 charges the product budget
	// for a worker that failed at its own job, and a worker that wrote nothing
	// readable by the end of its turn did exactly that. Only a pane that died
	// under it, or the automation refusing to run, is the automation's failure.
	row({ phase: PHASE_IMPLEMENT, outcome: "invalid-result", action: STAGE_ACTIONS.freshRetry, budget: BUDGET_KINDS.repair }),
	row({ phase: PHASE_IMPLEMENT, outcome: "no-result", action: STAGE_ACTIONS.freshRetry, budget: BUDGET_KINDS.repair }),
	row({ phase: PHASE_IMPLEMENT, outcome: "timeout", action: STAGE_ACTIONS.freshRetry, budget: BUDGET_KINDS.repair }),
	row({
		phase: PHASE_IMPLEMENT,
		outcome: "wrote-but-hung",
		action: STAGE_ACTIONS.advance,
		to: PHASE_HARVEST,
		anomaly: ANOMALY_WROTE_BUT_HUNG,
	}),
	row({ phase: PHASE_IMPLEMENT, outcome: "dead-worker", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_IMPLEMENT, outcome: "automation-failure", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_IMPLEMENT, outcome: "cancelled", action: STAGE_ACTIONS.dispose, disposition: "released" }),

	// ── harvest (§7.4's builder-fault predicates) ────────────────────────────
	row({ phase: PHASE_HARVEST, outcome: "passed", action: STAGE_ACTIONS.advance, to: PHASE_VERIFY }),
	row({
		phase: PHASE_HARVEST,
		outcome: "predicate-failed",
		action: STAGE_ACTIONS.repair,
		budget: BUDGET_KINDS.repair,
		evidence: EVIDENCE_TRUST.fact,
	}),

	// ── verify (§8.2) ────────────────────────────────────────────────────────
	// §14.15: a failed verify goes **straight to repair**, so the reviewer only
	// ever sees mechanically-passing code. `passed` is the one row that reaches
	// review, and that is what makes the invariant structural rather than a rule
	// the walk is trusted to follow.
	row({ phase: PHASE_VERIFY, outcome: "passed", action: STAGE_ACTIONS.advance, to: PHASE_REVIEW }),
	row({
		phase: PHASE_VERIFY,
		outcome: "failed",
		action: STAGE_ACTIONS.repair,
		budget: BUDGET_KINDS.repair,
		evidence: EVIDENCE_TRUST.fact,
	}),
	row({
		phase: PHASE_VERIFY,
		outcome: "unrunnable",
		action: STAGE_ACTIONS.retry,
		budget: BUDGET_KINDS.automation,
		exhausted: Object.freeze({ reasonClass: "check-unrunnable" }),
	}),

	// ── review (§8.4): the three verdict-shaped results, then the attempt-level
	// outcomes a reviewer attempt can end with instead of a verdict. Both levels
	// are here because §8.10 routes both, and they are different levels (§8.8).
	row({ phase: PHASE_REVIEW, outcome: "completed", action: STAGE_ACTIONS.verdict }),
	row({ phase: PHASE_REVIEW, outcome: "approved", action: STAGE_ACTIONS.advance, to: PHASE_INTEGRATE }),
	row({
		phase: PHASE_REVIEW,
		outcome: "rejected",
		action: STAGE_ACTIONS.repair,
		budget: BUDGET_KINDS.repair,
		evidence: EVIDENCE_TRUST.untrusted,
	}),
	/**
	 * §8.10's only outcome with **no retry at all**: a read-only role that wrote
	 * has broken its own contract, and retrying it buys a second violation
	 * (§14.19).
	 */
	row({
		phase: PHASE_REVIEW,
		outcome: "mutation-detected",
		action: STAGE_ACTIONS.dispose,
		reasonClass: "review-mutation",
		retryable: false,
	}),
	row({ phase: PHASE_REVIEW, outcome: "needs-human", action: STAGE_ACTIONS.dispose }),
	// §8.6: a reviewer attempt that died says nothing about the work, so it
	// charges the **automation** budget — charging the builder would eventually
	// discard good work on an infra flake.
	row({ phase: PHASE_REVIEW, outcome: "worker-failed", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "invalid-result", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "no-result", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "dead-worker", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "timeout", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "automation-failure", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "wrote-but-hung", action: STAGE_ACTIONS.verdict, anomaly: ANOMALY_WROTE_BUT_HUNG }),
	row({ phase: PHASE_REVIEW, outcome: "cancelled", action: STAGE_ACTIONS.dispose, disposition: "released" }),

	// ── integrate (§7.5) ─────────────────────────────────────────────────────
	row({ phase: PHASE_INTEGRATE, outcome: "integrated", action: STAGE_ACTIONS.dispose, disposition: "published" }),
	/**
	 * §8.10: a rebase conflict consumes a **fresh-retry, not a repair**, because
	 * the prior tip is precisely what conflicts. A second conflict is `failed` /
	 * `rebase-conflict`, and the controller never attempts automatic resolution —
	 * that would put a model inside a controller phase.
	 */
	row({
		phase: PHASE_INTEGRATE,
		outcome: "rebase-conflict",
		action: STAGE_ACTIONS.freshRetry,
		budget: BUDGET_KINDS.repair,
		exhausted: Object.freeze({ reasonClass: "rebase-conflict" }),
	}),
	row({ phase: PHASE_INTEGRATE, outcome: "predicate-failed", action: STAGE_ACTIONS.dispose, fault: BUDGET_KINDS.automation }),
	row({ phase: PHASE_INTEGRATE, outcome: "push-failed", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),

	// ── The four rows that name no phase ─────────────────────────────────────
	row({ phase: TABLE_WIDE, outcome: "repair-budget-exhausted", action: STAGE_ACTIONS.dispose, reasonClass: "repair-budget-exhausted" }),
	row({
		phase: TABLE_WIDE,
		outcome: "automation-budget-exhausted",
		action: STAGE_ACTIONS.dispose,
		reasonClass: "automation-budget-exhausted",
	}),
	row({ phase: TABLE_WIDE, outcome: "duplicate-identical", action: STAGE_ACTIONS.idempotentReturn }),
	row({ phase: TABLE_WIDE, outcome: "duplicate-conflicting", action: STAGE_ACTIONS.dispose, fault: BUDGET_KINDS.automation }),
]);

/** §8.10's four phase-less rows, by name. */
export const TABLE_WIDE_OUTCOMES = Object.freeze(
	OUTCOME_TABLE.filter((entry) => entry.phase === TABLE_WIDE).map((entry) => entry.outcome),
);

/**
 * Phase → outcome → row. Nested rather than keyed on a joined string: a single
 * key would have to spell `TABLE_WIDE`'s `null` as text, and the point of
 * §8.10's phase-less rows is that they belong to no phase — not that they belong
 * to one named "null".
 */
const INDEX = new Map();
for (const entry of OUTCOME_TABLE) {
	if (!INDEX.has(entry.phase)) INDEX.set(entry.phase, new Map());
	INDEX.get(entry.phase).set(entry.outcome, entry);
}

/**
 * The one way to read the table.
 *
 * @param {string | null} phase a §2.2 pipeline phase, or `TABLE_WIDE`
 * @param {string} outcome the attempt outcome or phase result to route
 * @returns {Readonly<object>} the declared row, never a copy
 * @throws {FactoryPipelineError} `outcome-unmapped` — the table is total over
 *   its declared domains, so a miss is a caller asking about a pair that does
 *   not exist rather than a gap to be defaulted through. There is no fallthrough
 *   row on purpose: the plausible default here is "carry on", which is how a
 *   failure becomes a publication.
 */
export function routeOutcome(phase, outcome) {
	const found = INDEX.get(phase)?.get(outcome);
	if (found !== undefined) return found;

	throw new FactoryPipelineError(
		"outcome-unmapped",
		`§8.10 maps no outcome ${JSON.stringify(outcome)} for phase ${JSON.stringify(phase)}; the table is total over ${
			phase === TABLE_WIDE ? "its phase-less rows" : `phase ${phase}'s outcomes`
		}, so this pair was never a possible answer.`,
		{
			at: "table",
			phase,
			outcome,
			domain: phase === TABLE_WIDE ? TABLE_WIDE_OUTCOMES : (PHASE_OUTCOME_DOMAINS[phase] ?? null),
		},
	);
}
