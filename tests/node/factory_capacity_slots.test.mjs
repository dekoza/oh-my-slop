import test from "node:test";
import assert from "node:assert/strict";

import { runStream } from "../../factory/lib/state/events.mjs";
import {
	capacityPlanOf as plan,
	FIXED_NOW as T0,
	leaveSupersededSlot,
	openCapacityPool as openPool,
} from "./helpers/factory-store.mjs";

/**
 * §9.4's capacity slots: **discrete named rows on the lease primitive**, never a
 * counter. A slot row names its holder, so it is probeable — and §5.3 settles an
 * unresolved fact by probing rather than by reasoning about a number.
 */

/** Every capacity record this run wrote, in sequence order (§14.37). */
function capacityEvents(store, run) {
	return store
		.readEvents({ stream: runStream(run) })
		.filter((event) => event.kind.startsWith("capacity."))
		.map((event) => ({ kind: event.kind, ticket: event.ticket, ...event.payload }));
}

// ── Discrete named rows, each naming its holder (§9.4) ───────────────────────

test("a lane's two slots are named rows that carry its identity", async (t) => {
	const { store, capacity, run } = await openPool(t);

	const lane = capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.equal(lane.ticket.name, "capacity:ticket:0");
	assert.equal(lane.model.name, "capacity:model:local:0");

	const row = store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:model:local:0"));
	const identity = JSON.parse(row.identity);
	assert.equal(identity.run, run, "the row names the run holding it, so it is probeable");
	assert.equal(identity.ticket, 42);
	assert.equal(identity.pool, "model");
	assert.equal(identity.class, "local");
});

test("the grant is an ordinary journal event on the run stream, never an effect", async (t) => {
	const { store, capacity, run } = await openPool(t);

	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.deepEqual(
		capacityEvents(store, run).map((event) => [event.kind, event.slot]),
		[
			["capacity.granted", "capacity:ticket:0"],
			["capacity.granted", "capacity:model:local:0"],
		],
	);
	assert.equal(
		store.read((db) => db.prepare("SELECT COUNT(*) AS rows FROM effect").get().rows),
		0,
		"nothing external mutates, so no probe is owed (§9.7)",
	);
});

// ── Waiting is announced once, never per poll (§9.7) ─────────────────────────

test("a lane blocked on a full class waits once, however often the loop asks", async (t) => {
	const { store, capacity, run } = await openPool(t, {
		plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 1, profiles: ["builder"] }] }),
	});
	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 1 }), null);
	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 2 }), null);
	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 3 }), null);

	const waits = capacityEvents(store, run).filter((event) => event.kind === "capacity.waiting");
	assert.equal(waits.length, 1, "retry-storm spam is how this diagnostic destroys its own usefulness");
	assert.equal(waits[0].ticket, 43);
	assert.equal(waits[0].resource_class, "local");
});

test("a full ticket pool is the declared ceiling, not a class anyone is queued behind", async (t) => {
	const { store, capacity, run } = await openPool(t);
	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 1 }), null);

	assert.deepEqual(
		capacityEvents(store, run).filter((event) => event.kind === "capacity.waiting"),
		[],
		"§9.7 records a lane blocking on a class; the ceiling explains this one on its own",
	);
});

test("a lane blocked on the model pool names the class it is queued behind", async (t) => {
	const { store, capacity, run } = await openPool(t, {
		plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 1, profiles: ["builder"] }] }),
	});
	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 1 }), null);

	const [wait] = capacityEvents(store, run).filter((event) => event.kind === "capacity.waiting");
	assert.equal(wait.pool, "model");
	assert.equal(wait.resource_class, "local");
	assert.equal(wait.size, 1);
	assert.equal(
		store.read((db) => db.prepare("SELECT COUNT(*) AS rows FROM lease WHERE name LIKE 'capacity:ticket:%'").get().rows),
		1,
		"a lane that cannot have its model slot never takes a ticket slot to wait in",
	);
});

test("a lane that waited and was later granted may wait again on a later block", async (t) => {
	const { store, capacity, run } = await openPool(t, {
		plan: plan({ ticketSlots: 3, classes: [{ class: "local", size: 1, profiles: ["builder"] }] }),
	});
	const first = capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 1 }), null);
	first.ticket.release({ reason: "terminal-disposition", at: T0 + 2 });
	first.model.release({ reason: "attempt-ended", at: T0 + 2 });
	const second = capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 3 });
	assert.notEqual(second, null, "43 was granted, so its latch is cleared");

	second.model.release({ reason: "attempt-ended", at: T0 + 4 });
	const third = capacity.acquireModel({ ticket: 44, resourceClass: "local", at: T0 + 5 });
	assert.notEqual(third, null);
	// 43 blocks again, on the class its own next attempt now wants.
	assert.equal(capacity.acquireModel({ ticket: 43, resourceClass: "local", at: T0 + 6 }), null);

	const waits = capacityEvents(store, run).filter((event) => event.kind === "capacity.waiting");
	assert.deepEqual(
		waits.map((event) => [event.ticket, event.resource_class]),
		[
			[43, "local"],
			[43, "local"],
		],
		"one record per block, and a granted lane may block again",
	);
});

