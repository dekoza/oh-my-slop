import assert from "node:assert/strict";
import test from "node:test";

import { parseScope } from "../../factory/lib/controller/scope.mjs";
import {
	edgeSatisfied,
	FRONTIER_EXCLUDED_LABELS,
	isEligible,
	MEMBER_CLASSES,
	readScope,
} from "../../factory/lib/tracker/frontier.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { refusalOfAsync } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";

/**
 * §3.1's scope resolution and §3.2's eligibility, blocking, and ordering.
 */

const ELIGIBLE = [FACTORY_LABELS.implementation, FACTORY_LABELS.readyForAgent];

function world(options) {
	const gitea = fakeGitea(options);
	return { gitea, reader: createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: gitea.request }) };
}

function classOf(resolved, ticket) {
	return resolved.members.find((member) => member.ticket === ticket)?.class;
}

test("a direct-ticket scope is the explicit set, read live", async () => {
	const { reader } = world({
		issues: [giteaIssue({ number: 10 }), giteaIssue({ number: 11 }), giteaIssue({ number: 12 })],
	});

	const resolved = await readScope(reader, parseScope(["11", "#10"]));

	assert.deepEqual(
		resolved.members.map((member) => member.ticket),
		[10, 11],
	);
	assert.deepEqual(resolved.claimable, [10, 11]);
});

test("a direct-ticket set of size one is a scope", async () => {
	const { reader } = world({ issues: [giteaIssue({ number: 10 })] });
	const resolved = await readScope(reader, parseScope(["10"]));
	assert.deepEqual(resolved.claimable, [10]);
});

test("parent-scoped membership is the literal first body line, on label-found candidates", async () => {
	const { gitea, reader } = world({
		issues: [
			giteaIssue({ number: 10, body: "Part of #75\n\nwork" }),
			giteaIssue({ number: 11, body: "Part of #76\n" }),
			giteaIssue({ number: 12, body: "## Parent\n\nPart of #75" }),
			giteaIssue({ number: 13, body: "Part of #75", labels: ["docs"] }),
		],
	});

	const resolved = await readScope(reader, parseScope(["75"], { parent: true }));

	assert.deepEqual(
		resolved.members.map((member) => member.ticket),
		[10],
	);
	// The candidate query is the label, server-side — #13 never reaches the
	// membership test because Gitea filtered it out.
	assert.match(gitea.pathsFor("issue.list")[0], /labels=workflow%3Aimplement/);
});

test("a closed member is still a member (§3.5's `closed` class)", async () => {
	const { reader } = world({
		issues: [
			giteaIssue({ number: 10, body: "Part of #75\n", state: "closed" }),
			giteaIssue({ number: 11, body: "Part of #75\n" }),
		],
	});

	const resolved = await readScope(reader, parseScope(["75"], { parent: true }));

	assert.deepEqual(
		resolved.members.map((member) => member.ticket),
		[10, 11],
	);
	assert.equal(classOf(resolved, 10), MEMBER_CLASSES.closed);
	assert.deepEqual(resolved.claimable, [11]);
});

test("eligibility is open ∧ workflow:implement ∧ ready-for-agent ∧ in scope", () => {
	assert.equal(isEligible({ state: "open", labels: ELIGIBLE }), true);
	assert.equal(isEligible({ state: "closed", labels: ELIGIBLE }), false);
	assert.equal(isEligible({ state: "open", labels: [FACTORY_LABELS.implementation] }), false);
	assert.equal(isEligible({ state: "open", labels: [FACTORY_LABELS.readyForAgent] }), false);
});

test("the frontier query excludes factory:needs-human and factory:awaiting-merge", async () => {
	assert.deepEqual([...FRONTIER_EXCLUDED_LABELS], [FACTORY_LABELS.needsHuman, FACTORY_LABELS.awaitingMerge]);
	assert.equal(isEligible({ state: "open", labels: [...ELIGIBLE, FACTORY_LABELS.needsHuman] }), false);
	assert.equal(isEligible({ state: "open", labels: [...ELIGIBLE, FACTORY_LABELS.awaitingMerge] }), false);

	const { reader } = world({
		issues: [
			giteaIssue({ number: 10, labels: [...ELIGIBLE, FACTORY_LABELS.needsHuman] }),
			giteaIssue({ number: 11, labels: [...ELIGIBLE, FACTORY_LABELS.awaitingMerge] }),
			giteaIssue({ number: 12 }),
		],
	});

	const resolved = await readScope(reader, parseScope(["10", "11", "12"]));

	assert.equal(classOf(resolved, 10), MEMBER_CLASSES.needsHuman);
	assert.equal(classOf(resolved, 11), MEMBER_CLASSES.awaitingMergeDependency);
	assert.deepEqual(resolved.claimable, [12]);
});

