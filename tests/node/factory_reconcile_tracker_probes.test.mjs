import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_REGISTRY } from "../../factory/lib/effects/registry.mjs";
import { unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { reconcile } from "../../factory/lib/reconcile/engine.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { trackerProbes, withTrackerProbes } from "../../factory/lib/reconcile/tracker-probes.mjs";
import { claimTicket } from "../../factory/lib/tracker/claims.mjs";
import { applyDisposition } from "../../factory/lib/tracker/disposition.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter, TRACKER_WRITES } from "../../factory/lib/tracker/writer.mjs";
import { openCapacityPool } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue, TRACKER_NOW } from "./helpers/factory-tracker.mjs";

/**
 * §5.3's re-probing for the tracker's three mutations — and §5.2's rule that a
 * missing claim comment means *possibly deleted*, never *no claim was made*.
 */

const ASSIGNEE = "kuferek";

async function claimed(t, world) {
	const pool = await openCapacityPool(t);
	const gitea = fakeGitea(world);
	const where = { repo: "acme/widgets", login: "kuferek" };
	const reader = createGiteaReader({ ...where, request: gitea.request });
	const writer = createGiteaWriter({ ...where, request: gitea.write });

	await claimTicket(pool.store, {
		reader,
		writer,
		hold: pool.hold,
		run: pool.run,
		ticket: 10,
		attempt: `${pool.run}-t10-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
	});

	return { ...pool, gitea, reader, writer, probes: withTrackerProbes(createProbeRegistry(), { reader, assignee: ASSIGNEE }) };
}

/** The same, for §8.9's disposition comment — the ticket's *second* comment effect. */
function unsettleDisposition(store) {
	return store.transaction(({ db }) => {
		const row = db.prepare("SELECT effect_key FROM effect WHERE operand = 'disposition'").get();
		db.prepare(
			"UPDATE effect SET state = 'requested', resolved_at = NULL, resolved_seq = NULL, result = NULL WHERE effect_key = ?",
		).run(row.effect_key);
		return row.effect_key;
	});
}

/** Put an effect back to `requested`, as a crash between the write and its record does. */
function unsettle(store, operation) {
	return store.transaction(({ db }) => {
		const row = db.prepare("SELECT effect_key FROM effect WHERE operation = ? LIMIT 1").get(operation);
		db.prepare(
			"UPDATE effect SET state = 'requested', resolved_at = NULL, resolved_seq = NULL, result = NULL WHERE effect_key = ?",
		).run(row.effect_key);
		return row.effect_key;
	});
}

test("every tracker write has a probe, and every probe has an implementation", () => {
	const probes = withTrackerProbes(createProbeRegistry(), { reader: {}, assignee: ASSIGNEE });

	// Derived from the writer's own surface rather than a list kept here: a
	// mutation added with no probe behind it is exactly what §5.3 cannot settle,
	// and a hand-kept list would have gone on passing while it was added.
	assert.deepEqual(
		Object.keys(TRACKER_WRITES).map((operation) => [
			operation,
			EFFECT_REGISTRY.probeFor(operation).call,
			EFFECT_REGISTRY.probeFor(operation).match,
		]),
		[
			["issue-assign", "issue.assignees", "present"],
			["issue-unassign", "issue.assignees", "absent"],
			["label-add", "issue.labels", "present"],
			["comment-post", "issue.comments", "embedded-key"],
			["pr-create", "pulls.by-head-branch", "present"],
			["issue-close", "issue.state", "state-equals"],
		],
	);

	// One read serves several operations, which is the point of keying the
	// registry by the read: `issue-assign` and `issue-unassign` are one call to
	// Gitea with two declared matches.
	for (const operation of Object.keys(TRACKER_WRITES)) {
		const call = EFFECT_REGISTRY.probeFor(operation).call;
		assert.notEqual(probes.implementationFor(call), null, `${operation} reads ${call}, which nothing implements`);
	}
	assert.deepEqual(
		[...probes.calls].sort(),
		["issue.assignees", "issue.comments", "issue.labels", "issue.state", "pulls.by-head-branch"],
	);
});

test("one read has one implementation — a base that already claims it refuses", () => {
	const base = createProbeRegistry();
	base.register("issue.assignees", () => ({ matched: false }));

	assert.throws(() => withTrackerProbes(base, { reader: {}, assignee: ASSIGNEE }), {
		reason: "probe-already-registered",
	});
});

test("an unsettled assignment is settled by re-reading the assignee", async (t) => {
	const { store, hold, probes } = await claimed(t, { issues: [giteaIssue({ number: 10 })] });
	unsettle(store, "issue-assign");

	const reconciled = await reconcile(store, {
		probes,
		fencingGeneration: hold.fencingGeneration,
		hold,
		actor: "controller",
		at: TRACKER_NOW,
	});

	assert.equal(reconciled.settled, 1);
	assert.deepEqual(unresolvedEffects(store), []);
});

test("a missing claim comment is possibly-deleted, corroborated by the durable assignee (§5.2)", async (t) => {
	const { store, gitea, hold, probes } = await claimed(t, { issues: [giteaIssue({ number: 10 })] });
	unsettle(store, "comment-post");
	// Somebody deleted the claim comment. It is gone from `/comments` and from
	// `/timeline` without trace, which is exactly why §5.2 refuses to read the
	// absence as evidence.
	gitea.comments.length = 0;

	const reconciled = await reconcile(store, {
		probes,
		fencingGeneration: hold.fencingGeneration,
		hold,
		actor: "controller",
		at: TRACKER_NOW,
	});

	assert.equal(reconciled.settled, 1);
	const settled = store.read((db) =>
		db.prepare("SELECT result FROM effect WHERE operation = 'comment-post'").get(),
	);
	assert.equal(JSON.parse(settled.result).absence, "possibly-deleted");

	const observed = store.read((db) =>
		db.prepare("SELECT payload FROM event WHERE kind = 'observation.recorded' ORDER BY seq DESC LIMIT 1").get(),
	);
	const payload = JSON.parse(observed.payload);
	assert.equal(payload.detail.absence, "possibly-deleted");
	assert.match(payload.detail.corroborated_by, /the durable assignee kuferek/);
});

test("a claim comment gone with the assignee gone too is uncorroborated, and the intent stands", async (t) => {
	const { store, gitea, hold, probes } = await claimed(t, { issues: [giteaIssue({ number: 10 })] });
	unsettle(store, "comment-post");
	gitea.comments.length = 0;
	gitea.issues[0].assignees = [];

	const reconciled = await reconcile(store, {
		probes,
		fencingGeneration: hold.fencingGeneration,
		hold,
		actor: "controller",
		at: TRACKER_NOW,
	});

	// §5.3: settled only by re-probing, never by reasoning. Nothing read agrees
	// with what the claim comment announced, so the requested record stays as it was.
	assert.equal(reconciled.settled, 0);
	assert.deepEqual(
		unresolvedEffects(store).map((row) => row.operation),
		["comment-post"],
	);
});

test("a deleted *release* comment is corroborated by the assignee being gone (§5.2)", async (t) => {
	// The corroborator is the assignee state the comment announced. A release says
	// the factory gave the ticket up, so an absent assignee agrees with it exactly
	// as strongly as a present one agrees with a claim — and without that
	// symmetry, every deleted release comment pins its run's artifacts forever
	// under §12.4 with no verb able to discharge it.
	const { store, gitea, hold, probes, writer, run } = await claimed(t, { issues: [giteaIssue({ number: 10 })] });

	await applyDisposition(store, {
		writer,
		hold,
		run,
		ticket: 10,
		attempt: `${run}-t10-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
		disposition: "released",
		reason: "the operator stopped the run",
	});

	const key = unsettleDisposition(store);
	gitea.comments.length = 0;

	const reconciled = await reconcile(store, {
		probes,
		fencingGeneration: hold.fencingGeneration,
		hold,
		actor: "controller",
		at: TRACKER_NOW,
	});

	assert.equal(reconciled.settled, 1);
	const settled = store.read((db) => db.prepare("SELECT result FROM effect WHERE effect_key = ?").get(key));
	assert.equal(JSON.parse(settled.result).absence, "possibly-deleted");
	assert.deepEqual(unresolvedEffects(store), []);
});

