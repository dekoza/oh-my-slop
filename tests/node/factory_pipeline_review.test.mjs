import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { createAttemptWorktree } from "../../factory/lib/git/attempt.mjs";
import { dispositionOf } from "../../factory/lib/pipeline/dispositions.mjs";
import { openRetryAttempt, originatingAttempt, planRetry } from "../../factory/lib/pipeline/repair.mjs";
import { reviewPhase } from "../../factory/lib/pipeline/review.mjs";
import { outcomeChain, resolveStage, walkStages } from "../../factory/lib/pipeline/stages.mjs";
import { routeOutcome } from "../../factory/lib/pipeline/table.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { REVIEW_ROLES } from "../../factory/lib/worker/roles.mjs";
import { mintedAttempt } from "./helpers/factory-git.mjs";
import { FIXED_NOW, manualTimers } from "./helpers/factory-store.mjs";

/**
 * §8.4's review phase: **the controller fans out, not the worker.**
 *
 * Everything here runs against a real store and a real private clone, because
 * the two properties worth proving are both about the world rather than about
 * control flow: two attempts really do get two worktrees at one commit, and the
 * attestation really does see a reviewer that wrote.
 */

const OUTBOX_VERSION = 1;

/** A routing whose review pair names two different profiles (§11.5). */
function routing(review = ["reader-a", "reader-b"]) {
	return { roles: { implement: "builder", freshRetry: "big-builder", review }, rules: [] };
}

const BLOCKING = Object.freeze({
	severity: "blocking",
	citation: "docs/specs/software-factory.md §7.5",
	statement: "integration pushes from the worktree, not the clone",
});

const ADVISORY = Object.freeze({
	severity: "advisory",
	citation: "Refactoring ch.3: Middle Man",
	statement: "this wrapper only delegates",
});

/** A reviewer's outbox record, as §6.6 normalises one. */
function verdict(word, findings = []) {
	return { schema_version: OUTBOX_VERSION, status: "completed", verdict: word, findings, summary: "read it" };
}

/**
 * A store, a clone, a controller hold, and one builder attempt whose branch
 * carries a commit — the tip a review is run against.
 */
