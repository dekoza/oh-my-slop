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
	/**
	 * #178: the pane was never observed working, so the two silence rows above it
	 * are describing a turn that never happened. A worker sitting on a first-run
	 * interstitial reports `idle` to Herdr — a settled status — and the
	 * fresh-retry rows would then charge the **repair** budget, at seconds per
	 * attempt, for "ended its turn without writing". This is the same fault class
	 * as `dead-worker`: the automation could not get a worker onto the work.
	 */
	row({ phase: PHASE_IMPLEMENT, outcome: "worker-never-started", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_IMPLEMENT, outcome: "cancelled", action: STAGE_ACTIONS.dispose, disposition: "released" }),
	/**
	 * #154: the provider refused the attempt — quota, rate limit, a usage cap —
	 * an observation typed apart from `timeout` and `no-result` (§6.6). The
	 * refusal is the provider's fault, so the ticket goes back to the frontier
	 * **untouched** — no label, no budget — and the time-boxed class memo the
	 * detection recorded is what keeps dispatch from launching into the same
	 * refusal again (§9). A reviewer's attempt is released the same way: the
	 * axis said nothing about the work, and charging the automation budget for
	 * a provider's cap would be the wrong blame with the same answer.
	 */
	row({ phase: PHASE_IMPLEMENT, outcome: "provider-refused", action: STAGE_ACTIONS.reroute }),

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
	/**
	 * §9.5 puts the rebase in this phase, so a conflict ends it here (§20, #113).
	 * Routed exactly as `integrate × rebase-conflict` is, and for the same reason:
	 * the prior tip is precisely what conflicts, so the tier is a **fresh-retry
	 * from the new base tip** rather than a repair, and a second conflict is
	 * `failed` / `rebase-conflict` with no automatic resolution attempted.
	 */
	row({
		phase: PHASE_VERIFY,
		outcome: "rebase-conflict",
		action: STAGE_ACTIONS.freshRetry,
		budget: BUDGET_KINDS.repair,
		exhausted: Object.freeze({ reasonClass: "rebase-conflict" }),
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
	// #178's outcome is reachable from any agent-borne phase, so it is routed for
	// both. The row is written because the table is **total** over its declared
	// domain (§8.10) — not because review misattributes: every silence row here
	// already charges automation, so this one changes nothing but the word an
	// operator reads.
	row({ phase: PHASE_REVIEW, outcome: "worker-never-started", action: STAGE_ACTIONS.retry, budget: BUDGET_KINDS.automation }),
	row({ phase: PHASE_REVIEW, outcome: "wrote-but-hung", action: STAGE_ACTIONS.verdict, anomaly: ANOMALY_WROTE_BUT_HUNG }),
	row({ phase: PHASE_REVIEW, outcome: "cancelled", action: STAGE_ACTIONS.dispose, disposition: "released" }),
	// #154, #155: a reviewer attempt its provider refused is the implement row's
	// twin — budgetless, rerouted onto the axis's own declared order, and
	// released only when that axis has nowhere left to go. The two axes reroute
	// independently, which is why §11.5 declares an order per axis (§8.4).
	row({ phase: PHASE_REVIEW, outcome: "provider-refused", action: STAGE_ACTIONS.reroute }),

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
	/**
	 * §9.5's loop re-rebased onto a base that moved, and the required set came
	 * back red on the result (§20, #113).
	 *
	 * **Why this disposes where `verify × failed` repairs**, since the two are the
	 * same function reporting the same fact about the same kind of commit: what
	 * differs is what has already been spent and what the red result is *about*. A
	 * red verify is the worker's own work failing at its own base, and §8.5's
	 * repair is scoped to exactly that. Here the work passed its verify and **both
	 * review axes** at the base it was built on, and what changed is not the work
	 * but the world it lands in — a repair would restart the whole pipeline, two
	 * model calls included, to answer a question nobody asked the worker. §8.9's
	 * `failed` is "the controller giving up needs an investigation", and deciding
	 * between adapting to the new base and redoing the ticket is one.
	 *
	 * **No budget**, which is what keeps §15's case 10 intact: the loop that
	 * re-rebases spends nothing, and this is the exit from it rather than another
	 * lap. And a **reason class with no fault**, so §14.18 settles it `failed`
	 * while §8.6's "product-level outcomes never trip the breaker" holds by
	 * construction rather than by a rule anyone has to remember.
	 */
	row({ phase: PHASE_INTEGRATE, outcome: "integration-red", action: STAGE_ACTIONS.dispose, reasonClass: "integration-red" }),

	// ── The four rows that name no phase ─────────────────────────────────────
	row({ phase: TABLE_WIDE, outcome: "repair-budget-exhausted", action: STAGE_ACTIONS.dispose, reasonClass: "repair-budget-exhausted" }),
	row({
		phase: TABLE_WIDE,
		outcome: "automation-budget-exhausted",
		action: STAGE_ACTIONS.dispose,
		reasonClass: "automation-budget-exhausted",
	}),
	/**
	 * #155: §9.9's reroute found nowhere left to go — every profile §11.5's order
	 * names for the role belongs to a class §9.8's memo has locked.
	 *
	 * **Phase-less, beside the two budget exhaustions it is shaped like.** All
	 * three say *the run ran out of something this ticket needed*, and none of
	 * them is an outcome any attempt had: this is what the walk answers **instead
	 * of** minting one. It also has to be reachable from `verify` and `integrate`
	 * — §11.5's fresh-retry is routed and both phases route to it — and those have
	 * no worker, so an attempt-level row there would be an outcome with nothing to
	 * belong to (§8.8).
	 *
	 * §9.8's answer holds unchanged: the ticket goes back to the frontier
	 * **untouched** — no label, no budget — and the memo keeps the next claim out
	 * of the exhausted classes until an expiry and a probe open one. Filing it
	 * `failed` would ask a human to investigate a provider's daily cap, and the
	 * investigation would end at "wait". It is a row of its own rather than the
	 * `provider-refused` row's second meaning because §8.9's `released` writes no
	 * comment: the outcome word on the terminal record is the only thing telling
	 * *a provider refused and we moved on* from *we ran out of providers*, and
	 * those are what an operator is choosing between when a ticket comes back
	 * untouched.
	 */
	row({ phase: TABLE_WIDE, outcome: "routes-exhausted", action: STAGE_ACTIONS.dispose, disposition: "released" }),
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
