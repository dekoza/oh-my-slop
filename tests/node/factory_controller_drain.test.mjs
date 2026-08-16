import assert from "node:assert/strict";
import test from "node:test";

import { DRAIN_MEMBER_CLASSES, drainReport, drainVerdict } from "../../factory/lib/controller/drain.mjs";
import { parseScope } from "../../factory/lib/controller/scope.mjs";
import { MEMBER_CLASSES, readScope } from "../../factory/lib/tracker/frontier.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { fakeGitea, giteaIssue, TRACKER_NOW } from "./helpers/factory-tracker.mjs";

/**
 * §3.5's drain: when a scope is drained, and what the classified per-member
 * report says about each member when it is.
 *
 * The views here come from a real `readScope` over a fake Gitea rather than from
 * hand-written member objects: the mapping under test is between two vocabularies
 * that both live in this repository, and a fixture that invented one of them
 * would prove only that the test agrees with itself.
 */

async function frontier(world, tickets) {
	const gitea = fakeGitea(world);
	const reader = createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: gitea.request });
	return readScope(reader, parseScope(tickets.map(String)), { at: TRACKER_NOW });
}

test("§3.5's six classes are exactly the report's vocabulary", () => {
	assert.deepEqual(DRAIN_MEMBER_CLASSES, [
		"closed",
		"needs-human",
		"awaiting-merge-dependency",
		"blocked-external",
		"human-owned",
		"failed",
	]);
});

test("a scope with nothing claimable and nothing movable is drained", async () => {
	const view = await frontier(
		{
			issues: [
				giteaIssue({ number: 10, state: "closed" }),
				giteaIssue({ number: 11, labels: ["workflow:implement", FACTORY_LABELS.needsHuman] }),
			],
		},
		[10, 11],
	);

	const verdict = drainVerdict(view);

	assert.equal(verdict.drained, true);
	assert.equal(verdict.claimable_now, 0);
	assert.deepEqual(verdict.movable, []);
});

test("a claimable member means not drained, and the verdict says which half failed", async () => {
	const view = await frontier({ issues: [giteaIssue({ number: 10 })] }, [10]);

	const verdict = drainVerdict(view);

	assert.equal(verdict.drained, false);
	assert.equal(verdict.claimable_now, 1);
});

test("a member blocked by something this run could still close is not drained", async () => {
	// #11 blocks #12, and #11 is claimable — so #12 can become claimable without
	// any external change. §3.5's second clause is not satisfied.
	const view = await frontier(
		{ issues: [giteaIssue({ number: 11 }), giteaIssue({ number: 12 })], dependencies: { 12: [11] } },
		[11, 12],
	);

	const verdict = drainVerdict(view);

	assert.equal(verdict.drained, false);
	assert.equal(
		view.members.find((member) => member.ticket === 12).class,
		MEMBER_CLASSES.blocked,
	);
});

