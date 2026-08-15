import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";

import { EXIT_LEASE_LOST } from "../../factory/lib/cli/exit-codes.mjs";
import { CONTROLLER_LEASE_TTL_MS, holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { processIdentity } from "../../factory/lib/identity/process.mjs";
import { LEASE_NAMES, openLeases } from "../../factory/lib/state/leases.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import { openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §4.6's controller lease from the controller's side: the advisory identity it
 * publishes, the 10-second renewal that is the liveness fact (§4.8), and
 * §14.6's absolute consequence of losing it.
 */

// ── The advisory identity blob (§4.6) ────────────────────────────────────────

test("the identity blob carries host, boot id, pid, and process start time, plus the run and pane", () => {
	const identity = processIdentity({ run: "01JRUN0000000000000000000A", pane: "herdr:2" });

	assert.equal(identity.host, hostname());
	assert.equal(identity.pid, process.pid);
	assert.ok(identity.boot_id === null || /^[0-9a-f-]{36}$/.test(identity.boot_id));
	assert.ok(Number.isSafeInteger(identity.process_start_time));
	assert.ok(identity.process_start_time <= Date.now());
	assert.equal(identity.run, "01JRUN0000000000000000000A");
	assert.equal(identity.pane, "herdr:2");
});

test("a machine with no boot id records null rather than inventing one", () => {
	const identity = processIdentity({ run: null, pane: null, readBootId: () => null });

	assert.equal(identity.boot_id, null);
	assert.equal(identity.run, null);
	assert.equal(identity.pane, null);
});

// ── Holding it (§4.6, §4.8) ──────────────────────────────────────────────────

const RUN = "01JRUN0000000000000000000A";
const T0 = 1_770_000_000_000;

/** A clock and a renewal timer the test drives by hand, so nothing is timing. */
function stoppedClock() {
	let at = T0;
	return { now: () => at, advance: (ms) => (at += ms) };
}

function manualTimers() {
	const scheduled = [];
	return {
		api: {
			setInterval: (fn, ms) => {
				const handle = { fn, ms, cleared: false };
				scheduled.push(handle);
				return handle;
			},
			clearInterval: (handle) => {
				handle.cleared = true;
			},
		},
		/** Fire every live interval once. */
		tick: () => {
			for (const handle of scheduled.filter((candidate) => !candidate.cleared)) handle.fn();
		},
		intervals: () => scheduled.filter((handle) => !handle.cleared).map((handle) => handle.ms),
	};
}

async function heldStore(t, { onLost = () => {} } = {}) {
	const store = await openTestStore(t);
	store.append(runStarted(RUN));
	const clock = stoppedClock();
	const timers = manualTimers();
	const leases = openLeases(store, { now: clock.now });
	const guard = holdControllerLease({
		store,
		leases,
		run: RUN,
		pane: "herdr:2",
		onLost,
		now: clock.now,
		timers: timers.api,
	});
	// No `after` hook releases it: the store's own hook closes the database
	// first, and a controller that dies without releasing is the case §10.4
	// adopts anyway.
	return { store, leases, guard, clock, timers };
}

test("the hold publishes the fence its effects are stamped with, and permits them", async (t) => {
	const { leases, guard } = await heldStore(t);

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(guard.token, row.token);
	assert.equal(guard.fencingGeneration, row.fencingGeneration);
	assert.equal(guard.lost, false);
	assert.deepEqual(guard.fence(), { token: row.token, generation: row.fencingGeneration });
	guard.assertMayIssueEffects();
	assert.equal(row.identity.pane, "herdr:2");
});

test("a second controller cannot take the hold, and is told which run and pane has it", async (t) => {
	const { store, leases } = await heldStore(t);

	assert.throws(
		() => holdControllerLease({ store, leases, run: "01JRUN0000000000000000000B", pane: "herdr:9" }),
		(error) => {
			assert.equal(error.reason, "lease-held");
			assert.equal(error.details.run, RUN);
			assert.equal(error.details.pane, "herdr:2");
			return true;
		},
	);
});

test("the row is renewed every 10 seconds, which is the liveness fact", async (t) => {
	const { leases, clock, timers } = await heldStore(t);

	assert.deepEqual(timers.intervals(), [10_000]);
	assert.equal(leases.inspect(LEASE_NAMES.controller).renewedAt, T0);

	clock.advance(10_000);
	timers.tick();

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(row.renewedAt, T0 + 10_000);
	assert.equal(row.expiresAt, T0 + 40_000, "the renewal did not move expiry three renewals ahead");
});

// ── Losing it (§14.6) ────────────────────────────────────────────────────────

test("a lost lease stops effects, emits controller.lease-lost, exits non-zero, and never reacquires", async (t) => {
	const losses = [];
	const { store, leases, guard, clock, timers } = await heldStore(t, { onLost: (loss) => losses.push(loss) });
	const mine = guard.fencingGeneration;

	// This controller is frozen past its TTL — SIGSTOP, a paused laptop, a long
	// blocking call — and a second controller adopts the lapsed lease.
	clock.advance(CONTROLLER_LEASE_TTL_MS + 1);
	const thief = openLeases(store, { now: clock.now }).acquire({
		name: LEASE_NAMES.controller,
		identity: { host: "workshop", boot_id: null, pid: 5151, process_start_time: T0, run: RUN, pane: "herdr:9" },
		ttlMs: CONTROLLER_LEASE_TTL_MS,
	});

	// …and then wakes up and renews.
	timers.tick();

	assert.equal(guard.lost, true);
	assert.deepEqual(losses, [
		{ endReason: "lease-lost", exitCode: EXIT_LEASE_LOST, details: { lease: "controller", fencing_generation: mine, holder_generation: thief.fencingGeneration } },
	]);
	assert.notEqual(EXIT_LEASE_LOST, 0);

	const emitted = store.readEvents({ stream: `run:${RUN}` }).filter((event) => event.kind === "controller.lease-lost");
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].payload.holder_generation, thief.fencingGeneration);
	assert.equal(emitted[0].visibility, "operator");

	assert.deepEqual(timers.intervals(), [], "the renewal loop kept running after the lease was lost");

	// Never reacquired, however long it waits and however often it is poked.
	clock.advance(10 * 60_000);
	timers.tick();
	guard.renew();
	assert.equal(leases.inspect(LEASE_NAMES.controller).token, thief.token);
	assert.equal(
		store.readEvents({ stream: `run:${RUN}` }).filter((event) => event.kind === "controller.lease-lost").length,
		1,
	);
});