test("a deleted *pause* comment is corroborated by the label it added, not by the assignee (§5.2)", async (t) => {
	// §8.9's other three dispositions **retain** the assignee, so "the assignee is
	// gone" corroborates nothing about them. What their comment announced is the
	// label, and the label is what is still there to agree with it. Reading the
	// release rule as "no assignee" for all four would leave every deleted pause
	// comment uncorroborated, pinning its run's artifacts under §12.4 forever.
	const { store, gitea, hold, probes, writer, run } = await claimed(t, { issues: [giteaIssue({ number: 10 })] });

	await applyDisposition(store, {
		writer,
		hold,
		run,
		ticket: 10,
		attempt: `${run}-t10-a1`,
		assignee: ASSIGNEE,
		at: TRACKER_NOW,
		disposition: "paused",
		reasonClass: "product-ambiguity",
		question: "Which of the two invoice rules applies?",
	});

	const key = unsettleDisposition(store);
	gitea.comments.length = 0;

	const reconciled = await reconcile(store, {
		probes,
		fencingGeneration: hold.fencingGeneration,
		hold,
		actor: "controller",
		at: TRACKER_NOW,
	});

	assert.equal(reconciled.settled, 1);
	const settled = store.read((db) => db.prepare("SELECT result FROM effect WHERE effect_key = ?").get(key));
	assert.equal(JSON.parse(settled.result).absence, "possibly-deleted");
	// The assignee is still standing, exactly as §8.9 requires of a pause — so it
	// is the label that did the corroborating.
	assert.deepEqual(
		gitea.issues[0].assignees.map((user) => user.login),
		[ASSIGNEE],
	);
	assert.deepEqual(unresolvedEffects(store), []);
});

test("the comment probe matches on the embedded key, never on a body that merely looks like one", async (t) => {
	const { store, gitea, reader } = await claimed(t, { issues: [giteaIssue({ number: 10 })] });
	const key = store.read((db) =>
		db.prepare("SELECT effect_key FROM effect WHERE operation = 'comment-post'").get(),
	).effect_key;

	// A comment carrying a key that *extends* ours. A prefix match would report
	// somebody else's comment as ours (§4.5).
	gitea.comments[0].body = gitea.comments[0].body.replace(key, `${key}-and-more`);

	const probe = trackerProbes({ reader, assignee: ASSIGNEE })["issue.comments"];
	const answer = await probe({ effect: { ticket: 10, effect_key: key, operand: "claim" } });

	assert.equal(answer.detail.absence, "possibly-deleted");
	assert.equal(answer.matched, true, "the assignee still corroborates the claim");
});
