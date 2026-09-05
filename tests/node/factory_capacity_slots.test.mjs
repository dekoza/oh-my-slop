import test from "node:test";
import assert from "node:assert/strict";

import { RETAINED_REASONS } from "../../factory/lib/capacity/slots.mjs";
import { ADOPTION_VERDICTS } from "../../factory/lib/domain/vocabulary.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { parseCapacitySlot } from "../../factory/lib/state/leases.mjs";
import {
	attemptLaunched,
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

/** One capacity row, exactly as the lease table holds it. */
function rowOf(store, name) {
	return store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get(name));
}

/**
 * §5.5's verdict, as a test says it. The five tests themselves are
 * `factory_worker_adoption.test.mjs`'s; what the pool cares about is which of
 * the three answers came back and which attempt it named.
 */
function verdict(answer, { attempt = null, run = null, ticket = null, tests = {}, detail = {} } = {}) {
	return Object.freeze({ verdict: answer, attempt, run, ticket, phase: "implement", tests, detail });
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

test("an endpoint-derived class takes and reads back its row, dotted host and all (#209)", async (t) => {
	// §9.1 spells a host into the class segment, so the row grammar has to admit
	// one — in the spelling `acquire` gates on as much as in the one that parses
	// it back. A config that loads and plans and then cannot take a slot is the
	// failure this asks about.
	const className = "endpoint-192.168.129.7-11545";
	const { store, capacity } = await openPool(t, {
		plan: plan({ classes: [{ class: className, size: 1, profiles: ["builder"] }] }),
	});

	const lane = capacity.acquireLane({ ticket: 42, resourceClass: className, at: T0 });

	assert.equal(lane.model.name, `capacity:model:${className}:0`);
	assert.equal(JSON.parse(rowOf(store, lane.model.name).identity).class, className);
	assert.deepEqual({ ...parseCapacitySlot(lane.model.name) }, { pool: "model", class: className, index: 0 });
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

	// With no probe wired there is no answer, so the row stays exactly as it is.
	const unsettled = await capacity.reclaim({ at: T0 + 1 });
	assert.equal(unsettled.reclaimed, 0);
	assert.match(unsettled.missing, /adoption probe/);
	assert.notEqual(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:0")), undefined);
	assert.equal(
		capacityEvents(store, run).filter((event) => event.kind === "capacity.released").length,
		0,
		"nothing is released by elapsed time or by reasoning (§14.1, §14.22)",
	);
});

test("a probe that disproves the holder releases the slot; one that proves it live does not", async (t) => {
	const { store, hold, capacity } = await openPool(t, {
		plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 2, profiles: ["builder"] }] }),
	});

	for (const [index, ticket] of [
		[0, 7],
		[1, 8],
	]) {
		leaveSupersededSlot(store, hold, { slot: `capacity:ticket:${index}`, ticket });
	}

	const settled = await capacity.reclaim({
		at: T0 + 5,
		probe: async ({ identity }) =>
			verdict(identity.ticket === 8 ? ADOPTION_VERDICTS.provable : ADOPTION_VERDICTS.disproved, {
				detail: { pane: "herdr:3" },
			}),
	});

	assert.equal(settled.reclaimed, 1);
	assert.deepEqual(
		settled.held.map((entry) => entry.ticket),
		[8],
		"a live holder is left alone, never evicted",
	);
	assert.equal(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:0")), undefined);
	assert.notEqual(store.read((db) => db.prepare("SELECT * FROM lease WHERE name = ?").get("capacity:ticket:1")), undefined);
});

// ── §5.5's adoption, at the pool ─────────────────────────────────────────────

