import test from "node:test";
import assert from "node:assert/strict";

import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from "../../factory/lib/controller/heartbeat.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { CONTROLLER_LEASE_TTL_MS, LEASE_NAMES, LEASE_RENEWAL_MS, openLeases } from "../../factory/lib/state/leases.mjs";
import { HEARTBEAT_STREAM } from "../../factory/lib/state/events.mjs";
import { FIXED_NOW as T0, leaseIdentity, manualTimers, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §4.8's liveness, driven by hand.
 *
 * Both cadences are asserted here rather than by waiting: a suite that slept
 * sixty seconds to watch one heartbeat would be the slowest thing in the repo
 * and would still prove less — the interval a timer was *registered* at is the
 * fact, and a wall-clock test cannot see it.
 */

const RUN = "01JRUN0000000000000000000A";

async function beating(t, { watching = () => 0, activity = () => "preflight: 0 lanes" } = {}) {
	const store = await openTestStore(t);
	store.append(runStarted(RUN));

	let at = T0;
	const clock = { now: () => at, advance: (ms) => (at += ms) };
	const timers = manualTimers();
	const leases = openLeases(store, { now: clock.now });
	const hold = holdControllerLease({ store, leases, run: RUN, pane: "w1:p3", timers: timers.api });
	const heartbeat = startHeartbeat({ store, hold, run: RUN, activity, watching, now: clock.now, timers: timers.api });

	return { store, leases, hold, heartbeat, clock, timers };
}

const beats = (store) => store.readEvents({ stream: HEARTBEAT_STREAM });

test("the lease renews at 10s and the heartbeat beats at 60s — two cadences, one hold", async (t) => {
	const { timers } = await beating(t);

	assert.deepEqual(timers.intervals().sort((a, b) => a - b), [LEASE_RENEWAL_MS, HEARTBEAT_INTERVAL_MS]);
	assert.equal(HEARTBEAT_INTERVAL_MS, 6 * LEASE_RENEWAL_MS, "the renewal is the cheap one, and it is the liveness fact");
});

test("the first beat is immediate, so a short run still proves its controller was alive", async (t) => {
	const { store, heartbeat } = await beating(t);

	assert.equal(heartbeat.emitted, 1);
	assert.equal(beats(store).length, 1);
});

test("each beat carries the lease token, the fencing generation, and one line of activity", async (t) => {
	const { store, hold, timers, clock } = await beating(t);

	clock.advance(HEARTBEAT_INTERVAL_MS);
	timers.tick(HEARTBEAT_INTERVAL_MS);

	const recorded = beats(store);
	assert.equal(recorded.length, 2);
	for (const beat of recorded) {
		assert.equal(beat.payload.lease_token, hold.token);
		assert.equal(beat.payload.fencing_generation, hold.fencingGeneration);
		assert.equal(beat.payload.activity, "preflight: 0 lanes");
		assert.doesNotMatch(beat.payload.activity, /\n/, "the activity summary is one line");
	}
	assert.deepEqual(
		recorded.map((beat) => beat.occurred_at),
		[T0, T0 + HEARTBEAT_INTERVAL_MS],
	);
});

test("the beat reports how many panes are watched, asked at each beat rather than fixed", async (t) => {
	let panes = 0;
	const { store, timers, clock } = await beating(t, { watching: () => panes });

	panes = 3;
	clock.advance(HEARTBEAT_INTERVAL_MS);
	timers.tick(HEARTBEAT_INTERVAL_MS);

	assert.deepEqual(
		beats(store).map((beat) => beat.payload.watching),
		[0, 3],
	);
});

test("a controller that lost its lease stops beating rather than claiming to be live", async (t) => {
	const { store, leases, hold, timers, clock } = await beating(t);

	// Somebody else took the row after this holder stopped renewing (§10.4).
	clock.advance(CONTROLLER_LEASE_TTL_MS + 1);
	leases.acquire({ name: LEASE_NAMES.controller, identity: leaseIdentity({ pid: 5151, run: RUN, pane: "w1:p9" }) });
	timers.tick(LEASE_RENEWAL_MS);
	assert.equal(hold.lost, true);

	timers.tick(HEARTBEAT_INTERVAL_MS);

	assert.equal(beats(store).length, 1, "a controller kept beating after §14.6 stopped it");
});

test("stopping clears the timer, and a stopped heart does not beat again", async (t) => {
	const { store, heartbeat, timers } = await beating(t);

	heartbeat.stop();

	assert.deepEqual(timers.intervals(), [LEASE_RENEWAL_MS], "the heartbeat timer outlived the run");
	assert.equal(heartbeat.beat(), false);
	assert.equal(beats(store).length, 1);
});
