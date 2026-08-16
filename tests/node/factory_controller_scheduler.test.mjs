import test from "node:test";
import assert from "node:assert/strict";

import { FactoryCapacityError } from "../../factory/lib/capacity/errors.mjs";
import { schedule } from "../../factory/lib/controller/scheduler.mjs";
import {
	capacityPlanOf as plan,
	FIXED_NOW as T0,
	leaveSupersededSlot,
	openCapacityPool as openPool,
} from "./helpers/factory-store.mjs";

/**
 * §9.6's loop: *while a slot is free and the live frontier is non-empty, take
 * the lowest-numbered claimable ticket; otherwise wait for a ticket execution to
 * terminate.*
 *
 * **There is no queue object.** Fairness is §3.2's ascending issue number and
 * nothing else, and starvation is structurally impossible rather than defended
 * against — which is why no aging or priority mechanism appears anywhere below.
 *
 * The loop is **parametric in capacity**: every test here hands it a number, and
 * two of them hand it a 2. There is no override seam to reach for, because
 * §9.3's ceiling is enforced in the config loader and the scheduler never learns
 * the constant exists.
 */

/**
 * Let the loop run until it is waiting on something the test controls. The loop
 * awaits the frontier between decisions, so "how many lanes did it start" is a
 * question about a settled event loop rather than about one microtask.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A lane whose completion the test decides, so nothing races a real clock. */
function deferred() {
	let settle;
	const promise = new Promise((resolve) => {
		settle = resolve;
	});
	return { promise, settle };
}

/** A frontier reader shaped like §3.2's answer: claimable tickets, ascending. */
function frontierOf(tickets, labels = {}) {
	return async () => ({
		claimable: [...tickets].sort((left, right) => left - right),
		members: [...tickets].map((ticket) => ({ ticket, labels: labels[ticket] ?? [] })),
	});
}

const localClass = () => "local";

// ── Order, and nothing but order (§3.2, §9.6) ────────────────────────────────

test("the lowest-numbered claimable ticket is taken first, with no priority mechanism", async (t) => {
	const { capacity } = await openPool(t);
	const started = [];

	const result = await schedule({
		capacity,
		frontier: frontierOf([91, 7, 42]),
		resourceClassOf: localClass,
		execute: ({ ticket }) => {
			started.push(ticket);
			return { disposition: "published" };
		},
	});

	assert.deepEqual(started, [7, 42, 91]);
	assert.equal(result.lanes_run, 3);
});

test("at capacity 1, a second ticket is never claimed while the first holds the slot", async (t) => {
	const { capacity } = await openPool(t);
	const first = deferred();
	const inFlight = [];

	const loop = schedule({
		capacity,
		frontier: frontierOf([7, 42]),
		resourceClassOf: localClass,
		execute: async ({ ticket }) => {
			inFlight.push(ticket);
			if (ticket === 7) await first.promise;
			return { disposition: "published" };
		},
	});

	await settle();
	assert.deepEqual(inFlight, [7], "the second lane is not buffered, queued, or pre-claimed — it is simply not claimed");

	first.settle();
	await loop;
	assert.deepEqual(inFlight, [7, 42]);
});

// ── Parametric in capacity, never special-cased at 1 (§9.3) ──────────────────

test("at capacity 2 with a two-slot class, two lanes run at once", async (t) => {
	const { capacity } = await openPool(t, { plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 2, profiles: ["builder"] }] }) });
	const gate = deferred();
	const live = [];

	const loop = schedule({
		capacity,
		frontier: frontierOf([7, 42, 91]),
		resourceClassOf: localClass,
		execute: async ({ ticket }) => {
			live.push(ticket);
			await gate.promise;
			return { disposition: "published" };
		},
	});

	await settle();
	assert.deepEqual(live, [7, 42], "two lanes, because the two pools carry two");

	gate.settle();
	const result = await loop;
	assert.deepEqual(live, [7, 42, 91]);
	assert.equal(result.lanes_run, 3);
});