async function reviewable(t) {
	const context = await mintedAttempt(t);
	const leases = openLeases(context.store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store: context.store, leases, timers: manualTimers().api });

	hold.recordStartupReconcile();
	hold.adopt(context.run);

	const built = await createAttemptWorktree(context.store, context.clone, {
		hold,
		run: context.run,
		ticket: context.ticket,
		attempt: context.attempt,
		phase: "implement",
		baseCommit: context.base.commit,
		workerConfig: context.workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});
	writeFileSync(join(built.worktreePath, "feature.txt"), "the work\n");
	execFileSync("git", ["-C", built.worktreePath, "add", "-A"]);
	execFileSync("git", ["-C", built.worktreePath, "commit", "-m", "the work"]);

	// §7.4's harvest, resolved as the walk would resolve it. The fan-out reads the
	// commit under review off this record rather than taking one from its caller
	// (§14.13), so a fixture without it is a ticket execution that never measured
	// anything — which is exactly what the phase refuses.
	const reviewedCommit = execFileSync("git", ["-C", built.worktreePath, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	resolveStage(context.store, {
		hold,
		run: context.run,
		ticket: context.ticket,
		phase: "harvest",
		attempt: context.attempt,
		outcome: "passed",
		detail: { head: reviewedCommit, commits_ahead: 1 },
		actor: "controller",
		at: FIXED_NOW,
	});

	return { ...context, hold, reviewedCommit };
}

/**
 * The seam §8.4 leaves to the caller: launch one read-only reviewer and wait.
 *
 * It records every request, so the tests can assert what the fan-out asked for —
 * and it can be told to mutate the worktree it was given, which is the only way
 * to exercise the guard that matters.
 */
function reviewers(answers, { mutate = {} } = {}) {
	const asked = [];
	const overlapping = [];
	let inFlight = 0;

	return {
		asked,
		overlapping,
		runAxis: async (request) => {
			inFlight += 1;
			if (inFlight > 1) overlapping.push(request.axis.name);
			asked.push(request);

			const write = mutate[request.axis.name];
			if (write !== undefined) write(request.worktreePath);

			const answer = answers[request.axis.name];
			const resolved = typeof answer === "function" ? answer(request) : answer;
			inFlight -= 1;
			return resolved;
		},
	};
}

function review(context, { answers, routing: active = routing(), ...overrides } = {}) {
	const seam = reviewers(answers ?? {}, overrides);
	return {
		seam,
		run: (more = {}) =>
			reviewPhase(context.store, context.clone, {
				hold: context.hold,
				run: context.run,
				ticket: context.ticket,
				attempt: context.attempt,
				baseCommit: context.base.commit,
				routing: active,
				labels: [],
				workerConfig: context.workerConfig,
				runAxis: seam.runAxis,
				actor: "controller",
				now: () => FIXED_NOW,
				...more,
			}),
	};
}

/** Both axes answering the same way, which is most tests' uninteresting half. */
function bothAnswering(answer) {
	return Object.fromEntries(REVIEW_ROLES.map((axis) => [axis.name, answer]));
}

const APPROVING = Object.freeze({ outcome: "completed", record: verdict("approve") });

// ── The fan-out: two attempts, two worktrees, one commit (§8.4) ──────────────

test("the two axes are the controller's, each with its own entry skill and attempt identity (§8.4)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, { answers: bothAnswering(APPROVING) });

	await run();

	assert.deepEqual(
		seam.asked.map((request) => request.axis.name),
		["review-standards", "review-spec"],
	);
	assert.deepEqual(
		seam.asked.map((request) => request.axis.entrySkill),
		["review-standards", "review-spec"],
		"each axis is invoked through its own independently invocable entry skill",
	);
	assert.equal(new Set(seam.asked.map((request) => request.identity.attempt)).size, 2);
	for (const request of seam.asked) {
		assert.notEqual(request.identity.attempt, context.attempt, "a reviewer is never the builder's attempt");
		assert.equal(request.identity.phase, "review");
	}
});

test("each axis gets its own worktree, at the reviewed commit (§7.3, §8.4)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, { answers: bothAnswering(APPROVING) });

	await run();

	const paths = seam.asked.map((request) => request.worktreePath);
	assert.equal(new Set(paths).size, 2, "two attempts never share a worktree (§14.23)");
	for (const path of paths) {
		assert.ok(existsSync(path));
		assert.equal(
			execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
			context.reviewedCommit,
			"both axes read the same commit — the one verify passed on (§14.13)",
		);
	}
});

test("a reviewer is handed a worktree and a diff, and nothing that could open a pane (§8.4)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, { answers: bothAnswering(APPROVING) });

	await run();

	assert.deepEqual(Object.keys(seam.asked[0]).sort(), [
		"axis",
		"baseCommit",
		"branch",
		"identity",
		"posture",
		"profile",
		"reviewedCommit",
		"try",
		"worktreePath",
	]);
	assert.deepEqual(
		seam.asked.map((request) => request.posture),
		["reviewer", "reviewer"],
		"§6.8's posture derives from the role, and the fan-out says so rather than leaving it to the launcher",
	);
	for (const request of seam.asked) {
		// The fixed point is the run's pin, never the commit the worktree is at: a
		// reviewer told to diff the reviewed commit against itself sees no change.
		assert.equal(request.baseCommit, context.base.commit);
		assert.equal(request.reviewedCommit, context.reviewedCommit);
		assert.notEqual(request.baseCommit, request.reviewedCommit);
	}
	// §6.8's mechanical half of the deny floor, applied by `createAttemptWorktree`:
	// a reviewer's worktree cannot push any more than a builder's can.
	const worktreePath = seam.asked[0].worktreePath;
	const remote = execFileSync("git", ["-C", worktreePath, "remote"], { encoding: "utf8" }).trim().split("\n")[0];
	assert.throws(
		() => execFileSync("git", ["-C", worktreePath, "push", remote, "HEAD"], { stdio: "pipe", encoding: "utf8" }),
		(error) => /factory-deny-floor/.test(String(error.stderr)),
	);
});

