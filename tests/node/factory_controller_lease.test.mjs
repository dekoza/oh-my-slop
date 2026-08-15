import test from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";

import { EXIT_LEASE_LOST } from "../../factory/lib/cli/exit-codes.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { processIdentity } from "../../factory/lib/identity/process.mjs";
import { CONTROLLER_LEASE_TTL_MS, LEASE_NAMES, LEASE_RENEWAL_MS, openLeases } from "../../factory/lib/state/leases.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import {
	FIXED_NOW as T0,
	leaseIdentity,
	manualTimers,
	openTestStore,
	runEnded,
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

	assert.equal(guard.release(), false);

	assert.equal(guard.lost, true);
	assert.deepEqual(
		losses.map((loss) => loss.exitCode),
		[EXIT_LEASE_LOST],
	);
	assert.equal(leaseLostEvents(store).length, 1);
	assert.throws(() => guard.assertMayIssueEffects(), { reason: "lease-lost" });
	assert.equal(openLeases(store).inspect(LEASE_NAMES.controller).token, thief.token, "it dropped another holder's row");
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
