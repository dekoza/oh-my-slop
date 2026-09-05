import test from "node:test";
import assert from "node:assert/strict";
import { reserveModelRoute } from "../../factory/lib/capacity/selection.mjs";
import { openCapacity } from "../../factory/lib/capacity/slots.mjs";
import { implementDispatch, capacityPlan } from "../../factory/lib/capacity/plan.mjs";
import { dispatchOrder, selectRoute } from "../../factory/lib/worker/dispatch.mjs";
import { schedule } from "../../factory/lib/controller/scheduler.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { openCapacityPool, capacityPlanOf, leaveSupersededSlot, FIXED_NOW } from "./helpers/factory-store.mjs";

test("#223: a competing model hold rolls back the entire initial lease pair", async (t) => {
	const { leases } = await openCapacityPool(t);
	const model = "capacity:model:local:0";
	const occupied = leases.acquire({ name: model, identity: {} });
	assert.throws(() => leases.acquireAll([
		{ name: "capacity:ticket:0", identity: {} }, { name: model, identity: {} },
	]), { reason: "lease-held" });
	assert.equal(leases.inspect("capacity:ticket:0"), null);
	assert.equal(leases.inspect(model).token, occupied.token);
});

test("#223: a class keeps its declared tie position when its first profile is already refused", async (t) => {
	const { capacity } = await openCapacityPool(t, { plan });
	const route = await selectRoute({ order: ["gpt", "claude", "sibling"], profiles: { ...profiles, sibling: profiles.gpt },
		dispatched: ["gpt"], exhaustion: capacity.exhaustion, pooled: true, capacity });
	assert.equal(route.profile, "sibling");
});

const profiles = {
	gpt: { kind: "pi", model: "gpt/model" },
	claude: { kind: "claude", model: "opus" },
};
const activeRouting = {
	roles: { implement: "gpt", freshRetry: "gpt", review: ["gpt", "gpt"] },
	rules: [],
	pooling: { implement: ["gpt", "claude"], review: [["gpt", "claude"], ["claude"]] },
};
const plan = capacityPlan({ concurrency: { maxTicketExecutions: 3, resources: { gpt: 2, "claude-code": 5 } }, profiles, activeRouting });

const dispatch = (capacity, routing = activeRouting, ticket = 1, labels = []) => implementDispatch(
	{ profiles, activeRouting: routing }, { ticket, labels }, { exhaustion: capacity.exhaustion, capacity },
);

test("#223: held attempts choose GPT first, then Claude by proportional occupancy", async (t) => {
	const { capacity } = await openCapacityPool(t, { plan });
	const first = await dispatch(capacity);
	assert.equal(first.profile, "gpt");
	const held = capacity.acquireLane({ ticket: 1, resourceClass: first.class });
	const second = await dispatch(capacity);
	assert.equal(second.profile, "claude");
	assert.deepEqual(second.considered.map(({ profile, held, size }) => ({ profile, held, size })), [
		{ profile: "gpt", held: 1, size: 2 }, { profile: "claude", held: 0, size: 5 },
	]);
	assert.deepEqual(second.pooling.order, ["gpt", "claude"]);
	held.model.release({ reason: "test" });
	held.ticket.release({ reason: "test" });
});

test("#223: a relevant model release admits another lane before the releasing ticket terminates", async (t) => {
	const { capacity } = await openCapacityPool(t, { plan: capacityPlanOf({ ticketSlots: 2, classes: [{ class: "gpt", size: 1, profiles: ["gpt"] }] }) });
	const routing = { ...activeRouting, pooling: { implement: ["gpt"] } };
	let releaseFirst;
	const gate = new Promise((resolve) => { releaseFirst = resolve; });
	let firstSlot;
	const launched = [];
	let reads = 0;
	const running = schedule({ capacity,
		frontier: async () => { reads++; return { claimable: [1, 2] }; },
		dispatch: (member) => dispatch(capacity, routing, member.ticket),
		execute: async ({ ticket, slots }) => {
			launched.push(ticket);
			if (ticket === 1) { firstSlot = slots.model; await gate; }
			return { disposition: "published" };
		},
	});
	try {
		await delay(80);
		assert.deepEqual(launched, [1]);
		const waitingReads = reads;
		await delay(80);
		assert.equal(reads, waitingReads, "unchanged capacity must not poll the tracker");
		firstSlot.release({ reason: "between-phases" });
		await delay(80);
		assert.deepEqual(launched, [1, 2]);
	} finally { releaseFirst(); await running; }
});
