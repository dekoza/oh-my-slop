import test from "node:test";
import assert from "node:assert/strict";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { requestEffect, resolveEffect } from "../../factory/lib/effects/records.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { budgetSpend } from "../../factory/lib/pipeline/budgets.mjs";
import { dispositionOf } from "../../factory/lib/pipeline/dispositions.mjs";
import { FactoryPipelineError } from "../../factory/lib/pipeline/errors.mjs";
import { outcomeChain, resolveStage, walkStages } from "../../factory/lib/pipeline/stages.mjs";
import { TABLE_WIDE, routeOutcome } from "../../factory/lib/pipeline/table.mjs";
import { answering, answeringInTurn } from "./helpers/factory-pipeline.mjs";
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
		walk: (phases, overrides = {}) =>
			walkStages(store, {
				hold,
				run,
				ticket,
				attempt: `${run}-t${ticket}-a1`,
				phases,
				actor: "controller",
				now: () => FIXED_NOW,
				// Generous by default, so a test that is about the seam is stopped by
				// the seam. §8.6's own numbers are the subject of the budget tests
				// below, which declare them.
				budgets: { repair: 9, freshRetry: 9, automation: 9 },
				...overrides,
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

test("a controller phase re-entered at the next try is a second fact, not a conflict (§8.10, #146)", async (t) => {
	const context = await executing(t);
	context.resolve("verify", "unrunnable", { detail: { problem: "pytest is not on this host" } });

	const again = context.resolve("verify", "passed", { try: 2 });

	assert.equal(again.state, "resolved");
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => step.outcome),
		["unrunnable", "passed"],
		"a workerless phase mints no attempt, so the try is what the re-entry varies",
	);
});

test("the same try under one attempt is still §8.10's typed conflict (#146)", async (t) => {
	const context = await executing(t);
	context.resolve("verify", "unrunnable", { try: 2 });

	assert.throws(
		() => context.resolve("verify", "passed", { try: 2 }),
		(error) => {
			assert.equal(error.reason, "stage-result-conflict");
			assert.equal(error.details.try, 2);
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

test("a green attempt walks the whole pipeline and settles as published (§8.1, §8.9)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answering({
		implement: "completed",
		harvest: "passed",
		verify: "passed",
		review: "approved",
	});

	const settled = await context.walk({
		...phases,
		// §7.5's publication is what the integrate executor answers with, and §8.9
		// refuses a `published` disposition that carries no link to it.
		integrate: async () => ({
			outcome: "integrated",
			detail: { pr: { number: 7001, url: "http://gitea.example/acme/widgets/pulls/7001" }, summary: "all green" },
		}),
	});

	assert.equal(settled.disposition, "published");
	assert.deepEqual(settled.pr, { number: 7001, url: "http://gitea.example/acme/widgets/pulls/7001" });
	assert.equal(settled.reason, "all green");
	assert.deepEqual(calls, ["implement", "harvest", "verify", "review"]);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }),
		[
			{ phase: "implement", outcome: "completed", attempt: context.attempt },
			{ phase: "harvest", outcome: "passed", attempt: context.attempt },
			{ phase: "verify", outcome: "passed", attempt: context.attempt },
			{ phase: "review", outcome: "approved", attempt: context.attempt },
			{ phase: "integrate", outcome: "integrated", attempt: context.attempt },
		],
		"the chain a finished walk leaves behind is the chain the status verb reads",
	);
});

test("a phase the caller wired no executor for is a composition defect, named as one", async (t) => {
	const context = await executing(t);
	const { phases } = answering({ implement: "completed", harvest: "passed", verify: "passed", review: "approved" });

	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.reason, "phase-unwired");
			assert.equal(error.details.phase, "integrate");
			return true;
		},
	);
});

test("a failed verify goes straight to repair: the reviewer never sees failing code (§14.15)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answering({ implement: "completed", harvest: "passed", verify: "failed" });

	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.reason, "retry-unplannable");
			assert.equal(error.details.action, "repair");
			assert.equal(error.details.budget, "repair");
			return true;
		},
	);

	assert.deepEqual(calls, ["implement", "harvest", "verify"], "review was never entered");
});

