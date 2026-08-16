import assert from "node:assert/strict";
import test from "node:test";

import { parseScope } from "../../factory/lib/controller/scope.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import {
	cursorKey,
	isDue,
	observe,
	openCursor,
	POLL_INTERVAL_MS,
	POLL_OVERLAP_MS,
	readCursor,
	sinceMillis,
} from "../../factory/lib/tracker/observation.mjs";
import { FIXED_NOW, openTestStore, refusalOfAsync } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaComment, giteaIssue, giteaTimelineEntry } from "./helpers/factory-tracker.mjs";

/**
 * §5.1's observation ingestion: a durable cursor, the two cheap `since`
 * endpoints at 15s with a 60s overlap, and every foreign fact entering as
 * `observation.recorded`.
 */

const SCOPE = parseScope(["10"]);

function world(options) {
	const gitea = fakeGitea(options);
	return { gitea, reader: createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: gitea.request }) };
}

function observations(store) {
	return store.readEvents({ kind: "observation.recorded" });
}

test("the cursor is durable and keyed by the scope (§5.1)", async (t) => {
	const store = await openTestStore(t);
	const other = parseScope(["11"]);

	const cursor = openCursor(store, { scope: SCOPE, at: FIXED_NOW });

	assert.equal(cursor.last_updated_at, FIXED_NOW);
	assert.equal(cursor.polled_at, null);
	assert.equal(readCursor(store, other), null);
	assert.notEqual(cursorKey(SCOPE), cursorKey(other));

	// It survives a reopen, which is the whole of "durable".
	assert.equal(readCursor(store, SCOPE).last_updated_at, FIXED_NOW);
});

test("the cursor key is canonical, so one scope is one watermark", () => {
	assert.equal(cursorKey({ kind: "direct-ticket", tickets: [10] }), cursorKey({ tickets: [10], kind: "direct-ticket" }));
});

test("opening a cursor twice keeps the first watermark", async (t) => {
	const store = await openTestStore(t);
	openCursor(store, { scope: SCOPE, at: FIXED_NOW });
	assert.equal(openCursor(store, { scope: SCOPE, at: FIXED_NOW + 5_000 }).last_updated_at, FIXED_NOW);
});

test("a fresh cursor starts at now, not at the epoch", async (t) => {
	const store = await openTestStore(t);
	const cursor = openCursor(store, { scope: SCOPE, at: FIXED_NOW });

	// Zero would ingest a repository's whole comment history as though it had
	// just happened; the frontier's state comes from readScope (§3.1).
	assert.equal(sinceMillis(cursor), FIXED_NOW - POLL_OVERLAP_MS);
});

test("the poll asks for the watermark less a 60-second overlap", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({ issues: [], comments: [] });

	await observe(store, { reader, scope: SCOPE, at: FIXED_NOW });

	const since = new URL(`http://x${gitea.pathsFor("issue.list")[0]}`).searchParams.get("since");
	assert.equal(Date.parse(since), FIXED_NOW - POLL_OVERLAP_MS);
});

test("both cheap endpoints are polled, and only those two", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({ issues: [giteaIssue({ number: 10 })], comments: [] });

	await observe(store, { reader, scope: SCOPE, at: FIXED_NOW });

	assert.equal(gitea.pathsFor("issue.list").length, 1);
	assert.equal(gitea.pathsFor("issue.comments").length, 1);
});

test("§5.1's cadence is 15 seconds, and a poll before it is a no-op", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({ issues: [giteaIssue({ number: 10 })] });

	await observe(store, { reader, scope: SCOPE, at: FIXED_NOW });
	const early = await observe(store, { reader, scope: SCOPE, at: FIXED_NOW + POLL_INTERVAL_MS - 1 });
	assert.equal(early.polled, false);
	assert.match(early.reason, /15000ms/);

	const due = await observe(store, { reader, scope: SCOPE, at: FIXED_NOW + POLL_INTERVAL_MS });
	assert.equal(due.polled, true);
	assert.equal(gitea.pathsFor("issue.list").length, 2);

	assert.equal(isDue({ polled_at: null }, FIXED_NOW), true);
	assert.equal(isDue({ polled_at: FIXED_NOW }, FIXED_NOW + POLL_INTERVAL_MS), true);
});