test("a member blocked by a needs-human blocker inherits that class, and names the blocker", async () => {
	const view = await frontier(
		{
			issues: [
				giteaIssue({ number: 11, labels: ["workflow:implement", FACTORY_LABELS.needsHuman] }),
				giteaIssue({ number: 12 }),
			],
			dependencies: { 12: [11] },
		},
		[11, 12],
	);

	assert.equal(drainVerdict(view).drained, true);
	const report = drainReport({ view });

	const dependent = report.members.find((member) => member.ticket === 12);
	assert.equal(dependent.class, MEMBER_CLASSES.needsHuman);
	assert.equal(dependent.blocked_by, 11);
	// Nothing the classifier knew is lost in the mapping.
	assert.equal(dependent.frontier_class, MEMBER_CLASSES.blocked);
	assert.match(dependent.reason, /blocked by #11, which is needs-human/);
});

test("every reported class is one of §3.5's six, whatever the frontier called it", async () => {
	const view = await frontier(
		{
			issues: [
				giteaIssue({ number: 10, state: "closed" }),
				giteaIssue({ number: 11, labels: ["workflow:implement", FACTORY_LABELS.failed] }),
				giteaIssue({ number: 12, labels: ["workflow:implement", FACTORY_LABELS.readyForHuman] }),
				// Missing `ready-for-agent`: the frontier calls it ineligible, and §3.5
				// has no such class — only a human adding the label changes it.
				giteaIssue({ number: 13, labels: ["workflow:implement"] }),
				giteaIssue({ number: 14, labels: ["workflow:implement", FACTORY_LABELS.awaitingMerge] }),
				giteaIssue({ number: 15 }),
			],
			dependencies: { 15: [13] },
		},
		[10, 11, 12, 13, 14, 15],
	);

	const report = drainReport({ view });

	for (const member of report.members) {
		assert.ok(DRAIN_MEMBER_CLASSES.includes(member.class), `${member.ticket} is ${member.class}`);
	}
	assert.deepEqual(
		report.members.map((member) => [member.ticket, member.class]),
		[
			[10, "closed"],
			[11, "failed"],
			[12, "human-owned"],
			[13, "human-owned"],
			[14, "awaiting-merge-dependency"],
			[15, "human-owned"],
		],
	);
	assert.equal(report.counts["human-owned"], 3);
	assert.equal(report.counts["blocked-external"], 0, "a class nothing is in is still an answer");
});

test("an out-of-scope blocker keeps its dependent blocked-external — scope never auto-expands", async () => {
	const view = await frontier(
		{ issues: [giteaIssue({ number: 40 }), giteaIssue({ number: 41 })], dependencies: { 41: [40] } },
		[41],
	);

	const report = drainReport({ view });

	assert.equal(report.members[0].class, MEMBER_CLASSES.blockedExternal);
	assert.equal(report.drained, true);
});

test("a dependency cycle is reported, not walked", async () => {
	const view = await frontier(
		{
			issues: [giteaIssue({ number: 20 }), giteaIssue({ number: 21 })],
			dependencies: { 20: [21], 21: [20] },
		},
		[20, 21],
	);

	const report = drainReport({ view });

	assert.equal(report.members.length, 2);
	for (const member of report.members) {
		assert.equal(member.class, MEMBER_CLASSES.blockedExternal);
		assert.match(member.reason, /dependency cycle/);
	}
});

test("§7.6's unmergeable flag is carried through and nothing acts on it", async () => {
	const view = await frontier(
		{ issues: [giteaIssue({ number: 14, labels: ["workflow:implement", FACTORY_LABELS.awaitingMerge] })] },
		[14],
	);
	const flagged = { ...view, members: [{ ...view.members[0], unmergeable: true }] };

	const noted = drainReport({ view: flagged });
	const undiscovered = drainReport({ view });

	assert.equal(noted.members[0].unmergeable, true);
	assert.deepEqual(noted.unmergeable.noted, [14]);
	assert.equal(noted.unmergeable.acted_on, false);
	// The flag changes nothing about the verdict — that is the whole of "no
	// automation acts on it in v1".
	assert.deepEqual(noted.drain, undiscovered.drain);
	// Undiscovered is not "mergeable": §7.5's PR discovery has not landed, and the
	// report names that rather than carrying a plausible `false`.
	assert.equal(undiscovered.members[0].unmergeable, null);
	assert.deepEqual(undiscovered.unmergeable.noted, []);
	assert.match(undiscovered.unmergeable.discovered_by, /#107/);
});

test("the report carries what the run did to each member, and a null where it did nothing", async () => {
	const view = await frontier(
		{ issues: [giteaIssue({ number: 10, state: "closed" }), giteaIssue({ number: 11, state: "closed" })] },
		[10, 11],
	);

	const report = drainReport({
		view,
		executed: {
			claimed: 1,
			released: 0,
			refused: [],
			blocked: [],
			lanes: [{ ticket: 10, disposition: "published" }],
		},
		inFlight: [],
	});

	assert.equal(report.claimed, 1);
	assert.equal(report.members.find((member) => member.ticket === 10).disposition, "published");
	assert.equal(report.members.find((member) => member.ticket === 11).disposition, null);
});

test("a scope nobody read is not drained — it is unanswered", () => {
	// `drained: true` here would be the plausible zero this repository refuses
	// everywhere else: a red preflight, an abandon already pending, or a loop that
	// never reached a decision would each report the work as finished on the
	// strength of never having looked.
	const report = drainReport({ missing: "the pipeline above the claim (#107)" });

	assert.deepEqual(report.members, []);
	assert.equal(report.claimed, 0);
	assert.equal(report.drained, null);
	assert.equal(report.drain.read, false);
	assert.equal(report.drain.claimable_now, null);
	assert.match(report.drain.reason, /no frontier was read/);
	assert.match(report.missing, /#107/);

	// A scope that *was* read and had nothing left is the other answer entirely.
	const looked = drainReport({ view: { claimable: [], members: [] } });
	assert.equal(looked.drained, true);
	assert.equal(looked.drain.read, true);
});
