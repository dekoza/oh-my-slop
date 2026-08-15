import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";

import { EXIT_LEASE_LOST } from "../../factory/lib/cli/exit-codes.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { processIdentity } from "../../factory/lib/identity/process.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { CONTROLLER_LEASE_TTL_MS, LEASE_NAMES, LEASE_RENEWAL_MS, openLeases } from "../../factory/lib/state/leases.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import {
	FIXED_NOW as T0,
	leaseIdentity,
	manualTimers,
	openTestStore,
	runEnded,
	runMoved,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §4.6's controller lease from the controller's side: the advisory identity it
 * publishes, the 10-second renewal that is the liveness fact (§4.8), and
 * §14.6's absolute consequence of losing it.
 */

const RUN = "01JRUN0000000000000000000A";

// ── The advisory identity blob (§4.6) ────────────────────────────────────────

test("the identity blob carries host, boot id, pid, and process start time, plus the run and pane", () => {
	const identity = processIdentity({ run: RUN, pane: "herdr:2" });

	assert.equal(identity.host, hostname());
	assert.equal(identity.pid, process.pid);
	assert.ok(identity.boot_id === null || /^[0-9a-f-]{36}$/.test(identity.boot_id));
	assert.ok(Number.isSafeInteger(identity.process_start_time));
	assert.ok(identity.process_start_time <= Date.now());
	assert.equal(identity.run, RUN);
	assert.equal(identity.pane, "herdr:2");
});

test("a machine with no boot id records null rather than inventing one", () => {
	const identity = processIdentity({ run: null, pane: null, readBootId: () => null });

	assert.equal(identity.boot_id, null);
	assert.equal(identity.run, null);
	assert.equal(identity.pane, null);
});

// ── Holding it (§4.6, §4.8) ──────────────────────────────────────────────────

/** A clock and a renewal timer the test drives by hand, so nothing is timing. */
function stoppedClock() {
	let at = T0;
	return { now: () => at, advance: (ms) => (at += ms) };
}

async function heldStore(t, { onLost = () => {}, store: override = null } = {}) {
	const store = await openTestStore(t);
	store.append(runStarted(RUN));
	const clock = stoppedClock();
	const timers = manualTimers();
	const leases = openLeases(store, { now: clock.now });
	const guard = holdControllerLease({
		store: override === null ? store : override(store),
		leases,
		run: RUN,
		pane: "herdr:2",
		onLost,
		timers: timers.api,
	});
	// No `after` hook releases it: the store's own hook closes the database
	// first, and a controller that dies without releasing is the case §10.4
	// adopts anyway.
	return { store, leases, guard, clock, timers };
}

/** A second controller adopting the lease this one stopped renewing. */
function adoptFrom(store, clock) {
	clock.advance(CONTROLLER_LEASE_TTL_MS + 1);
	return openLeases(store, { now: clock.now }).acquire({
		name: LEASE_NAMES.controller,
		identity: leaseIdentity({ pid: 5151, run: RUN, pane: "herdr:9" }),
	});
}

test("the hold publishes the fence its effects are stamped with, and permits them", async (t) => {
	const { leases, guard } = await heldStore(t);
	guard.recordStartupReconcile();

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(guard.token, row.token);
	assert.equal(guard.fencingGeneration, row.fencingGeneration);
	assert.equal(guard.lost, false);
	assert.deepEqual(guard.fence(), { token: row.token, generation: row.fencingGeneration });
	guard.assertMayIssueEffects();
	assert.equal(row.identity.pane, "herdr:2");
});

test("the lease is used for no effect until startup reconcile has run under it (§5.4)", async (t) => {
	const { guard } = await heldStore(t);

	// Not a mode anyone has to remember to enter: the gate is shut until the
	// reconciliation that §5.4 puts before the first effect actually happened.
	assert.equal(guard.reconciled, false);
	assert.throws(
		() => guard.fence(),
		(error) => {
			assert.equal(error.reason, "reconcile-required");
			assert.equal(error.details.run, RUN);
			return true;
		},
	);

	guard.recordStartupReconcile();

	assert.equal(guard.reconciled, true);
	assert.equal(guard.fence().generation, guard.fencingGeneration);
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

	assert.deepEqual(timers.intervals(), [LEASE_RENEWAL_MS]);
	assert.equal(leases.inspect(LEASE_NAMES.controller).renewedAt, T0);

	clock.advance(LEASE_RENEWAL_MS);
	timers.tick();

	const row = leases.inspect(LEASE_NAMES.controller);
	assert.equal(row.renewedAt, T0 + LEASE_RENEWAL_MS);
	assert.equal(row.expiresAt, T0 + LEASE_RENEWAL_MS + CONTROLLER_LEASE_TTL_MS);
});