test("after the loss, in-flight work is abandoned rather than pushed to Gitea or git", async (t) => {
	const { store, guard, clock, timers } = await heldStore(t);
	const touched = [];

	// A stand-in for #92's effect issuer: everything that reaches a foreign
	// system passes the gate before it does anything.
	function issueEffect(operation) {
		guard.assertMayIssueEffects();
		touched.push(operation);
	}

	issueEffect("gitea.comment");

	clock.advance(CONTROLLER_LEASE_TTL_MS + 1);
	openLeases(store, { now: clock.now }).acquire({
		name: LEASE_NAMES.controller,
		identity: { host: "workshop", boot_id: null, pid: 5151, process_start_time: T0, run: RUN, pane: "herdr:9" },
		ttlMs: CONTROLLER_LEASE_TTL_MS,
	});
	timers.tick();

	assert.throws(() => issueEffect("git.push"), { name: "FactoryStateError", reason: "lease-lost" });
	assert.throws(() => guard.fence());
	assert.deepEqual(touched, ["gitea.comment"]);
});

test("the guard has no reacquisition path to reach by accident", () => {
	const [, source] = factorySources().find(([path]) => path.endsWith("lease-guard.mjs"));

	assert.equal((source.match(/leases\.acquire\(/g) ?? []).length, 1, "the guard acquires more than once");
});
