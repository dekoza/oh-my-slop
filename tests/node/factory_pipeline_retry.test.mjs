import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { createRetrySeam } from "../../factory/lib/pipeline/retry.mjs";
import { budgetSpend } from "../../factory/lib/pipeline/budgets.mjs";
import { outcomeChain, resolveStage, walkStages } from "../../factory/lib/pipeline/stages.mjs";
import { routeOutcome } from "../../factory/lib/pipeline/table.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { workedAttempt } from "./helpers/factory-git.mjs";
import { answeringInTurn } from "./helpers/factory-pipeline.mjs";
import { FIXED_NOW, manualTimers } from "./helpers/factory-store.mjs";

/**
 * §8.10's four retry rows, through the seam that answers them — and the one that
 * never reaches it (#146).
 *
 * The question this file exists for is *what an automation retry of a controller
 * phase is*. The answer is that it is not an attempt: `verify` and `integrate`
 * have no worker (§8.8), so a retry of one re-enters the phase under the attempt
 * already being walked, at the next try, and mints nothing. The seam is composed
 * here anyway on every one of these walks, so "it is never asked" is an
 * observation about a wired seam rather than about a missing one.
 */

/** A run, a hold, a worked-on first attempt, and the composed seam over them. */
async function executing(t, { selectRoute = null, readResult = null } = {}) {
	const context = await workedAttempt(t);
	const leases = openLeases(context.store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store: context.store, leases, timers: manualTimers().api });

	hold.recordStartupReconcile();
	hold.adopt(context.run);

	const asked = [];
	const seam = createRetrySeam(context.store, context.clone, {
		hold,
		run: context.run,
		ticket: context.ticket,
		baseBranch: "main",
		selectRoute,
		readResult,
		workerConfig: context.workerConfig,
		actor: "controller",
		now: () => FIXED_NOW,
	});

	return {
		...context,
		hold,
		asked,
		nextAttempt: async (request) => {
			asked.push(request);
			return seam(request);
		},
		ask: seam,
		walk: (phases, overrides = {}) =>
			walkStages(context.store, {
				hold,
				run: context.run,
				ticket: context.ticket,
				attempt: context.attempt,
				phases,
				actor: "controller",
				now: () => FIXED_NOW,
				budgets: { repair: 9, freshRetry: 9, automation: 9 },
				...overrides,
			}),
	};
}

const PUBLICATION = { outcome: "integrated", detail: { pr: { number: 8801, url: "http://gitea.example/p/8801" } } };

/** A request in the shape `walkStages` hands the seam. */
function asking(phase, outcome, { attempt, detail = null }) {
	const row = routeOutcome(phase, outcome);
	return { tier: row.action, budget: row.budget, attempt, phase, outcome, detail, row };
}

// ── The two workerless phases: a full retry, with the seam wired (§8.8, #146) ─

test("verify × unrunnable completes a full retry through a composed walk, asking no seam (§8.10, #146)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: ["unrunnable", "passed"],
		review: ["approved"],
		integrate: [PUBLICATION],
	});

	const settled = await context.walk(phases, { nextAttempt: context.nextAttempt });

	assert.equal(settled.disposition, "published");
	assert.deepEqual(context.asked, [], "§8.8: verify has no worker, so nothing mints for its retry");
	assert.deepEqual(
		calls.filter((call) => call.phase === "verify").map((call) => call.attempt),
		[context.attempt, context.attempt],
	);
	assert.equal(
		context.store.readAttempts({ runId: context.run }).length,
		1,
		"no attempt row exists without a pane, worktree, and manifest behind it (§2.1, §4.4)",
	);
});

test("verify × unrunnable exhausts its budget into check-unrunnable (§8.6, §8.10)", async (t) => {
	const context = await executing(t);
	const { phases } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: [{ outcome: "unrunnable", detail: { problem: "pytest is not on this host" } }],
	});

	const settled = await context.walk(phases, {
		nextAttempt: context.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 1 },
	});

	assert.equal(settled.disposition, "failed");
	assert.equal(settled.reason_class, "check-unrunnable");
	assert.equal(settled.fault, "automation");
	assert.deepEqual(context.asked, []);
});

