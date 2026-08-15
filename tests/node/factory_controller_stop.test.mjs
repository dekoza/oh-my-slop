import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_OK, EXIT_REFUSED } from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { ENTRY_MODES } from "../../factory/lib/controller/entry.mjs";
import { runStop } from "../../factory/lib/controller/stop.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { FIXED_NOW, herdrAnswering, leaseIdentity, makeAgentDir } from "./helpers/factory-store.mjs";

/**
 * §10.5: **`stop` writes a durable stop-request record carrying the actor
 * slot, polled at ticket boundaries.**
 *
 * The verb takes no lease and finds no pid: the record on the run's stream is
 * the interface, and "works from any terminal" is true by construction rather
 * than by process-table archaeology.
 */

/**
 * The one thing injected is the Herdr probe, for the same reason as in the
 * start suite: it is a live read of the operator's terminal multiplexer, and a
 * suite that only passes on a machine running one would be testing the machine.
 */
const AVAILABLE = herdrAnswering();

function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		cwd: makeRepo(t),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HERDR_PANE_ID: "w1:p7" },
		herdr: AVAILABLE,
	};
}

async function storeOf(t, context) {
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	t.after(() => store.close());
	return store;
}

/**
 * A run the way a controller mid-run leaves one: a `run.started` record and
 * the `controller` lease whose advisory identity names the run and the pane it
 * runs in. `lapsed` dates the row from the past, the way a crashed controller
 * leaves it: still there, already expired.
 */
async function liveRun(context, { pane = "w1:p3", at = Date.now(), lapsed = false } = {}) {
	const runId = newUlid();
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	try {
		const stamped = lapsed ? FIXED_NOW : at;
		store.append({
			kind: "run.started",
			source: "controller",
			run: runId,
			occurredAt: stamped,
			observedAt: stamped,
			payload: { scope: { kind: "direct-ticket", tickets: [42] }, mode: ENTRY_MODES.started },
		});
		openLeases(store, { now: () => stamped }).acquire({
			name: "controller",
			identity: leaseIdentity({ run: runId, pane }),
		});
	} finally {
		store.close();
	}
	return runId;
}

// ── The first stop (§10.5) ───────────────────────────────────────────────────

test("the first stop writes a durable stop-request carrying the actor slot", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(context);

	const { exitCode, value } = await runCli(["stop"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.ok, true);
	assert.equal(value.report.run, runId);

	const store = await storeOf(t, context);
	const [record] = store.readEvents({ stream: runStream(runId), kind: "run.stop-requested" });
	assert.notEqual(record, undefined, "the stop request is not durable");
	assert.equal(record.source, "operator", "the verb's process wrote it, not the controller");
	assert.equal(record.payload.actor, "operator:stop");
	assert.equal(record.visibility, "operator");
});

test("the stop request lands on the run's stream, and the verb never moves the lifecycle", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(context);

	await runCli(["stop"], context);

	const store = await storeOf(t, context);
	// The record is on the stream before any lifecycle move: `draining` is
	// visible when *requested*, not when the phase ends, and the move itself is
	// the controller's — the verb never touches the lifecycle.
	const events = store.readEvents({ stream: runStream(runId) });
	assert.equal(events.find((event) => event.kind === "run.stop-requested") !== undefined, true);
	assert.deepEqual(
		events.filter((event) => event.kind === "run.lifecycle-changed"),
		[],
		"the stop verb moved the run's lifecycle",
	);
	assert.equal(store.readRun(runId).lifecycle, "preflight");
});

test("the first stop's output says a second one escalates to abandon", async (t) => {
	const context = invocation(t);
	await liveRun(context);

	const { value } = await runCli(["stop"], context);

	assert.match(value.message, /second/i);
	assert.match(value.message, /abandon/i);
});

// ── Refusals: a verb that cannot do its job says what is missing ────────────

test("a stop with no run in this repository refuses, naming nothing to poll", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["stop"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "no-run");
});

