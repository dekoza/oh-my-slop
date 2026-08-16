import test from "node:test";
import assert from "node:assert/strict";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { budgetSpend, exhaustionOf, requireBudget } from "../../factory/lib/pipeline/budgets.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { routeOutcome } from "../../factory/lib/pipeline/table.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
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

	// "A second conflict is `failed` / `rebase-conflict`" — and it spent a
	// fresh-retry, so the fault is the product's and the breaker never sees it.
	const conflict = exhaustionOf(routeOutcome("integrate", "rebase-conflict"));
	assert.equal(conflict.reason_class, "rebase-conflict");
	assert.equal(conflict.fault, "repair");
});

test("a row that charges no budget cannot be asked for one", () => {
	assert.equal(refusal(() => exhaustionOf(routeOutcome("implement", "completed"))).reason, "outcome-unmapped");
});
