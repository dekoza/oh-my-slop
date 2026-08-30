import test from "node:test";
import assert from "node:assert/strict";

import { validateBudgets } from "../../factory/lib/config/defaults.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { CONTROLLER_DERIVED_REASON_CLASSES } from "../../factory/lib/domain/vocabulary.mjs";
import {
	BUDGET_KEYS,
	BUDGET_KEY_FOR_ACTION,
	budgetSpend,
	exhaustionOf,
	requireBudget,
	reviewAutomationRetry,
} from "../../factory/lib/pipeline/budgets.mjs";
import { dispositionForReasonClass } from "../../factory/lib/pipeline/dispositions.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { OUTCOME_TABLE, routeOutcome } from "../../factory/lib/pipeline/table.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import { FIXED_NOW, attemptLaunched, manualTimers, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §8.6's budgets, **counted per ticket and never reset within a run**.
 *
 * Nothing here increments. The spend is a count of the stage resolutions that
 * charged each budget, read back from the journal in sequence order — which is
 * what makes it survive a controller crash without a counter to keep in step,
 * and what makes §8.6's `replanCount` failure mode unexpressible rather than
 * merely avoided.
 */

/** A store with a run, a hold, and one launched attempt. */
async function executing(t, { ticket = 42 } = {}) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const opened = runStarted();

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(opened.run);
	store.append(attemptLaunched(opened.run, ticket, 1));

	const run = opened.run;
	const minted = new Set([`${run}-t${ticket}-a1`]);
	return {
		store,
		run,
		ticket,
		/** Resolve one stage, as the walk would, under an attempt of its own. */
		charge: (phase, outcome, { ticket: on = ticket, attempt = 1 } = {}) => {
			const id = `${run}-t${on}-a${attempt}`;
			if (!minted.has(id)) {
				store.append(attemptLaunched(run, on, attempt));
				minted.add(id);
			}

			return resolveStage(store, {
				hold,
				run,
				ticket: on,
				phase,
				attempt: id,
				outcome,
				actor: "controller",
				at: FIXED_NOW,
			});
		},
	};
}

test("a ticket execution that has resolved nothing has spent nothing", async (t) => {
	const { store, run, ticket } = await executing(t);

	assert.deepEqual({ ...budgetSpend(store, { run, ticket }) }, { repair: 0, freshRetry: 0, automation: 0 });
});

test("a stage §8.10 routes to repair charges the repair budget", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("verify", "failed");

	assert.deepEqual({ ...budgetSpend(store, { run, ticket }) }, { repair: 1, freshRetry: 0, automation: 0 });
});

test("§8.6: an automation failure never consumes the product budget", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("implement", "dead-worker");
	charge("verify", "unrunnable", { attempt: 2 });

	assert.deepEqual({ ...budgetSpend(store, { run, ticket }) }, { repair: 0, freshRetry: 0, automation: 2 });
});

test("§8.6: a reviewer attempt that failed charges the automation budget, not the builder's", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	// §8.4's fan-out resolves each axis attempt as a `review` stage of its own,
	// so a reviewer that crashed reaches this count exactly as a dead builder
	// does — and charging the builder would discard good work on an infra flake.
	charge("review", "dead-worker", { attempt: 2 });
	charge("review", "worker-failed", { attempt: 3 });

	assert.deepEqual({ ...budgetSpend(store, { run, ticket }) }, { repair: 0, freshRetry: 0, automation: 2 });
});

test("§8.6: the two product tiers are granted separately, so they are counted separately", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("verify", "failed");
	charge("implement", "no-result", { attempt: 2 });

	assert.deepEqual({ ...budgetSpend(store, { run, ticket }) }, { repair: 1, freshRetry: 1, automation: 0 });
});

test("§8.6: the spend is per ticket, so one ticket's failures are not another's", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("verify", "failed");
	charge("verify", "failed", { ticket: 43 });
	charge("verify", "failed", { ticket: 43, attempt: 2 });

	assert.equal(budgetSpend(store, { run, ticket }).repair, 1);
	assert.equal(budgetSpend(store, { run, ticket: 43 }).repair, 2);
});

test("§8.6: an advancing stage charges nothing — only a retry action spends", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("implement", "completed");
	charge("harvest", "passed");

	assert.deepEqual({ ...budgetSpend(store, { run, ticket }) }, { repair: 0, freshRetry: 0, automation: 0 });
});

