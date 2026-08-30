import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { EXIT_OK } from "../../factory/lib/cli/exit-codes.mjs";
import { RETAINED_REASONS } from "../../factory/lib/capacity/slots.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { ENTRY_MODES } from "../../factory/lib/controller/entry.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { ADOPTION_VERDICTS } from "../../factory/lib/domain/vocabulary.mjs";
import { requestEffect } from "../../factory/lib/effects/records.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { attemptDir, attemptOutboxPath, herdrAgentName } from "../../factory/lib/worker/attempt.mjs";
import { runWorkspaceLabel } from "../../factory/lib/worker/workspace.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";
import { herdrAnswering, makeAgentDir, makeHome, manualTimers } from "./helpers/factory-store.mjs";
import { fakeHerdr, workerTransportsAnswering } from "./helpers/factory-worker.mjs";

/**
 * §5.5 and §10.4 end to end: **a controller killed mid-lane restarts, re-enters
 * the same run, and either adopts the live worker or declares it dead.**
 *
 * These go through `runStart` against a real repository, a real policy file and
 * a real store, with Herdr and Gitea faked — the properties are about which
 * durable records exist afterwards and which capacity rows are held, and
 * neither is observable from a unit handed a stub. The multiplexer is driven
 * through the same `runHerdr` seam the production path uses, so there is no
 * probe override for a test to reach for that a run would not.
 */

const TICKET = 42;
const AT = 1_770_000_000_000;

function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		repoRoot: makeRepo(t),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr: herdrAnswering(true),
		workerTransports: workerTransportsAnswering(root),
	};
}

async function withStore(t, context, body) {
	const store = await openStore({ repoRoot: context.repoRoot, agentDir: context.agentDir });
	try {
		return await body(store);
	} finally {
		store.close();
	}
}

/**
 * What a controller killed mid-implement leaves behind: an unended run, a
 * launched and correlated attempt, a live pane carrying its token, and the two
 * capacity rows the dead controller's generation took.
 */
async function killedMidLane(
	t,
	context,
	{ herdr = fakeHerdr(), correlated = true, ended = false, tickets = [TICKET] } = {},
) {
	const run = newUlid(AT);
	const attempt = `${run}-t${TICKET}-a1`;

	const worktree = join(context.repoRoot, "..", `worktree-${attempt}`);
	mkdirSync(worktree, { recursive: true });

	// The pane a launch leaves: a tab in the run's own workspace, stamped with
	// the attempt token before the agent starts (§6.4).
	const workspace = await herdr.control.openWorkspace({ cwd: "/state", label: runWorkspaceLabel(run) });
	const tab = await herdr.control.openTab({ workspace: workspace.workspace, cwd: worktree, label: "factory" });
	await herdr.control.stamp(tab.pane, { attempt, title: "factory" });
	await herdr.control.startAgent({ name: herdrAgentName(attempt), kind: "pi", pane: tab.pane });

	await withStore(t, context, (store) => {
		store.append({
			kind: "run.started",
			source: "controller",
			run,
			occurredAt: AT,
			observedAt: AT,
			payload: { scope: { kind: "direct-ticket", tickets }, mode: ENTRY_MODES.started },
		});
		mkdirSync(attemptDir(store.storeDir, attempt), { recursive: true });
		store.append({
			kind: "attempt.launched",
			source: "controller",
			run,
			ticket: TICKET,
			phase: "implement",
			attempt,
			occurredAt: AT + 1,
			observedAt: AT + 1,
			payload: {
				role: "implement",
				runtime: "pi",
				profile: "builder",
				worktree,
				outbox: attemptOutboxPath(store.storeDir, attempt),
			},
		});
		if (correlated) {
			store.append({
				kind: "attempt.correlated",
				source: "controller",
				run,
				ticket: TICKET,
				phase: "implement",
				attempt,
				occurredAt: AT + 2,
				observedAt: AT + 2,
				payload: {
					runtime: "pi",
					herdr: { workspace: workspace.workspace, tab: tab.tab, pane: tab.pane, agent: herdrAgentName(attempt), kind: "pi" },
					transcript: null,
				},
			});
		}
		if (ended) {
			store.append({
				kind: "attempt.ended",
				source: "controller",
				run,
				ticket: TICKET,
				phase: "implement",
				attempt,
				occurredAt: AT + 3,
				observedAt: AT + 3,
				payload: { outcome: "no-result" },
			});
		}

		leaveDeadRows(store, { run });
	});

	return { run, attempt, herdr, pane: tab.pane, worktree };
}

/**
 * The lane's two rows, as the dead controller's generation holds them: written
 * through a hold that is then given up, so the generation really is below the
 * successor's rather than being hand-set to a number.
 */