test("integrate × push-failed completes a full retry, then exhausts into automation-budget-exhausted (§8.6, §8.10)", async (t) => {
	const context = await executing(t);
	const retried = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: ["passed"],
		review: ["approved"],
		integrate: [{ outcome: "push-failed", detail: { problem: "the remote refused" } }, PUBLICATION],
	});

	assert.equal((await context.walk(retried.phases, { nextAttempt: context.nextAttempt })).disposition, "published");

	// The same row, on a ticket execution whose automation budget is one — the
	// retry is granted once and refused the second time.
	const spent = await executing(t, {});
	const stuck = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: ["passed"],
		review: ["approved"],
		integrate: [{ outcome: "push-failed", detail: { problem: "the remote refused" } }],
	});

	const settled = await spent.walk(stuck.phases, {
		nextAttempt: spent.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 1 },
	});

	assert.equal(settled.disposition, "failed");
	assert.equal(settled.reason_class, "automation-budget-exhausted");
	assert.equal(settled.phase, "integrate");
	assert.deepEqual(spent.asked, []);
});

test("a controller phase that reaches the seam is refused, never given a plan (§8.8, #146)", async (t) => {
	const context = await executing(t);

	await assert.rejects(
		() => context.ask(asking("integrate", "push-failed", { attempt: context.attempt })),
		(error) => {
			assert.equal(error.reason, "retry-unplannable");
			assert.equal(error.details.at, "phase");
			return true;
		},
	);
});

// ── The rows that do mint, through the same seam (§8.5, §8.10) ───────────────