// ── §8.5's two tiers, as the walk reaches them ───────────────────────────────

/**
 * A retry seam that mints the next attempt, as `pipeline/repair.mjs` plans it —
 * and records what the walk handed it, because §8.5's tier, §8.10's budget and
 * the failure's own evidence are the whole of what a repair is planned from.
 */
function retrying(context, { attempts = 2 } = {}) {
	const asked = [];

	return {
		asked,
		nextAttempt: async (request) => {
			asked.push(request);
			// Deterministic, as `planRetry` is: one ordinal past the attempt being
			// answered, so a replay of the same failure plans the same attempt.
			const ordinal = Number.parseInt(request.attempt.split("-a").at(-1), 10) + 1;
			if (ordinal > attempts) {
				// §8.6's budget lives in the seam, and this stands in for its refusal
				// until #111 counts: what the walk needs is for the seam to stop.
				throw new Error("budget spent");
			}
			const attempt = `${context.run}-t${context.ticket}-a${ordinal}`;
			if (context.store.readAttempts({ runId: context.run }).every((row) => row.attempt_id !== attempt)) {
				context.store.append(attemptLaunched(context.run, context.ticket, ordinal));
			}
			return { attempt };
		},
	};
}

test("a repair re-enters implement under a new attempt, never the one that failed (§8.5)", async (t) => {
	const context = await executing(t);
	const seam = retrying(context);
	const seen = [];
	const phases = {
		implement: async ({ attempt }) => {
			seen.push(attempt);
			return { outcome: "completed" };
		},
		harvest: async () => ({ outcome: "passed" }),
		verify: async () => ({ outcome: seen.length === 1 ? "failed" : "passed" }),
		review: async () => ({ outcome: "approved" }),
	};

	// The repaired attempt walks clean through review to a publication.
	const settled = await context.walk(
		{ ...phases, integrate: async () => ({ outcome: "integrated", detail: { pr: { number: 7002, url: "u" } } }) },
		{ nextAttempt: seam.nextAttempt },
	);
	assert.equal(settled.disposition, "published");

	assert.deepEqual(seen, [context.attempt, `${context.run}-t${context.ticket}-a2`]);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => [
			step.phase,
			step.outcome,
			step.attempt,
		]),
		[
			["implement", "completed", context.attempt],
			["harvest", "passed", context.attempt],
			["verify", "failed", context.attempt],
			["implement", "completed", `${context.run}-t${context.ticket}-a2`],
			["harvest", "passed", `${context.run}-t${context.ticket}-a2`],
			["verify", "passed", `${context.run}-t${context.ticket}-a2`],
			["review", "approved", `${context.run}-t${context.ticket}-a2`],
			["integrate", "integrated", `${context.run}-t${context.ticket}-a2`],
		],
		"the chain is a list across attempts: the repair is on it, and the failure it answers still is",
	);
});

test("the walk hands the seam the tier, the budget, and the failure's own evidence (§8.5, §8.10)", async (t) => {
	const context = await executing(t);
	const seam = retrying(context, { attempts: 1 });
	const { phases } = answering({
		implement: "completed",
		harvest: "passed",
		verify: { outcome: "failed", detail: { red: ["pytest"] } },
	});

	await assert.rejects(() => context.walk(phases, { nextAttempt: seam.nextAttempt }), /budget spent/);

	assert.deepEqual(seam.asked, [
		{
			tier: "repair",
			budget: "repair",
			phase: "verify",
			outcome: "failed",
			detail: { red: ["pytest"] },
			attempt: context.attempt,
			row: routeOutcome("verify", "failed"),
		},
	]);
});

test("an invalid result is a fresh-retry, and it is the seam that is told which tier (§8.10)", async (t) => {
	const context = await executing(t);
	const seam = retrying(context, { attempts: 1 });
	const { phases } = answering({ implement: "invalid-result" });

	await assert.rejects(() => context.walk(phases, { nextAttempt: seam.nextAttempt }), /budget spent/);

	assert.equal(seam.asked[0].tier, "fresh-retry");
	assert.equal(seam.asked[0].budget, "repair", "§8.6 charges the product budget for a worker that wrote nothing readable");
});