test("§11.5's review pair maps onto the axes positionally: diversity is available, not mandated (§8.4)", async (t) => {
	const context = await reviewable(t);
	const diverse = review(context, { answers: bothAnswering(APPROVING), routing: routing(["reader-a", "reader-b"]) });
	await diverse.run();

	assert.deepEqual(
		diverse.seam.asked.map((request) => [request.axis.name, request.profile]),
		[
			["review-standards", "reader-a"],
			["review-spec", "reader-b"],
		],
	);

	const same = review(await reviewable(t), {
		answers: bothAnswering(APPROVING),
		routing: routing(["reader", "reader"]),
	});
	await same.run();

	assert.deepEqual(
		same.seam.asked.map((request) => request.profile),
		["reader", "reader"],
		"the same profile twice is a visible choice, and independence never came from distinct weights",
	);
});

test("a routing that does not name one profile per axis is refused, never stretched (§11.5)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, { answers: bothAnswering(APPROVING), routing: routing(["only-one"]) });

	await assert.rejects(run, (error) => {
		assert.equal(error.reason, "review-unroutable");
		assert.equal(error.details.at, "routing");
		return true;
	});
});

// ── Both always run to completion (§8.4, §15 case 12) ────────────────────────

test("the surviving axis is never cancelled on the other's rejection (§8.4)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, {
		answers: {
			"review-standards": { outcome: "completed", record: verdict("reject", [BLOCKING]) },
			"review-spec": APPROVING,
		},
	});

	const answered = await run();

	assert.deepEqual(seam.asked.map((request) => request.axis.name), ["review-standards", "review-spec"]);
	assert.equal(answered.outcome, "rejected");
});

test("under a size-1 class the axes take turns: they never overlap (§15 case 12)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, { answers: bothAnswering(APPROVING) });

	await run();

	assert.deepEqual(seam.overlapping, [], "there is never a moment when two review attempts want a model slot");
});

// ── The union, and what it decides (§8.4) ────────────────────────────────────

test("no blocking finding on either axis is an approval (§8.4)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: bothAnswering({ outcome: "completed", record: verdict("approve", [ADVISORY]) }),
	});

	const answered = await run();

	assert.equal(answered.outcome, "approved");
	assert.equal(routeOutcome("review", answered.outcome).to, "integrate");
	assert.equal(answered.detail.advisory.length, 2, "advisory findings are evidence and never a gate");
});

test("one or more blocking findings on either axis is a rejection (§8.4)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: {
			"review-standards": APPROVING,
			"review-spec": { outcome: "completed", record: verdict("reject", [BLOCKING]) },
		},
	});

	const answered = await run();

	assert.equal(answered.outcome, "rejected");
	assert.equal(routeOutcome("review", answered.outcome).action, "repair");
	assert.equal(routeOutcome("review", answered.outcome).evidence, "untrusted");
});

test("the union is a concatenation: nothing merged, nothing reranked, nothing dropped (§8.4)", async (t) => {
	const context = await reviewable(t);
	const shared = { ...BLOCKING, statement: "both axes noticed this" };
	const { run } = review(context, {
		answers: {
			"review-standards": { outcome: "completed", record: verdict("reject", [ADVISORY, shared]) },
			"review-spec": { outcome: "completed", record: verdict("reject", [shared, BLOCKING]) },
		},
	});

	const answered = await run();

	assert.deepEqual(
		answered.detail.blocking,
		[
			{ axis: "review-standards", ...shared },
			{ axis: "review-spec", ...shared },
			{ axis: "review-spec", ...BLOCKING },
		],
		"an identical finding from both axes stays two findings: deduplicating is merging",
	);
	assert.deepEqual(answered.detail.advisory, [{ axis: "review-standards", ...ADVISORY }]);
});