/** §11.6's declared numbers at their documented defaults. */
const DEFAULTS = Object.freeze({ repair: 1, freshRetry: 1, automation: 1 });

function refusal(fn) {
	try {
		fn();
	} catch (error) {
		return error;
	}

	return assert.fail("expected the budget to refuse");
}

test("the first repair is granted: one resolution charged, one declared", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	const resolved = charge("verify", "failed");
	const granted = requireBudget(store, { run, ticket, budgets: DEFAULTS, row: resolved.row });

	assert.equal(granted.key, "repair");
	assert.equal(granted.spent, 1);
	assert.equal(granted.declared, 1);
});

test("the second repair is refused: the budget is never reset within a run", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("verify", "failed");
	const second = charge("verify", "failed", { attempt: 2 });

	const error = refusal(() => requireBudget(store, { run, ticket, budgets: DEFAULTS, row: second.row }));
	assert.equal(error.reason, "budget-exhausted");
	assert.equal(error.details.key, "repair");
	assert.equal(error.details.spent, 2);
	assert.equal(error.details.declared, 1);
});

test("§8.6: a declared budget of 2 grants the second repair and refuses the third", async (t) => {
	const { store, run, ticket, charge } = await executing(t);
	const budgets = { ...DEFAULTS, repair: 2 };

	charge("verify", "failed");
	const second = charge("verify", "failed", { attempt: 2 });
	assert.equal(requireBudget(store, { run, ticket, budgets, row: second.row }).spent, 2);

	const third = charge("verify", "failed", { attempt: 3 });
	assert.equal(refusal(() => requireBudget(store, { run, ticket, budgets, row: third.row })).reason, "budget-exhausted");
});

test("§8.6: automation failures interleaved among repairs do not exhaust the product budget", async (t) => {
	const { store, run, ticket, charge } = await executing(t);

	charge("implement", "dead-worker");
	charge("implement", "automation-failure", { attempt: 2 });
	const repair = charge("verify", "failed", { attempt: 3 });

	assert.equal(requireBudget(store, { run, ticket, budgets: DEFAULTS, row: repair.row }).spent, 1);
});

test("§8.8: an exhausted product budget fails with `repair-budget-exhausted`", () => {
	assert.deepEqual({ ...exhaustionOf(routeOutcome("verify", "failed")) }, {
		outcome: "repair-budget-exhausted",
		disposition: "failed",
		reason_class: "repair-budget-exhausted",
		fault: "repair",
	});
});

test("§8.8: an exhausted automation budget fails with `automation-budget-exhausted`", () => {
	assert.deepEqual({ ...exhaustionOf(routeOutcome("implement", "dead-worker")) }, {
		outcome: "automation-budget-exhausted",
		disposition: "failed",
		reason_class: "automation-budget-exhausted",
		fault: "automation",
	});
});

test("§8.10: a row naming its own exhausted class keeps that class, and the fault it charged", () => {
	// "verify → unrunnable → retry; exhausted ⇒ `failed` / `check-unrunnable`".
	const unrunnable = exhaustionOf(routeOutcome("verify", "unrunnable"));
	assert.equal(unrunnable.reason_class, "check-unrunnable");
	assert.equal(unrunnable.fault, "automation");

	// #194: "a third conflict is `failed` / `rebase-conflict`" — the row taken
	// once the rebase-repair is spent is the fresh-retry, so the fault is the
	// product's and the breaker never sees it.
	const conflict = exhaustionOf(routeOutcome("integrate", "rebase-conflict").thereafter);
	assert.equal(conflict.reason_class, "rebase-conflict");
	assert.equal(conflict.fault, "repair");
});

test("a row that charges no budget cannot be asked for one", () => {
	assert.equal(refusal(() => exhaustionOf(routeOutcome("implement", "completed"))).reason, "outcome-unmapped");
	// #194: the rebase-repair charges nothing, so it has nothing to exhaust — its
	// bound is the `thereafter` row, and asking it for a budget is the same
	// question asked of a row that never retries.
	assert.equal(refusal(() => exhaustionOf(routeOutcome("verify", "rebase-conflict"))).reason, "outcome-unmapped");
});

// ── §8.6: no counter exists that is not compared to a bound ──────────────────

