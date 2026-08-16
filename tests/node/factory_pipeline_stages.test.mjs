import test from "node:test";
import assert from "node:assert/strict";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { requestEffect, resolveEffect } from "../../factory/lib/effects/records.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { dispositionOf } from "../../factory/lib/pipeline/dispositions.mjs";
import { outcomeChain, resolveStage, walkStages } from "../../factory/lib/pipeline/stages.mjs";
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
		walk: (phases) =>
			walkStages(store, {
				hold,
				run,
				ticket,
				attempt: `${run}-t${ticket}-a1`,
				phases,
				actor: "controller",
				now: () => FIXED_NOW,
			}),
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

// ── The walk (§8.1's order, §8.10's routing) ─────────────────────────────────

/** Phase executors that answer with what each test is about, and count calls. */
function answering(outcomes) {
	const calls = [];
	const phases = {};
	for (const [phase, answer] of Object.entries(outcomes)) {
		phases[phase] = async () => {
			calls.push(phase);
			return typeof answer === "string" ? { outcome: answer, detail: null } : answer;
		};
	}
	return { phases, calls };
}

test("a green attempt walks implement → harvest → verify, and stops where review is unbuilt", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answering({ implement: "completed", harvest: "passed", verify: "passed" });

	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.reason, "not-yet-implemented");
			assert.equal(error.details.phase, "review");
			assert.match(error.details.missing, /#112/);
			return true;
		},
	);

	assert.deepEqual(calls, ["implement", "harvest", "verify"]);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }),
		[
			{ phase: "implement", outcome: "completed", attempt: context.attempt },
			{ phase: "harvest", outcome: "passed", attempt: context.attempt },
			{ phase: "verify", outcome: "passed", attempt: context.attempt },
		],
		"the chain a stopped walk leaves behind is the chain `factory status` reads",
	);
});

test("a failed verify goes straight to repair: the reviewer never sees failing code (§14.15)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answering({ implement: "completed", harvest: "passed", verify: "failed" });

	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.reason, "not-yet-implemented");
			assert.equal(error.details.action, "repair");
			assert.equal(error.details.budget, "repair");
			return true;
		},
	);

	assert.deepEqual(calls, ["implement", "harvest", "verify"], "review was never entered");
});

test("a needs-human attempt pauses under the worker's own reason class (§8.10, §14.18)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answering({
		implement: { outcome: "needs-human", detail: { reason_class: "spec-contradiction", question: "which one?" } },
	});

	const settled = await context.walk(phases);

	assert.equal(settled.disposition, "paused");
	assert.equal(settled.reason_class, "spec-contradiction");
	// §8.9's pause comment carries **the exact question**, so it rides out of the
	// walk beside the class it came in with: the tracker action would otherwise
	// have to re-read a detail this function has just finished reading (#109).
	assert.equal(settled.question, "which one?");
	assert.deepEqual(calls, ["implement"]);
});

test("wrote-but-hung is harvested rather than failed, and consumes no budget (§8.10)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answering({ implement: "wrote-but-hung", harvest: "passed", verify: "unrunnable" });

	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.details.phase, "verify", "the hang did not end the walk");
			return true;
		},
	);

	assert.deepEqual(calls, ["implement", "harvest", "verify"]);
	assert.equal(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket })[0].outcome,
		"wrote-but-hung",
	);
});

test("a cancelled attempt releases the ticket, an honest state rather than a failure (§8.9)", async (t) => {
	const context = await executing(t);
	const { phases } = answering({ implement: "cancelled" });

	const settled = await context.walk(phases);

	assert.deepEqual(settled, {
		disposition: "released",
		reason_class: null,
		fault: null,
		question: null,
		phase: "implement",
		outcome: "cancelled",
		conflict: null,
		// §8.9's pause and failure comments are required to carry the chain, so the
		// walk hands back the one it just wrote rather than making #109 re-derive it.
		chain: [{ phase: "implement", outcome: "cancelled", attempt: context.attempt }],
	});
});