// ── Spans: the ticket slot outlives the attempt's model slot (§9.4) ──────────

test("releasing an attempt's model slot leaves the ticket slot held", async (t) => {
	const { store, capacity, run } = await openPool(t);
	const lane = capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	lane.model.release({ reason: "attempt-ended", at: T0 + 10 });

	assert.equal(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:model:local:0")), undefined);
	assert.notEqual(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:0")), undefined);
	assert.deepEqual(
		capacityEvents(store, run)
			.filter((event) => event.kind === "capacity.released")
			.map((event) => [event.slot, event.reason]),
		[["capacity:model:local:0", "attempt-ended"]],
	);

	const next = capacity.acquireModel({ ticket: 42, resourceClass: "local", at: T0 + 11 });
	assert.equal(next.name, "capacity:model:local:0", "a lane between phases squats on no GPU");
});

test("a slot releases exactly once, however many times it is asked", async (t) => {
	const { store, capacity, run } = await openPool(t);
	const lane = capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.equal(lane.ticket.release({ reason: "terminal-disposition", at: T0 + 5 }), true);
	assert.equal(lane.ticket.release({ reason: "terminal-disposition", at: T0 + 6 }), false);

	assert.equal(
		capacityEvents(store, run).filter((event) => event.kind === "capacity.released").length,
		1,
	);
});

// ── No TTL, ever (§9.4, §14.22) ──────────────────────────────────────────────

test("no elapsed time frees a capacity slot", async (t) => {
	let clock = T0;
	const { store, capacity } = await openPool(t, { now: () => clock });
	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	clock = T0 + 90 * 24 * 60 * 60 * 1000;

	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: clock }), null);
	assert.equal(
		store.read((db) => db.prepare("SELECT expires_at FROM lease WHERE name = ?").get("capacity:ticket:0").expires_at),
		null,
		"an expiring slot would free itself while its pane still talks to the GPU",
	);
});

// ── Fenced to the controller's generation, settled by probe (§9.4, §14.22) ───

test("a slot is stamped with the controller's own generation, not a fresh one", async (t) => {
	const { store, hold, capacity } = await openPool(t);

	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	assert.deepEqual(
		store
			.read((db) =>
				db.prepare("SELECT name, fencing_generation FROM lease WHERE name LIKE 'capacity:%' ORDER BY name").all(),
			)
			.map((row) => [row.name, row.fencing_generation]),
		[
			["capacity:model:local:0", hold.fencingGeneration],
			["capacity:ticket:0", hold.fencingGeneration],
		],
		"a slot is fenced to the lease that took it (§9.4)",
	);
});

test("a slot a stale controller takes after its successor started is still superseded", async (t) => {
	const { store, hold, capacity, leases } = await openPool(t);

	// The successor: this controller's lease lapsed and was taken over, which the
	// stale hold has not discovered — a holder learns that at its next
	// compare-and-swap and not one moment sooner.
	store.transaction(({ db }) => db.prepare("DELETE FROM lease WHERE name = 'controller'").run());
	const successor = leases.acquire({ name: "controller", identity: { run: null, pane: "herdr:9" } });
	assert.ok(successor.fencingGeneration > hold.fencingGeneration);

	// The stale controller, still believing it holds the lease, takes a slot.
	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 + 1 });

	const rows = store.read((db) =>
		db.prepare("SELECT fencing_generation FROM lease WHERE name LIKE 'capacity:%'").all(),
	);
	assert.ok(
		rows.every((row) => row.fencing_generation < successor.fencingGeneration),
		"minting a fresh generation here would stamp the row above its successor's and honor it forever",
	);
});

