import assert from "node:assert/strict";
import test from "node:test";

import { commentCarriesEffectKey } from "../../factory/lib/effects/keys.mjs";
import { unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { EFFECT_REGISTRY } from "../../factory/lib/effects/registry.mjs";
import {
	CLAIM_OUTCOMES,
	claimTicket,
	FOREIGN_STALE_AFTER_MS,
	isClaimComment,
} from "../../factory/lib/tracker/claims.mjs";
import { applyDisposition } from "../../factory/lib/tracker/disposition.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter, TRACKER_WRITES } from "../../factory/lib/tracker/writer.mjs";
import { fakeGitea, giteaComment, giteaIssue, TRACKER_NOW } from "./helpers/factory-tracker.mjs";
import { openCapacityPool, runEnded, runMoved } from "./helpers/factory-store.mjs";

/**
 * §3.3's claim: assignee plus a structured claim comment, then a re-read — and
 * every way that re-read can come back.
 */

const ASSIGNEE = "kuferek";

/** The reader, the writer, and the world all three of them see. */
function tracker(options) {
	const gitea = fakeGitea(options);
	const where = { repo: "acme/widgets", login: "kuferek" };
	return {
		gitea,
		reader: createGiteaReader({ ...where, request: gitea.request }),
		writer: createGiteaWriter({ ...where, request: gitea.write }),
	};
}

async function claiming(t, options) {
	const pool = await openCapacityPool(t);
	return { ...pool, ...tracker(options) };
}

function claim(store, { reader, writer, hold, run, ticket, ...rest }) {
	return claimTicket(store, {
		reader,
		writer,
		hold,
		run,
		ticket,
		attempt: `${run}-t${ticket}-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
		...rest,
	});
}

test("a claim is the assignee, a structured comment carrying §3.3's four fields, and a re-read", async (t) => {
	const { store, run, hold, reader, writer, gitea } = await claiming(t, { issues: [giteaIssue({ number: 10 })] });

	const claimed = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(claimed.outcome, CLAIM_OUTCOMES.claimed);
	assert.deepEqual(
		gitea.writes.map((write) => write.operation),
		["issue-assign", "comment-post"],
	);

	const posted = gitea.comments.at(-1);
	assert.equal(posted.user.login, ASSIGNEE);
	for (const field of [`run: ${run}`, "ticket: 10", `attempt: ${run}-t10-a1`, `at: ${new Date(TRACKER_NOW).toISOString()}`]) {
		assert.ok(posted.body.includes(field), `the claim comment omits "${field}"`);
	}

	// The re-read is §3.3's, not an implementation detail: the claim is not
	// answered until the tracker has been asked what it now says.
	const reads = gitea.calls.map((entry) => entry.call);
	assert.deepEqual(reads, ["issue.get", "issue.get", "issue.comments"]);
	assert.ok(gitea.issues[0].assignees.some((user) => user.login === ASSIGNEE));
});

test("every tracker mutation is a §4.5 pair, and none is left requested", async (t) => {
	const { store, run, hold, reader, writer, gitea } = await claiming(t, { issues: [giteaIssue({ number: 10 })] });

	await claim(store, { reader, writer, hold, run, ticket: 10 });

	const effects = store.read((db) => db.prepare("SELECT * FROM effect ORDER BY requested_seq").all());
	assert.deepEqual(
		effects.map((row) => [row.operation, row.state, row.ticket]),
		[
			["issue-assign", "resolved", 10],
			["comment-post", "resolved", 10],
		],
	);
	assert.deepEqual(unresolvedEffects(store), []);

	// §4.5: the comment carries **its own** effect key, exactly, so the probe finds
	// *this* comment rather than one that merely looks like it.
	const posted = effects.find((row) => row.operation === "comment-post");
	assert.ok(commentCarriesEffectKey(gitea.comments.at(-1).body, posted.effect_key));
	assert.ok(!commentCarriesEffectKey(gitea.comments.at(-1).body, effects[0].effect_key));
	assert.equal(JSON.parse(posted.result).comment_id, gitea.comments.at(-1).id);
});

test("re-claiming the same ticket in the same run mutates nothing — the effect key is the idempotency", async (t) => {
	const { store, run, hold, reader, writer, gitea } = await claiming(t, { issues: [giteaIssue({ number: 10 })] });

	await claim(store, { reader, writer, hold, run, ticket: 10 });
	const writesAfterFirst = gitea.writes.length;
	const again = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(again.outcome, CLAIM_OUTCOMES.alreadyClaimed);
	assert.match(again.reason, /already claimed by this run/);
	assert.equal(gitea.writes.length, writesAfterFirst, "a second claim mutated the tracker");
});

test("an assignee the factory did not set is an absolute human claim — no write, no clock consulted", async (t) => {
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		// Idle for a year: staleness must not even be asked about (§3.3).
		issues: [giteaIssue({ number: 10, assignees: ["a-human"], updatedAt: "2025-01-01T00:00:00+00:00" })],
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.humanClaimed);
	assert.match(answered.reason, /a-human/);
	assert.deepEqual(gitea.writes, [], "a human claim was contested");
	assert.deepEqual(unresolvedEffects(store), []);
});

test("a live same-factory claim is never contested", async (t) => {
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
	});

	// A first run claims it, and stays running.
	await claim(store, { reader, writer, hold, run, ticket: 10 });
	const writesAfterFirst = gitea.writes.length;

	const other = "01JRUNOTHER0000000000000B";
	store.append({
		kind: "run.started",
		source: "controller",
		run: other,
		occurredAt: TRACKER_NOW,
		observedAt: TRACKER_NOW,
		payload: { scope: { kind: "direct-ticket", tickets: [10] } },
	});

	const answered = await claim(store, { reader, writer, hold, run: other, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.liveClaim);
	assert.match(answered.reason, new RegExp(run));
	assert.equal(gitea.writes.length, writesAfterFirst, "a live claim was contested");
});

test("same-factory staleness is proven from durable state, with no waiting period", async (t) => {
	const { store, run, hold, reader, writer, gitea } = await claiming(t, { issues: [giteaIssue({ number: 10 })] });

	await claim(store, { reader, writer, hold, run, ticket: 10 });
	store.append(runMoved(run, "draining", { at: TRACKER_NOW }));
	store.append(runEnded(run, { at: TRACKER_NOW, endReason: "abandoned" }));

	const other = "01JRUNOTHER0000000000000B";
	store.append({
		kind: "run.started",
		source: "controller",
		run: other,
		occurredAt: TRACKER_NOW,
		observedAt: TRACKER_NOW,
		payload: { scope: { kind: "direct-ticket", tickets: [10] } },
	});

	// The ticket was touched seconds ago, so no clock-based rule could permit
	// this. The proof is the ended run, and §3.3 gives it no waiting period.
	const answered = await claim(store, { reader, writer, hold, run: other, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.takenOver);
	assert.equal(answered.takeover.tier, "same-factory");
	assert.equal(answered.takeover.claimed_by, run);

	// §3.3: the takeover comment is posted **first**. The first run's two writes
	// lead, so the takeover's are the last three.
	assert.deepEqual(
		gitea.writes.slice(2).map((write) => write.operation),
		["comment-post", "issue-assign", "comment-post"],
	);
	// The comment says **what it displaced**, and the fields come from the verdict
	// rather than from the wrapper carrying it: §5.2 makes comment text
	// authoritative for nothing, so nothing downstream would ever catch an
	// `undefined` rendered into the one artefact a human reads here.
	const posted = gitea.writes[2].body.body;
	assert.match(posted, /claim taken over/);
	assert.match(posted, /The previous claim is this factory's: run \w+ ended abandoned\./);
	assert.match(posted, new RegExp(`taken_over_from: ${run}`));
	assert.match(posted, /tier: same-factory/);
	assert.equal(posted.includes("undefined"), false);
});

test("a re-entered takeover rebuilds its comment under a later clock and posts nothing twice", async (t) => {
	// §10.4's re-entry, at the one point it is reachable: a crash between the
	// assignment's intent and its resolution leaves the takeover comment recorded
	// and the claim unproven, so the next pass takes the ticket over again. The
	// comment body carries §3.3's timestamp, which is a different value on that
	// pass — and the effect is idempotent only if what the key compares is the
	// claim's *intent* rather than the prose rendered from it.
	const { store, run, hold, reader, writer, gitea } = await claiming(t, { issues: [giteaIssue({ number: 10 })] });
	await claim(store, { reader, writer, hold, run, ticket: 10 });
	store.append(runMoved(run, "draining", { at: TRACKER_NOW }));
	store.append(runEnded(run, { at: TRACKER_NOW, endReason: "abandoned" }));

	const other = "01JRUNOTHER0000000000000B";
	store.append({
		kind: "run.started",
		source: "controller",
		run: other,
		occurredAt: TRACKER_NOW,
		observedAt: TRACKER_NOW,
		payload: { scope: { kind: "direct-ticket", tickets: [10] } },
	});
	await claim(store, { reader, writer, hold, run: other, ticket: 10 });

	// The crash: the assignment's record never reached `resolved`, so nothing in
	// durable state proves this run holds the ticket.
	store.transaction(({ db }) => {
		db.prepare(
			`UPDATE effect SET state = 'requested', resolved_at = NULL, resolved_seq = NULL, result = NULL
			 WHERE run_id = ? AND operation = 'issue-assign'`,
		).run(other);
	});
	const writesBefore = gitea.writes.length;
	const commentsBefore = gitea.comments.length;

	const again = await claim(store, { reader, writer, hold, run: other, ticket: 10, at: TRACKER_NOW + 3_600_000 });

	assert.equal(again.outcome, CLAIM_OUTCOMES.takenOver);
	assert.equal(gitea.comments.length, commentsBefore, "the re-entered claim posted its comments a second time");
	// Only the assignment is performed again: it is the one mutation this run
	// cannot prove landed.
	assert.deepEqual(
		gitea.writes.slice(writesBefore).map((write) => write.operation),
		["issue-assign"],
	);
	assert.deepEqual(unresolvedEffects(store), []);
});

test("a claim this factory released is not proof of a later one, so the foreign tier applies", async (t) => {
	// Run A claims #10 and releases it. Somebody else — same assignee login, a
	// different install — then claims it. Matching on the old assign row would let
	// §3.3's first tier take it over with no waiting period, on the strength of a
	// record describing a claim this factory already gave up.
	const { store, run, hold, reader, writer, gitea } = await claiming(t, { issues: [giteaIssue({ number: 10 })] });
	await claim(store, { reader, writer, hold, run, ticket: 10 });
	await applyDisposition(store, {
		writer,
		hold,
		run,
		ticket: 10,
		attempt: `${run}-t10-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
		disposition: "released",
		reason: "done with it",
	});
	gitea.issues[0].assignees = [{ id: 9, login: ASSIGNEE, username: ASSIGNEE }];
	const writesBefore = gitea.writes.length;

	const other = "01JRUNOTHER0000000000000B";
	store.append({
		kind: "run.started",
		source: "controller",
		run: other,
		occurredAt: TRACKER_NOW,
		observedAt: TRACKER_NOW,
		payload: { scope: { kind: "direct-ticket", tickets: [10] } },
	});

	const answered = await claim(store, { reader, writer, hold, run: other, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.notStale);
	assert.equal(gitea.writes.length, writesBefore, "a claim this factory cannot account for was taken over");
});

test("a foreign claim with recent ticket trace is not stale, however the assignee reads", async (t) => {
	const fresh = new Date(TRACKER_NOW - 60_000).toISOString();
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		issues: [giteaIssue({ number: 10, assignees: [ASSIGNEE], updatedAt: fresh })],
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.notStale);
	assert.equal(answered.idle_ms, 60_000);
	assert.deepEqual(gitea.writes, []);
});

