import test from "node:test";
import assert from "node:assert/strict";

import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import {
	parsePullBody,
	publishPullRequest,
	PULL_BODY_SCHEMA_VERSION,
	pullTitle,
	renderPullBody,
} from "../../factory/lib/tracker/pulls.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { TEST_HOLD as HOLD } from "./helpers/factory-git.mjs";
import { fakeGitea, giteaIssue, giteaPull } from "./helpers/factory-tracker.mjs";
import { FIXED_NOW, openTestStore, refusalOf, refusalOfAsync, runStarted } from "./helpers/factory-store.mjs";

/**
 * §7.5's pull request: its title, its machine-parseable body, `Closes #N`, the
 * check-then-create that survives a crash, and the sweep that keeps **one live
 * PR per ticket**.
 */

const RUN = "01JRUN0000000000000000000A";
const TICKET = 42;
const ATTEMPT = `${RUN}-t${TICKET}-a1`;
const BRANCH = `factory/t${TICKET}/a${ATTEMPT}`;

function block(overrides = {}) {
	return {
		identity: { run: RUN, ticket: TICKET, attempt: ATTEMPT },
		base_commit: "a".repeat(40),
		package_revision: "b".repeat(64),
		branch: BRANCH,
		head: "c".repeat(40),
		evidence: [{ produced_by: `${RUN}/${TICKET}/verify/${ATTEMPT}/artifact-write/check-output/unit`, digest: "d".repeat(64) }],
		attestation: { algorithm: "sha256", digest: "e".repeat(64), bytes: 1024 },
		summary: "3 required checks green; both review axes approved.",
		advisory: [],
		...overrides,
	};
}

async function world(t, { pulls = [], issues = [giteaIssue({ number: TICKET, title: "feat: a thing" })] } = {}) {
	const store = await openTestStore(t);
	store.append(runStarted(RUN, { at: FIXED_NOW }));
	const gitea = fakeGitea({ issues, pulls, comments: [] });
	return {
		store,
		gitea,
		reader: createGiteaReader({ repo: "acme/widgets", login: "gitea", request: gitea.request }),
		writer: createGiteaWriter({ repo: "acme/widgets", login: "gitea", request: gitea.write }),
	};
}

function publish(store, context, overrides = {}) {
	return publishPullRequest(store, {
		reader: context.reader,
		writer: context.writer,
		hold: HOLD,
		run: RUN,
		ticket: TICKET,
		attempt: ATTEMPT,
		branch: BRANCH,
		baseBranch: "main",
		title: pullTitle({ ticket: TICKET, title: "feat: a thing" }),
		body: renderPullBody(block()),
		at: FIXED_NOW,
		...overrides,
	});
}

test("the title is the ticket's own, with its conventional prefix, plus (#N) (§7.5)", () => {
	assert.equal(pullTitle({ ticket: 42, title: "feat: a thing" }), "feat: a thing (#42)");
	// A ticket with no prefix gets none invented for it: the factory classifies
	// no change it did not classify.
	assert.equal(pullTitle({ ticket: 42, title: "a thing" }), "a thing (#42)");
	// Idempotent, so a re-entry that re-derives the title produces the same string
	// and not `… (#42) (#42)`.
	assert.equal(pullTitle({ ticket: 42, title: "feat: a thing (#42)" }), "feat: a thing (#42)");
	assert.equal(pullTitle({ ticket: 42, title: "  " }), "Ticket 42 (#42)");
});