test("an orderly release frees the row and closes the gate with its own reason", async (t) => {
	const { leases, guard, timers } = await heldStore(t);

	assert.equal(guard.release(), true);
	assert.equal(leases.inspect(LEASE_NAMES.controller), null);
	assert.deepEqual(timers.intervals(), []);
	assert.equal(guard.lost, false, "an orderly release is not §14.6's loss");
	assert.throws(() => guard.assertMayIssueEffects(), { reason: "lease-released" });
});

// ── Losing it (§14.6) ────────────────────────────────────────────────────────

test("normal run ending and controller-lease release commit together", async (t) => {
	const { store, leases, guard } = await heldStore(t);

	assert.equal(guard.release({ event: runEnded(RUN) }), true);
	assert.equal(leases.inspect(LEASE_NAMES.controller), null);
	assert.equal(store.readRun(RUN).end_reason, "drained");
	assert.equal(store.readEvents({}).filter((event) => event.kind === "run.ended").length, 1);
});

test("a record only the holder may write goes in under the token, not beside it", async (t) => {
	const { store, guard } = await heldStore(t);
	guard.recordStartupReconcile();

	guard.append(runMoved(RUN, "running"));

	assert.equal(store.readRun(RUN).lifecycle, "running");
});

test("a stale holder cannot move a run whose lease a successor already adopted", async (t) => {
	const losses = [];
	const { store, guard, clock } = await heldStore(t, { onLost: (loss) => losses.push(loss) });
	guard.recordStartupReconcile();
	const thief = adoptFrom(store, clock);

	// Nothing has told this holder yet — the renewal has not fired, so its latch
	// still says it holds the lease. A successor adopts a *lapsed* row without
	// asking anyone, so the compare has to happen in the write's own transaction
	// rather than in the holder's memory.
	assert.equal(guard.lost, false);
	assert.throws(() => guard.append(runMoved(RUN, "running")), { reason: "lease-lost" });

	assert.equal(store.readRun(RUN).lifecycle, "preflight", "a stale holder moved a run its successor owns");
	assert.equal(guard.lost, true, "the refused write is §14.6's loss, discovered by the compare");
	assert.deepEqual(
		losses.map((loss) => loss.exitCode),
		[EXIT_LEASE_LOST],
	);
	assert.equal(openLeases(store).inspect(LEASE_NAMES.controller).token, thief.token);
});

test("a lost lease stops effects, emits controller.lease-lost, exits non-zero, and never reacquires", async (t) => {
	const losses = [];
	const { store, leases, guard, clock, timers } = await heldStore(t, { onLost: (loss) => losses.push(loss) });
	const mine = guard.fencingGeneration;

	// This controller is frozen past its TTL — SIGSTOP, a paused laptop, a long
	// blocking call — and a second controller adopts the lapsed lease…
	const thief = adoptFrom(store, clock);

	// …and then it wakes up and renews.
	timers.tick();

	assert.equal(guard.lost, true);
	assert.deepEqual(losses, [
		{
			endReason: "lease-lost",
			exitCode: EXIT_LEASE_LOST,
			details: { lease: "controller", fencing_generation: mine, holder_generation: thief.fencingGeneration },
		},
	]);
	assert.notEqual(EXIT_LEASE_LOST, 0);

	const emitted = leaseLostEvents(store);
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].payload.holder_generation, thief.fencingGeneration);
	assert.equal(emitted[0].visibility, "operator");

	assert.deepEqual(timers.intervals(), [], "the renewal loop kept running after the lease was lost");

	// Never reacquired, however long it waits and however often it is poked.
	clock.advance(10 * 60_000);
	timers.tick();
	guard.renew();
	assert.equal(leases.inspect(LEASE_NAMES.controller).token, thief.token);
	assert.equal(leaseLostEvents(store).length, 1);
});

test("a release that finds the lease already gone is a loss, not a quiet false", async (t) => {
	const losses = [];
	const { store, guard, clock } = await heldStore(t, { onLost: (loss) => losses.push(loss) });
	const thief = adoptFrom(store, clock);

	assert.equal(guard.release({ event: runEnded(RUN) }), false);

	assert.equal(guard.lost, true);
	assert.equal(store.readRun(RUN).end_reason, null, "a stale holder committed its terminal event");
	assert.deepEqual(
		losses.map((loss) => loss.exitCode),
		[EXIT_LEASE_LOST],
	);
	assert.equal(leaseLostEvents(store).length, 1);
	assert.throws(() => guard.assertMayIssueEffects(), { reason: "lease-lost" });
	assert.equal(openLeases(store).inspect(LEASE_NAMES.controller).token, thief.token, "it dropped another holder's row");
});

// ── Losing it before the run exists (§14.6, §10.4) ───────────────────────────