test("§8.10: an action that retries and a row that names a budget are the same set of rows", () => {
	const spends = OUTCOME_TABLE.filter((row) => Object.hasOwn(BUDGET_KEY_FOR_ACTION, row.action));
	const budgeted = OUTCOME_TABLE.filter((row) => row.budget !== null);

	// Both directions, because both are the same defect wearing different
	// clothes: a retry action with no budget column is a retry nothing bounds,
	// and a budget column on a row that never retries is a bound nothing reads.
	assert.deepEqual(spends, budgeted);
	assert.ok(spends.length > 0, "the table declares retries at all");
});

test("§11.6: every budget an action can charge is a number the loader declares", () => {
	// The loader's own answer with nothing declared, which is §11.6's defaults.
	const declared = Object.keys(validateBudgets(undefined, ".pi/factory.json"));

	for (const key of BUDGET_KEYS) assert.ok(declared.includes(key), `budgets.${key} is spent but never declared`);
});

test("§8.6: the breaker's threshold is declared in the same block and charged by nothing", () => {
	const declared = Object.keys(validateBudgets(undefined, ".pi/factory.json"));

	// It is a *threshold*, not an allowance: N counts ticket executions, and no
	// §8.10 action spends it. A row that charged it would be a retry bounded by
	// how many other tickets had failed, which is not a thing.
	assert.ok(declared.includes("circuitBreaker"));
	assert.equal(BUDGET_KEYS.includes("circuitBreaker"), false);
	assert.equal(
		OUTCOME_TABLE.some((row) => BUDGET_KEY_FOR_ACTION[row.action] === "circuitBreaker"),
		false,
	);
});

test("§8.6: the tree holds no retry counter — the legacy shape is not reintroduced", () => {
	// `job-pipeline`'s `replanCount` was incremented forever and compared to
	// nothing, and §8.6 names it as the failure mode being foreclosed. This is
	// the same shape of grep the journal's no-mid-stream-delete invariant uses:
	// the property is worth more as a structural check over the shipped tree
	// than as a rule each new module is trusted to remember.
	//
	// Comments are stripped first, because both modules that count budgets *cite*
	// `replanCount` as the thing they exist not to be, and a check that could not
	// tell the citation from the deed would push the explanation out of the code.
	const counters = factorySources().filter(([, source]) =>
		/\b(replanCount|repairCount|retryCount|attemptsUsed|budgetUsed)\b/.test(withoutComments(source)),
	);

	assert.deepEqual(counters.map(([path]) => path), []);
});

test("§8.8: every class an exhaustion can file under is controller-derived, and so unwritable by a worker", () => {
	const filed = OUTCOME_TABLE.filter((row) => row.budget !== null).map((row) => exhaustionOf(row).reason_class);

	assert.ok(filed.length > 0);
	for (const reasonClass of new Set(filed)) {
		assert.ok(
			CONTROLLER_DERIVED_REASON_CLASSES.includes(reasonClass),
			`${reasonClass} would let a worker claim a budget it cannot see has run out (§6.6, §8.8)`,
		);
		assert.equal(dispositionForReasonClass(reasonClass), "failed", "§14.18");
	}
});

// ── §8.4's seam, answered from this module's count ───────────────────────────

test("the review fan-out's retries and the builder's are one ticket execution's automation spend", async (t) => {
	const { store, run, ticket, charge } = await executing(t);
	const seam = reviewAutomationRetry(store, { run, ticket, budgets: { ...DEFAULTS, automation: 2 } });

	// A dead builder, then a dead reviewer. Two places counting would have let
	// the axis retry twice more on a budget the builder had already halved.
	charge("implement", "dead-worker");
	charge("review", "dead-worker", { attempt: 2 });
	await seam({ outcome: "dead-worker" });

	charge("review", "timeout", { attempt: 3 });
	const error = await seam({ outcome: "timeout" }).then(
		() => assert.fail("expected the shared automation budget to refuse"),
		(refused) => refused,
	);

	assert.equal(error.reason, "budget-exhausted");
	assert.equal(error.details.spent, 3);
	assert.equal(error.details.reason_class, "automation-budget-exhausted");
});

/** Source with block and line comments removed. Enough for a plain-ESM tree. */
function withoutComments(source) {
	return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}