test("a stop against a holder that has not recorded its run yet refuses as run-unresolvable", async (t) => {
	const context = invocation(t);
	const store = await storeOf(t, context);
	openLeases(store).acquire({ name: "controller", identity: leaseIdentity({ run: null, pane: "w1:p3" }) });

	const { exitCode, value } = await runCli(["stop"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "run-unresolvable");
	assert.match(value.error.message, /moment/);
});

test("a stop against a holder whose run has no durable record yet refuses as run-unresolvable", async (t) => {
	const context = invocation(t);
	const phantom = newUlid();
	const store = await storeOf(t, context);
	openLeases(store).acquire({ name: "controller", identity: leaseIdentity({ run: phantom, pane: "w1:p3" }) });

	const { exitCode, value } = await runCli(["stop"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "run-unresolvable");
	assert.equal(value.error.run, phantom);
});

test("a stop against an ended run refuses, naming its end reason", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(context);
	const store = await storeOf(t, context);
	const at = store.readRun(runId).started_at + 1;
	store.append({
		kind: "run.ended",
		source: "controller",
		run: runId,
		occurredAt: at,
		observedAt: at,
		payload: { end_reason: "drained" },
	});

	// The lease outlives its run in this fixture: the refusal must come from
	// the run's state, not from the lease's.
	const { exitCode, value } = await runCli(["stop"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "run-ended");
	assert.equal(value.error.run, runId);
	assert.equal(value.error.end_reason, "drained");
});

test("a stop against a crashed controller still records the request: the record is the interface", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(context, { lapsed: true });

	const { exitCode, value } = await runCli(["stop"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.live, false, "the report claimed a controller that had lapsed");
	assert.match(value.message, /no live controller/i);

	const store = await storeOf(t, context);
	assert.equal(
		store.readEvents({ stream: runStream(runId), kind: "run.stop-requested" }).length,
		1,
		"the request did not reach the run's stream",
	);
});

// ── Structure ────────────────────────────────────────────────────────────────

test("the stop verb never takes the lease: it cannot race the controller it addresses", () => {
	// §10.5 asks for a write that works from any terminal without finding a
	// pid. Taking the lease would be the opposite: a stop that refuses while a
	// controller is alive is a stop that never lands mid-run. The guard is on
	// the module's own source, in the style of the journal-deletion grep.
	const here = dirname(fileURLToPath(import.meta.url));
	const source = readFileSync(join(here, "..", "..", "factory", "lib", "controller", "stop.mjs"), "utf8");
	assert.doesNotMatch(source, /\.acquire\(/, "the stop verb acquires the controller lease");
});

test("runStop answers from the same structured value as the CLI does", async (t) => {
	const context = invocation(t);
	const runId = await liveRun(context);

	const answered = await runStop({ repoRoot: context.cwd, agentDir: context.agentDir });

	assert.equal(answered.exitCode, EXIT_OK);
	assert.equal(answered.report.run, runId);
});

// ── The controller honours the record at the ticket boundary (§9.6, §10.5) ──

/**
 * A run the way §9.6's boundary finds it: not ended, unheld, with the
 * operator's request already on its stream. A crashed controller is the normal
 * producer of this shape, and re-entry is the normal consumer of it.
 */
async function runWithRequests(context, { kinds = [] } = {}) {
	const runId = newUlid();
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	try {
		store.append({
			kind: "run.started",
			source: "controller",
			run: runId,
			occurredAt: FIXED_NOW,
			observedAt: FIXED_NOW,
			payload: { scope: { kind: "direct-ticket", tickets: [42] }, mode: ENTRY_MODES.started },
		});
		for (const [i, kind] of kinds.entries()) {
			store.append({
				kind,
				source: "operator",
				run: runId,
				occurredAt: FIXED_NOW + 1 + i,
				observedAt: FIXED_NOW + 1 + i,
				payload:
					kind === "run.stop-requested"
						? { actor: "operator:stop" }
						: { actor: "operator:stop", supersedes: null },
			});
		}
	} finally {
		store.close();
	}
	return runId;
}

/** An in-flight ticket execution: launched, and no terminal disposition recorded. */
async function runWithInFlight(context, { kinds = [] } = {}) {
	const runId = await runWithRequests(context, { kinds });
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	try {
		store.append({
			kind: "attempt.launched",
			source: "controller",
			run: runId,
			ticket: 42,
			phase: "implement",
			attempt: `${runId}-t42-a1`,
			occurredAt: FIXED_NOW + 10,
			observedAt: FIXED_NOW + 10,
			payload: { role: "implement" },
		});
	} finally {
		store.close();
	}
	return runId;
}

test("a pending stop ends the re-entered run stopped-by-operator, through draining, exiting 3", async (t) => {
	const context = invocation(t);
	const runId = await runWithRequests(context, { kinds: ["run.stop-requested"] });

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, 3);
	assert.equal(value.report.run, runId);
	assert.equal(value.report.end_reason, "stopped-by-operator");
	assert.equal(value.report.lifecycle, "ended");

	const store = await storeOf(t, context);
	const moved = store
		.readEvents({ stream: runStream(runId) })
		.filter((event) => event.kind === "run.lifecycle-changed")
		.map((event) => event.payload.lifecycle);
	assert.deepEqual(moved, ["preflight", "running", "draining"], "the stop did not pass through draining");
	assert.equal(store.readRun(runId).end_reason, "stopped-by-operator");
});

test("a pending abandon ends the run abandoned, exiting 4", async (t) => {
	const context = invocation(t);
	const runId = await runWithRequests(context, { kinds: ["run.abandon-requested"] });

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, 4);
	assert.equal(value.report.end_reason, "abandoned");

	const store = await storeOf(t, context);
	assert.equal(store.readRun(runId).end_reason, "abandoned");
});

test("an abandon supersedes the stop that preceded it", async (t) => {
	const context = invocation(t);
	const runId = await runWithRequests(context, {
		kinds: ["run.stop-requested", "run.abandon-requested"],
	});

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, 4);
	assert.equal(value.report.end_reason, "abandoned", "the earlier stop won over its own escalation");
});

