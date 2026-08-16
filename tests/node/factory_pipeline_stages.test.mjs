import test from "node:test";
import assert from "node:assert/strict";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { dispositionOf } from "../../factory/lib/pipeline/dispositions.mjs";
import { outcomeChain, resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { TABLE_WIDE, routeOutcome } from "../../factory/lib/pipeline/table.mjs";
import {
	FIXED_NOW,
	attemptLaunched,
	manualTimers,
	openTestStore,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §8.10's stage machine: a ticket execution's phases, resolved into durable
 * state one at a time.
 *
 * A stage result is a **record**, not a return value, which is what makes the
 * table re-enterable (§8.10): a controller that dies between an external effect
 * and the resolution it belongs to re-reads the chain and continues from it,
 * rather than replaying a phase whose work already happened.
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
	return {
		store,
		hold,
		run,
		ticket,
		attempt: `${run}-t${ticket}-a1`,
		resolve: (phase, outcome, overrides = {}) =>
			resolveStage(store, {
				hold,
				run,
				ticket,
				phase,
				attempt: `${run}-t${ticket}-a1`,
				outcome,
				actor: "controller",
				at: FIXED_NOW,
				...overrides,
			}),
	};
}

test("a resolved stage is recorded, and answers with §8.10's own row", async (t) => {
	const context = await executing(t);

	const resolved = context.resolve("implement", "completed");

	assert.equal(resolved.state, "resolved");
	assert.equal(resolved.row.action, "advance");
	assert.equal(resolved.row.to, "harvest");
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }),
		[{ phase: "implement", outcome: "completed", attempt: context.attempt }],
	);
});

test("a duplicate identical result returns the committed one, and records nothing new (§8.10)", async (t) => {
	const context = await executing(t);
	context.resolve("implement", "completed", { detail: { commits: ["a1b2c3d"] } });

	const again = context.resolve("implement", "completed", { detail: { commits: ["a1b2c3d"] } });

	assert.equal(again.state, "already-resolved");
	assert.equal(again.outcome, "completed");
	assert.deepEqual(again.detail, { commits: ["a1b2c3d"] });
	assert.equal(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).length,
		1,
		"a second record saying the same thing would report a phase that ran twice",
	);
});

test("a conflicting result under the same semantic key is a typed conflict (§8.10)", async (t) => {
	const context = await executing(t);
	context.resolve("implement", "completed");

	assert.throws(
		() => context.resolve("implement", "worker-failed"),
		(error) => {
			assert.equal(error.reason, "stage-result-conflict");
			assert.equal(error.details.committed, "completed");
			assert.equal(error.details.found, "worker-failed");
			return true;
		},
	);
});

test("a typed conflict is filed as failed under an automation fault (§8.10)", () => {
	assert.deepEqual(dispositionOf(routeOutcome(TABLE_WIDE, "duplicate-conflicting")), {
		disposition: "failed",
		reason_class: null,
		fault: "automation",
	});
});

test("the same phase resolved under a later attempt is a new result, not a contradiction (§8.5)", async (t) => {
	const context = await executing(t);
	context.resolve("implement", "worker-failed");
	context.store.append(attemptLaunched(context.run, context.ticket, 2));

	const repaired = context.resolve("implement", "completed", { attempt: `${context.run}-t${context.ticket}-a2` });

	assert.equal(repaired.state, "resolved");
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => step.outcome),
		["worker-failed", "completed"],
		"a repair re-enters the phase; the chain is a list, and its shape is what an operator reads (§8.10)",
	);
});