test("a size-1 class holds the run to one lane whatever the declared ceiling says", async (t) => {
	const { capacity } = await openPool(t, { plan: plan({ ticketSlots: 2, classes: [{ class: "local", size: 1, profiles: ["builder"] }] }) });
	const gate = deferred();
	const live = [];

	const loop = schedule({
		capacity,
		frontier: frontierOf([7, 42]),
		resourceClassOf: localClass,
		execute: async ({ ticket }) => {
			live.push(ticket);
			await gate.promise;
			return { disposition: "published" };
		},
	});

	await settle();
	assert.deepEqual(live, [7], "the second ticket is never claimed (§9.2, §15 case 2)");

	gate.settle();
	await loop;
	assert.deepEqual(live, [7, 42]);
});

// ── Spans: the ticket slot outlives its attempts (§9.4, §15 case 4) ──────────

test("the ticket slot survives repair and fresh-retry, and a newly eligible ticket cannot take it", async (t) => {
	const { capacity } = await openPool(t);
	const seen = [];
	let eligible = [7];

	await schedule({
		capacity,
		frontier: async () => ({
			claimable: [...eligible],
			members: eligible.map((ticket) => ({ ticket, labels: [] })),
		}),
		resourceClassOf: localClass,
		execute: async ({ ticket, slots }) => {
			// A second attempt: the model slot goes back between attempts, the
			// ticket slot does not.
			eligible = [7, 42];
			slots.model.release({ reason: "attempt-ended", at: T0 + 1 });
			seen.push(capacity.snapshot({ at: T0 + 2 }));

			const repair = capacity.acquireModel({ ticket, resourceClass: "local", at: T0 + 3 });
			assert.notEqual(repair, null, "an exited attempt's slot is free for the repair attempt");
			repair.release({ reason: "attempt-ended", at: T0 + 4 });

			return { disposition: "published" };
		},
	});

	assert.deepEqual(
		seen.map((snapshot) => [snapshot.ticket.held, snapshot.classes[0].held]),
		[
			[1, 0],
			[1, 0],
		],
		"between phases a lane holds its ticket slot and zero model slots",
	);
});

test("after a full run no capacity row is left held", async (t) => {
	const { store, capacity } = await openPool(t);

	await schedule({
		capacity,
		frontier: frontierOf([7, 42]),
		resourceClassOf: localClass,
		execute: () => ({ disposition: "published" }),
	});

	assert.equal(
		store.read((db) => db.prepare("SELECT COUNT(*) AS rows FROM lease WHERE name LIKE 'capacity:%'").get().rows),
		0,
		"§15 case 5: every terminal disposition frees the ticket slot",
	);
});

test("a lane that leaves its own slots held still frees them at its terminal disposition", async (t) => {
	const { capacity } = await openPool(t);

	await schedule({
		capacity,
		frontier: frontierOf([7]),
		resourceClassOf: localClass,
		execute: () => ({ disposition: "failed" }),
	});

	assert.deepEqual(capacity.snapshot({ at: T0 }).ticket, { size: 1, held: 0, waiting: 0, superseded: 0 });
});

// ── The frontier is live, and nothing about it is retained (§3.1, §9.6) ──────

test("membership is recomputed at every scheduling decision", async (t) => {
	const { capacity } = await openPool(t);
	const polls = [];
	let eligible = [7, 42];

	const started = [];
	await schedule({
		capacity,
		frontier: async () => {
			polls.push([...eligible]);
			return { claimable: [...eligible], members: eligible.map((ticket) => ({ ticket, labels: [] })) };
		},
		resourceClassOf: localClass,
		execute: ({ ticket }) => {
			started.push(ticket);
			// 42 stops being claimable while 7 runs — a human took it, or a blocker
			// re-opened. The loop reads that, rather than a list it kept.
			eligible = ticket === 7 ? [] : eligible;
			return { disposition: "published" };
		},
	});

	assert.deepEqual(started, [7], "a ticket that left the frontier is never claimed from a stale copy");
	assert.ok(polls.length >= 2, "the frontier is asked again after the lane terminated");
});