test("a rejection's detail is the reviewers' words, which is what the repair prompt quotes (§8.5)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: {
			"review-standards": { outcome: "completed", record: verdict("reject", [BLOCKING]) },
			"review-spec": APPROVING,
		},
	});

	const answered = await run();

	assert.deepEqual(Object.keys(answered.detail).sort(), ["advisory", "blocking"]);
});

// ── The attestation: the authoritative guard (§6.8, §14.19) ──────────────────

test("a reviewer that committed is a mutation, whatever verdict it also wrote (§6.8)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, {
		answers: bothAnswering(APPROVING),
		mutate: {
			"review-standards": (worktreePath) => {
				writeFileSync(join(worktreePath, "helpful.txt"), "I fixed it for you\n");
				execFileSync("git", ["-C", worktreePath, "add", "-A"]);
				execFileSync("git", ["-C", worktreePath, "commit", "-m", "helpful"]);
			},
		},
	});

	const answered = await run();

	assert.equal(answered.outcome, "mutation-detected");
	assert.equal(answered.detail.axis, "review-standards", "the mutation is attributable to a specific attempt");
	assert.deepEqual(answered.detail.attestation.reasons, ["head-moved"]);
	assert.deepEqual(
		seam.asked.map((request) => request.axis.name),
		["review-standards", "review-spec"],
		"both axes still ran to completion: the phase's answer is decided after both, never during",
	);
});

test("a reviewer that edited without committing is a mutation too (§6.8)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: bothAnswering(APPROVING),
		mutate: { "review-spec": (worktreePath) => writeFileSync(join(worktreePath, "notes.md"), "scratch\n") },
	});

	const answered = await run();

	assert.equal(answered.outcome, "mutation-detected");
	assert.equal(answered.detail.axis, "review-spec");
	assert.deepEqual(answered.detail.attestation.reasons, ["dirty-after"]);
});

test("mutation-detected is failed / review-mutation, and the only outcome with no retry (§14.19)", () => {
	const row = routeOutcome("review", "mutation-detected");

	assert.equal(row.retryable, false);
	assert.deepEqual(dispositionOf(row), { disposition: "failed", reason_class: "review-mutation", fault: null });
	assert.deepEqual(
		routeOutcome("review", "mutation-detected").budget,
		null,
		"retrying a read-only role that wrote buys a second violation",
	);
});

test("a mutating axis is never given another attempt (§14.19)", async (t) => {
	const context = await reviewable(t);
	const { seam, run } = review(context, {
		answers: bothAnswering(APPROVING),
		mutate: { "review-standards": (worktreePath) => writeFileSync(join(worktreePath, "x.txt"), "x\n") },
	});

	await run({ automationRetry: async () => assert.fail("a mutation is never charged to a budget") });

	assert.deepEqual(
		seam.asked.filter((request) => request.axis.name === "review-standards").map((request) => request.try),
		[1],
	);
});

test("the attestation rides every axis result, not only the mutations (§8.7)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, { answers: bothAnswering(APPROVING) });

	await run();

	const reviewed = context.store.readEvents({ kind: "stage.resolved" }).filter((record) => record.phase === "review");
	assert.equal(reviewed.length, 2, "each axis resolved its own stage, under its own attempt");
	assert.equal(new Set(reviewed.map((record) => record.attempt)).size, 2);
	for (const record of reviewed) {
		assert.equal(record.payload.detail.attestation.mutated, false);
		assert.equal(record.payload.detail.attestation.before_head, context.reviewedCommit);
	}
});

// ── §8.10's other review rows ────────────────────────────────────────────────