test("a foreign claim goes stale after 24h without ticket trace, takeover comment first", async (t) => {
	const old = new Date(TRACKER_NOW - FOREIGN_STALE_AFTER_MS - 60_000).toISOString();
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		issues: [giteaIssue({ number: 10, assignees: [ASSIGNEE], updatedAt: old })],
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.takenOver);
	assert.equal(answered.takeover.tier, "foreign");
	assert.equal(gitea.writes[0].operation, "comment-post");
	assert.match(gitea.writes[0].body.body, /claim taken over/);
});

test("a comment is ticket trace too — an idle field with a live discussion is not abandoned", async (t) => {
	const old = new Date(TRACKER_NOW - FOREIGN_STALE_AFTER_MS - 60_000).toISOString();
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		issues: [giteaIssue({ number: 10, assignees: [ASSIGNEE], updatedAt: old })],
		comments: [
			giteaComment({
				id: 500,
				ticket: 10,
				createdAt: new Date(TRACKER_NOW - 5_000).toISOString(),
				updatedAt: new Date(TRACKER_NOW - 5_000).toISOString(),
			}),
		],
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.notStale);
	assert.deepEqual(gitea.writes, []);
});

test("a collision is arbitrated by the lowest claim-comment id, and the loser leaves the winner's claim alone", async (t) => {
	// A second factory claims the same ticket while ours is in flight: its comment
	// id is lower, and it wins.
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
		onWrite: ({ operation, ticket }, world) => {
			if (operation !== "comment-post" || world.comments.some((c) => c.id === 1)) return;
			world.comments.push(
				giteaComment({
					id: 1,
					ticket,
					author: "other-factory",
					body: "<!-- factory-claim -->\nsomebody else got here first",
					createdAt: new Date(TRACKER_NOW).toISOString(),
					updatedAt: new Date(TRACKER_NOW).toISOString(),
				}),
			);
		},
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.lostCollision);
	assert.deepEqual(answered.lost_to, [1]);

	// **The loser writes nothing further.** Id arbitration is only reachable
	// between installs sharing one tracker identity — any other login is answered
	// as an absolute human claim before a single write — so "un-assign myself"
	// would be a PATCH clearing the *winner's* assignee, leaving it holding a claim
	// comment on an unassigned ticket. §3.3's "a live claim is never contested"
	// outranks its "the loser un-assigns itself" where the two collide.
	assert.deepEqual(
		gitea.writes.map((write) => write.operation),
		["issue-assign", "comment-post"],
	);
	assert.deepEqual(
		gitea.issues[0].assignees.map((user) => user.login),
		[ASSIGNEE],
		"the loser cleared the assignee the winner is claiming under",
	);
});