test("a ticket that becomes claimable mid-run is picked up without any requeue", async (t) => {
	const { capacity } = await openPool(t);
	let eligible = [7];
	const started = [];

	await schedule({
		capacity,
		frontier: async () => ({ claimable: [...eligible], members: eligible.map((ticket) => ({ ticket, labels: [] })) }),
		resourceClassOf: localClass,
		execute: ({ ticket }) => {
			started.push(ticket);
			if (ticket === 7) eligible = [42];
			return { disposition: "published" };
		},
	});

	assert.deepEqual(started, [7, 42]);
});

// ── Drain and abandon (§3.5, §9.6) ───────────────────────────────────────────

test("draining stops claiming and lets every in-flight lane reach its disposition", async (t) => {
	const { capacity } = await openPool(t);
	const gate = deferred();
	const started = [];
	let claiming = true;

	const loop = schedule({
		capacity,
		frontier: frontierOf([7, 42]),
		resourceClassOf: localClass,
		claiming: () => claiming,
		execute: async ({ ticket }) => {
			started.push(ticket);
			await gate.promise;
			return { disposition: "published" };
		},
	});

	await settle();
	claiming = false;
	gate.settle();
	const result = await loop;

	assert.deepEqual(started, [7], "no new claims once the drain is asked for");
	assert.deepEqual(
		result.lanes.map((lane) => [lane.ticket, lane.disposition]),
		[[7, "published"]],
		"and the lane that was already running still finished",
	);
});

test("abandon releases in-flight lanes and their slots, and waits for nothing", async (t) => {
	const { store, capacity } = await openPool(t);
	const never = deferred();
	let abandoning = false;

	const loop = schedule({
		capacity,
		frontier: frontierOf([7]),
		resourceClassOf: localClass,
		abandoning: () => abandoning,
		execute: async () => {
			abandoning = true;
			await never.promise;
			return { disposition: "published" };
		},
	});

	const result = await loop;

	assert.deepEqual(
		result.lanes.map((lane) => [lane.ticket, lane.disposition]),
		[[7, "released"]],
	);
	assert.equal(
		store.read((db) => db.prepare("SELECT COUNT(*) AS rows FROM lease WHERE name LIKE 'capacity:%'").get().rows),
		0,
		"the slots go back; the pane is left alive for the next reconcile (§9.6, §14.27)",
	);
	never.settle();
});

// ── Refusals raised before any work (§11.5) ──────────────────────────────────

test("a ticket matching two routing rules is refused without being claimed, and does not spin the loop", async (t) => {
	const { capacity } = await openPool(t);
	const started = [];

	const result = await schedule({
		capacity,
		frontier: frontierOf([7, 42]),
		resourceClassOf: ({ ticket }) => {
			if (ticket === 7) {
				throw new FactoryCapacityError("routing-ambiguous", `Ticket ${ticket} matches two rules.`, { ticket });
			}
			return "local";
		},
		execute: ({ ticket }) => {
			started.push(ticket);
			return { disposition: "published" };
		},
	});

	assert.deepEqual(started, [42]);
	assert.deepEqual(
		result.refused.map((entry) => [entry.ticket, entry.reason]),
		[[7, "routing-ambiguous"]],
	);
});

test("a slot pool blocked by a previous controller's rows ends the loop rather than spinning", async (t) => {
	const { store, hold, capacity } = await openPool(t);
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 5 });

	const result = await schedule({
		capacity,
		frontier: frontierOf([7]),
		resourceClassOf: localClass,
		execute: () => assert.fail("nothing may run on a slot this controller does not hold"),
	});

	assert.equal(result.lanes_run, 0);
	assert.deepEqual(
		result.blocked.map((entry) => entry.slot),
		["capacity:ticket:0"],
	);
});