test("a ready-for-human member is visible, unclaimable, and blocks its dependents", async () => {
	const { reader } = world({
		issues: [
			giteaIssue({ number: 10, labels: [FACTORY_LABELS.implementation, FACTORY_LABELS.readyForHuman] }),
			giteaIssue({ number: 11 }),
		],
		dependencies: { 11: [10] },
	});

	const resolved = await readScope(reader, parseScope(["10", "11"]));

	assert.equal(classOf(resolved, 10), MEMBER_CLASSES.humanOwned);
	assert.equal(classOf(resolved, 11), MEMBER_CLASSES.blocked);
	assert.deepEqual(resolved.claimable, []);
	// Reported, never touched: it is in the member list with its own class.
	assert.match(resolved.members.find((m) => m.ticket === 10).reason, /never touches/);
});

test("a failed member is excluded and never auto-requeued", async () => {
	const { reader } = world({ issues: [giteaIssue({ number: 10, labels: [...ELIGIBLE, FACTORY_LABELS.failed] })] });
	const resolved = await readScope(reader, parseScope(["10"]));
	assert.equal(classOf(resolved, 10), MEMBER_CLASSES.failed);
});

test("a blocking edge is satisfied only by the blocker being closed", async () => {
	assert.equal(edgeSatisfied({ state: "closed" }), true);
	assert.equal(edgeSatisfied({ state: "open" }), false);

	const { reader } = world({
		issues: [
			giteaIssue({ number: 10, state: "closed" }),
			giteaIssue({ number: 11 }),
			giteaIssue({ number: 12 }),
		],
		dependencies: { 11: [10], 12: [11] },
	});

	const resolved = await readScope(reader, parseScope(["10", "11", "12"]));

	assert.equal(classOf(resolved, 11), MEMBER_CLASSES.claimable);
	assert.equal(classOf(resolved, 12), MEMBER_CLASSES.blocked);
	assert.deepEqual(resolved.claimable, [11]);
});

test("scope never auto-expands: an open blocker outside scope marks its dependent blocked-external", async () => {
	const { reader } = world({
		issues: [giteaIssue({ number: 11 }), giteaIssue({ number: 99 })],
		dependencies: { 11: [99] },
	});

	const resolved = await readScope(reader, parseScope(["11"]));

	assert.equal(classOf(resolved, 11), MEMBER_CLASSES.blockedExternal);
	// The blocker is read, not adopted.
	assert.deepEqual(
		resolved.members.map((member) => member.ticket),
		[11],
	);
	assert.match(resolved.members[0].reason, /scope never auto-expands/i);
});

test("a closed blocker outside scope satisfies the edge", async () => {
	const { reader } = world({
		issues: [giteaIssue({ number: 11 }), giteaIssue({ number: 99, state: "closed" })],
		dependencies: { 11: [99] },
	});

	assert.equal(classOf(await readScope(reader, parseScope(["11"])), 11), MEMBER_CLASSES.claimable);
});

test("a blocker awaiting a human merge classes its dependent awaiting-merge-dependency", async () => {
	const { reader } = world({
		issues: [
			giteaIssue({ number: 10, labels: [...ELIGIBLE, FACTORY_LABELS.awaitingMerge] }),
			giteaIssue({ number: 11 }),
		],
		dependencies: { 11: [10] },
	});

	assert.equal(classOf(await readScope(reader, parseScope(["10", "11"])), 11), MEMBER_CLASSES.awaitingMergeDependency);
});

test("ordering among claimable tickets is ascending issue number", async () => {
	const { reader } = world({
		issues: [giteaIssue({ number: 40 }), giteaIssue({ number: 7 }), giteaIssue({ number: 19 })],
	});

	const resolved = await readScope(reader, parseScope(["40", "7", "19"]));

	assert.deepEqual(resolved.claimable, [7, 19, 40]);
	assert.deepEqual(
		resolved.members.map((member) => member.ticket),
		[7, 19, 40],
	);
});

