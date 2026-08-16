import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { READ_OPERATIONS } from "../../factory/lib/effects/catalogue.mjs";
import {
	createGiteaReader,
	foreignId,
	MAX_PAGES,
	normaliseIssue,
	PAGE_LIMIT,
	sinceParameter,
} from "../../factory/lib/tracker/gitea.mjs";
import { refusalOf, refusalOfAsync } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaComment, giteaIssue, giteaTimelineEntry, TRACKER_NOW } from "./helpers/factory-tracker.mjs";

/**
 * §5.1's Gitea read path. Every test drives the reader's own URL building,
 * paging, and normalisation against the shapes a live instance answers.
 */

function reader(world, overrides = {}) {
	const gitea = fakeGitea(world);
	return {
		gitea,
		read: createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: gitea.request, ...overrides }),
	};
}

test("the candidate query filters by label server-side (§3.1)", async () => {
	const { gitea, read } = reader({
		issues: [
			giteaIssue({ number: 10 }),
			giteaIssue({ number: 11, labels: ["docs"] }),
			giteaIssue({ number: 12, state: "closed" }),
		],
	});

	const found = await read.listIssues({ labels: ["workflow:implement"] });

	assert.deepEqual(
		found.map((issue) => issue.number),
		[10],
	);
	assert.match(gitea.pathsFor("issue.list")[0], /labels=workflow%3Aimplement/);
	assert.match(gitea.pathsFor("issue.list")[0], /state=open/);
});

test("an issue is normalised into the fields decisions rest on", async () => {
	const { read } = reader({
		issues: [
			giteaIssue({
				number: 42,
				id: 999,
				labels: ["workflow:implement", "ready-for-agent"],
				assignees: ["factory-bot"],
				contentVersion: 3,
				body: "Part of #75\n",
			}),
		],
	});

	const issue = await read.readIssue(42);

	assert.equal(issue.number, 42);
	assert.equal(issue.state, "open");
	assert.deepEqual(issue.labels, ["workflow:implement", "ready-for-agent"]);
	assert.deepEqual(issue.assignees, ["factory-bot"]);
	assert.equal(issue.content_version, 3);
	assert.equal(issue.foreign_id, foreignId("issue", 999, issue.updated_at_raw));
	assert.equal(issue.body, "Part of #75\n");
});

test("the foreign id names the fact, so an unchanged record repeats and a changed one does not", () => {
	const first = normaliseIssue(giteaIssue({ number: 42, id: 999, updatedAt: "2026-08-15T13:40:34+02:00" }));
	const same = normaliseIssue(giteaIssue({ number: 42, id: 999, updatedAt: "2026-08-15T13:40:34+02:00" }));
	const edited = normaliseIssue(giteaIssue({ number: 42, id: 999, updatedAt: "2026-08-15T14:00:00+02:00" }));

	// §5.1's 60-second overlap re-reads the same record; that must be free.
	assert.equal(first.foreign_id, same.foreign_id);
	// And an issue that actually moved must not be swallowed by the dedup that
	// makes the overlap free.
	assert.notEqual(first.foreign_id, edited.foreign_id);
});

test("an unassigned issue reads as no assignees, not as a missing answer", async () => {
	const { read } = reader({ issues: [giteaIssue({ number: 42, assignees: null })] });
	assert.deepEqual((await read.readIssue(42)).assignees, []);
});

test("§4.3's raw timestamp survives beside the parsed one", async () => {
	const { read } = reader({ issues: [giteaIssue({ number: 42, updatedAt: "2026-08-15T13:40:34+02:00" })] });
	const issue = await read.readIssue(42);

	assert.equal(issue.updated_at_raw, "2026-08-15T13:40:34+02:00");
	assert.equal(issue.updated_at, Date.parse("2026-08-15T11:40:34Z"));
});

test("a Gitea with no content_version answers null rather than a plausible zero", () => {
	const raw = giteaIssue({ number: 42 });
	delete raw.content_version;
	assert.equal(normaliseIssue(raw).content_version, null);
});

test("both cheap since endpoints are driven from one watermark (§5.1)", async () => {
	const { gitea, read } = reader({
		issues: [
			giteaIssue({ number: 10, updatedAt: "2026-08-15T10:00:00+00:00" }),
			giteaIssue({ number: 11, updatedAt: "2026-08-15T14:00:00+00:00" }),
		],
		comments: [
			giteaComment({ id: 500, ticket: 10, updatedAt: "2026-08-15T10:00:00+00:00" }),
			giteaComment({ id: 501, ticket: 11, updatedAt: "2026-08-15T14:00:00+00:00" }),
		],
	});

	const since = sinceParameter(Date.parse("2026-08-15T12:00:00Z"));
	const issues = await read.issuesSince(since);
	const comments = await read.commentsSince(since);

	assert.deepEqual(
		issues.map((issue) => issue.number),
		[11],
	);
	assert.deepEqual(
		comments.map((comment) => comment.id),
		[501],
	);
	// A closed ticket that just moved is exactly what the frontier must see.
	assert.match(gitea.pathsFor("issue.list")[0], /state=all/);
});