function leaveDeadRows(store, { run }) {
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => AT });
	const dead = holdControllerLease({ store, leases, timers: timers.api });
	dead.recordStartupReconcile();
	dead.adopt(run);

	for (const [name, pool, resourceClass] of [
		["capacity:ticket:0", "ticket", null],
		["capacity:model:local:0", "model", "local"],
	]) {
		leases.acquire({
			name,
			fencedTo: dead.fencingGeneration,
			identity: { run, ticket: TICKET, attempt: null, pool, class: resourceClass },
		});
	}

	dead.release();
}

/** The frontier the restarted run reads, and the lane it would execute. */
function world({ tickets = [TICKET] } = {}) {
	return { issues: tickets.map((ticket) => giteaIssue({ number: ticket })) };
}

/**
 * The same scope, with nothing on it a run may claim: the ticket is closed, so
 * §3.2 leaves it out of the frontier while the tracker still answers about it.
 * A scope whose issues 404 would fail the read rather than drain.
 */
function nonclaimable({ tickets = [TICKET] } = {}) {
	return { issues: tickets.map((ticket) => giteaIssue({ number: ticket, state: "closed" })) };
}

async function restart(t, context, { herdr, gitea, execute, tickets = [] }) {
	const loaded = loadFactoryConfig({ cwd: context.repoRoot });
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };

	return runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		herdr: context.herdr,
		workerTransports: context.workerTransports,
		args: tickets.map(String),
		flags: new Set([FOREGROUND_FLAG]),
		// The one seam: Herdr's CLI. The adoption probe is built inside the run
		// from it, exactly as production does.
		runHerdr: herdr.run,
		tracker: createGiteaReader({ ...where, request: gitea.request }),
		trackerWriter: createGiteaWriter({ ...where, request: gitea.write }),
		...(execute === undefined ? { pipeline: null } : { execute }),
	});
}

/** Every capacity row this store holds, as the lease table has them. */
async function capacityRows(t, context) {
	return withStore(t, context, (store) =>
		store.read((db) => db.prepare("SELECT * FROM lease WHERE name LIKE 'capacity:%' ORDER BY name").all()),
	);
}

// ── Adoption: the live worker keeps the slot its pane holds (§5.5, §15 case 6) ─

test("a restart re-enters the run, adopts the live worker, and re-acquires the slot its pane holds", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);
	const lanes = [];

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(world()),
		execute: async (lane) => {
			lanes.push(lane);
			return { disposition: "published", claimed: true, pr: { number: 7, url: "http://gitea/pulls/7" } };
		},
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.run, killed.run, "§10.4 keeps the run id");
	assert.equal(answer.report.entry.mode, ENTRY_MODES.adopted);

	// The lane came back without being claimed off the frontier: it was already
	// this factory's, and its slots were already held.
	assert.deepEqual(
		lanes.map((lane) => lane.ticket),
		[TICKET],
	);
	assert.deepEqual(
		answer.report.capacity.reclaim.resumed.map((lane) => [lane.ticket, lane.attempt, ...lane.slots]),
		[[TICKET, killed.attempt, "capacity:ticket:0", "capacity:model:local:0"]],
	);
	assert.equal(answer.report.capacity.reclaim.adopted, 2, "a lane is its ticket row and its model row");
	assert.equal(answer.report.capacity.reclaim.reclaimed, 0, "nothing was released: the worker was provable");

	// §15 case 5: the lane finished, so no row is left held.
	assert.deepEqual(await capacityRows(t, context), []);

	// §13.B: adoption stops no agent, and the pane is exactly where it was.
	assert.equal(
		killed.herdr.commands().includes("agent send-keys"),
		false,
		"§5.5 settles two controllers with the lease, not by killing the worker",
	);
	assert.notEqual(killed.herdr.paneFor(killed.attempt), null);
});

test("an adopted row is transferred onto this controller's generation, never released and re-taken", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);
	const before = await capacityRows(t, context);

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(world()),
		// A lane that never terminates would hold the run open, so it settles —
		// what this test reads is the record of the transfer, not the row's fate.
		execute: async () => ({ disposition: "released", claimed: true }),
	});

	const events = await withStore(t, context, (store) =>
		store.readEvents({ stream: runStream(killed.run) }).filter((event) => event.kind.startsWith("capacity.")),
	);
	const adopted = events.find((event) => event.payload.slot === "capacity:ticket:0");

	assert.equal(adopted.kind, "capacity.granted");
	assert.equal(adopted.payload.fencing_generation, answer.report.liveness.fencing_generation);
	assert.equal(
		adopted.payload.adopted_from.fencing_generation,
		before.find((row) => row.name === "capacity:ticket:0").fencing_generation,
	);
	assert.equal(adopted.payload.adoption.pane, killed.pane, "the proof that authorised the move rides with it");
	assert.equal(
		events.filter((event) => event.kind === "capacity.released" && event.payload.reason === "reclaimed-by-probe")
			.length,
		0,
	);
});

