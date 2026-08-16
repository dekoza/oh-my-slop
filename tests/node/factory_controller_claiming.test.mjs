import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { EXIT_OK } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { CLAIM_OUTCOMES } from "../../factory/lib/tracker/claims.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";

/**
 * The whole of #102 through a real run: §14.21's ordering, §3.3's claim, §3.5's
 * drain and its classified report, and §3.4's *the run never waits*.
 *
 * These go through `runStart` against a real repository, a real policy file and a
 * real store, with only Gitea faked — the properties under test are about what
 * order durable records land in and what the run exits with, and neither is
 * observable from a unit that was handed a stub.
 */

function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");
	const repoRoot = makeRepo(t);

	return {
		repoRoot,
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr: herdrAnswering(true),
		// The §6.2 runtime probes are live reads of the operator's harnesses,
		// injected for the same reason the Herdr probe is.
		workerTransports: workerTransportsAnswering(root),
	};
}

/**
 * A run over a scope, with a pipeline that records what it was handed. The
 * pipeline is #107's seam; everything below the claim is this package's.
 */
async function runOver(t, { world, tickets, pipeline, lanes = [] }) {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.repoRoot });
	const gitea = fakeGitea(world);
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		herdr: context.herdr,
		workerTransports: context.workerTransports,
		args: tickets.map(String),
		flags: new Set([FOREGROUND_FLAG]),
		tracker: createGiteaReader({ ...where, request: gitea.request }),
		trackerWriter: createGiteaWriter({ ...where, request: gitea.write }),
		pipeline:
			pipeline ??
			(async (lane) => {
				lanes.push(lane);
				return { disposition: "published" };
			}),
	});

	return { answer, gitea, context, lanes };
}

async function eventsOf(t, context) {
	const store = await openStore({ repoRoot: context.repoRoot, agentDir: context.agentDir });
	t.after(() => store.close());
	return store;
}