test("a provable lane of this run is transferred onto this generation, never released and re-taken", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	// The mint is what makes the attempt real: the projections refuse an
	// attempt-scoped record for a tuple nothing launched, and an adopted row
	// names the attempt it was proved for (§6.5).
	store.append(attemptLaunched(run, 42, 1));
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });
	leaveSupersededSlot(store, hold, { slot: "capacity:model:local:0", ticket: 42, run, pool: "model" });
	const before = rowOf(store, "capacity:ticket:0");

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.provable, { attempt: `${run}-t42-a1`, ticket: 42, run }),
	});

	assert.equal(settled.adopted, 2, "a lane is its ticket row and its model row, taken whole");
	assert.deepEqual(
		settled.resumed.map((lane) => [lane.ticket, lane.slots.ticket.name, lane.slots.model.name]),
		[[42, "capacity:ticket:0", "capacity:model:local:0"]],
	);

	const after = rowOf(store, "capacity:ticket:0");
	assert.equal(after.fencing_generation, hold.fencingGeneration, "§15 case 6: the slot its pane holds");
	assert.notEqual(after.holder_token, before.holder_token, "the swap is on the predecessor's token");
	assert.equal(
		capacityEvents(store, run).filter((event) => event.kind === "capacity.released").length,
		0,
		"a release-then-acquire would open a window a third controller could take the index in",
	);
	const granted = capacityEvents(store, run).find((event) => event.slot === "capacity:ticket:0");
	assert.equal(granted.adopted_from.fencing_generation, before.fencing_generation);
});

test("a live lane of another run is left alone: there is no lane here to resume it into", async (t) => {
	const { store, hold, capacity } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run: "01JRUNOTHER00000000000000" });

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.provable, { attempt: "01JRUNOTHER00000000000000-t42-a1" }),
	});

	assert.deepEqual(settled.resumed, []);
	assert.deepEqual(
		settled.held.map((entry) => entry.reason),
		[RETAINED_REASONS.otherRun],
	);
	assert.equal(rowOf(store, "capacity:ticket:0").fencing_generation, hold.fencingGeneration - 1);
});

test("nothing is transferred when this run has nothing to resume a lane with", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });

	// `adopt: false` is the red preflight, and the run with no pipeline: a row
	// moved onto a generation that ends without using it is the one no successor
	// can settle.
	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: false,
		probe: async () => verdict(ADOPTION_VERDICTS.provable, { attempt: `${run}-t42-a1` }),
	});

	assert.deepEqual(settled.resumed, []);
	assert.equal(settled.adopted, 0);
	assert.deepEqual(
		settled.held.map((entry) => entry.reason),
		[RETAINED_REASONS.notExecuting],
	);
	assert.equal(rowOf(store, "capacity:ticket:0").fencing_generation, hold.fencingGeneration - 1);
});

test("a disproved lane settles its attempt before its rows, and once for the pair", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });
	leaveSupersededSlot(store, hold, { slot: "capacity:model:local:0", ticket: 42, run, pool: "model" });
	const settledAttempts = [];

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.disproved, { attempt: `${run}-t42-a1`, ticket: 42, run }),
		settleAttempt: async (answer) => settledAttempts.push(answer.attempt),
	});

	assert.equal(settled.reclaimed, 2);
	assert.deepEqual(
		settledAttempts,
		[`${run}-t42-a1`],
		"two rows name one attempt, and the projector refuses a second ending",
	);
	assert.deepEqual(settled.settled, [`${run}-t42-a1`]);
	const released = capacityEvents(store, run).filter((event) => event.kind === "capacity.released");
	assert.deepEqual(
		released.map((event) => [event.reason, event.settled_attempt]),
		[
			["reclaimed-by-probe", `${run}-t42-a1`],
			["reclaimed-by-probe", `${run}-t42-a1`],
		],
	);
});

test("a row whose durable state names no adoptable attempt is released with nothing to settle", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });
	const settledAttempts = [];

	// The probe's durable-state branch: the attempt this row named has already
	// ended, so `attempt` is null and there is nothing left to end.
	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () =>
			verdict(ADOPTION_VERDICTS.disproved, { detail: { refusal: "attempt-already-ended", basis: "durable-state" } }),
		settleAttempt: async (answer) => settledAttempts.push(answer.attempt),
	});

	assert.equal(settled.reclaimed, 1);
	assert.deepEqual(settledAttempts, [], "an ending written for a settled attempt is the one the projector refuses");
	assert.equal(rowOf(store, "capacity:ticket:0"), undefined);
});