/** A hold as `factory start` takes it: no run is known at acquisition. */
async function runlessStore(t, { onLost = () => {} } = {}) {
	const store = await openTestStore(t);
	const clock = stoppedClock();
	const timers = manualTimers();
	const guard = holdControllerLease({
		store,
		leases: openLeases(store, { now: clock.now }),
		pane: "herdr:2",
		onLost,
		timers: timers.api,
	});
	guard.recordStartupReconcile();
	return { store, guard, clock };
}

test("an intended run is named in the lease identity but is not yet the durable run", async (t) => {
	const { store, guard } = await runlessStore(t);
	const minted = newUlid();

	guard.intend(minted);

	// §10.5's refusal names the run out of the advisory blob, so a second
	// `factory start` sees what this one is up to…
	assert.equal(openLeases(store).inspect(LEASE_NAMES.controller).identity.run, minted);
	// …but no `run.started` has committed, so the hold does not yet claim to be
	// driving a run any durable record names.
	assert.equal(guard.run, null);

	guard.append(runStarted(minted));
	guard.adopt(minted);
	assert.equal(guard.run, minted);
});

test("a lease lost before run.started concedes with no phantom run", async (t) => {
	const losses = [];
	const { store, guard, clock } = await runlessStore(t, { onLost: (loss) => losses.push(loss) });
	const minted = newUlid();
	guard.intend(minted);

	adoptFrom(store, clock);

	// The write being refused is `run.started` itself: the run has no row, so a
	// concession that named the minted ULID would be rejected by the projector
	// and the promised typed loss would never surface.
	assert.throws(() => guard.append(runStarted(minted)), { reason: "lease-lost" });

	assert.equal(guard.lost, true);
	assert.equal(store.readRun(minted), null, "a run nobody started gained a row");
	const emitted = store.readEvents({ kind: "controller.lease-lost" });
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].run, null, "the loss event named a run whose run.started was never written");
	assert.equal(emitted[0].stream, "controller");
	assert.deepEqual(
		losses.map((loss) => loss.exitCode),
		[EXIT_LEASE_LOST],
	);
});

test("a theft discovered while intending a run concedes the same way", async (t) => {
	const losses = [];
	const { store, guard, clock } = await runlessStore(t, { onLost: (loss) => losses.push(loss) });

	adoptFrom(store, clock);

	assert.throws(() => guard.intend(newUlid()), { reason: "lease-lost" });

	assert.equal(guard.lost, true);
	assert.equal(guard.run, null);
	const emitted = store.readEvents({ kind: "controller.lease-lost" });
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].run, null);
	assert.deepEqual(
		losses.map((loss) => loss.exitCode),
		[EXIT_LEASE_LOST],
	);
});

test("once run.started has committed, a later loss names the run it leaves open", async (t) => {
	const { store, guard, clock } = await runlessStore(t);
	const minted = newUlid();
	guard.intend(minted);
	guard.append(runStarted(minted));
	guard.adopt(minted);

	adoptFrom(store, clock);

	assert.throws(() => guard.append(runMoved(minted, "running")), { reason: "lease-lost" });

	const emitted = store.readEvents({ kind: "controller.lease-lost" });
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].run, minted, "the loss lost track of the run that durably exists");
	assert.equal(store.readRun(minted).lifecycle, "preflight");
});

test("a journal that cannot record the loss still hands the run loop its exit", async (t) => {
	const losses = [];
	const { store, guard, clock, timers } = await heldStore(t, {
		onLost: (loss) => losses.push(loss),
		store: (real) => ({
			...real,
			append: () => {
				throw new Error("disk full");
			},
		}),
	});

	adoptFrom(store, clock);

	// The store failing is not a reason to keep issuing effects, and not a
	// reason for the run to end zero.
	assert.throws(() => timers.tick(), /disk full/);
	assert.equal(guard.lost, true);
	assert.deepEqual(
		losses.map((loss) => loss.exitCode),
		[EXIT_LEASE_LOST],
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

	guard.recordStartupReconcile();
	issueEffect("gitea.comment");

	adoptFrom(store, clock);
	timers.tick();

	assert.throws(() => issueEffect("git.push"), { name: "FactoryStateError", reason: "lease-lost" });
	assert.throws(() => guard.fence());
	assert.deepEqual(touched, ["gitea.comment"]);
});

test("the guard has no reacquisition path to reach by accident", () => {
	const guardSource = factorySources().find(([path]) => path.endsWith("lease-guard.mjs"));
	assert.ok(guardSource, "lease-guard.mjs is not among the factory's sources");

	const acquisitions = guardSource[1].match(/leases\.acquire\(/g) ?? [];
	assert.equal(acquisitions.length, 1, `the guard acquires ${acquisitions.length} times; §14.6 allows only the first`);
});

function leaseLostEvents(store) {
	return store.readEvents({ stream: `run:${RUN}` }).filter((event) => event.kind === "controller.lease-lost");
}