// ── Declared dead otherwise (§5.5, §15 case 7) ───────────────────────────────

test("a disproved worker's attempt is settled and its rows released by probe, with an empty frontier", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);
	// The pane's process ended while the controller was down: Herdr answers, and
	// no pane carries the token.
	killed.herdr.vanish();

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => {
			throw new Error("a disproved lane must not be resumed");
		},
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.end_reason, "drained");
	assert.equal(answer.report.capacity.reclaim.reclaimed, 2, "both rows were released by probe");
	assert.deepEqual(answer.report.capacity.reclaim.settled, [killed.attempt]);
	assert.deepEqual(await capacityRows(t, context), [], "§15 case 7, and nothing waited for a clock");

	// The attempt does not stay unfinished: its ticket is never re-offered this
	// run, so an ending nobody wrote would leave it in flight forever.
	const [ended] = await withStore(t, context, (store) => store.readEvents({ kind: "attempt.ended" }));
	assert.equal(ended.attempt, killed.attempt);
	assert.equal(ended.payload.outcome, "dead-worker");
	assert.equal(ended.payload.adoption.verdict, ADOPTION_VERDICTS.disproved);
	assert.equal(ended.payload.stop_anomaly.anomaly, "stop-not-attempted");
	assert.equal(killed.herdr.commands().includes("agent send-keys"), false);
});

test("a row naming an attempt the projections already settled is released with nothing to end", async (t) => {
	const context = invocation(t);
	// The controller died between `attempt.ended` and the slot release, and the
	// pane is still wedged — so all five tests would pass on it.
	const killed = await killedMidLane(t, context, { ended: true });

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => {
			throw new Error("an ended attempt must not be resumed");
		},
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.capacity.reclaim.reclaimed, 2);
	assert.deepEqual(answer.report.capacity.reclaim.resumed, []);
	assert.deepEqual(answer.report.capacity.reclaim.settled, []);
	assert.deepEqual(await capacityRows(t, context), []);

	const ended = await withStore(t, context, (store) => store.readEvents({ kind: "attempt.ended" }));
	assert.equal(ended.length, 1, "the projector's refusal of a second ending was never reached for");
});

test("an attempt whose launch never finished is no worker to adopt", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context, { correlated: false });

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => {
			throw new Error("an uncorrelated attempt is a launch to finish, not a worker to adopt");
		},
	});

	assert.deepEqual(answer.report.capacity.reclaim.resumed, []);
	assert.equal(answer.report.capacity.reclaim.reclaimed, 2);
	assert.deepEqual(await capacityRows(t, context), []);
});

// ── Unanswerable is not absent (§5.2, §12.4) ─────────────────────────────────

test("a Herdr that will not answer settles nothing, and the run's report accounts for what it left", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);
	killed.herdr.refuse["pane list"] = { exitCode: 1, stderr: "connection refused" };

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => {
			throw new Error("an unanswerable probe resumes nothing");
		},
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.capacity.reclaim.reclaimed, 0);
	assert.deepEqual(answer.report.capacity.reclaim.resumed, []);
	assert.deepEqual(
		answer.report.capacity.reclaim.held.map((row) => [row.slot, row.reason, row.verdict]),
		[
			["capacity:model:local:0", RETAINED_REASONS.unanswerable, ADOPTION_VERDICTS.unanswerable],
			["capacity:ticket:0", RETAINED_REASONS.unanswerable, ADOPTION_VERDICTS.unanswerable],
		],
	);

	// Left held, and **said out loud**: the run that took these rows is over, so
	// no successor can adopt them and only a later probe can settle them.
	assert.equal(answer.report.capacity.unsettled.count, 2);
	assert.deepEqual(
		answer.report.capacity.unsettled.rows.map((row) => row.adoptable_by_successor),
		[false, false],
	);
	assert.match(answer.report.capacity.unsettled.resolution, /re-probes/);
	assert.equal((await capacityRows(t, context)).length, 2, "unanswerable is not absent");
});

// ── The transfer waits for the preflight verdict ─────────────────────────────