test("a reviewer's needs-human pauses the ticket execution under its own class (§14.18)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: {
			"review-standards": APPROVING,
			"review-spec": {
				outcome: "needs-human",
				record: { status: "needs-human", reason_class: "spec-contradiction", question: "which section wins?" },
			},
		},
	});

	const answered = await run();

	assert.equal(answered.outcome, "needs-human");
	assert.equal(answered.detail.reason_class, "spec-contradiction");
	assert.equal(answered.detail.question, "which section wins?");
	assert.equal(dispositionOf(routeOutcome("review", answered.outcome), { reasonClass: "spec-contradiction" }).disposition, "paused");
});

test("a completed reviewer that wrote no verdict produced no result for its role (§6.6, §8.4)", async (t) => {
	const context = await reviewable(t);
	const attempts = [];
	const { run } = review(context, {
		answers: {
			"review-standards": (request) => {
				attempts.push(request.try);
				return request.try === 1
					? { outcome: "completed", record: { status: "completed", verdict: null, findings: [] } }
					: APPROVING;
			},
			"review-spec": APPROVING,
		},
	});

	const answered = await run({ automationRetry: async () => {} });

	assert.deepEqual(attempts, [1, 2], "the axis was retried, because nothing was heard from it");
	assert.equal(answered.outcome, "approved");
	assert.equal(
		context.store
			.readEvents({ kind: "stage.resolved" })
			.find((record) => record.payload.detail.axis === "review-standards").payload.outcome,
		"invalid-result",
	);
});

test("a reviewer attempt that died is retried against the automation budget (§8.10)", async (t) => {
	const context = await reviewable(t);
	const charged = [];
	const { seam, run } = review(context, {
		answers: {
			"review-standards": (request) => (request.try === 1 ? { outcome: "dead-worker", record: null } : APPROVING),
			"review-spec": APPROVING,
		},
	});

	const answered = await run({
		automationRetry: async (request) => {
			charged.push(request);
		},
	});

	assert.deepEqual(charged.map((request) => [request.axis, request.outcome, request.budget, request.try]), [
		["review-standards", "dead-worker", "automation", 2],
	]);
	assert.equal(answered.outcome, "approved");
	const retried = seam.asked.filter((request) => request.axis.name === "review-standards");
	assert.equal(retried.length, 2);
	assert.notEqual(retried[0].identity.attempt, retried[1].identity.attempt, "every resume is a fresh attempt (§8.5)");
	assert.notEqual(retried[0].worktreePath, retried[1].worktreePath, "with a fresh worktree");
});

test("with no budget wired the review refuses rather than answering for an unheard axis (§8.6)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: { "review-standards": { outcome: "timeout", record: null }, "review-spec": APPROVING },
	});

	await assert.rejects(run, (error) => {
		assert.equal(error.reason, "retry-unplannable");
		assert.equal(error.details.budget, "automation");
		assert.match(error.message, /#111/);
		return true;
	});
});

// ── Re-entry (§8.10) ─────────────────────────────────────────────────────────

test("a re-entered review re-runs no axis and allocates no second attempt (§8.10)", async (t) => {
	const context = await reviewable(t);
	const first = review(context, { answers: bothAnswering(APPROVING) });
	const once = await first.run();

	const second = review(context, { answers: bothAnswering(APPROVING) });
	const again = await second.run();

	assert.deepEqual(again, once, "the record is the resume point");
	assert.deepEqual(second.seam.asked, [], "a recorded axis is not reviewed again");
	assert.equal(
		context.store.readEvents({ kind: "attempt.launched" }).filter((record) => record.payload.review !== undefined).length,
		2,
		"and the allocation found the mints it already wrote",
	);
});

