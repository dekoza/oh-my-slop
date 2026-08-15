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
import { FIXED_NOW, leaseIdentity, makeAgentDir } from "./helpers/factory-store.mjs";

/**
 * §10.5: **`stop` writes a durable stop-request record carrying the actor
 * slot, polled at ticket boundaries.**
 *
 * The verb takes no lease and finds no pid: the record on the run's stream is
 * the interface, and "works from any terminal" is true by construction rather
 * than by process-table archaeology.
 */

function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		cwd: makeRepo(t),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable) },
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
