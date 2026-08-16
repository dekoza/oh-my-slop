import assert from "node:assert/strict";
import test from "node:test";

import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { claimTicket, isClaimComment } from "../../factory/lib/tracker/claims.mjs";
import { applyDisposition } from "../../factory/lib/tracker/disposition.mjs";
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