test("a red preflight adopts nothing: no generation is transferred to a run that will not execute", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);
	const before = await capacityRows(t, context);

	// A missing Herdr is §10.3's red required check, and the run ends
	// `baseline-red` without a lane ever being offered a slot.
	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => {
			throw new Error("a red run executes nothing");
		},
	});
	assert.equal(answer.report.end_reason, "drained", "the fixture's preflight is green; the red case follows");

	const red = invocation(t);
	red.herdr = herdrAnswering(false);
	const killedRed = await killedMidLane(t, red);
	const redAnswer = await restart(t, red, {
		herdr: killedRed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => {
			throw new Error("a red run executes nothing");
		},
	});

	assert.equal(redAnswer.report.end_reason, "baseline-red");
	assert.deepEqual(redAnswer.report.capacity.reclaim.resumed, []);
	assert.equal(redAnswer.report.capacity.reclaim.adopted, 0);
	assert.deepEqual(
		redAnswer.report.capacity.reclaim.held.map((row) => row.reason),
		[RETAINED_REASONS.notExecuting, RETAINED_REASONS.notExecuting],
	);

	const rows = await capacityRows(t, red);
	assert.deepEqual(
		rows.map((row) => row.fencing_generation),
		before.map(() => 1),
		"a row moved onto a generation that ends unused is the one no successor can settle",
	);
});

test("a run with nothing to execute a lane with transfers nothing either", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);

	// `pipeline: null` is the focused no-pipeline seam: the run reads no frontier
	// and can resume no lane, so adopting one would strand its rows.
	const answer = await restart(t, context, { herdr: killed.herdr, gitea: fakeGitea(nonclaimable()) });

	assert.deepEqual(answer.report.capacity.reclaim.resumed, []);
	assert.deepEqual(
		answer.report.capacity.reclaim.held.map((row) => row.reason),
		[RETAINED_REASONS.notExecuting, RETAINED_REASONS.notExecuting],
	);
	assert.equal((await capacityRows(t, context)).length, 2);
});

// ── §15: a crash between an external effect and its durable resolution ───────

test("an effect requested by a controller that then died is settled by re-probe at the next startup", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);

	// §4.5's pair with only its first half written: the pane was opened, the
	// agent started, and the controller died before the resolution committed.
	const key = await withStore(t, context, (store) => {
		const leases = openLeases(store, { now: () => AT });
		const hold = holdControllerLease({ store, leases, timers: manualTimers().api });
		hold.recordStartupReconcile();
		hold.adopt(killed.run);
		const requested = requestEffect(store, {
			operation: "agent-start",
			operand: null,
			run: killed.run,
			ticket: TICKET,
			phase: "implement",
			attempt: killed.attempt,
			actor: "controller",
			fencingGeneration: hold.fence().generation,
			payload: { runtime: "pi", role: "implement" },
			at: AT + 4,
		});
		hold.release();
		return requested.key;
	});

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(nonclaimable()),
		execute: async () => ({ disposition: "released", claimed: true }),
	});

	// §5.3: settled **only** by re-probing the external system. The pane still
	// carries the token and still hosts a live agent, so the mutation happened.
	assert.deepEqual(answer.report.reconcile.unsettled, []);
	assert.equal(answer.report.reconcile.settled, 1);

	const [concluded] = await withStore(t, context, (store) => store.readEvents({ kind: "reconcile.concluded" }));
	assert.equal(concluded.payload.conclusion, "adopted");
	assert.deepEqual(
		concluded.payload.evidence.map((entry) => [entry.source, entry.effect_key, entry.matched]),
		[["harness", key, true]],
	);
	assert.equal(
		await withStore(t, context, (store) => store.read((db) => db.prepare("SELECT resolved_at FROM effect WHERE effect_key = ?").get(key).resolved_at)) !== null,
		true,
		"the resolution the dead controller never committed is committed now",
	);
});

// ── Two controllers (§5.5) ───────────────────────────────────────────────────

test("a second controller cannot adopt while the first holds the lease, and kills nothing to find out", async (t) => {
	const context = invocation(t);
	const killed = await killedMidLane(t, context);

	// A live holder: the lease row is taken and being renewed.
	const live = await withStore(t, context, (store) => {
		const leases = openLeases(store, { now: () => Date.now() });
		const timers = manualTimers();
		const hold = holdControllerLease({ store, leases, timers: timers.api });
		hold.recordStartupReconcile();
		hold.adopt(killed.run);
		return { generation: hold.fencingGeneration };
	});

	const answer = await restart(t, context, {
		herdr: killed.herdr,
		gitea: fakeGitea(world()),
		execute: async () => {
			throw new Error("a second controller must not run a lane the first holds");
		},
	});

	// §10.4: it resolves against the live selector rather than queueing, and it
	// claimed nothing.
	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.live, true);
	assert.equal(answer.report.run, killed.run);
	assert.equal(answer.report.claimed, 0);

	const rows = await capacityRows(t, context);
	assert.deepEqual(
		rows.map((row) => row.fencing_generation),
		[live.generation - 1, live.generation - 1],
		"the fencing generation is what excludes the second adopter",
	);
	assert.equal(
		killed.herdr.commands().includes("agent send-keys"),
		false,
		"§5.5 is explicit: not by killing the worker",
	);
});
