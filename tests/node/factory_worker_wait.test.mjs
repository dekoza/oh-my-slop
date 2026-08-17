import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";

import { fromFrame } from "../../factory/lib/controller/herdr-events.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { ATTEMPT_OUTCOMES } from "../../factory/lib/domain/vocabulary.mjs";
import { unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { attemptDir, attemptOutboxPath, herdrAgentName } from "../../factory/lib/worker/attempt.mjs";
import {
	awaitCompletion,
	cancelAttempt,
	decideOutcome,
	DEFAULT_NO_PROGRESS_TIMEOUT_MS,
	readLiveness,
	SETTLE_GRACE_MS,
} from "../../factory/lib/worker/lifecycle.mjs";
import { OUTBOX_SCHEMA_VERSION, readOutbox } from "../../factory/lib/worker/outbox.mjs";
import { fakeHerdr } from "./helpers/factory-worker.mjs";
import {
	attemptLaunched,
	FIXED_NOW,
	manualTimers,
	openTestStore,
	refusalOfAsync,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §6.6's typed completion: **the outbox is the authoritative domain result,
 * harness and Herdr lifecycle events are the authoritative termination
 * signal**, and the wait is first-signal-wins over both.
 *
 * The state table is exercised twice over: as a pure function, where every row
 * is one assertion, and through the real wait, where the same rows have to
 * survive a subscription, a poll, and a settle grace.
 */

const OUTCOME_SET = new Set(ATTEMPT_OUTCOMES);

function liveness({ status = "working", alive = true, settledAt = null } = {}) {
	return { status, alive, settledAt };
}

function outboxOf(state, { status = "completed" } = {}) {
	return {
		state,
		record: state === "valid" ? { status } : null,
		problems: [],
		bytes: null,
	};
}

// ── The state table, row by row (§6.6) ───────────────────────────────────────

test("a valid outbox and a settled worker yields the worker's own status", () => {
	for (const status of ["completed", "needs-human", "worker-failed"]) {
		const decided = decideOutcome({
			outbox: outboxOf("valid", { status }),
			liveness: liveness({ status: "done", alive: false, settledAt: FIXED_NOW }),
			at: FIXED_NOW,
			deadline: FIXED_NOW + 60_000,
		});
		assert.equal(decided.outcome, status);
	}
});

test("a valid outbox and a worker still working is wrote-but-hung, not a failure (§8.10)", () => {
	const decided = decideOutcome({
		outbox: outboxOf("valid"),
		liveness: liveness({ status: "working" }),
		at: FIXED_NOW,
		deadline: FIXED_NOW + 60_000,
	});

	assert.equal(decided.outcome, "wrote-but-hung");
});

test("a present-but-invalid outbox is invalid-result whatever the worker is doing", () => {
	for (const state of ["invalid", "unreadable"]) {
		for (const alive of [true, false]) {
			const decided = decideOutcome({
				outbox: outboxOf(state),
				liveness: liveness({ alive, settledAt: alive ? null : FIXED_NOW }),
				at: FIXED_NOW,
				deadline: FIXED_NOW + 60_000,
			});
			assert.equal(decided.outcome, "invalid-result");
		}
	}
});

test("an outbox that does not echo the minted tuple is an automation failure (§6.5)", () => {
	const decided = decideOutcome({
		outbox: outboxOf("foreign"),
		liveness: liveness(),
		at: FIXED_NOW,
		deadline: FIXED_NOW + 60_000,
	});

	assert.equal(decided.outcome, "automation-failure");
});

test("silence splits by fault: a settled worker is no-result, a gone one is dead-worker", () => {
	// §8.10 routes them to different budgets — a worker that ended its turn
	// without writing failed at its own job; a pane that died under it did not.
	const settled = decideOutcome({
		outbox: outboxOf("absent"),
		liveness: liveness({ status: "done", alive: false, settledAt: FIXED_NOW - SETTLE_GRACE_MS }),
		at: FIXED_NOW,
		deadline: FIXED_NOW + 60_000,
	});
	assert.equal(settled.outcome, "no-result");

	for (const status of ["exited", "released"]) {
		const gone = decideOutcome({
			outbox: outboxOf("absent"),
			liveness: liveness({ status, alive: false, settledAt: FIXED_NOW }),
			at: FIXED_NOW,
			deadline: FIXED_NOW + 60_000,
		});
		assert.equal(gone.outcome, "dead-worker", `${status} was not read as a worker that is gone`);
	}
});

test("a settled worker gets the grace before its silence is called silent-completion", () => {
	const waiting = decideOutcome({
		outbox: outboxOf("absent"),
		liveness: liveness({ status: "idle", alive: false, settledAt: FIXED_NOW }),
		at: FIXED_NOW + SETTLE_GRACE_MS - 1,
		deadline: FIXED_NOW + 60_000,
	});

	// A write one filesystem beat behind the status change must not burn a
	// repair budget on a completed attempt.
	assert.equal(waiting, null);
});

test("a worker that never settles is a timeout, and until then nothing is decided", () => {
	const table = { outbox: outboxOf("absent"), liveness: liveness({ status: "working" }) };

	assert.equal(decideOutcome({ ...table, at: FIXED_NOW, deadline: FIXED_NOW + 1 }), null);
	assert.equal(decideOutcome({ ...table, at: FIXED_NOW + 1, deadline: FIXED_NOW + 1 }).outcome, "timeout");
});

// ── §6.6's two clocks, #150 ──────────────────────────────────────────────────

test("no observed progress ends the attempt on the no-progress clock, and the clock is named (§6.6, #150)", () => {
	const table = { outbox: outboxOf("absent"), liveness: liveness({ status: "working" }) };

	assert.equal(
		decideOutcome({ ...table, at: FIXED_NOW, deadline: FIXED_NOW + 60_000, noProgressDeadline: FIXED_NOW + 1 }),
		null,
	);
	const decided = decideOutcome({
		...table,
		at: FIXED_NOW + 1,
		deadline: FIXED_NOW + 60_000,
		noProgressDeadline: FIXED_NOW + 1,
	});
	assert.equal(decided.outcome, "timeout");
	assert.equal(decided.clock, "no-progress");
});

test("the hard ceiling still bounds a progressing worker, and names itself (§6.6, #150)", () => {
	const table = { outbox: outboxOf("absent"), liveness: liveness({ status: "working" }) };
	const decided = decideOutcome({
		...table,
		at: FIXED_NOW + 60_000,
		deadline: FIXED_NOW + 60_000,
		noProgressDeadline: FIXED_NOW + 120_000,
	});
	assert.equal(decided.outcome, "timeout");
	assert.equal(decided.clock, "deadline");
});

test("a controller that stopped observing is the automation's failure, not the worker tier's (§8.10, #150)", () => {
	const decided = decideOutcome({
		outbox: outboxOf("absent"),
		liveness: liveness({ status: "working" }),
		at: FIXED_NOW + 1,
		deadline: FIXED_NOW + 60_000,
		noProgressDeadline: FIXED_NOW + 1,
		observationDegraded: true,
	});
	assert.equal(decided.outcome, "automation-failure");
	assert.equal(decided.clock, undefined, "a non-timeout carries no clock");
});

test("every outcome the table can produce is one of §8.8's", () => {
	for (const outbox of ["valid", "invalid", "unreadable", "foreign", "absent"]) {
		for (const status of ["working", "blocked", "idle", "done", "released", "exited"]) {
			const decided = decideOutcome({
				outbox: outboxOf(outbox),
				liveness: readLiveness({ status, alive: true }, { settledAt: null }, FIXED_NOW - 60_000),
				at: FIXED_NOW,
				deadline: FIXED_NOW,
			});
			if (decided === null) continue;
			assert.ok(OUTCOME_SET.has(decided.outcome), `${outbox} × ${status} produced ${decided.outcome}`);
		}
	}
});

// ── Liveness is "still working", not "the process exists" ────────────────────

test("an interactive harness sitting at its prompt is settled, not alive", () => {
	// The crux: neither runtime exits when a turn ends. Reading "the process is
	// there" as liveness would make every normal completion `wrote-but-hung`.
	for (const status of ["idle", "done", "released", "exited"]) {
		assert.equal(readLiveness({ status }, { settledAt: null }, FIXED_NOW).alive, false, status);
	}
	for (const status of ["working", "blocked", "unknown"]) {
		assert.equal(readLiveness({ status }, { settledAt: null }, FIXED_NOW).alive, true, status);
	}
});

test("the grace is measured from the first settle, not from the latest transition", () => {
	const first = readLiveness({ status: "idle" }, { settledAt: null }, FIXED_NOW);
	const second = readLiveness({ status: "done" }, first, FIXED_NOW + 5_000);

	assert.equal(second.settledAt, FIXED_NOW);
	assert.equal(readLiveness({ status: "working" }, second, FIXED_NOW + 6_000).settledAt, null, "work resets it");
});

test("a live `pane.agent_status_changed` frame reaches the rows the old matcher made unreachable (§6.6, #149)", () => {
	// The old matcher dropped the dotted frame, so decideOutcome never saw a
	// settled worker: its "worker's own status" and "no-result" rows were dead.
	// A frame off the wire must reach both.
	const frame = (agentStatus) =>
		fromFrame(
			JSON.parse(
				`{"data":{"agent":"claude","agent_status":"${agentStatus}","pane_id":"w1:p2","workspace_id":"w1"},"event":"pane.agent_status_changed"}`,
			),
			"w1:p2",
		);

	const idle = readLiveness(frame("idle"), { settledAt: null }, FIXED_NOW);
	assert.equal(idle.alive, false, "idle is a settled worker, not an alive one");
	assert.equal(idle.settledAt, FIXED_NOW);
	assert.equal(
		decideOutcome({
			outbox: outboxOf("absent"),
			liveness: idle,
			at: FIXED_NOW + SETTLE_GRACE_MS,
			deadline: FIXED_NOW + 60_000,
		}).outcome,
		"no-result",
		"a settled worker with no outbox is silent-completion",
	);

	const done = readLiveness(frame("done"), { settledAt: null }, FIXED_NOW);
	assert.equal(
		decideOutcome({
			outbox: outboxOf("valid", { status: "worker-failed" }),
			liveness: done,
			at: FIXED_NOW,
			deadline: FIXED_NOW + 60_000,
		}).outcome,
		"worker-failed",
		"a valid outbox from a settled worker yields the worker's own status",
	);
});

// ── The wait, end to end ─────────────────────────────────────────────────────

/** A store with a run, a hold, and one launched attempt whose pane is live. */
async function waiting(t, { herdr = fakeHerdr() } = {}) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const opened = runStarted();

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(opened.run);
	store.append(attemptLaunched(opened.run, 42, 1));

	const identity = { run: opened.run, ticket: 42, phase: "implement", attempt: `${opened.run}-t42-a1` };
	// A pane carrying the attempt's token, as a launch would have left it.
	await herdr.control.openPane({ cwd: "/state/worktrees/attempt", label: "factory" });
	await herdr.control.stamp("w1:p1", { attempt: identity.attempt, title: "factory" });
	await herdr.control.startAgent({ name: herdrAgentName(identity.attempt), kind: "pi", pane: "w1:p1" });
	herdr.calls.length = 0;

	return {
		store,
		hold,
		herdr,
		identity,
		run: opened.run,
		writeOutbox(content) {
			mkdirSync(attemptDir(store.storeDir, identity.attempt), { recursive: true });
			writeFileSync(
				attemptOutboxPath(store.storeDir, identity.attempt),
				typeof content === "string" ? content : JSON.stringify(content),
			);
		},
		wait: (overrides = {}) =>
			awaitCompletion(store, {
				hold,
				identity,
				pane: "w1:p1",
				agent: herdrAgentName(identity.attempt),
				socket: "/run/herdr.sock",
				herdr: herdr.control,
				timeoutMs: 60_000,
				actor: "controller",
				now: () => FIXED_NOW,
				sleep: async () => {},
				// Each test drives the transitions it is about, so the socket half is
				// injected rather than defaulted: a default here would be a fourth
				// place the observation stream is described.
				watch: () => ({ close: () => {}, degraded: () => false }),
				...overrides,
			}),
	};
}

function completedOutbox(identity) {
	return {
		schema_version: OUTBOX_SCHEMA_VERSION,
		status: "completed",
		...identity,
		summary: "did the thing",
		commits: ["a1b2c3d"],
	};
}

test("an omitted no-progress window is the default, never an unreachable one (§6.6, #150)", async (t) => {
	// Proven live: production composed the wait without a timeoutMs, the
	// deadline computed as NaN, and §6.6's timeout row was unreachable — a
	// worker that hung mid-turn would have been waited on forever. Both clocks
	// have code-owned defaults for the same reason.
	const context = await waiting(t);
	let clock = FIXED_NOW;

	const result = await context.wait({
		timeoutMs: undefined,
		noProgressTimeoutMs: undefined,
		now: () => clock,
		sleep: async () => {
			clock += 60_000;
			if (clock - FIXED_NOW > 3 * DEFAULT_NO_PROGRESS_TIMEOUT_MS) {
				throw new Error("the wait sailed past three default no-progress windows without timing out");
			}
		},
	});

	assert.equal(result.outcome, "timeout");
	assert.equal(result.clock, "no-progress");
	assert.ok(clock - FIXED_NOW >= DEFAULT_NO_PROGRESS_TIMEOUT_MS, "the default no-progress window was not honoured");
});

test("the hard ceiling still bounds a worker that keeps producing progress (§6.6, #150)", async (t) => {
	const context = await waiting(t);
	let clock = FIXED_NOW;
	let step = 0;
	let push;

	const result = await context.wait({
		timeoutMs: 60_000,
		noProgressTimeoutMs: 10_000,
		now: () => clock,
		watch: ({ onTransition }) => {
			push = onTransition;
			return { close: () => {}, degraded: () => false };
		},
		sleep: async () => {
			clock += 1_000;
			step += 1;
			// A status transition every five samples: progress keeps arriving, so
			// only the hard ceiling may end the attempt.
			if (step % 5 === 0) {
				push({ status: "working", alive: true, agent: "pi", source: "poll", event: null, from: "working" });
			}
		},
	});

	assert.equal(result.outcome, "timeout");
	assert.equal(result.clock, "deadline");
});

test("pane output growth is observed progress, and its absence is the no-progress timeout (§6.6, #150)", async (t) => {
	const context = await waiting(t);
	let clock = FIXED_NOW;
	let samples = 0;

	const result = await context.wait({
		timeoutMs: 60_000,
		noProgressTimeoutMs: 10_000,
		now: () => clock,
		sleep: async () => {
			clock += 1_000;
			samples += 1;
			// The pane grows for three samples, then goes quiet.
			if (samples <= 3) context.herdr.paneOutput = `output ${samples}`;
		},
	});

	assert.equal(result.outcome, "timeout");
	assert.equal(result.clock, "no-progress");
	assert.equal(result.lastProgress.fact, "worker.output", "the disposition names the last observed progress");

	const [ended] = context.store.readEvents({ kind: "attempt.ended" });
	assert.equal(ended.payload.clock, "no-progress");
	assert.equal(ended.payload.last_progress.fact, "worker.output");
	assert.equal(ended.payload.last_progress.source, "herdr");
});

test("a degraded observation channel makes a no-progress timeout an automation failure (§8.10, #150)", async (t) => {
	const context = await waiting(t);
	let clock = FIXED_NOW;

	const result = await context.wait({
		timeoutMs: 60_000,
		noProgressTimeoutMs: 10_000,
		now: () => clock,
		watch: ({ onDegraded }) => {
			onDegraded({ source: "herdr", reason: "socket-unavailable", detail: "ENOENT", fallback: "polling", interval_ms: 2_000 });
			return { close: () => {}, degraded: () => true };
		},
		sleep: async () => {
			clock += 1_000;
		},
	});

	assert.equal(result.outcome, "automation-failure");
	assert.equal(result.clock, null, "a controller fault is not a worker-tier timeout");
});

test("an idle seed is a state, not a transition: the just-prompted worker gets its turn before silence counts (§6.6)", async (t) => {
	// Proven live (run 01M068G2…): a freshly prompted pi agent still reads
	// "idle" before its model begins the turn, and a seed that starts the
	// settle clock harvested both attempts as no-result 2052ms after
	// correlation. Only an observed transition into a settled status may
	// start the clock; the seed is a state with no history.
	const context = await waiting(t, { herdr: fakeHerdr({ agentStatus: "idle" }) });
	let clock = FIXED_NOW;
	let polls = 0;
	let push;

	const result = await context.wait({
		now: () => clock,
		watch: ({ onTransition }) => {
			push = onTransition;
			return { close: () => {}, degraded: () => false };
		},
		sleep: async () => {
			clock += 1_000;
			polls += 1;
			// The model starts long after the settle grace has elapsed since the
			// seed, works, settles, and writes — the ordinary slow first token.
			if (polls === 5) push({ status: "working", alive: true, agent: "pi", source: "subscribe", event: null, from: "idle" });
			if (polls === 6) {
				context.writeOutbox(completedOutbox(context.identity));
				push({ status: "idle", alive: false, agent: "pi", source: "subscribe", event: null, from: "working" });
			}
		},
	});

	assert.equal(result.outcome, "completed");
});

test("a valid outbox from a settled worker is harvested, and the agent stopped (§6.6)", async (t) => {
	const context = await waiting(t);
	context.writeOutbox(completedOutbox(context.identity));
	context.herdr.settle("done");

	const harvested = await context.wait({
		watch: ({ onTransition }) => {
			onTransition({ status: "done", alive: false, agent: "pi", source: "subscribe", event: null, from: "working" });
			return { close: () => {}, degraded: () => false };
		},
	});

	assert.equal(harvested.outcome, "completed");
	assert.equal(harvested.record.summary, "did the thing");
	assert.equal(harvested.agent_stopped, true);

	// The liveness seed, then the stop, then the read-back — and **the agent,
	// never the pane** (§13.B).
	assert.deepEqual(context.herdr.commands(), ["pane list", "agent send-keys", "pane list"]);
	assert.equal(context.herdr.panes.length, 1, "the pane survives its worker");
});

test("attempt.ended records the outcome, the evidence, and nothing more", async (t) => {
	const context = await waiting(t);
	context.writeOutbox(completedOutbox(context.identity));

	await context.wait({
		watch: ({ onTransition }) => {
			onTransition({ status: "done", alive: false, agent: "pi", source: "subscribe", event: null, from: "working" });
			return { close: () => {}, degraded: () => false };
		},
	});

	const [ended] = context.store.readEvents({ kind: "attempt.ended" });
	assert.equal(ended.payload.outcome, "completed");
	assert.equal(ended.payload.result.summary, "did the thing", "the outbox is evidence, carried and never believed");
	assert.equal(ended.payload.worker_status, "done");
	assert.equal(context.store.readAttempts({ runId: context.run })[0].outcome, "completed");
});

test("an attempt ends once: a late outbox after a cancellation is ignored for state (§6.6)", async (t) => {
	const context = await waiting(t);

	const cancelled = await cancelAttempt(context.store, {
		hold: context.hold,
		identity: context.identity,
		herdr: context.herdr.control,
		agent: herdrAgentName(context.identity.attempt),
		by: "operator:stop",
		reason: "the operator asked",
		actor: "operator:stop",
		now: () => FIXED_NOW,
	});

	assert.equal(cancelled.outcome, "cancelled");
	const [ended] = context.store.readEvents({ kind: "attempt.ended" });
	assert.equal(ended.payload.cancelled_by, "operator:stop");
	assert.equal(ended.payload.cancellation_reason, "the operator asked");

	// The worker writes anyway. The projector is what refuses, so this is
	// structural rather than a rule the harvest path remembers to follow.
	context.writeOutbox(completedOutbox(context.identity));
	const late = readOutbox(attemptOutboxPath(context.store.storeDir, context.identity.attempt), context.identity);
	assert.equal(late.state, "valid", "the file is still evidence");
	assert.throws(
		() =>
			context.store.append({
				kind: "attempt.ended",
				source: "controller",
				...context.identity,
				occurredAt: FIXED_NOW,
				observedAt: FIXED_NOW,
				payload: { outcome: "completed" },
			}),
		/already ended as cancelled/,
	);
});

test("a cancellation stops the agent as an effect, and closes no pane", async (t) => {
	const context = await waiting(t);

	await cancelAttempt(context.store, {
		hold: context.hold,
		identity: context.identity,
		herdr: context.herdr.control,
		agent: herdrAgentName(context.identity.attempt),
		by: "operator:stop",
		reason: "the operator asked",
		actor: "operator:stop",
		now: () => FIXED_NOW,
	});

	const [requested] = context.store.readEvents({ kind: "effect.requested" });
	assert.equal(requested.payload.operation, "agent-stop");
	assert.deepEqual(unresolvedEffects(context.store), []);
	assert.equal(context.herdr.commands().includes("pane close"), false);
	assert.equal(context.herdr.panes.length, 1);
});

test("a wedged agent is an anomaly on the record, never an escalation (§13.B)", async (t) => {
	// A harness that ignores its own quit keys: the pane stays, the agent stays,
	// and #86's resolution accepts exactly that — a wedged pane is evidence.
	const herdr = fakeHerdr({ ignoresQuitKeys: true });
	const context = await waiting(t, { herdr });

	const cancelled = await cancelAttempt(context.store, {
		hold: context.hold,
		identity: context.identity,
		herdr: herdr.control,
		agent: herdrAgentName(context.identity.attempt),
		by: "operator:stop",
		reason: "the operator asked",
		actor: "operator:stop",
		now: () => FIXED_NOW,
	});

	assert.equal(cancelled.outcome, "cancelled");
	assert.equal(cancelled.agent_stopped, false, "the record says it did not go");
	const [ended] = context.store.readEvents({ kind: "attempt.ended" });
	assert.equal(ended.payload.agent_stopped, false);
});

// ── §5.1's observation half ──────────────────────────────────────────────────

test("agent-status transitions are recorded as events, one per observed change", async (t) => {
	const context = await waiting(t);
	context.writeOutbox(completedOutbox(context.identity));

	await context.wait({
		watch: ({ onTransition }) => {
			// The sequence a poll structurally cannot see (§5.1).
			onTransition({ status: "working", alive: true, agent: "pi", source: "subscribe", event: "pane_agent_status_changed", from: null });
			onTransition({ status: "blocked", alive: true, agent: "pi", source: "subscribe", event: "pane_agent_status_changed", from: "working" });
			onTransition({ status: "working", alive: true, agent: "pi", source: "subscribe", event: "pane_agent_status_changed", from: "blocked" });
			onTransition({ status: "done", alive: false, agent: "pi", source: "subscribe", event: "pane_agent_status_changed", from: "working" });
			return { close: () => {}, degraded: () => false };
		},
	});

	const observed = context.store.readEvents({ stream: runStream(context.run), kind: "observation.recorded" });
	assert.deepEqual(observed.map((event) => event.payload.status), ["working", "blocked", "working", "done"]);
	assert.equal(observed[0].source, "herdr");
	assert.equal(observed[0].payload.fact, "worker.alive", "§5.2 names the fact a status transition records");
	assert.equal(observed[1].payload.from, "working");

	// Herdr dates nothing it answers, so the slot §4.3 reserves for a foreign
	// system's own timestamp stays empty rather than carrying our clock.
	assert.equal(observed[0].payload.occurred_at_raw, undefined);
	// Each transition is its own foreign id, or the dedup index would let the
	// first sighting suppress every later one.
	assert.equal(new Set(observed.map((event) => event.foreign_source_id)).size, 4);
});

test("a socket that will not carry the transitions degrades loudly and keeps watching", async (t) => {
	const context = await waiting(t);
	context.writeOutbox(completedOutbox(context.identity));

	await context.wait({
		watch: ({ onTransition, onDegraded }) => {
			onDegraded({ source: "herdr", reason: "socket-unavailable", detail: "ENOENT", fallback: "polling", interval_ms: 2_000 });
			onDegraded({ source: "herdr", reason: "socket-unavailable", detail: "ENOENT", fallback: "polling", interval_ms: 2_000 });
			onTransition({ status: "done", alive: false, agent: "pi", source: "poll", event: null, from: null });
			return { close: () => {}, degraded: () => true };
		},
	});

	const [degraded, ...more] = context.store.readEvents({ kind: "observation.degraded" });
	assert.equal(degraded.payload.reason, "socket-unavailable");
	assert.equal(degraded.payload.fallback, "polling");
	assert.equal(degraded.source, "controller", "Herdr did not tell us this; its silence did");
	assert.deepEqual(more, [], "the fallback is a state, not a stream of notices");

	// Which half saw it rides the observation, so an operator can tell a run
	// whose transitions were all sampled from one that was subscribed.
	const [observed] = context.store.readEvents({ kind: "observation.recorded" });
	assert.equal(observed.payload.observed_by, "poll");
});

test("an unrecognised frame for this pane is recorded as a diagnostic, never silent (§5.1)", async (t) => {
	const context = await waiting(t);
	context.writeOutbox(completedOutbox(context.identity));

	await context.wait({
		watch: ({ onTransition, onUnrecognised }) => {
			onUnrecognised({ pane: "w1:p1", event: "pane.new_event" });
			onUnrecognised({ pane: "w1:p1", event: "pane.new_event" });
			onUnrecognised({ pane: "w1:p1", event: "pane.another_event" });
			onTransition({ status: "done", alive: false, agent: "pi", source: "subscribe", event: null, from: null });
			return { close: () => {}, degraded: () => false };
		},
	});

	const unrecognised = context.store.readEvents({ kind: "observation.unrecognised" });
	assert.equal(unrecognised.length, 2, "once per distinct wire name, not per frame");
	assert.equal(unrecognised[0].payload.event, "pane.new_event");
	assert.equal(unrecognised[0].payload.pane, "w1:p1");
	assert.equal(unrecognised[0].source, "controller", "our vocabulary gap, not Herdr's fact");
	assert.deepEqual(
		unrecognised.map((event) => event.payload.event),
		["pane.new_event", "pane.another_event"],
	);
});

// ── The refusal ──────────────────────────────────────────────────────────────

test("a wait or a cancel for an attempt nothing launched refuses rather than inventing one", async (t) => {
	const context = await waiting(t);
	const unlaunched = { ...context.identity, attempt: `${context.run}-t42-a9` };

	for (const call of [
		() => context.wait({ identity: unlaunched }),
		() =>
			cancelAttempt(context.store, {
				hold: context.hold,
				identity: unlaunched,
				herdr: context.herdr.control,
				agent: "x",
				by: "operator:stop",
				reason: "why",
				actor: "operator:stop",
				now: () => FIXED_NOW,
			}),
	]) {
		const error = await refusalOfAsync(call);
		assert.equal(error.reason, "worker-not-launched");
	}
});