test("a row from a dead generation blocks its index until a probe settles it", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);

	// A slot the *previous* controller took: fenced to its lease generation,
	// which this hold's supersedes.
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 7 });

	assert.equal(capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 }), null);
	assert.deepEqual(
		capacity.blocked().map((entry) => [entry.slot, entry.ticket, entry.superseded]),
		[["capacity:ticket:0", 7, true]],
	);

	// No probe in this package settles a pane, so the row stays exactly as it is.
	const unsettled = capacity.reclaim({ at: T0 + 1 });
	assert.equal(unsettled.reclaimed, 0);
	assert.match(unsettled.missing, /#114/);
	assert.notEqual(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:0")), undefined);
	assert.equal(
		capacityEvents(store, run).filter((event) => event.kind === "capacity.released").length,
		0,
		"nothing is released by elapsed time or by reasoning (§14.1, §14.22)",
	);
});

test("a probe that finds the holder gone releases the slot; one that finds it live does not", async (t) => {
	const { store, hold, capacity } = await openPool(t, {
		plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 2, profiles: ["builder"] }] }),
	});

	for (const [index, ticket] of [
		[0, 7],
		[1, 8],
	]) {
		leaveSupersededSlot(store, hold, { slot: `capacity:ticket:${index}`, ticket });
	}

	const settled = capacity.reclaim({
		at: T0 + 5,
		probe: ({ identity }) => ({ live: identity.ticket === 8, detail: { pane: "herdr:3" } }),
	});

	assert.equal(settled.reclaimed, 1);
	assert.deepEqual(
		settled.held.map((entry) => entry.ticket),
		[8],
		"a live holder is adopted, not evicted",
	);
	assert.equal(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:0")), undefined);
	assert.notEqual(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:1")), undefined);
});

// ── What §9.7 asks status and doctor to print ────────────────────────────────

test("the snapshot carries the declared ceiling, the effective concurrency, and per class size, held and waiting", async (t) => {
	const { capacity } = await openPool(t, {
		plan: plan({
			ticketSlots: 4,
			classes: [
				{ class: "local", size: 1, profiles: ["builder"] },
				{ class: "claude-code", size: 2, profiles: ["reviewer"] },
			],
			// A routing whose rules send implement to either class, so all three
			// slots really can start a ticket.
			implementClasses: ["local", "claude-code"],
		}),
	});
	capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });
	assert.equal(capacity.acquireLane({ ticket: 43, resourceClass: "local", at: T0 + 1 }), null);

	const snapshot = capacity.snapshot({ at: T0 + 2 });

	assert.equal(snapshot.declared_ceiling, 4);
	assert.equal(snapshot.effective_concurrency, 3);
	assert.deepEqual(snapshot.ticket, { size: 4, held: 1, waiting: 0, superseded: 0 });
	assert.deepEqual(snapshot.classes, [
		{ class: "local", size: 1, held: 1, waiting: 1, superseded: 0, exhaustion: null },
		{ class: "claude-code", size: 2, held: 0, waiting: 0, superseded: 0, exhaustion: null },
	]);
});

test("a size-1 class reports effective concurrency 1 beside a ceiling that says four", async (t) => {
	const { capacity } = await openPool(t, {
		plan: plan({ ticketSlots: 4, classes: [{ class: "local", size: 1, profiles: ["builder"] }] }),
	});

	const snapshot = capacity.snapshot({ at: T0 });

	assert.equal(snapshot.declared_ceiling, 4);
	assert.equal(snapshot.effective_concurrency, 1, "§15 case 19");
	assert.equal(snapshot.pane_bound, 8, "derived, never configured (§9.1)");
});

test("a released lane leaves no capacity row held", async (t) => {
	const { store, capacity } = await openPool(t);
	const lane = capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	lane.model.release({ reason: "attempt-ended", at: T0 + 1 });
	lane.ticket.release({ reason: "terminal-disposition", at: T0 + 2 });

	assert.equal(
		store.read((db) => db.prepare("SELECT COUNT(*) AS rows FROM lease WHERE name LIKE 'capacity:%'").get().rows),
		0,
	);
	assert.deepEqual(capacity.snapshot({ at: T0 + 3 }).ticket, { size: 1, held: 0, waiting: 0, superseded: 0 });
});

test("a controller that lost its lease releases nothing, leaving the rows for its successor's probe", async (t) => {
	const { store, hold, capacity } = await openPool(t);
	const lane = capacity.acquireLane({ ticket: 42, resourceClass: "local", at: T0 });

	// The row is taken over by somebody else, which is how this hold learns it is
	// stale at its next compare-and-swap.
	store.read((db) => db.prepare("DELETE FROM lease WHERE name = 'controller'").run());
	hold.renew();
	assert.equal(hold.lost, true);

	assert.equal(lane.ticket.release({ reason: "terminal-disposition", at: T0 + 1 }), false);
	assert.notEqual(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:0")), undefined);
});