test("a direct-ticket member without the labels is ineligible, and says which are missing", async () => {
	const { reader } = world({ issues: [giteaIssue({ number: 10, labels: ["docs"] })] });
	const resolved = await readScope(reader, parseScope(["10"]));

	assert.equal(classOf(resolved, 10), MEMBER_CLASSES.ineligible);
	assert.match(resolved.members[0].reason, /workflow:implement and ready-for-agent/);
});

test("membership is recomputed on every call — nothing is cached", async () => {
	const issues = [giteaIssue({ number: 10 })];
	const { gitea, reader } = world({ issues });

	assert.deepEqual((await readScope(reader, parseScope(["10"]))).claimable, [10]);

	issues[0].labels = [{ id: 1, name: FACTORY_LABELS.implementation }];
	assert.deepEqual((await readScope(reader, parseScope(["10"]))).claimable, []);
	assert.equal(gitea.pathsFor("issue.get").length, 2);
});

test("an assignee is reported and never acted on here", async () => {
	const { reader } = world({ issues: [giteaIssue({ number: 10, assignees: ["a-human"] })] });
	const resolved = await readScope(reader, parseScope(["10"]));

	assert.deepEqual(resolved.members[0].assignees, ["a-human"]);
	// §3.3's absolute human claim is arbitrated at claim time (#102); §3.2's
	// predicate has four terms and an assignee is none of them.
	assert.equal(classOf(resolved, 10), MEMBER_CLASSES.claimable);
});

test("every class is counted, zeros included, and §3.5's six are all reachable", async () => {
	const { reader } = world({ issues: [giteaIssue({ number: 10 })] });
	const resolved = await readScope(reader, parseScope(["10"]));

	assert.deepEqual(Object.keys(resolved.counts).sort(), Object.values(MEMBER_CLASSES).sort());
	assert.equal(resolved.counts[MEMBER_CLASSES.claimable], 1);
	assert.equal(resolved.counts[MEMBER_CLASSES.failed], 0);

	// §3.5's classified per-member report names exactly these six.
	for (const name of ["closed", "needs-human", "awaiting-merge-dependency", "blocked-external", "human-owned", "failed"]) {
		assert.ok(Object.values(MEMBER_CLASSES).includes(name), name);
	}
});

test("a scope shape nobody recognises is refused, not read as a direct-ticket set", async () => {
	const { reader } = world({ issues: [] });

	const refusal = await refusalOfAsync(() => readScope(reader, { kind: "everything" }));
	assert.equal(refusal.reason, "scope-unrecognised");
});

test("blocked says whether the run could still move the blocker (§3.5)", async () => {
	const { reader } = world({
		issues: [
			giteaIssue({ number: 10 }),
			giteaIssue({ number: 11 }),
			giteaIssue({ number: 12, labels: [FACTORY_LABELS.implementation, FACTORY_LABELS.readyForHuman] }),
			giteaIssue({ number: 13 }),
		],
		dependencies: { 11: [10], 13: [12] },
	});

	const resolved = await readScope(reader, parseScope(["10", "11", "12", "13"]));

	// #11 waits on #10, which this run can claim and close: internal change.
	const waitingOnWork = resolved.members.find((member) => member.ticket === 11);
	assert.equal(waitingOnWork.class, MEMBER_CLASSES.blocked);
	assert.equal(waitingOnWork.awaits_external, false);

	// #13 waits on a human-owned member, which will never close on its own — so
	// the scope is drained however the class reads.
	const waitingOnHuman = resolved.members.find((member) => member.ticket === 13);
	assert.equal(waitingOnHuman.class, MEMBER_CLASSES.blocked);
	assert.equal(waitingOnHuman.awaits_external, true);
});

test("a caller maintaining the graph passes it in rather than paying for it again (§5.1)", async () => {
	const { gitea, reader } = world({
		issues: [giteaIssue({ number: 10 }), giteaIssue({ number: 11 })],
		dependencies: { 11: [10] },
	});

	const withReads = await readScope(reader, parseScope(["10", "11"]));
	const reads = gitea.pathsFor("issue.dependencies").length;
	assert.equal(reads, 2, "one per member when nothing was supplied");

	const supplied = await readScope(reader, parseScope(["10", "11"]), {
		edges: new Map([
			[10, []],
			[11, [{ number: 10, state: "open", labels: [] }]],
		]),
	});

	assert.equal(gitea.pathsFor("issue.dependencies").length, reads, "no dependency read was made");
	assert.deepEqual(supplied.claimable, withReads.claimable);
});