test("the body carries §7.5's whole list and ends in Closes #N", () => {
	const body = renderPullBody(block());

	const parsed = parsePullBody(body);
	assert.equal(parsed.schema_version, PULL_BODY_SCHEMA_VERSION);
	assert.deepEqual(parsed.identity, { run: RUN, ticket: TICKET, attempt: ATTEMPT });
	assert.equal(parsed.base_commit, "a".repeat(40));
	assert.equal(parsed.package_revision, "b".repeat(64));
	assert.equal(parsed.attestation.digest, "e".repeat(64));
	assert.equal(parsed.evidence.length, 1);

	// The manual merge is what closes the ticket, through Gitea's own automation.
	assert.match(body, /\nCloses #42$/);
});

test("§8.7's summary and advisory findings ride the block; blocking findings never do", () => {
	const parsed = parsePullBody(
		renderPullBody(
			block({
				summary: "one advisory finding stands",
				advisory: [{ axis: "review-standards", severity: "advisory", statement: "this helper could be inlined" }],
			}),
		),
	);

	assert.equal(parsed.summary, "one advisory finding stands");
	assert.deepEqual(parsed.advisory.map((finding) => finding.severity), ["advisory"]);
	assert.equal(Object.hasOwn(parsed, "blocking"), false, "a blocking finding reached a published PR");

	// And it is a **refusal**, not a caller's discipline: the body is rendered by
	// spreading whatever block it is handed, so a rule left to every call site
	// would be as strong as the least careful one.
	const refusal = refusalOf(() =>
		renderPullBody(block({ blocking: [{ severity: "blocking", statement: "this swallows an error" }] })),
	);
	assert.equal(refusal.name, "FactoryTrackerError");
	assert.equal(refusal.reason, "pull-unpublishable");
});

test("the block survives prose an operator wrote around it, and a body with none is not ours", () => {
	const body = renderPullBody(block());

	assert.ok(parsePullBody(`A human's note.\n\n${body}\n\nAnd another.`) !== null);
	assert.equal(parsePullBody("Just a pull request somebody opened by hand."), null);
	assert.equal(parsePullBody(null), null);
});

test("a summary containing a fenced block does not close the machine block early", () => {
	const parsed = parsePullBody(renderPullBody(block({ summary: "the check printed:\n```\nE   assert 1 == 2\n```" })));

	assert.equal(parsed.summary, "the check printed:\n```\nE   assert 1 == 2\n```");
});

test("publication opens one PR against the default branch, as a resolved effect (§7.5, §4.5)", async (t) => {
	const context = await world(t);

	const published = await publish(context.store, context);

	assert.equal(published.pull.branch, BRANCH);
	assert.equal(context.gitea.pulls.length, 1);
	assert.equal(context.gitea.pulls[0].base.ref, "main");
	assert.equal(context.gitea.pulls[0].head.ref, BRANCH);
	assert.deepEqual(
		context.store
			.read((db) => db.prepare("SELECT effect_key, state FROM effect ORDER BY requested_seq").all())
			.map((row) => ({ ...row })),
		[{ effect_key: `${RUN}/${TICKET}/implement/-/pr-create/${BRANCH}`, state: "resolved" }],
	);
});

test("a re-entered publication returns the committed PR and never opens a second one (§7.7)", async (t) => {
	const context = await world(t);
	const first = await publish(context.store, context);

	const again = await publish(context.store, context);

	assert.equal(again.pull.number, first.pull.number);
	assert.equal(context.gitea.pulls.length, 1);
	assert.equal(context.gitea.writes.filter((write) => write.operation === "pr-create").length, 1);
});

test("a crash between opening the PR and recording it is adopted, not doubled (§7.7's check-then-create)", async (t) => {
	// The PR the dead controller opened, with no effect row behind it.
	const context = await world(t, {
		pulls: [giteaPull({ number: 7100, headBranch: BRANCH, body: renderPullBody(block()) })],
	});

	const published = await publish(context.store, context);

	assert.equal(published.pull.number, 7100);
	assert.equal(context.gitea.pulls.length, 1);
	assert.equal(context.gitea.writes.filter((write) => write.operation === "pr-create").length, 0);
});

test("a stale PR from a dead earlier attempt is closed with a comment linking the new one (§7.5)", async (t) => {
	const stale = `factory/t${TICKET}/a${RUN}-t${TICKET}-a0`;
	const context = await world(t, {
		pulls: [giteaPull({ number: 7050, headBranch: stale, body: renderPullBody(block()) })],
	});

	const published = await publish(context.store, context);

	assert.deepEqual(
		published.superseded.map((entry) => ({ number: entry.number, branch: entry.branch })),
		[{ number: 7050, branch: stale }],
	);
	assert.equal(context.gitea.pulls.find((pull) => pull.number === 7050).state, "closed");

	// The comment goes on the pull request being closed, and it names the live one.
	const comment = context.gitea.comments.find((entry) => entry.issue_url.endsWith("/issues/7050"));
	assert.ok(comment !== undefined, "a stale PR was closed with nothing said about it");
	assert.match(comment.body, new RegExp(`${published.pull.number}|${published.pull.url}`));
	assert.match(comment.body, /factory-effect: .*\/comment-post\/superseded\/7050/);
});

test("a pull request a human opened from a factory branch is left alone (§7.6)", async (t) => {
	const stale = `factory/t${TICKET}/a${RUN}-t${TICKET}-a0`;
	const context = await world(t, {
		pulls: [giteaPull({ number: 7050, headBranch: stale, body: "I fixed this up by hand." })],
	});

	const published = await publish(context.store, context);

	assert.deepEqual([...published.superseded], []);
	assert.equal(context.gitea.pulls.find((pull) => pull.number === 7050).state, "open");
});

test("another ticket's open PR is not this ticket's to close (§7.5)", async (t) => {
	const other = "factory/t99/a01JRUN0000000000000000000A-t99-a1";
	const context = await world(t, {
		pulls: [giteaPull({ number: 7060, headBranch: other, body: renderPullBody(block()) })],
	});

	const published = await publish(context.store, context);

	assert.deepEqual([...published.superseded], []);
	assert.equal(context.gitea.pulls.find((pull) => pull.number === 7060).state, "open");
});

test("a PR is never opened from a branch this ticket did not build (§14.11)", async (t) => {
	const context = await world(t);

	const refusal = await refusalOfAsync(() => publish(context.store, context, { branch: "main" }));

	assert.equal(refusal.name, "FactoryTrackerError");
	assert.equal(refusal.reason, "pull-unpublishable");
	assert.equal(context.gitea.writes.length, 0);
});

test("a closed PR is never adopted as this attempt's publication (§7.6)", async (t) => {
	const context = await world(t, {
		pulls: [giteaPull({ number: 7080, state: "closed", headBranch: BRANCH, body: renderPullBody(block()) })],
	});

	const published = await publish(context.store, context);

	// The human closed it unmerged; §7.5's redo path opens a new one rather than
	// resurrecting theirs.
	assert.notEqual(published.pull.number, 7080);
	assert.equal(context.gitea.pulls.find((pull) => pull.number === 7080).state, "closed");
});
