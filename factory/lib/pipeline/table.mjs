import {
	PHASE_HARVEST,
	PHASE_IMPLEMENT,
	PHASE_INTEGRATE,
	PHASE_OUTCOME_DOMAINS,
	PHASE_REVIEW,
	PHASE_VERIFY,
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

/** What the controller does with a resolved (phase, outcome) pair. */
export const ACTIONS = Object.freeze({
	/** On to the next phase (§8.1's order). */
	advance: "advance",
	/**
	 * An agent-borne phase whose attempt came back `completed`: the phase result
	 * is the verdict the worker wrote, which is a different level from the
	 * attempt outcome that carried it (§8.8).
	 */
	verdict: "verdict",
	/**
	 * §8.10: **`wrote-but-hung` is not a failure.** The outbox is valid, so it is
	 * harvested, the agent is stopped as routine shutdown, and the anomaly is
	 * what gets recorded.
	 */
	harvestAnomaly: "harvest-anomaly",
	/** §8.5 tier 1 — a fresh attempt from the prior attempt's tip. */
	repair: "repair",
	/** §8.5 tier 2 — a fresh attempt from the pinned base, work discarded. */
	freshRetry: "fresh-retry",
	/** The same phase again: the automation failed, not the work. */
	retry: "retry",
	/** The ticket execution settles here (§8.9). */
	dispose: "dispose",
	/** §8.10's duplicate-identical row: return the committed result unchanged. */
	idempotentReturn: "idempotent-return",
});

/** §8.6's two counters, and §8.10's fourth column. */
export const BUDGETS = Object.freeze({ repair: "repair", automation: "automation" });

/**
 * §8.5's repair-prompt trust framing, carried on the rows that produce a repair
 * prompt: controller-produced evidence is presented **as fact**, worker-authored
 * text goes in a clearly delimited **untrusted block**. A reviewer whose findings
 * contain an injected directive must not have it promoted into an instruction to
 * a write-capable builder.
 */
export const EVIDENCE_TRUST = Object.freeze({ fact: "fact", untrusted: "untrusted" });

/**
 * §8.10's last four rows, which name no phase. They are in the same table
 * because they are answers to the same question — *given this outcome, what
 * happens* — and a second structure for them is a second place to forget.
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
	retryable = true,
}) =>
	Object.freeze({ phase, outcome, action, to, budget, disposition, reasonClass, fault, exhausted, evidence, retryable });

export const OUTCOME_TABLE = Object.freeze([
	// ── implement: no phase result of its own — its result is its attempt's (§8.1)
	row({ phase: PHASE_IMPLEMENT, outcome: "completed", action: ACTIONS.advance, to: PHASE_HARVEST }),
	row({ phase: PHASE_IMPLEMENT, outcome: "needs-human", action: ACTIONS.dispose }),
	row({
		phase: PHASE_IMPLEMENT,
		outcome: "worker-failed",
		action: ACTIONS.repair,
		budget: BUDGETS.repair,
		evidence: EVIDENCE_TRUST.untrusted,
	}),
	// The three fresh-retry rows below consume the **repair** budget though every
	// one of them is a controller-derived outcome: §8.6 charges the product budget
	// for a worker that failed at its own job, and a worker that wrote nothing
	// readable by the end of its turn did exactly that. Only a pane that died
	// under it, or the automation refusing to run, is the automation's failure.
	row({ phase: PHASE_IMPLEMENT, outcome: "invalid-result", action: ACTIONS.freshRetry, budget: BUDGETS.repair }),
	row({ phase: PHASE_IMPLEMENT, outcome: "no-result", action: ACTIONS.freshRetry, budget: BUDGETS.repair }),
	row({ phase: PHASE_IMPLEMENT, outcome: "timeout", action: ACTIONS.freshRetry, budget: BUDGETS.repair }),
	row({ phase: PHASE_IMPLEMENT, outcome: "wrote-but-hung", action: ACTIONS.harvestAnomaly, to: PHASE_HARVEST }),
	row({ phase: PHASE_IMPLEMENT, outcome: "dead-worker", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_IMPLEMENT, outcome: "automation-failure", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_IMPLEMENT, outcome: "cancelled", action: ACTIONS.dispose, disposition: "released" }),

	// ── harvest (§7.4's builder-fault predicates) ────────────────────────────
	row({ phase: PHASE_HARVEST, outcome: "passed", action: ACTIONS.advance, to: PHASE_VERIFY }),
	row({
		phase: PHASE_HARVEST,
		outcome: "predicate-failed",
		action: ACTIONS.repair,
		budget: BUDGETS.repair,
		evidence: EVIDENCE_TRUST.fact,
	}),

	// ── verify (§8.2) ────────────────────────────────────────────────────────
	// §14.15: a failed verify goes **straight to repair**, so the reviewer only
	// ever sees mechanically-passing code. `passed` is the one row that reaches
	// review, and that is what makes the invariant structural rather than a rule
	// the walk is trusted to follow.
	row({ phase: PHASE_VERIFY, outcome: "passed", action: ACTIONS.advance, to: PHASE_REVIEW }),
	row({
		phase: PHASE_VERIFY,
		outcome: "failed",
		action: ACTIONS.repair,
		budget: BUDGETS.repair,
		evidence: EVIDENCE_TRUST.fact,
	}),
	row({
		phase: PHASE_VERIFY,
		outcome: "unrunnable",
		action: ACTIONS.retry,
		budget: BUDGETS.automation,
		exhausted: Object.freeze({ reasonClass: "check-unrunnable" }),
	}),

	// ── review (§8.4): the three verdict-shaped results, then the attempt-level
	// outcomes a reviewer attempt can end with instead of a verdict. Both levels
	// are here because §8.10 routes both, and they are different levels (§8.8).
	row({ phase: PHASE_REVIEW, outcome: "completed", action: ACTIONS.verdict }),
	row({ phase: PHASE_REVIEW, outcome: "approved", action: ACTIONS.advance, to: PHASE_INTEGRATE }),
	row({
		phase: PHASE_REVIEW,
		outcome: "rejected",
		action: ACTIONS.repair,
		budget: BUDGETS.repair,
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
		action: ACTIONS.dispose,
		reasonClass: "review-mutation",
		retryable: false,
	}),
	row({ phase: PHASE_REVIEW, outcome: "needs-human", action: ACTIONS.dispose }),
	// §8.6: a reviewer attempt that died says nothing about the work, so it
	// charges the **automation** budget — charging the builder would eventually
	// discard good work on an infra flake.
	row({ phase: PHASE_REVIEW, outcome: "worker-failed", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "invalid-result", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "no-result", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "dead-worker", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "timeout", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "automation-failure", action: ACTIONS.retry, budget: BUDGETS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "wrote-but-hung", action: ACTIONS.harvestAnomaly, to: PHASE_REVIEW }),
	row({ phase: PHASE_REVIEW, outcome: "cancelled", action: ACTIONS.dispose, disposition: "released" }),

	// ── integrate (§7.5) ─────────────────────────────────────────────────────
	row({ phase: PHASE_INTEGRATE, outcome: "integrated", action: ACTIONS.dispose, disposition: "published" }),
	/**
	 * §8.10: a rebase conflict consumes a **fresh-retry, not a repair**, because
	 * the prior tip is precisely what conflicts. A second conflict is `failed` /
	 * `rebase-conflict`, and the controller never attempts automatic resolution —
	 * that would put a model inside a controller phase.
	 */
	row({
		phase: PHASE_INTEGRATE,
		outcome: "rebase-conflict",
		action: ACTIONS.freshRetry,
		budget: BUDGETS.repair,
		exhausted: Object.freeze({ reasonClass: "rebase-conflict" }),
	}),
	row({ phase: PHASE_INTEGRATE, outcome: "predicate-failed", action: ACTIONS.dispose, fault: BUDGETS.automation }),
	row({ phase: PHASE_INTEGRATE, outcome: "push-failed", action: ACTIONS.retry, budget: BUDGETS.automation }),

	// ── The four rows that name no phase ─────────────────────────────────────
	row({ phase: TABLE_WIDE, outcome: "repair-budget-exhausted", action: ACTIONS.dispose, reasonClass: "repair-budget-exhausted" }),
	row({
		phase: TABLE_WIDE,
		outcome: "automation-budget-exhausted",
		action: ACTIONS.dispose,
		reasonClass: "automation-budget-exhausted",
	}),
	row({ phase: TABLE_WIDE, outcome: "duplicate-identical", action: ACTIONS.idempotentReturn }),
	row({ phase: TABLE_WIDE, outcome: "duplicate-conflicting", action: ACTIONS.dispose, fault: BUDGETS.automation }),
]);

/** §8.10's four phase-less rows, by name. */
export const TABLE_WIDE_OUTCOMES = Object.freeze(
	OUTCOME_TABLE.filter((entry) => entry.phase === TABLE_WIDE).map((entry) => entry.outcome),
);

const INDEX = new Map(OUTCOME_TABLE.map((entry) => [`${entry.phase} ${entry.outcome}`, entry]));

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
	const found = INDEX.get(`${phase} ${outcome}`);
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