test("a claim comment from a concluded claim is not a contender, however low its id", async (t) => {
	// The ticket is unassigned, so whatever this old claim was, it is over. Its id
	// is 1; treating it as a contender would make the ticket permanently unclaimable.
	const { store, run, hold, reader, writer } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
		comments: [
			giteaComment({
				id: 1,
				ticket: 10,
				body: "<!-- factory-claim -->\na claim from a run that has long since ended",
				createdAt: new Date(TRACKER_NOW - 86_400_000).toISOString(),
				updatedAt: new Date(TRACKER_NOW - 86_400_000).toISOString(),
			}),
		],
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.claimed);
	assert.deepEqual(answered.contested, []);
});

test("an assignment that did not survive the re-read is a lost collision, not a claim", async (t) => {
	const { store, run, hold, reader, writer } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
		onWrite: ({ operation }, world) => {
			if (operation !== "comment-post") return;
			world.issues[0].assignees = [{ id: 2, login: "someone-else", username: "someone-else" }];
		},
	});

	const answered = await claim(store, { reader, writer, hold, run, ticket: 10 });

	assert.equal(answered.outcome, CLAIM_OUTCOMES.lostCollision);
	assert.match(answered.reason, /someone-else/);
});

test("a tracker that refuses the write leaves the intent standing for §5.3 to settle", async (t) => {
	const { store, run, hold, reader, writer } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
		status: { "/issues/10": 502 },
	});

	await assert.rejects(() => claim(store, { reader, writer, hold, run, ticket: 10 }), {
		reason: "tracker-unreachable",
	});
});