test("every foreign fact enters as observation.recorded with its source and foreign id", async (t) => {
	const store = await openTestStore(t);
	const { reader } = world({
		issues: [giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:00+00:00" })],
		comments: [giteaComment({ id: 500, ticket: 10, updatedAt: "2026-02-01T12:00:00+00:00" })],
	});

	await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:30Z") });

	const events = observations(store);
	assert.equal(events.length, 2);
	for (const event of events) {
		assert.equal(event.source, "gitea");
		assert.match(event.foreign_source_id, /^gitea:(issue|comment):/);
		assert.equal(event.payload.foreign_id, event.foreign_source_id);
		// §4.3: the raw timestamp string, verbatim.
		assert.equal(event.payload.occurred_at_raw, "2026-02-01T12:00:00+00:00");
		assert.equal(event.occurred_at, Date.parse("2026-02-01T12:00:00Z"));
	}
});

test("re-polling is idempotent by construction — the overlap costs duplicates, never records", async (t) => {
	const store = await openTestStore(t);
	const { reader } = world({
		issues: [giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:00+00:00" })],
		comments: [giteaComment({ id: 500, ticket: 10, updatedAt: "2026-02-01T12:00:00+00:00" })],
	});

	const first = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:30Z") });
	const second = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:50Z") });

	assert.equal(first.recorded.length, 2);
	assert.equal(second.recorded.length, 0);
	// The overlap did re-read them; that is what it is for.
	assert.equal(second.records_seen, 2);
	assert.equal(second.deduped, 2);
	assert.equal(observations(store).length, 2);
});

test("a record that actually moved is not swallowed by the dedup", async (t) => {
	const store = await openTestStore(t);
	const issue = giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:00+00:00" });
	const { reader } = world({ issues: [issue] });

	await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:30Z") });

	issue.updated_at = "2026-02-01T12:00:45+00:00";
	issue.labels = [{ id: 1, name: "workflow:implement" }];
	const second = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:50Z") });

	assert.equal(second.recorded.length, 1);
	assert.deepEqual(observations(store).at(-1).payload.observed.labels, ["workflow:implement"]);
});

test("the watermark is a record's updated_at, never our clock", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({
		issues: [giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:40+00:00" })],
	});

	const polledAt = Date.parse("2026-02-01T12:00:50Z");
	await observe(store, { reader, scope: SCOPE, at: polledAt });
	const advanced = readCursor(store, SCOPE);

	// `?since=` is compared against `updated_at` by the *tracker's* clock, so a
	// watermark taken from ours would put two clocks in one comparison.
	assert.equal(advanced.last_updated_at, Date.parse("2026-02-01T12:00:40Z"));
	assert.equal(advanced.last_updated_at_raw, "2026-02-01T12:00:40+00:00");
	assert.match(advanced.last_foreign_id, /^gitea:issue:1010@/);
	assert.equal(advanced.polls, 1);

	// A quiet poll keeps it. The window is anchored to the last thing that
	// happened, so it stops growing the moment the tracker goes quiet.
	const quietAt = Date.parse("2026-02-01T12:10:00Z");
	await observe(store, { reader, scope: SCOPE, at: quietAt });
	assert.equal(readCursor(store, SCOPE).last_updated_at, advanced.last_updated_at);
	assert.equal(readCursor(store, SCOPE).polls, 2);

	const since = new URL(`http://x${gitea.pathsFor("issue.list").at(-1)}`).searchParams.get("since");
	assert.equal(Date.parse(since), Date.parse("2026-02-01T12:00:40Z") - POLL_OVERLAP_MS);
});

test("a tracker clock behind ours still yields no gaps (§5.1's overlap promise)", async (t) => {
	const store = await openTestStore(t);
	// The tracker's clock lags ours by ten minutes — far more than the overlap.
	const ourClock = Date.parse("2026-02-01T12:00:50Z");
	const issue = giteaIssue({ number: 10, updatedAt: "2026-02-01T11:50:40+00:00" });
	const { reader } = world({ issues: [issue], serverTime: Date.parse("2026-02-01T11:50:50Z") });

	// The first poll's window is our clock's, so it sees nothing — and anchors to
	// the tracker's own `Date` rather than staying on a clock it will never meet.
	await observe(store, { reader, scope: SCOPE, at: ourClock });
	assert.equal(readCursor(store, SCOPE).last_updated_at, Date.parse("2026-02-01T11:50:50Z"));

	// A record written just after that poll, stamped by the lagging tracker.
	// Were the watermark our clock, `since` would already be past it and the
	// record would be lost — the gap §5.1 says the overlap cannot produce.
	issue.updated_at = "2026-02-01T11:50:55+00:00";
	const next = await observe(store, { reader, scope: SCOPE, at: ourClock + POLL_INTERVAL_MS });

	assert.equal(next.recorded.length, 1);
	assert.equal(readCursor(store, SCOPE).last_updated_at, Date.parse("2026-02-01T11:50:55Z"));
});

test("a tracker clock ahead of ours leaves the bootstrap rather than being maxed against it", async (t) => {
	const store = await openTestStore(t);
	const { reader } = world({ issues: [giteaIssue({ number: 10, updatedAt: "2026-02-01T12:01:30+00:00" })] });

	await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:50Z") });

	assert.equal(readCursor(store, SCOPE).last_updated_at, Date.parse("2026-02-01T12:01:30Z"));
});

test("per-issue timeline runs only for issues the cheap pass flagged", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({
		issues: [
			giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:40+00:00" }),
			giteaIssue({ number: 11, updatedAt: "2026-01-01T00:00:00+00:00" }),
		],
		timeline: { 10: [], 11: [] },
	});

	const polled = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:50Z") });

	assert.deepEqual(polled.flagged, [10]);
	assert.deepEqual(gitea.pathsFor("issue.timeline").length, 1);
	assert.match(gitea.pathsFor("issue.timeline")[0], /\/issues\/10\/timeline/);
});

test("a re-polled issue is not flagged again, so the timeline read stays cheap", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({
		issues: [giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:40+00:00" })],
		timeline: { 10: [] },
	});

	await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:50Z") });
	const second = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:01:10Z") });

	assert.deepEqual(second.flagged, []);
	assert.equal(gitea.pathsFor("issue.timeline").length, 1);
});

test("dependencies and blocks are read only on an add_dependency", async (t) => {
	const store = await openTestStore(t);
	const { gitea, reader } = world({
		issues: [
			giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:40+00:00" }),
			giteaIssue({ number: 11, updatedAt: "2026-02-01T12:00:40+00:00" }),
			giteaIssue({ number: 89, state: "closed", updatedAt: "2026-01-01T00:00:00+00:00" }),
		],
		timeline: {
			10: [giteaTimelineEntry({ id: 900, type: "label", label: "ready-for-agent", createdAt: "2026-02-01T12:00:40+00:00" })],
			11: [giteaTimelineEntry({ id: 901, type: "add_dependency", dependentIssue: 89, createdAt: "2026-02-01T12:00:40+00:00" })],
		},
		dependencies: { 11: [89] },
	});

	const polled = await observe(store, { reader, scope: parseScope(["10", "11"]), at: Date.parse("2026-02-01T12:00:50Z") });

	assert.deepEqual(polled.dependency_reads, [11]);
	assert.equal(gitea.pathsFor("issue.dependencies").length, 2, "dependencies and blocks, for #11 only");

	const graph = observations(store).find((event) => event.payload.fact_classes.includes("ticket.dependencies"));
	assert.deepEqual(graph.payload.observed.blocked_by, [{ ticket: 89, state: "closed" }]);
});

test("content_version is the cheap body-edit detector", async (t) => {
	const store = await openTestStore(t);
	const issue = giteaIssue({ number: 10, contentVersion: 1, updatedAt: "2026-02-01T12:00:00+00:00" });
	const { reader } = world({ issues: [issue] });

	const first = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:30Z") });
	assert.deepEqual(first.body_edits, [], "the first sighting has nothing to compare against");

	issue.updated_at = "2026-02-01T12:00:45+00:00";
	issue.labels = [...issue.labels, { id: 9, name: "docs" }];
	const relabelled = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:50Z") });
	assert.deepEqual(relabelled.body_edits, [], "a label move is not a body edit");

	issue.updated_at = "2026-02-01T12:01:10+00:00";
	issue.content_version = 2;
	const edited = await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:01:20Z") });

	assert.deepEqual(edited.body_edits, [10]);
	const recorded = observations(store).at(-1).payload.observed;
	assert.equal(recorded.body_edited, true);
	assert.equal(recorded.previous_content_version, 1);
	assert.equal(store.read((db) => db.prepare("SELECT * FROM observed_issue WHERE ticket = 10").get()).content_version, 2);
});

test("a comment enters as existence, never as text (§5.2)", async (t) => {
	const store = await openTestStore(t);
	const { reader } = world({
		comments: [giteaComment({ id: 500, ticket: 10, updatedAt: "2026-02-01T12:00:00+00:00" })],
	});

	await observe(store, { reader, scope: SCOPE, at: Date.parse("2026-02-01T12:00:30Z") });

	const event = observations(store)[0];
	assert.deepEqual(event.payload.fact_classes, ["comment.observed"]);
	assert.equal(event.payload.observed.absence_means, "possibly-deleted");
	assert.equal(JSON.stringify(event.payload).includes("authoritative for nothing"), false, "the body is not recorded");
});

test("observations ride the run's stream when a run owns the poll", async (t) => {
	const store = await openTestStore(t);
	const run = "01JRUN0000000000000000000A";
	store.append({
		kind: "run.started",
		source: "controller",
		run,
		occurredAt: FIXED_NOW,
		observedAt: FIXED_NOW,
		payload: { scope: SCOPE },
	});
	const { reader } = world({ issues: [giteaIssue({ number: 10, updatedAt: "2026-02-01T12:00:00+00:00" })] });

	await observe(store, { reader, scope: SCOPE, run, at: Date.parse("2026-02-01T12:00:30Z") });

	const event = observations(store)[0];
	assert.equal(event.run, run);
	assert.equal(event.stream, `run:${run}`);
	assert.equal(event.ticket, 10);
});

test("a tracker that refuses stops the poll rather than advancing the watermark", async (t) => {
	const store = await openTestStore(t);
	const { reader } = world({ issues: [], status: { "/issues?" : 500 } });

	const refusal = await refusalOfAsync(() => observe(store, { reader, scope: SCOPE, at: FIXED_NOW }));

	assert.equal(refusal.reason, "tracker-unreachable");
	assert.equal(readCursor(store, SCOPE).polled_at, null);
	assert.equal(readCursor(store, SCOPE).polls, 0);
});

test("webhooks are not used: the binary opens no inbound surface and registers no hook (§5.1)", async () => {
	const { factorySources } = await import("./helpers/factory-repo.mjs");

	for (const [path, source] of factorySources()) {
		// §5.1 rejects webhooks for v1 because "the controller has no inbound HTTP
		// surface". That is a statement about the code, so it is checked as one:
		// ingestion is the cursor above polling, and a listener appearing anywhere
		// in `factory/` would make the sentence false without failing a test.
		assert.equal(/createServer\s*\(|\.listen\s*\(/.test(source), false, `${path} opens an inbound surface`);
		// The other half: nothing asks Gitea to *send* us anything either.
		assert.equal(/["'`][^"'`]*\/hooks\b/.test(source), false, `${path} touches the tracker's hooks API`);
	}
});