test("an unanswerable probe moves nothing, and the run's closing account names it", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.unanswerable, { detail: { herdr_answered: false } }),
	});

	assert.equal(settled.reclaimed, 0);
	assert.deepEqual(settled.resumed, []);
	assert.notEqual(rowOf(store, "capacity:ticket:0"), undefined, "unanswerable is not absent (§5.2, §12.4)");

	const account = capacity.unsettled({ at: T0 + 9 });
	assert.equal(account.count, 1);
	assert.deepEqual(
		account.rows.map((row) => [row.slot, row.reason, row.verdict, row.adoptable_by_successor]),
		[["capacity:ticket:0", RETAINED_REASONS.unanswerable, ADOPTION_VERDICTS.unanswerable, false]],
	);
	assert.match(account.resolution, /re-probes/);
});

test("a model row with no ticket row behind it is not adopted: half a lane resumes nothing", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:model:local:0", ticket: 42, run, pool: "model" });

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.provable, { attempt: `${run}-t42-a1` }),
	});

	assert.deepEqual(settled.resumed, []);
	assert.deepEqual(
		settled.held.map((entry) => entry.reason),
		[RETAINED_REASONS.halfLane],
	);
	assert.equal(rowOf(store, "capacity:model:local:0").fencing_generation, hold.fencingGeneration - 1);
});

test("a lane whose row moves under the probe is retained, and the other lanes still resume", async (t) => {
	const { store, hold, capacity, leases, run } = await openPool(t, {
		plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 2, profiles: ["builder"] }] }),
	});
	store.append(attemptLaunched(run, 42, 1));
	store.append(attemptLaunched(run, 43, 1));
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:1", ticket: 43, run });

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async ({ identity }) => {
			// 43's row goes away between the proof and the swap — a release the
			// compare-and-swap is what catches, because the token stops matching.
			if (identity.ticket === 43) leases.release(leases.inspect("capacity:ticket:1"));
			return verdict(ADOPTION_VERDICTS.provable, { attempt: `${run}-t${identity.ticket}-a1` });
		},
	});

	assert.deepEqual(
		settled.resumed.map((lane) => lane.ticket),
		[42],
		"one lane's surprise is not the other's",
	);
	assert.deepEqual(
		settled.held.map((entry) => [entry.ticket, entry.reason]),
		[[43, RETAINED_REASONS.moved]],
	);
	assert.equal(rowOf(store, "capacity:ticket:0").fencing_generation, hold.fencingGeneration);
});

test("a row naming a pool this run does not have is retained, never adopted into one", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	store.append(attemptLaunched(run, 42, 1));
	// The ceiling shrank and a class went away while nobody was driving: index 3
	// is outside the ticket pool, and `rico` is not a class this plan declares.
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:3", ticket: 42, run });
	leaveSupersededSlot(store, hold, { slot: "capacity:model:rico:0", ticket: 42, run, pool: "model" });

	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.provable, { attempt: `${run}-t42-a1` }),
	});

	assert.deepEqual(settled.resumed, []);
	assert.deepEqual(
		settled.held.map((entry) => [entry.slot, entry.reason]),
		[
			["capacity:model:rico:0", RETAINED_REASONS.outsidePool],
			["capacity:ticket:3", RETAINED_REASONS.outsidePool],
		],
	);
	assert.equal(rowOf(store, "capacity:ticket:3").fencing_generation, hold.fencingGeneration - 1);
});

test("a row this run adopted and never ran is given back before the run ends", async (t) => {
	const { store, hold, capacity, run } = await openPool(t);
	store.append(attemptLaunched(run, 42, 1));
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 42, run });
	const settled = await capacity.reclaim({
		at: T0 + 5,
		adopt: true,
		probe: async () => verdict(ADOPTION_VERDICTS.provable, { attempt: `${run}-t42-a1` }),
	});
	assert.equal(settled.resumed.length, 1);

	assert.equal(capacity.releaseAdopted({ at: T0 + 6 }), 1);
	assert.equal(rowOf(store, "capacity:ticket:0"), undefined, "no successor could ever adopt a row of an ended run");
	assert.equal(capacity.releaseAdopted({ at: T0 + 7 }), 0, "a lane that gave its slots back has nothing more taken");
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
