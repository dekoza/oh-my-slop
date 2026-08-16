import assert from "node:assert/strict";
import test from "node:test";

import { writeArtifact } from "../../factory/lib/artifacts/writes.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { claimTicket, isClaimComment } from "../../factory/lib/tracker/claims.mjs";
import { applyDisposition, DISPOSITION_ACTIONS } from "../../factory/lib/tracker/disposition.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { attemptLaunched, openCapacityPool } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue, TRACKER_NOW } from "./helpers/factory-tracker.mjs";

/**
 * §8.9's four dispositions as facts on the tracker, and the one machine-parseable
 * comment block all four of them carry.
 */

const ASSIGNEE = "kuferek";

/** A store with a run, a hold, and a tracker the reads and the writes share. */
async function settling(t, options) {
	const pool = await openCapacityPool(t);
	const gitea = fakeGitea(options);
	const where = { repo: "acme/widgets", login: "kuferek" };

	return {
		...pool,
		gitea,
		reader: createGiteaReader({ ...where, request: gitea.request }),
		writer: createGiteaWriter({ ...where, request: gitea.write }),
	};
}

/** The ticket is claimed first, exactly as a ticket execution reaches §8.9. */
async function claimed(context, ticket) {
	await claimTicket(context.store, {
		reader: context.reader,
		writer: context.writer,
		hold: context.hold,
		run: context.run,
		ticket,
		attempt: `${context.run}-t${ticket}-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
	});
	return `${context.run}-t${ticket}-a1`;
}

function dispose(context, { ticket, ...rest }) {
	return applyDisposition(context.store, {
		writer: context.writer,
		hold: context.hold,
		run: context.run,
		ticket,
		attempt: `${context.run}-t${ticket}-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
		...rest,
	});
}

/** The stages a ticket execution walked, as the journal would hold them (§8.10). */
function resolveStages(context, ticket, attempt, stages) {
	// The projections refuse an attempt-scoped record for a tuple nothing minted,
	// so the attempt is launched first exactly as a lane would launch it.
	context.store.append(attemptLaunched(context.run, ticket, 1, { at: TRACKER_NOW }));

	for (const [phase, outcome] of stages) {
		resolveStage(context.store, {
			hold: context.hold,
			run: context.run,
			ticket,
			phase,
			attempt,
			outcome,
			actor: "controller",
			at: TRACKER_NOW,
		});
	}
}

function labelsOf(gitea, ticket) {
	return gitea.issues.find((issue) => issue.number === ticket).labels.map((label) => label.name);
}

function assigneesOf(gitea, ticket) {
	return gitea.issues.find((issue) => issue.number === ticket).assignees.map((user) => user.login);
}

/** The machine half of the comment, read back the way a machine would read it. */
function blockIn(body) {
	const fenced = /`{3,}json\n([\s\S]*?)\n`{3,}/.exec(body);
	assert.ok(fenced !== null, `no machine-parseable block in:\n${body}`);
	return JSON.parse(fenced[1]);
}

test("paused sets factory:needs-human, retains the assignee, and carries the reason class and the exact question", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	const attempt = await claimed(context, 10);
	const question = "Should a cancelled order keep its invoice?\n\nThe spec says both, in §4 and §9.";

	const paused = await dispose(context, {
		ticket: 10,
		disposition: "paused",
		reasonClass: "product-ambiguity",
		question,
	});

	assert.equal(paused.disposition, "paused");
	assert.deepEqual(labelsOf(context.gitea, 10), [
		"workflow:implement",
		"ready-for-agent",
		FACTORY_LABELS.needsHuman,
	]);
	// §8.9: the assignee is retained, so nothing else claims the ticket while a
	// human owes it an answer.
	assert.deepEqual(assigneesOf(context.gitea, 10), [ASSIGNEE]);

	const body = context.gitea.comments.at(-1).body;
	const block = blockIn(body);
	assert.deepEqual(block.identity, { run: context.run, ticket: 10, attempt });
	assert.equal(block.disposition, "paused");
	assert.equal(block.reason_class, "product-ambiguity");
	// **The exact question**, not a summary: the human's reply is what resumes the
	// ticket, so a lossy rendering would have them answer a different question.
	assert.equal(block.question, question);
	assert.ok(body.includes("> Should a cancelled order keep its invoice?"), "the question is not visible to a human");
});

test("failed sets factory:failed, retains the assignee, and carries the outcome chain", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	const attempt = await claimed(context, 10);
	resolveStages(context, 10, attempt, [
		["implement", "completed"],
		["harvest", "passed"],
		["verify", "failed"],
	]);

	const failed = await dispose(context, {
		ticket: 10,
		disposition: "failed",
		reasonClass: "repair-budget-exhausted",
	});

	assert.equal(failed.disposition, "failed");
	assert.ok(labelsOf(context.gitea, 10).includes(FACTORY_LABELS.failed));
	assert.deepEqual(assigneesOf(context.gitea, 10), [ASSIGNEE]);

	// §8.10: the operator's next action depends on the **shape** of the chain, not
	// on its last element, so the comment carries the whole of it.
	const block = blockIn(context.gitea.comments.at(-1).body);
	assert.deepEqual(
		block.outcome_chain.map((step) => [step.phase, step.outcome, step.attempt]),
		[
			["implement", "completed", attempt],
			["harvest", "passed", attempt],
			["verify", "failed", attempt],
		],
	);
	assert.equal(block.reason_class, "repair-budget-exhausted");
});