test("implement × dead-worker mints a relaunched builder at the prior tip (§8.10, #146)", async (t) => {
	const context = await executing(t);

	const answered = await context.ask(asking("implement", "dead-worker", { attempt: context.attempt }));

	assert.notEqual(answered.attempt, context.attempt, "§8.5: a resume is a fresh attempt with a fresh worktree");
	assert.equal(answered.plan.tier, "retry");
	assert.equal(answered.plan.profile, "builder", "§11.5: a dead pane is no reason to re-route");
	assert.equal(answered.plan.baseCommit, context.head, "the pane died, not the work — its commits are kept");
	assert.ok(existsSync(answered.plan.worktreePath));
	assert.equal(
		execFileSync("git", ["-C", answered.plan.worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		context.head,
	);
});

test("the seam is idempotent: a re-entry after a crash lands on the attempt it already opened (§8.5)", async (t) => {
	const context = await executing(t);
	const first = await context.ask(asking("implement", "dead-worker", { attempt: context.attempt }));

	const again = await context.ask(asking("implement", "dead-worker", { attempt: context.attempt }));

	assert.equal(again.attempt, first.attempt);
	assert.equal(context.store.readAttempts({ runId: context.run }).length, 2, "one retry, one new attempt");
});

test("§8.5's fresh-retry reaches its tier through the same seam, pinned by a fetch of its own (§7.2)", async (t) => {
	const asked = [];
	const context = await executing(t, {
		selectRoute: async (request) => {
			asked.push(request);
			return { declared: "big-builder", profile: "big-builder", class: "local", rerouted: false, reason: null, considered: [] };
		},
	});

	const answered = await context.ask(asking("implement", "no-result", { attempt: context.attempt }));

	assert.equal(answered.plan.tier, "fresh-retry");
	assert.equal(answered.plan.profile, "big-builder", "§11.5's one tier-dependent routing point");
	assert.equal(answered.plan.baseCommit, context.base.commit, "the work is discarded: the branch starts at the pin");
	assert.deepEqual(asked, [{ role: "fresh-retry", dispatched: [] }], "a fresh-retry re-dispatches its role from scratch");
});

test("#155: a provider-refused attempt is rerouted onto a profile this execution has not yet spent", async (t) => {
	const asked = [];
	const context = await executing(t, {
		selectRoute: async (request) => {
			asked.push(request);
			return {
				declared: "builder",
				profile: "big-builder",
				class: "claude-code",
				rerouted: true,
				reason: "local exhausted (§9.8)",
				considered: [
					{ profile: "builder", class: "local", state: "blocked", until: 900 },
					{ profile: "big-builder", class: "claude-code", state: "available", until: null },
				],
			};
		},
	});

	// The walk resolves the failing stage **before** it asks the seam, and that
	// resolution is what the bound is read from (#155) — so the fixture commits it
	// too, rather than asking the seam about a refusal nothing recorded.
	resolveStage(context.store, {
		hold: context.hold,
		run: context.run,
		ticket: context.ticket,
		phase: "implement",
		attempt: context.attempt,
		outcome: "provider-refused",
		actor: "controller",
		at: FIXED_NOW,
	});

	const answered = await context.ask(asking("implement", "provider-refused", { attempt: context.attempt }));

	assert.equal(answered.plan.tier, "reroute");
	assert.equal(answered.plan.profile, "big-builder");
	assert.equal(answered.plan.role, "implement", "the role does not change: §11.5's order is per role");
	assert.equal(answered.plan.from.kind, "prior-tip", "a refusal judged nothing, so the working line is kept");
	assert.equal(answered.plan.routing.declared, "builder", "and the mint records what was declared beside what runs");
	assert.deepEqual(
		asked,
		[{ role: "implement", dispatched: ["builder"] }],
		"the profile already spent is excluded, which is what bounds the reroute",
	);
});

test("#223: a recovered pooled builder reroute reuses its mint without reserving another model slot", async (t) => {
	let selections = 0;
	const context = await executing(t, { selectRoute: async () => {
		if (selections++ > 0) throw new Error("a minted reroute must not select or reserve again");
		return { declared: "builder", profile: "big-builder", class: "local", considered: [], pooling: { order: ["big-builder"], selected: { class: "local", held: 0, size: 1 } } };
	} });
	const request = asking("implement", "provider-refused", { attempt: context.attempt });
	const first = await context.ask(request);
	const again = await context.ask(request);
	assert.equal(again.attempt, first.attempt);
	assert.equal(again.plan.profile, first.plan.profile);
	assert.deepEqual(again.plan.routing.pooling, first.plan.routing.pooling);
	assert.equal(selections, 1);
});

test("#155: a reroute with no routable profile left refuses as its own typed answer, not as a plan", async (t) => {
	const context = await executing(t, {
		selectRoute: async () => ({
			declared: "builder",
			profile: null,
			class: null,
			rerouted: false,
			reason: null,
			considered: [{ profile: "builder", class: "local", state: "blocked", until: 900 }],
		}),
	});

	await assert.rejects(
		() => context.ask(asking("implement", "provider-refused", { attempt: context.attempt })),
		(error) => {
			assert.equal(error.reason, "routes-exhausted");
			assert.equal(error.details.role, "implement");
			assert.match(error.message, /builder on local: blocked/, "the refusal says what it tried and why each failed");
			return true;
		},
	);
});

test("#155: a row that chooses a profile with no dispatch seam wired is refused, never routed blind", async (t) => {
	const context = await executing(t);

	await assert.rejects(
		() => context.ask(asking("implement", "provider-refused", { attempt: context.attempt })),
		(error) => {
			assert.equal(error.reason, "retry-unplannable");
			assert.equal(error.details.at, "seam");
			assert.match(error.message, /memo/, "reaching for the routing without §9.8's memo is the failure named");
			return true;
		},
	);
});

test("the prior worker's own prose reaches the brief through the seam, quoted as untrusted (§8.5)", async (t) => {
	const asked = [];
	const context = await executing(t, {
		readResult: (attempt) => {
			asked.push(attempt);
			return { summary: "I rewrote the parser and it is worse now" };
		},
	});

	const answered = await context.ask(asking("verify", "failed", { attempt: context.attempt, detail: { red: ["pytest"] } }));

	assert.deepEqual(asked, [context.attempt]);
	assert.deepEqual(
		answered.plan.brief.untrusted.map((entry) => [entry.label, entry.text]),
		[["summary", "I rewrote the parser and it is worse now"]],
		"a worker's account of its own failure is never presented to the next one as fact",
	);
});

test("§8.5's repair reaches its tier through the same seam", async (t) => {
	const context = await executing(t);

	const answered = await context.ask(asking("verify", "failed", { attempt: context.attempt, detail: { red: ["pytest"] } }));

	assert.equal(answered.plan.tier, "repair");
	assert.equal(answered.plan.baseCommit, context.head, "§8.5: a repair branches from the prior attempt's tip");
});

test("a walk wired with this seam repairs a failed verify under a new attempt (§8.5, §8.10)", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: ["failed", "passed"],
		review: ["approved"],
		integrate: [PUBLICATION],
	});

	const settled = await context.walk(phases, { nextAttempt: context.nextAttempt });

	assert.equal(settled.disposition, "published");
	assert.equal(context.asked.length, 1);
	const implementations = calls.filter((call) => call.phase === "implement").map((call) => call.attempt);
	assert.equal(implementations.length, 2, "a tier's subject is the work, so it rebuilds");
	assert.notEqual(implementations[1], implementations[0]);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => step.phase),
		["implement", "harvest", "verify", "implement", "harvest", "verify", "review", "integrate"],
	);
});