test("a controller that died after the reviewer answered re-runs that axis and no other (§8.10)", async (t) => {
	const context = await reviewable(t);
	const died = review(context, {
		answers: {
			"review-standards": APPROVING,
			"review-spec": () => {
				throw new Error("controller died mid-review");
			},
		},
	});
	await assert.rejects(died.run, /controller died/);

	const resumed = review(context, { answers: bothAnswering(APPROVING) });
	const answered = await resumed.run();

	assert.equal(answered.outcome, "approved");
	assert.deepEqual(
		resumed.seam.asked.map((request) => request.axis.name),
		["review-spec"],
		"the axis whose stage was already resolved is read back rather than re-reviewed",
	);
});

// ── The phase, inside §8.1's walk ────────────────────────────────────────────

test("a rejected review routes to a repair whose attempt is past both reviewers' (§8.5, §2.1)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, {
		answers: {
			"review-standards": { outcome: "completed", record: verdict("reject", [BLOCKING]) },
			"review-spec": APPROVING,
		},
	});
	const planned = [];

	await assert.rejects(
		() =>
			walkStages(context.store, {
				hold: context.hold,
				run: context.run,
				ticket: context.ticket,
				attempt: context.attempt,
				phases: {
					implement: async () => ({ outcome: "completed" }),
					harvest: async () => ({ outcome: "passed" }),
					verify: async () => ({ outcome: "passed" }),
					review: () => run(),
				},
				nextAttempt: async (request) => {
					// The seam as a lane wires it: §8.5 plans the tier and
					// `openRetryAttempt` allocates §2.1's ordinal against the record.
					const plan = planRetry({
						prior: originatingAttempt(context.store, {
							run: context.run,
							ticket: context.ticket,
							attempt: request.attempt,
						}),
						failure: request,
					});
					const opened = await openRetryAttempt(context.store, context.clone, {
						hold: context.hold,
						plan,
						run: context.run,
						ticket: context.ticket,
						workerConfig: context.workerConfig,
						actor: "controller",
						at: FIXED_NOW,
					});
					planned.push(opened);
					// One repair is enough to show where the ordinal landed. §8.6's
					// budget granted it — this throw is only how the test stops, and
					// `factory_pipeline_stages.test.mjs` is where the budget's own
					// refusal is exercised.
					throw new Error("far enough");
				},
				budgets: { repair: 1, freshRetry: 1, automation: 1 },
				actor: "controller",
				now: () => FIXED_NOW,
			}),
		/far enough/,
	);

	assert.equal(planned[0].tier, "repair");
	assert.equal(
		planned[0].attempt,
		`${context.run}-t${context.ticket}-a4`,
		"a1 built it, a2 and a3 reviewed it, and the repair takes the next free ordinal rather than a reviewer's",
	);
	assert.deepEqual(
		outcomeChain(context.store, { run: context.run, ticket: context.ticket })
			.filter((step) => step.phase === "review")
			.map((step) => [step.outcome, step.attempt]),
		[
			["completed", `${context.run}-t${context.ticket}-a2`],
			["completed", `${context.run}-t${context.ticket}-a3`],
			["rejected", context.attempt],
		],
		"both axis results are on the chain under their own attempts, beside the phase's own under the builder's",
	);
	assert.deepEqual(
		planned[0].brief.untrusted.map((entry) => entry.source),
		["the reviewer", "the reviewer"],
		"§8.5: the findings reach the builder inside the delimited untrusted block, never as instructions",
	);
	assert.ok(
		planned[0].brief.untrusted.some((entry) => entry.text.includes(BLOCKING.statement)),
		"and the blocking finding is in it",
	);
});

test("the axis mint says why the attempt exists: which axis, whose work, which try (§6.5)", async (t) => {
	const context = await reviewable(t);
	const { run } = review(context, { answers: bothAnswering(APPROVING) });

	await run();

	assert.deepEqual(
		context.store
			.readEvents({ kind: "attempt.launched" })
			.filter((record) => record.payload.review !== undefined)
			.map((record) => record.payload.review),
		[
			{ axis: "review-standards", of: context.attempt, try: 1 },
			{ axis: "review-spec", of: context.attempt, try: 1 },
		],
	);
});