test("published sets factory:awaiting-merge, retains the assignee, and links the PR", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	await claimed(context, 10);

	const published = await dispose(context, {
		ticket: 10,
		disposition: "published",
		pr: { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" },
	});

	assert.equal(published.disposition, "published");
	assert.ok(labelsOf(context.gitea, 10).includes(FACTORY_LABELS.awaitingMerge));
	assert.deepEqual(assigneesOf(context.gitea, 10), [ASSIGNEE]);

	const body = context.gitea.comments.at(-1).body;
	assert.deepEqual(blockIn(body).pr, { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" });
	assert.ok(body.includes("http://gitea.example/acme/widgets/pulls/7"), "the PR link is not visible to a human");
});

test("settling the same ticket execution again mutates nothing — the effect key is the idempotency", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	await claimed(context, 10);
	const first = await dispose(context, {
		ticket: 10,
		disposition: "paused",
		reasonClass: "missing-access",
		question: "Which credential should the deploy use?",
	});
	const writesAfterFirst = context.gitea.writes.length;

	// A re-entered run re-derives the same disposition from durable state and
	// arrives here again. Nothing about the block reads a clock, so the payload
	// is the one already committed and Gitea is never asked twice (§4.5, §10.4).
	const again = await dispose(context, {
		ticket: 10,
		disposition: "paused",
		reasonClass: "missing-access",
		question: "Which credential should the deploy use?",
		at: TRACKER_NOW + 90_000,
	});

	assert.equal(context.gitea.writes.length, writesAfterFirst, "a second settlement mutated the tracker");
	assert.equal(again.comment.id, first.comment.id);
	assert.equal(again.comment.outcome, "already-resolved");
	assert.equal(labelsOf(context.gitea, 10).filter((label) => label === FACTORY_LABELS.needsHuman).length, 1);
});

test("a second, different disposition for one ticket execution is a typed conflict, never a second block", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	await claimed(context, 10);
	await dispose(context, { ticket: 10, disposition: "failed", fault: "automation" });

	// One ticket execution settles once. The comment's effect key does not carry
	// the disposition, precisely so that a second one disagreeing about how this
	// execution ended is §4.5's payload conflict rather than two blocks on the
	// ticket saying different things.
	await assert.rejects(() => dispose(context, { ticket: 10, disposition: "released" }), {
		reason: "effect-payload-conflict",
	});
	assert.equal(context.gitea.comments.filter((comment) => comment.body.includes('"disposition"')).length, 1);
});

test("a disposition refuses rather than posting a block it cannot carry", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	await claimed(context, 10);
	const writesBefore = context.gitea.writes.length;

	// §3.4: the exact question is what the human answers, so a pause without one
	// puts a ticket in front of somebody with nothing to reply to.
	await assert.rejects(() => dispose(context, { ticket: 10, disposition: "paused", reasonClass: "dependency-unmet" }), {
		reason: "disposition-incomplete",
	});
	// §8.9: `published` links the PR. A published ticket whose work nobody can
	// find is the same failure as no publication at all.
	await assert.rejects(() => dispose(context, { ticket: 10, disposition: "published" }), {
		reason: "disposition-incomplete",
	});
	// §14.18 owns which class settles as what, so a class filed under the wrong
	// disposition is refused by the one function that maps them.
	await assert.rejects(
		() => dispose(context, { ticket: 10, disposition: "failed", reasonClass: "product-ambiguity" }),
		{ reason: "disposition-incomplete" },
	);
	await assert.rejects(() => dispose(context, { ticket: 10, disposition: "abandoned" }), {
		reason: "disposition-unknown",
	});

	assert.equal(context.gitea.writes.length, writesBefore, "a refused disposition still wrote to the tracker");
});

test("§14.20: no disposition removes a label or re-adds ready-for-agent", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 }), giteaIssue({ number: 11 })] });
	await claimed(context, 10);
	await dispose(context, {
		ticket: 10,
		disposition: "failed",
		reasonClass: "check-unrunnable",
	});

	// The legacy failure this replaces removed `ready-for-human` and added
	// `ready-for-agent` back, re-arming a ticket for the next run to die on
	// identically with nobody watching. Every label the fixture started with is
	// still there, one label has been added, and no write removed anything.
	assert.deepEqual(labelsOf(context.gitea, 10), ["workflow:implement", "ready-for-agent", FACTORY_LABELS.failed]);
	assert.deepEqual(
		context.gitea.writes.filter((write) => write.operation.startsWith("label")).map((write) => write.body.labels),
		[[FACTORY_LABELS.failed]],
	);
	assert.deepEqual(
		Object.values(DISPOSITION_ACTIONS)
			.map((row) => row.label)
			.filter((label) => label !== null),
		[FACTORY_LABELS.awaitingMerge, FACTORY_LABELS.needsHuman, FACTORY_LABELS.failed],
	);
});