// ── #194: a rebase conflict is a rebase-repair before any fresh-retry ────────

/** A rebase conflict's detail, as `pipeline/integration.mjs` records one, over this fixture's base. */
function conflicting(context) {
	return {
		outcome: "rebase-conflict",
		detail: {
			base_commit: context.base.commit,
			previous_base: context.base.commit,
			head: context.head,
			conflicts: ["docs/specs/software-factory.md"],
			base_movement: " docs/specs/software-factory.md | 1 +\n 1 file changed, 1 insertion(+)",
			evidence_ref: null,
			worktree: "/nowhere",
		},
	};
}

/** The spend, read the way §8.6 reads it. */
function spendOf(context) {
	return budgetSpend(context.store, { run: context.run, ticket: context.ticket });
}

test("#194: conflict → rebase-repair → green verify → review → integrated, with all three counts unchanged", async (t) => {
	const context = await executing(t);
	const { phases, calls } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: [conflicting(context), "passed"],
		review: ["approved"],
		integrate: [PUBLICATION],
	});

	const settled = await context.walk(phases, {
		nextAttempt: context.nextAttempt,
		budgets: { repair: 0, freshRetry: 0, automation: 0 },
	});

	assert.equal(settled.disposition, "published");
	assert.deepEqual(spendOf(context), { repair: 0, freshRetry: 0, automation: 0 }, "a rebase-repair charges nothing");
	assert.deepEqual(
		context.asked.map((request) => request.tier),
		["rebase-repair"],
		"the seam was asked for the tier once, and for no fresh-retry",
	);
	const implementations = calls.filter((call) => call.phase === "implement").map((call) => call.attempt);
	assert.equal(implementations.length, 2, "a tier's subject is the work, so it re-enters implement");
	assert.notEqual(implementations[1], context.attempt);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket }).map((step) => [step.phase, step.outcome]),
		[
			["implement", "completed"],
			["harvest", "passed"],
			["verify", "rebase-conflict"],
			["implement", "completed"],
			["harvest", "passed"],
			["verify", "passed"],
			["review", "approved"],
			["integrate", "integrated"],
		],
	);

	// The mint says why the attempt exists — and onto what it was told to rebase
	// — so §7.4's harvest can read the boundary off it later.
	const minted = context.store
		.readEvents({ stream: `run:${context.run}`, kind: "attempt.launched" })
		.find((record) => record.attempt === implementations[1]);
	assert.equal(minted.payload.tier, "rebase-repair");
	assert.equal(minted.payload.prior_attempt, context.attempt);
	assert.equal(minted.payload.onto, context.base.commit);
	assert.equal(minted.payload.base_commit, context.head, "the branch starts at the tip that would not replay");
	// And the base commit is in the worker's reach from its own worktree.
	execFileSync("git", ["-C", minted.payload.worktree, "cat-file", "-e", `${context.base.commit}^{commit}`]);
});