test("a tracker that will not state its own clock refuses the claim rather than substituting ours", async (t) => {
	// §3.3's arbitration window and its staleness window are both comparisons
	// against the tracker's clock. Reaching for `Date.now()` would settle them by
	// the skew between two machines, so the claim refuses instead.
	const { store, run, hold, reader, writer, gitea } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
		serverTime: null,
	});

	await assert.rejects(() => claim(store, { reader, writer, hold, run, ticket: 10 }), {
		reason: "tracker-clock-unknown",
	});
	assert.deepEqual(gitea.writes, [], "a claim went ahead without knowing the tracker's clock");
});

test("the write surface is §4.5's tracker mutations, each a registered effect kind", async () => {
	const { gitea, writer } = tracker({ issues: [] });

	// There is no method argument and no path argument, so a mutation outside the
	// table is not something this module can be *told* to perform.
	assert.deepEqual(Object.keys(writer).sort(), ["addLabels", "assign", "comment", "login", "repo", "unassign"]);
	assert.deepEqual(Object.keys(TRACKER_WRITES), ["issue-assign", "issue-unassign", "label-add", "comment-post"]);

	// §14.20: **no label removal.** A `factory:failed` label is cleared by a human
	// or not at all, so the removal legacy's `failAutomation` used to re-arm a
	// ticket is not a mutation this factory can perform.
	assert.equal(Object.keys(TRACKER_WRITES).includes("label-remove"), false);
	for (const operation of Object.keys(TRACKER_WRITES)) {
		// §14.3: a kind with no probe cannot be registered, so this is also the
		// proof that every write here is re-probeable.
		assert.ok(EFFECT_REGISTRY.has(operation), `${operation} is not a registered effect kind`);
		assert.ok(EFFECT_REGISTRY.probeFor(operation).call.length > 0);
	}
	assert.deepEqual(gitea.writes, []);
});

test("a write the tracker refuses by status is never recorded as having landed", async (t) => {
	const { store, run, hold, reader, writer } = await claiming(t, {
		issues: [giteaIssue({ number: 10 })],
		status: { "/issues/10/comments": 403 },
	});

	await assert.rejects(() => claim(store, { reader, writer, hold, run, ticket: 10 }), {
		reason: "tracker-unreachable",
	});

	// The assignment landed and resolved; the comment's intent stands, unresolved,
	// for §5.3 to settle by re-probing rather than by reasoning.
	assert.deepEqual(
		unresolvedEffects(store).map((row) => row.operation),
		["comment-post"],
	);
});