test("the block references this ticket execution's evidence by digest, and never by path", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	const attempt = await claimed(context, 10);
	const written = writeArtifact(context.store, {
		content: "1 passed, 0 failed\n",
		mediaType: "text/plain",
		role: "check-output",
		name: "unit-e1",
		run: context.run,
		ticket: 10,
		phase: "verify",
		actor: "controller",
		fencingGeneration: context.hold.fencingGeneration,
		at: TRACKER_NOW,
	});
	// A second run's artifact for a different ticket must not be in this block.
	writeArtifact(context.store, {
		content: "somebody else's output\n",
		mediaType: "text/plain",
		role: "check-output",
		name: "unit-e2",
		run: context.run,
		ticket: 11,
		phase: "verify",
		actor: "controller",
		fencingGeneration: context.hold.fencingGeneration,
		at: TRACKER_NOW,
	});

	await dispose(context, { ticket: 10, disposition: "failed", fault: "automation" });

	const evidence = blockIn(context.gitea.comments.at(-1).body).evidence;
	assert.deepEqual(
		evidence.map((reference) => reference.digest),
		[written.reference.digest],
	);
	// §14.28: an artifact is addressed by digest, never by a location — so there
	// is nothing in the block for a `../` to be typed into.
	assert.equal(JSON.stringify(evidence).includes("/blobs/"), false);
	assert.equal(evidence[0].produced_by, written.key);
	assert.equal(evidence[0].bytes, written.reference.bytes);
	assert.equal(evidence[0].produced_by.includes(attempt) || evidence[0].produced_by.includes("/10/"), true);
});

test("§8.9: every disposition gets the same block — identity tuple, outcome chain, evidence", async (t) => {
	const settlements = {
		published: { pr: { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" } },
		paused: { reasonClass: "out-of-scope-discovered", question: "Is the migration in scope?" },
		failed: { reasonClass: "review-mutation" },
		released: { reason: "the controller shut down mid-attempt" },
	};

	// One ticket per disposition, each in its own store, because a ticket
	// execution settles once — and the point here is that the four blocks have
	// one shape rather than four.
	for (const [disposition, extra] of Object.entries(settlements)) {
		const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
		const attempt = await claimed(context, 10);
		resolveStages(context, 10, attempt, [["implement", "completed"]]);

		await dispose(context, { ticket: 10, disposition, ...extra });

		const block = blockIn(context.gitea.comments.at(-1).body);
		assert.deepEqual(
			{ ...block, outcome_chain: block.outcome_chain.length, evidence: block.evidence.length },
			{
				schema_version: 1,
				identity: { run: context.run, ticket: 10, attempt },
				disposition,
				reason_class: extra.reasonClass ?? null,
				fault: null,
				question: extra.question ?? null,
				reason: extra.reason ?? null,
				pr: extra.pr ?? null,
				// §8.7's advisory findings, on every block for the same reason the
				// question is: one shape, whatever the disposition, so a machine
				// reading a ticket's history parses one thing.
				advisory: extra.advisory ?? null,
				outcome_chain: 1,
				evidence: 0,
			},
			`${disposition} does not carry §8.9's block`,
		);
	}
});

test("§8.7's summary and advisory findings land in the ticket comment; blocking findings never do", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	const attempt = await claimed(context, 10);
	resolveStages(context, 10, attempt, [["implement", "completed"]]);

	await dispose(context, {
		ticket: 10,
		disposition: "published",
		pr: { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" },
		reason: "3 required check(s) green at abcdef012345; 2 review axis verdict(s): approved, approved.",
		advisory: [{ axis: "review-standards", severity: "advisory", statement: "this helper could be inlined" }],
	});

	const posted = context.gitea.comments.at(-1).body;
	const block = blockIn(posted);
	assert.match(block.reason, /3 required check\(s\) green/);
	assert.deepEqual(block.advisory.map((finding) => finding.statement), ["this helper could be inlined"]);
	// The caller passes no blocking findings, and the block has no slot to put one
	// in: a blocking finding is one a repair already answered.
	assert.equal(Object.hasOwn(block, "blocking"), false);
});

test("released drops the claim with no label, and still carries the block", async (t) => {
	const context = await settling(t, { issues: [giteaIssue({ number: 10 })] });
	await claimed(context, 10);

	const released = await dispose(context, {
		ticket: 10,
		disposition: "released",
		reason: "the operator stopped the run",
	});

	assert.equal(released.disposition, "released");
	assert.deepEqual(assigneesOf(context.gitea, 10), []);
	// §8.9: no label. The labels are exactly as the fixture created them.
	assert.deepEqual(labelsOf(context.gitea, 10), ["workflow:implement", "ready-for-agent"]);

	const block = blockIn(context.gitea.comments.at(-1).body);
	assert.equal(block.disposition, "released");
	assert.equal(block.reason, "the operator stopped the run");
	// It carries no claim marker: a release announcement must not read as a
	// contender to the next run's arbitration (§3.3).
	assert.equal(isClaimComment(context.gitea.comments.at(-1).body), false);
});