test("a ticket is never claimed before its ticket slot and its model slot are held (§14.21)", async (t) => {
	const { answer, context, gitea } = await runOver(t, {
		world: { issues: [giteaIssue({ number: 42 })] },
		tickets: [42],
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.execution.claimed, 1);

	// §14.37: ordering is by sequence, never by clock. Both slots are granted
	// before the assignment's intent is even recorded, let alone performed.
	const store = await eventsOf(t, context);
	const journal = store.readEvents({}).filter((event) => event.ticket === 42);
	const granted = journal.filter((event) => event.kind === "capacity.granted");
	const claimed = journal
		.filter((event) => event.kind === "effect.requested" && event.payload.operation === "issue-assign")
		.map((event) => event.seq);

	// §14.21 names both pools, so the test names both: a ticket slot alone would
	// satisfy a weaker invariant than the one written down.
	assert.deepEqual(
		granted.map((event) => event.payload.pool).sort(),
		["model", "ticket"],
	);
	assert.equal(claimed.length, 1);
	assert.ok(
		Math.max(...granted.map((event) => event.seq)) < claimed[0],
		"the claim was recorded before both slots were held",
	);
	assert.deepEqual(
		gitea.writes.map((write) => write.operation),
		["issue-assign", "comment-post"],
	);
});

test("the pipeline is handed the claim, and the disposition comes back on the member", async (t) => {
	const lanes = [];
	const { answer } = await runOver(t, {
		world: { issues: [giteaIssue({ number: 42 })] },
		tickets: [42],
		lanes,
	});

	assert.equal(lanes.length, 1);
	assert.equal(lanes[0].claim.outcome, CLAIM_OUTCOMES.claimed);
	assert.equal(lanes[0].attempt.endsWith("-t42-a1"), true);
	assert.equal(answer.report.execution.members.find((member) => member.ticket === 42).disposition, "published");
	assert.equal(answer.report.execution.in_flight, 0, "a lane that reached a disposition was reported in flight");
});

test("§3.5: nothing claimable and nothing movable is drained, and the run exits without polling", async (t) => {
	const reads = [];
	const { answer, gitea } = await runOver(t, {
		world: {
			issues: [
				giteaIssue({ number: 40, state: "closed" }),
				giteaIssue({ number: 41, labels: ["workflow:implement", FACTORY_LABELS.needsHuman] }),
				giteaIssue({ number: 42 }),
			],
			dependencies: { 42: [41] },
		},
		tickets: [40, 41, 42],
		pipeline: async (lane) => {
			reads.push(lane.ticket);
			return { disposition: "published" };
		},
	});

	assert.equal(answer.report.end_reason, "drained");
	assert.equal(answer.report.execution.drained, true);
	assert.deepEqual(reads, [], "a scope with nothing claimable claimed something anyway");
	assert.deepEqual(gitea.writes, [], "a drained scope wrote to the tracker");

	// Exactly §3.5's six, and the dependent inherits its blocker's class.
	assert.deepEqual(
		answer.report.execution.members.map((member) => [member.ticket, member.class]),
		[
			[40, "closed"],
			[41, "needs-human"],
			[42, "needs-human"],
		],
	);
	assert.equal(answer.report.execution.members[2].blocked_by, 41);
	assert.match(answer.message, /drained all 3 member\(s\)/);
});

test("§3.4: the run never waits for a human answer — it ends and the ticket waits for the next run", async (t) => {
	const { answer } = await runOver(t, {
		world: {
			issues: [giteaIssue({ number: 42, labels: ["workflow:implement", FACTORY_LABELS.needsHuman] })],
		},
		tickets: [42],
	});

	// No timer, no poll, no second look: the run reached its end reason on the
	// first frontier read and exited with it.
	assert.equal(answer.report.end_reason, "drained");
	assert.equal(answer.report.execution.claimed, 0);
	assert.equal(answer.report.execution.members[0].class, "needs-human");
	assert.match(answer.report.execution.members[0].reason, /removing the label/);
});

test("§3.3: a human-claimed ticket is left exactly as it was, and the lane ends with no disposition", async (t) => {
	const lanes = [];
	const { answer, gitea } = await runOver(t, {
		world: { issues: [giteaIssue({ number: 42, assignees: ["a-human"] })] },
		tickets: [42],
		lanes,
	});

	assert.deepEqual(lanes, [], "the pipeline ran against a ticket a human holds");
	assert.deepEqual(gitea.writes, [], "a human claim was contested");
	assert.deepEqual(
		gitea.issues[0].assignees.map((user) => user.login),
		["a-human"],
	);
	assert.equal(answer.report.execution.members[0].disposition, null);
	assert.equal(answer.report.end_reason, "drained");

	// §9.7: a run that wrote nothing to the tracker must not report a claim. The
	// loop ran a lane, and the lane declined — those are two different numbers.
	assert.equal(answer.report.execution.claimed, 0);
	assert.equal(answer.report.execution.lanes_run, 1);
	assert.match(answer.message, /having claimed 0 tickets/);
	// And the member says who to go and talk to, not merely that it is unclaimable.
	assert.equal(answer.report.execution.members[0].class, "human-owned");
	assert.match(answer.report.execution.members[0].reason, /assigned to a-human/);
});

test("§8.9: released drops the claim with no label, so the ticket returns to the frontier", async (t) => {
	const labelsBefore = giteaIssue({ number: 42 }).labels.map((label) => label.name);
	const { answer, gitea, context } = await runOver(t, {
		world: { issues: [giteaIssue({ number: 42 })] },
		tickets: [42],
		pipeline: async () => ({ disposition: "released", reason: "the pipeline gave the work up" }),
	});

	assert.equal(answer.report.execution.members[0].disposition, "released");
	// The claim is dropped by the run itself: §8.9's row is the tracker action for
	// the disposition, and this is the one of the four this slice owns.
	assert.deepEqual(gitea.issues[0].assignees, []);
	assert.deepEqual(
		gitea.issues[0].labels.map((label) => label.name),
		labelsBefore,
		"§8.9's released touches no label",
	);
	assert.deepEqual(
		gitea.writes.map((write) => write.operation),
		["issue-assign", "comment-post", "issue-unassign", "comment-post"],
	);
	assert.match(gitea.comments.at(-1).body, /reason: the pipeline gave the work up/);

	// And it is durable: a run that reported a finished lane as still in flight
	// would be telling the next controller there is something to reconcile.
	const store = await eventsOf(t, context);
	assert.deepEqual(
		store.readTicketExecutions(answer.report.run).map((row) => [row.ticket, row.disposition]),
		[[42, "released"]],
	);
	assert.equal(answer.report.execution.in_flight, 0);
});

test("a run reads the frontier again at every scheduling decision, and caches nothing", async (t) => {
	const { gitea } = await runOver(t, {
		world: { issues: [giteaIssue({ number: 42 }), giteaIssue({ number: 43 })] },
		tickets: [42, 43],
	});

	// §9.6's loop at one ticket slot makes five decisions over two tickets: take
	// #42; look again and find #43 claimable but no slot free, so wait; #42
	// terminates, look again and take #43; look again and find nothing, so wait;
	// #43 terminates, look again and find nothing, so break. §3.1 recomputes
	// membership at every one of them, and `frontier.mjs` caches nothing — so the
	// scope is read five times, not once with four answers served from memory.
	//
	// It counts #43's dependency read rather than #42's issue read because the
	// claim has reads of its own on the ticket it is claiming: the pre-claim look
	// and §3.3's re-read. Nothing but a frontier resolution asks #43 for its edges.
	const decisions = gitea.calls.filter(
		(entry) => entry.call === "issue.dependencies" && entry.path.includes("/issues/43/dependencies"),
	);
	assert.equal(decisions.length, 5, "the frontier was not re-read at every scheduling decision");
});