test("a re-entered walk asks the seam again, and the seam answers with the same attempt (§8.10)", async (t) => {
	const context = await executing(t);
	const seam = retrying(context);
	const first = answering({ implement: "completed", harvest: "passed", verify: "failed" });
	await assert.rejects(() => context.walk(first.phases, { nextAttempt: seam.nextAttempt }), /budget spent/);
	const asked = seam.asked.length;

	// The controller died after the second attempt's failed verify. Every stage is
	// recorded, so the replay re-runs no phase — and reaches the same tier
	// decisions again, in the same order.
	const second = answering({ implement: "completed", harvest: "passed", verify: "failed" });
	await assert.rejects(() => context.walk(second.phases, { nextAttempt: seam.nextAttempt }), /budget spent/);

	assert.deepEqual(second.calls, [], "a recorded stage is not run again");
	assert.deepEqual(
		seam.asked.slice(asked),
		seam.asked.slice(0, asked),
		"the seam is asked again on every replay and asked the same question, so it is what must be idempotent",
	);
});

test("a walk with no retry seam refuses rather than carrying on (§8.10)", async (t) => {
	const context = await executing(t);
	const { phases } = answering({ implement: "worker-failed" });

	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.reason, "retry-unplannable");
			assert.equal(error.details.at, "seam");
			// The plausible fallthrough — carry on to harvest — is how a failing
			// attempt becomes a publication.
			assert.equal(error.details.action, "repair");
			return true;
		},
	);
});

test("a seam that hands back the attempt it was given is refused (§8.5)", async (t) => {
	const context = await executing(t);
	const { phases } = answering({ implement: "worker-failed" });

	await assert.rejects(
		() => context.walk(phases, { nextAttempt: async ({ attempt }) => ({ attempt }) }),
		(error) => {
			assert.equal(error.reason, "retry-unplannable");
			assert.equal(error.details.at, "seam");
			assert.match(error.message, /fresh attempt/);
			return true;
		},
	);
});

test("an agent-borne automation retry is held to the same rule: a seam answering with its own attempt is refused (§8.5, #146)", async (t) => {
	const context = await executing(t);
	// §8.10 routes `implement × dead-worker` to the automation retry, which does
	// mint — the phase has a worker, and a relaunch is a worker run. Re-entering
	// implement under the same attempt would read its recorded result back and
	// route here again, without end.
	const { phases } = answering({ implement: "dead-worker" });

	await assert.rejects(
		() => context.walk(phases, { nextAttempt: async ({ attempt }) => ({ attempt }) }),
		(error) => {
			assert.equal(error.reason, "retry-unplannable");
			assert.equal(error.details.at, "seam");
			assert.equal(error.details.action, "retry");
			return true;
		},
	);
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
	const { phases, calls } = answering({ implement: "wrote-but-hung", harvest: "passed", verify: "passed" });

	// `review` is deliberately unwired: the walk has to get past the hang to reach
	// a phase nobody supplied, which is what proves the hang did not end it.
	await assert.rejects(
		() => context.walk(phases),
		(error) => {
			assert.equal(error.reason, "phase-unwired");
			assert.equal(error.details.phase, "review", "the hang did not end the walk");
			return true;
		},
	);

	assert.deepEqual(calls, ["implement", "harvest", "verify"]);
	assert.equal(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket })[0].outcome,
		"wrote-but-hung",
	);
	assert.deepEqual(
		budgetSpend(context.store, { run: context.run, ticket: context.ticket }),
		{ repair: 0, freshRetry: 0, automation: 0 },
		"§8.10: the outbox is valid, so this is an ordinary action carrying an anomaly — not a failure that spends",
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
		pr: null,
		reason: null,
		advisory: null,
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
	const { phases } = answering({ implement: "completed", harvest: "passed", verify: "passed", review: "approved" });
	const before = context.store.head().seq;

	await assert.rejects(() => context.walk(phases), /wired no executor/);

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

	const rest = {
		harvest: async () => ({ outcome: "passed" }),
		verify: async () => ({ outcome: "passed" }),
		review: async () => ({ outcome: "approved" }),
	};
	await assert.rejects(() => context.walk({ implement, ...rest }), /controller died/);
	await assert.rejects(() => context.walk({ implement, ...rest }), /wired no executor/);

	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => step.phase),
		["implement", "harvest", "verify", "review"],
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