test("a comment is attributed to its issue and identified by a namespaced foreign id", async () => {
	const { read } = reader({ comments: [giteaComment({ id: 13333, ticket: 92 })] });
	const [comment] = await read.commentsSince(sinceParameter(0));

	assert.equal(comment.ticket, 92);
	assert.equal(comment.foreign_id, foreignId("comment", 13333, comment.updated_at_raw));
	// An issue id and a comment id come from different sequences, so a bare
	// number would let one shadow the other.
	assert.notEqual(comment.foreign_id, foreignId("issue", 13333, comment.updated_at_raw));
});

test("a timeline entry keeps Gitea's own type and its dependency target", async () => {
	const { read } = reader({
		timeline: {
			100: [
				giteaTimelineEntry({ id: 13031, type: "add_dependency", dependentIssue: 89 }),
				giteaTimelineEntry({ id: 12897, type: "label", label: "workflow:implement" }),
			],
		},
	});

	const entries = await read.timelineSince(100, sinceParameter(0));

	assert.deepEqual(
		entries.map((entry) => [entry.type, entry.dependent_issue]),
		[
			["add_dependency", 89],
			["label", null],
		],
	);
	assert.equal(entries[0].ticket, 100);
});

test("dependencies and blocks read the same edge from both ends", async () => {
	const { read } = reader({
		issues: [giteaIssue({ number: 100 }), giteaIssue({ number: 89, state: "closed" })],
		dependencies: { 100: [89] },
	});

	assert.deepEqual((await read.dependencies(100)).map((issue) => issue.number), [89]);
	assert.deepEqual((await read.blocks(89)).map((issue) => issue.number), [100]);
});

test("a list read walks every page", async () => {
	const many = Array.from({ length: PAGE_LIMIT * 2 + 7 }, (_, index) => giteaIssue({ number: index + 1 }));
	const { gitea, read } = reader({ issues: many });

	assert.equal((await read.listIssues()).length, many.length);
	assert.equal(gitea.pathsFor("issue.list").length, 3);
});

test("a tracker that never stops paging is refused rather than walked forever", async () => {
	const endless = {
		request: async () => ({ status: 200, body: Array.from({ length: PAGE_LIMIT }, () => giteaIssue({ number: 1 })) }),
	};
	const read = createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: endless.request });

	const refusal = await refusalOfAsync(() => read.listIssues());
	assert.equal(refusal.reason, "tracker-answer-invalid");
	assert.equal(refusal.details.pages, MAX_PAGES);
});

test("a non-2xx status is a refusal, not an answer", async () => {
	// `tea api` exits 0 on a 404 and prints the error body, so the status is the
	// only trustworthy verdict.
	const { read } = reader({ issues: [], status: { "/issues/42": 404 } });

	const refusal = await refusalOfAsync(() => read.readIssue(42));
	assert.equal(refusal.reason, "tracker-unreachable");
	assert.equal(refusal.details.status, 404);
});

test("an answer whose shape a decision cannot rest on is refused", async () => {
	const wrong = { request: async () => ({ status: 200, body: { message: "not found" } }) };
	const read = createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: wrong.request });

	const refusal = await refusalOfAsync(() => read.listIssues());
	assert.equal(refusal.reason, "tracker-answer-invalid");
	assert.equal(refusal.details.expected, "array");
});

test("an issue missing the fields the factory reads is refused rather than defaulted", () => {
	const refusal = refusalOf(() => normaliseIssue({ number: 42, updated_at: "2026-08-15T13:40:34+02:00" }));
	assert.equal(refusal.reason, "tracker-answer-invalid");
	assert.equal(refusal.details.at, "issue.state");
});

test("every read the client performs is one §4.5 declares", async () => {
	const { gitea, read } = reader({
		issues: [giteaIssue({ number: 10 })],
		comments: [giteaComment({ id: 1, ticket: 10 })],
		timeline: { 10: [] },
		dependencies: { 10: [] },
	});

	await read.listIssues();
	await read.readIssue(10);
	await read.issuesSince(sinceParameter(0));
	await read.commentsSince(sinceParameter(0));
	await read.timelineSince(10, sinceParameter(0));
	await read.dependencies(10);
	await read.blocks(10);

	assert.ok(gitea.calls.length > 0);
	for (const { call } of gitea.calls) assert.ok(READ_OPERATIONS.includes(call), call);
});

test("the default transport asks for GET and takes no method to vary", () => {
	const source = readFileSync(new URL("../../factory/lib/tracker/gitea.mjs", import.meta.url), "utf8");

	// The claim is about the transport, so it is checked against the transport:
	// asserting `options.method === undefined` on an injected seam would pass for
	// any object at all, which is a test that cannot fail.
	assert.match(source, /"--method",\s*"GET"/);
	for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
		assert.equal(source.includes(`"${verb}"`), false, `${verb} is reachable from the read path`);
	}
});

test("the tracker's own clock comes back with every answer", async () => {
	const { read } = reader({ issues: [giteaIssue({ number: 10 })] });
	assert.equal(read.serverTime(), null, "nothing has been read yet");

	await read.listIssues();
	assert.equal(read.serverTime(), TRACKER_NOW);
});
