import assert from "node:assert/strict";
import test from "node:test";

import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { snapshotDigest, snapshotTicket, TICKET_SNAPSHOT_VERSION } from "../../factory/lib/tracker/snapshot.mjs";
import { fakeGitea, giteaComment, giteaIssue, TRACKER_NOW } from "./helpers/factory-tracker.mjs";

/**
 * §14.17 and §6.4: **a worker is never handed a tracker credential**, so the
 * controller snapshots the ticket into the attempt context at claim time.
 */

function reader(world) {
	return createGiteaReader({ repo: "minder/oh-my-slop", login: "minder", request: fakeGitea(world).request });
}

test("the snapshot carries the body and the comments the worker will be shown", async () => {
	const snapshot = await snapshotTicket(
		reader({
			issues: [giteaIssue({ number: 42, title: "Make it work", body: "It should work.", labels: ["workflow:implement"] })],
			comments: [
				giteaComment({ id: 4712, ticket: 42, body: "second" }),
				giteaComment({ id: 4711, ticket: 42, body: "first" }),
			],
		}),
		42,
	);

	assert.equal(snapshot.snapshot_version, TICKET_SNAPSHOT_VERSION);
	assert.equal(snapshot.number, 42);
	assert.equal(snapshot.title, "Make it work");
	assert.equal(snapshot.body, "It should work.");
	assert.deepEqual([...snapshot.labels], ["workflow:implement"]);
	// Gitea's comment ids share one monotonic sequence (§5.1), so id order is
	// the order a human read them in — and it is stable where a timestamp sort
	// is not when two comments land in the same second.
	assert.deepEqual(snapshot.comments.map((comment) => comment.id), [4711, 4712]);
	assert.deepEqual(snapshot.comments.map((comment) => comment.body), ["first", "second"]);
});

test("every timestamp in it is the tracker's, and the raw string is kept verbatim", async () => {
	const issue = giteaIssue({ number: 42 });
	const snapshot = await snapshotTicket(reader({ issues: [issue], comments: [] }), 42);

	assert.equal(snapshot.updated_at_raw, issue.updated_at, "§4.3: normalising in place destroys the evidence");
	assert.equal(snapshot.snapshot_at, TRACKER_NOW, "the tracker's own Date header, never our clock");
	assert.equal(snapshot.snapshot_at_raw, new Date(TRACKER_NOW).toISOString());
});

test("the digest is evidence: the same ticket state hashes the same, an edited one does not", async () => {
	const world = { issues: [giteaIssue({ number: 42, body: "before" })], comments: [] };
	const first = await snapshotTicket(reader(world), 42);
	const again = await snapshotTicket(reader(world), 42);

	assert.equal(snapshotDigest(first), snapshotDigest(again), "key order must not be part of the answer");

	const edited = await snapshotTicket(reader({ issues: [giteaIssue({ number: 42, body: "after" })], comments: [] }), 42);
	assert.notEqual(
		snapshotDigest(edited),
		snapshotDigest(first),
		"a ticket edited between two attempts is how 'the worker saw something else' becomes visible",
	);
});

test("a snapshot is a plain JSON value, so it can ride a manifest and an effect payload", async () => {
	const snapshot = await snapshotTicket(
		reader({ issues: [giteaIssue({ number: 42 })], comments: [giteaComment({ id: 1, ticket: 42 })] }),
		42,
	);

	assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(snapshot)));
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.comments[0]), true);
});