// ── §8.6's budgets, as the walk spends them ──────────────────────────────────

/** A seam that always mints, so the budget is the only thing that can stop the walk. */
function minting(context) {
	const asked = [];

	return {
		asked,
		nextAttempt: async (request) => {
			asked.push(request);
			const ordinal = Number.parseInt(request.attempt.split("-a").at(-1), 10) + 1;
			const attempt = `${context.run}-t${context.ticket}-a${ordinal}`;
			if (context.store.readAttempts({ runId: context.run }).every((row) => row.attempt_id !== attempt)) {
				context.store.append(attemptLaunched(context.run, context.ticket, ordinal));
			}
			return { attempt };
		},
	};
}

test("§8.10: an automation failure retries **the same phase**, never a fresh implement (#146)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		// The first verify never ran; the second is a real green.
		verify: ["unrunnable", "passed"],
		review: ["approved"],
		integrate: ["integrated"],
	});

	// **No seam wired at all**, which is the mechanic: §8.8 gives `verify` no
	// worker, so its retry has nothing to ask one for. That a *composed* seam goes
	// unasked on the same walk is `factory_pipeline_retry.test.mjs`'s.
	const settled = await context.walk(phases);

	assert.equal(settled.disposition, "published");
	assert.deepEqual(
		calls.filter((call) => call.phase === "implement").length,
		1,
		"the builder was not re-run: the automation failed, not the work",
	);
	assert.deepEqual(
		calls.filter((call) => call.phase === "verify").map((call) => call.attempt),
		[context.attempt, context.attempt],
		"§8.5's fresh attempt is a statement about worker attempts; a controller phase re-enters under its own",
	);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => `${step.phase}:${step.outcome}`),
		["implement:completed", "harvest:passed", "verify:unrunnable", "verify:passed", "review:approved", "integrate:integrated"],
	);
});

test("§8.6: an exhausted automation budget fails with a class no worker can write (§8.8)", async (t) => {
	const context = await executing(t);
	const seam = minting(context);
	const { phases } = answering({ implement: "dead-worker" });

	const settled = await context.walk(phases, {
		nextAttempt: seam.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 1 },
	});

	assert.equal(settled.disposition, "failed");
	assert.equal(settled.reason_class, "automation-budget-exhausted");
	assert.equal(settled.fault, "automation");
	assert.equal(seam.asked.length, 1, "one retry granted, the second refused");
});

test("§8.10: a row naming its own exhausted class fails with that class, not the budget's", async (t) => {
	const context = await executing(t);
	const seam = minting(context);
	const { phases } = answering({ implement: "completed", harvest: "passed", verify: "unrunnable" });

	const settled = await context.walk(phases, {
		nextAttempt: seam.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 1 },
	});

	assert.equal(settled.disposition, "failed");
	assert.equal(settled.reason_class, "check-unrunnable", "§8.10: verify unrunnable, exhausted ⇒ failed / check-unrunnable");
	assert.equal(settled.fault, "automation");
});

test("§8.6: an exhausted repair budget fails with `repair-budget-exhausted`", async (t) => {
	const context = await executing(t);
	const seam = minting(context);
	const { phases } = answering({ implement: "completed", harvest: "passed", verify: "failed" });

	const settled = await context.walk(phases, {
		nextAttempt: seam.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 1 },
	});

	assert.equal(settled.disposition, "failed");
	assert.equal(settled.reason_class, "repair-budget-exhausted");
	assert.equal(settled.fault, "repair", "a product verdict, so §8.6's breaker never sees it");
	assert.equal(seam.asked.length, 1);
});