test("abandon marks the in-flight executions released, durably, and the report says so", async (t) => {
	const context = invocation(t);
	const runId = await runWithInFlight(context, { kinds: ["run.abandon-requested"] });

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, 4);
	assert.equal(value.report.execution.in_flight, 1);
	assert.equal(value.report.execution.released, 1);

	const store = await storeOf(t, context);
	const [execution] = store.readTicketExecutions(runId);
	assert.equal(execution.disposition, "released", "the release did not reach the durable projection");
	assert.notEqual(execution.ended_at, null, "a released execution has no end to wait for");

	const [record] = store.readEvents({ stream: runStream(runId), kind: "ticket.disposition-changed" });
	assert.notEqual(record, undefined);
	assert.equal(record.run, runId);
	assert.equal(record.ticket, 42);
	assert.equal(record.payload.disposition, "released");
	assert.equal(record.source, "controller");
});

test("a stop never marks an execution released: that is abandon's word alone", async (t) => {
	const context = invocation(t);
	const runId = await runWithInFlight(context, { kinds: ["run.stop-requested"] });

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, 3);
	assert.equal(value.report.execution.released, 0);

	const store = await storeOf(t, context);
	const [execution] = store.readTicketExecutions(runId);
	assert.equal(execution.disposition, null, "the stop reached into the lanes' dispositions");
	assert.equal(
		store.readEvents({ stream: runStream(runId), kind: "ticket.disposition-changed" }).length,
		0,
	);
});

test("the end reason is a property of the controller loop, never derived from the lanes", async (t) => {
	// §9.6: however differently the lanes end, the reason stays the loop's.
	// A run whose projection holds an in-flight execution and no request still
	// ends drained — the lane does not vote.
	const context = invocation(t);
	const runId = await runWithInFlight(context, {});

	const { exitCode, value } = await runCli(["start"], context);

	assert.equal(exitCode, 0);
	assert.equal(value.report.end_reason, "drained");
	assert.equal(value.report.execution.in_flight, 1, "the run did not report the lane it is leaving behind");
	assert.match(value.report.execution.missing, /#101/, "the waiting the lane owes is not named");
});

test("the report carries the operator requests that decided the reason", async (t) => {
	const context = invocation(t);
	const runId = await runWithRequests(context, {
		kinds: ["run.stop-requested", "run.abandon-requested"],
	});

	const { value } = await runCli(["start"], context);

	assert.deepEqual(
		value.report.operator.map((request) => request.kind),
		["run.stop-requested", "run.abandon-requested"],
	);
	assert.equal(value.report.operator[0].actor, "operator:stop");
});
