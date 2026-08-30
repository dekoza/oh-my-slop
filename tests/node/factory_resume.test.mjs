import assert from "node:assert/strict";
import test from "node:test";

import { planTicketContinuation } from "../../factory/lib/pipeline/resume.mjs";

const RUN = "01PAUSED00000000000000000";
const TICKET = 42;
const ATTEMPT = `${RUN}-t${TICKET}-a1`;
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function pauseBody({ attempt = ATTEMPT, question = "Which rule applies?" } = {}) {
	return [
		"🤖 **factory — paused** · `product-ambiguity`",
		"",
		"```json",
		JSON.stringify(
			{
				schema_version: 1,
				identity: { run: RUN, ticket: TICKET, attempt },
				disposition: "paused",
				reason_class: "product-ambiguity",
				question,
			},
			null,
			2,
		),
		"```",
	].join("\n");
}

function snapshot(comments) {
	return Object.freeze({
		snapshot_version: 1,
		number: TICKET,
		title: "Resume the work",
		body: "Keep committed work after clarification.",
		state: "open",
		labels: Object.freeze(["workflow:implement", "ready-for-agent"]),
		assignees: Object.freeze(["kuferek"]),
		updated_at_raw: "2026-08-30T14:00:00Z",
		content_version: 1,
		snapshot_at: Date.parse("2026-08-30T14:10:00Z"),
		snapshot_at_raw: "2026-08-30T14:10:00.000Z",
		comments: Object.freeze(comments.map((comment) => Object.freeze(comment))),
	});
}

function comment(id, author, body) {
	return {
		id,
		author,
		body,
		created_at_raw: `2026-08-30T14:0${id}:00Z`,
		updated_at_raw: `2026-08-30T14:0${id}:00Z`,
	};
}

function cloneAnswering() {
	const calls = [];
	return {
		calls,
		git: async (args) => {
			calls.push(args);
			if (args[0] === "rev-parse") return HEAD;
			if (args[0] === "rev-list") return "1";
			throw new Error(`unexpected git call: ${args.join(" ")}`);
		},
	};
}

test("a cleared needs-human ticket resumes from the paused attempt's committed tip", async () => {
	const clone = cloneAnswering();
	const ticketSnapshot = snapshot([
		comment(1, "kuferek", pauseBody()),
		comment(2, "minder", "Use the cancellation-time rule."),
	]);

	const plan = await planTicketContinuation({
		clone,
		baseCommit: BASE,
		ticketSnapshot,
		trackerLogin: "kuferek",
	});

	assert.equal(plan.kind, "resume");
	assert.equal(plan.baseCommit, HEAD);
	assert.equal(plan.claim.paused_attempt, ATTEMPT);
	assert.equal(plan.claim.pause_comment, 1);
	assert.deepEqual(plan.claim.answering_comments, [{ id: 2, author: "minder" }]);
	assert.equal(plan.claim.resumed_from, HEAD);
	assert.equal(plan.brief.resume.exchanges[0].question, "Which rule applies?");
	assert.deepEqual(plan.brief.resume.exchanges[0].answers, [
		{ id: 2, author: "minder", body: "Use the cancellation-time rule." },
	]);
	assert.deepEqual(plan.ticketSnapshot.comments.map((entry) => entry.id), [1], "the answer would otherwise render twice");
	assert.deepEqual(clone.calls, [
		["rev-parse", "--verify", `refs/heads/factory/t${TICKET}/a${ATTEMPT}^{commit}`],
		["rev-list", "--count", `${BASE}..${HEAD}`],
	]);
});