test("§8.6: automation failures never consume the product budget, however many are interleaved", async (t) => {
	const context = await executing(t);
	const seam = minting(context);
	// a1 dies on the automation; a2 fails verify; a3 dies again; a4 passes.
	const verdicts = new Map([
		["a1", { implement: "dead-worker" }],
		["a2", { implement: "completed", harvest: "passed", verify: "failed" }],
		["a3", { implement: "dead-worker" }],
		["a4", { implement: "completed", harvest: "passed", verify: "passed", review: "approved", integrate: "integrated" }],
	]);
	const phases = Object.fromEntries(
		["implement", "harvest", "verify", "review", "integrate"].map((phase) => [
			phase,
			async ({ attempt }) => ({ outcome: verdicts.get(attempt.split("-").at(-1))[phase] }),
		]),
	);

	const settled = await context.walk(phases, {
		nextAttempt: seam.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 2 },
	});

	assert.equal(settled.disposition, "published", "the one repair was still available after two automation failures");
	assert.deepEqual(seam.asked.map((request) => request.budget), ["automation", "repair", "automation"]);
});

test("a walk that reaches a retry with no declared budgets refuses rather than granting one", async (t) => {
	const context = await executing(t);
	const seam = minting(context);
	const { phases } = answering({ implement: "worker-failed" });

	await assert.rejects(
		() => context.walk(phases, { nextAttempt: seam.nextAttempt, budgets: null }),
		(error) => error.reason === "retry-unplannable" && /budgets\.repair/.test(error.message),
	);
});

test("a provider-refused attempt is rerouted onto a fresh attempt, charged to nothing (§8.10, #154, #155)", async (t) => {
	// The provider's refusal is neither the worker's fault nor the automation's,
	// so the ticket is not made to pay for it: the same work re-enters implement
	// under a new attempt on the next routable profile, and no budget moves.
	const context = await executing(t);
	const seam = retrying(context);
	const { phases, calls } = answeringInTurn({
		implement: ["provider-refused", "completed"],
		harvest: ["passed"],
		verify: ["passed"],
		review: ["approved"],
		integrate: ["integrated"],
	});

	const settled = await context.walk(phases, { nextAttempt: seam.nextAttempt });

	assert.equal(settled.disposition, "published");
	assert.deepEqual(seam.asked.map((request) => request.tier), ["reroute"]);
	assert.equal(seam.asked[0].budget, null, "a reroute names no budget, because it spends none");
	assert.notEqual(
		calls.find((call) => call.phase === "harvest").attempt,
		calls[0].attempt,
		"the work went somewhere else, not back to the attempt the provider refused",
	);
	assert.deepEqual(
		budgetSpend(context.store, { run: context.run, ticket: context.ticket }),
		{ repair: 0, freshRetry: 0, automation: 0 },
		"the provider's refusal charges no budget — before #154 the same refusal arrived as a repair-charged no-result",
	);
});

test("a reroute with nowhere left to go releases the ticket untouched, as its own outcome (§8.10, #155)", async (t) => {
	const context = await executing(t);
	const { phases } = answering({ implement: "provider-refused" });

	const settled = await context.walk(phases, {
		nextAttempt: async () => {
			throw new FactoryPipelineError("routes-exhausted", "every routable profile for role implement is memo-locked", {
				at: "route",
				role: "implement",
			});
		},
	});

	assert.equal(settled.disposition, "released", "the ticket goes back to the frontier: no label, no human owed anything");
	assert.equal(settled.outcome, "routes-exhausted", "and it is distinguishable from a worker that failed");
	assert.equal(settled.reason_class, null);
	assert.equal(settled.fault, null, "no fault: §8.6's breaker counts neither a product nor an automation failure");
	assert.deepEqual(
		settled.chain.map((entry) => entry.outcome),
		["provider-refused"],
		"the chain says the refusal happened and the reroute answered it, rather than only the ending",
	);
	assert.deepEqual(budgetSpend(context.store, { run: context.run, ticket: context.ticket }), {
		repair: 0,
		freshRetry: 0,
		automation: 0,
	});
});