test("#194: a second conflict is the fresh-retry as today, and a third is failed / rebase-conflict — bound read from the journal", async (t) => {
	const context = await executing(t, {
		selectRoute: async () => ({ declared: "big-builder", profile: "big-builder", class: "local", rerouted: false, reason: null, considered: [] }),
	});
	const { phases } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: [conflicting(context)],
	});

	const settled = await context.walk(phases, {
		nextAttempt: context.nextAttempt,
		budgets: { repair: 1, freshRetry: 1, automation: 1 },
	});

	assert.equal(settled.disposition, "failed");
	assert.equal(settled.reason_class, "rebase-conflict");
	assert.equal(settled.fault, "repair", "the third conflict exhausted the product budget, as before #194");
	assert.deepEqual(context.asked.map((request) => request.tier), ["rebase-repair", "fresh-retry"]);
	// §8.6 counts resolutions, and the refused third one is itself a charge —
	// two fresh-retry resolutions against a bound of one. The rebase-repair
	// resolution is not among them.
	assert.deepEqual(spendOf(context), { repair: 0, freshRetry: 2, automation: 0 });
	// The record says what the controller did each time, so an operator reading
	// the journal sees the bound being spent without re-deriving it.
	const conflicts = context.store
		.readEvents({ stream: `run:${context.run}`, kind: "stage.resolved" })
		.filter((record) => record.phase === "verify")
		.map((record) => [record.payload.action, record.payload.budget]);
	assert.deepEqual(conflicts, [
		["rebase-repair", null],
		["fresh-retry", "repair"],
		["fresh-retry", "repair"],
	]);
});

test("#194: a rebase-repair whose rebased result is red routes verify × failed → repair, as today", async (t) => {
	const context = await executing(t);
	const { phases } = answeringInTurn({
		implement: ["completed"],
		harvest: ["passed"],
		verify: [conflicting(context), { outcome: "failed", detail: { red: ["unit"] } }, "passed"],
		review: ["approved"],
		integrate: [PUBLICATION],
	});

	const settled = await context.walk(phases, {
		nextAttempt: context.nextAttempt,
		budgets: { repair: 1, freshRetry: 0, automation: 0 },
	});

	assert.equal(settled.disposition, "published");
	assert.deepEqual(context.asked.map((request) => request.tier), ["rebase-repair", "repair"], "nothing new is trusted");
	assert.deepEqual(spendOf(context), { repair: 1, freshRetry: 0, automation: 0 });
});

test("#194: a rebase-repair that ends needs-human pauses the ticket with the worker's reason class, as any attempt does", async (t) => {
	const context = await executing(t);
	const { phases } = answeringInTurn({
		implement: [
			"completed",
			{
				outcome: "needs-human",
				detail: { reason_class: "spec-contradiction", question: "The base now forbids the approach the ticket asks for; which wins?" },
			},
		],
		harvest: ["passed"],
		verify: [conflicting(context)],
	});

	const settled = await context.walk(phases, { nextAttempt: context.nextAttempt });

	assert.equal(settled.disposition, "paused");
	assert.equal(settled.reason_class, "spec-contradiction");
	assert.match(settled.question, /which wins/);
	assert.deepEqual(context.asked.map((request) => request.tier), ["rebase-repair"]);
});

test("#194: a re-entry reads the row it recorded, not the row the journal would now route to", async (t) => {
	const context = await executing(t);
	const resolving = {
		hold: context.hold,
		run: context.run,
		ticket: context.ticket,
		phase: "verify",
		attempt: context.attempt,
		...conflicting(context),
		actor: "controller",
		at: FIXED_NOW,
	};
	const first = resolveStage(context.store, resolving);
	assert.equal(first.row.action, "rebase-repair");

	// The same semantic key, resolved again — a controller that died between the
	// resolution and the mint. The journal now holds one rebase-repair, and a
	// naive re-read would answer fresh-retry for a record that says otherwise.
	const again = resolveStage(context.store, resolving);
	assert.equal(again.state, "already-resolved");
	assert.equal(again.row.action, "rebase-repair", "the recorded action is the answer on re-entry");
});