test("a conflicting duplicate is routed to failed / automation, not thrown at the caller (§8.10)", async (t) => {
	const context = await executing(t);
	// A second controller resolves the stage differently while this one is still
	// running the phase — the only way one walk meets a conflict it did not write.
	const implement = async () => {
		context.resolve("implement", "worker-failed");
		return { outcome: "completed", detail: null };
	};

	const settled = await context.walk({ implement });

	assert.deepEqual(settled.disposition, "failed");
	assert.equal(settled.fault, "automation");
	assert.equal(settled.outcome, "duplicate-conflicting");
	assert.equal(settled.conflict.committed, "worker-failed");
	assert.equal(settled.conflict.found, "completed");
});

test("a worker's own test evidence is context, never the verdict (§14.16)", async (t) => {
	const context = await executing(t);
	const { phases } = answering({
		implement: { outcome: "completed", detail: { test_evidence: "851 passed, all green" } },
		harvest: "passed",
		verify: "failed",
	});

	await assert.rejects(() => context.walk(phases), /repair/);

	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => [
			step.phase,
			step.outcome,
		]),
		[
			["implement", "completed"],
			["harvest", "passed"],
			["verify", "failed"],
		],
		"the controller's own rerun is the attestation boundary; the worker's claim rode along as context",
	);
});

test("the walk writes nothing to the tracker: its whole output is the journal (#108)", async (t) => {
	const context = await executing(t);
	const { phases } = answering({ implement: "completed", harvest: "passed", verify: "passed" });
	const before = context.store.head().seq;

	await assert.rejects(() => context.walk(phases), /not built/);

	assert.deepEqual(
		[
			...new Set(
				context.store
					.readEvents({ sinceSeq: before })
					.map((record) => record.kind),
			),
		],
		["stage.resolved"],
		"no effect is requested, so nothing outside the database is mutated (§4.5)",
	);
});

test("a re-entered walk replays the chain from durable state and re-runs nothing (§8.10)", async (t) => {
	const context = await executing(t);
	const first = answering({ implement: "completed", harvest: "passed", verify: "failed" });
	await assert.rejects(() => context.walk(first.phases), /repair/);

	// The controller died and came back: same run, same attempt, same table.
	const second = answering({ implement: "completed", harvest: "passed", verify: "failed" });
	await assert.rejects(() => context.walk(second.phases), /repair/);

	assert.deepEqual(second.calls, [], "a recorded stage is not run again — the record is the resume point");
	assert.equal(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).length,
		3,
		"and the chain does not grow a duplicate step",
	);
});

test("a crash between an external effect and its recorded resolution replays clean (§8.10)", async (t) => {
	const context = await executing(t);
	const identity = {
		run: context.run,
		ticket: context.ticket,
		phase: "implement",
		attempt: context.attempt,
		operation: "agent-start",
		operand: null,
		actor: "controller",
		fencingGeneration: context.hold.fence().generation,
		payload: { agent: "worker" },
		at: FIXED_NOW,
	};
	let died = false;
	const implement = async () => {
		const requested = requestEffect(context.store, identity);
		if (requested.state !== "resolved") {
			resolveEffect(context.store, {
				key: requested.key,
				actor: "controller",
				fencingGeneration: identity.fencingGeneration,
				result: { started: true },
				at: FIXED_NOW,
			});
		}
		// The controller dies here the first time: the pane is up and the journal
		// knows it, and nothing has said what the attempt came back with.
		if (!died) {
			died = true;
			throw new Error("controller died mid-attempt");
		}
		return { outcome: "completed", detail: null };
	};

	const rest = { harvest: async () => ({ outcome: "passed" }), verify: async () => ({ outcome: "passed" }) };
	await assert.rejects(() => context.walk({ implement, ...rest }), /controller died/);
	await assert.rejects(() => context.walk({ implement, ...rest }), /not built/);

	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => step.phase),
		["implement", "harvest", "verify"],
		"one implement step, from the replay that finished it",
	);
	assert.equal(
		context.store.readEvents({ kind: "effect.requested" }).length,
		1,
		"and the effect was requested once: §4.5's key is what makes the replay idempotent",
	);
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
