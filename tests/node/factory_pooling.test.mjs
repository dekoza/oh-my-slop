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

test("#223: one lane waiting on two alternatives is counted once and a grant clears both waits", async (t) => {
	const { capacity } = await openCapacityPool(t, { plan });
	capacity.exhaustion.wait({ ticket: 1, resourceClass: "gpt" });
	capacity.exhaustion.wait({ ticket: 1, resourceClass: "claude-code" });
	assert.equal(capacity.snapshot().lanes.waiting, 1);
	const slot = capacity.acquireModel({ ticket: 1, resourceClass: "claude-code" });
	assert.deepEqual(capacity.snapshot().classes.map((entry) => entry.waiting), [0, 0]);
	slot.release({ reason: "test" });
	capacity.exhaustion.wait({ ticket: 1, resourceClass: "gpt" });
	assert.equal(capacity.snapshot().lanes.waiting, 1, "a later wait must be announced again");
});

test("#223: exact occupancy examples, full pools, endpoint siblings, and adopted rows", async (t) => {
	const { capacity, store, hold, run } = await openCapacityPool(t, { plan });
	const held = [capacity.acquireModel({ ticket: 90, resourceClass: "gpt" }),
		capacity.acquireModel({ ticket: 91, resourceClass: "claude-code" }), capacity.acquireModel({ ticket: 92, resourceClass: "claude-code" })];
	assert.equal((await dispatch(capacity)).profile, "claude", "2/5 is below 1/2");
	held.push(capacity.acquireModel({ ticket: 93, resourceClass: "gpt" }));
	assert.equal((await dispatch(capacity)).profile, "claude", "full GPT never stalls free Claude");
	for (let i = 0; i < 3; i++) held.push(capacity.acquireModel({ ticket: 94 + i, resourceClass: "claude-code" }));
	const full = await dispatch(capacity);
	assert.equal(full.profile, null);
	assert.deepEqual(full.considered.map((seen) => seen.state), ["busy", "busy"]);
	for (const slot of held) slot.release({ reason: "test" });
	for (let i = 0; i < 5; i++) assert.equal((await dispatch(capacity)).profile, "gpt");
	leaveSupersededSlot(store, hold, { slot: "capacity:ticket:0", ticket: 99, run });
	leaveSupersededSlot(store, hold, { slot: "capacity:model:gpt:0", ticket: 99, run, pool: "model" });
	const adopted = await capacity.reclaim({ adopt: true, probe: async () => ({ verdict: "provable", attempt: null, detail: {} }) });
	assert.equal(adopted.adopted, 2);
	assert.equal((await dispatch(capacity)).profile, "claude", "adopted usage is real usage");
	capacity.releaseAdopted();
	const endpoints = {
		one: { kind: "pi", model: "local/a", endpoint: { env: "MODEL_URL", url: "http://machine:1234" } },
		two: { kind: "pi", model: "local/b", endpoint: { env: "MODEL_URL", url: "http://machine:1234/" } },
		claude: profiles.claude,
	};
	const shared = capacityPlan({ concurrency: { maxTicketExecutions: 3, resources: { "endpoint-machine-1234": 2, "claude-code": 5 } }, profiles: endpoints,
		activeRouting: { roles: { implement: "one", freshRetry: "one", review: ["one", "one"] }, rules: [], pooling: { implement: ["one", "two", "claude"] } } });
	assert.equal(shared.classes.length, 2);
	assert.equal(shared.resourceSlots, 7);
	assert.equal(shared.implementSlots, 7);
});

test("#223: legacy fallbacks, authoritative labels, and fresh-retry are not load-balanced", async (t) => {
	const { capacity } = await openCapacityPool(t, { plan });
	const held = capacity.acquireModel({ ticket: 90, resourceClass: "gpt" });
	const legacy = { roles: activeRouting.roles, rules: [], fallbacks: { implement: ["claude"] } };
	assert.equal((await dispatch(capacity, legacy)).profile, "gpt");
	const labelled = { ...activeRouting, rules: [{ labelsAny: ["pinned"], role: "implement", profile: "gpt" }] };
	assert.equal((await dispatch(capacity, labelled, 1, ["pinned"])).profile, "gpt");
	assert.deepEqual(dispatchOrder(activeRouting, { role: "freshRetry" }), ["gpt"]);
	const reviewLabel = { ...activeRouting, rules: [{ labelsAny: ["pinned"], role: "review", profile: ["gpt", "gpt"] }] };
	assert.deepEqual(dispatchOrder(reviewLabel, { role: "review", labels: ["pinned"], axis: 1 }), ["gpt"]);
	held.release({ reason: "test" });
});

test("#223: exhausted empty pools remain excluded until probe-driven admission", async (t) => {
	let clock = FIXED_NOW;
	let probes = 0;
	const { capacity } = await openCapacityPool(t, { plan, now: () => clock, probeClass: async () => { probes++; return { verdict: "admitted" }; } });
	capacity.exhaustion.record("gpt", { until: clock + 1000 });
	const choose = () => selectRoute({ order: ["gpt", "claude"], profiles, exhaustion: capacity.exhaustion, capacity, pooled: true, at: clock });
	assert.equal((await choose()).profile, "claude");
	assert.equal(probes, 0);
	clock += 1001;
	assert.equal((await choose()).profile, "gpt");
	assert.equal(probes, 1);
});

test("#223: competing pooled attempt reservations reconsider capacity and never overbook", async (t) => {
	const { capacity, leases } = await openCapacityPool(t, { plan });
	const reservations = await Promise.all(Array.from({ length: 7 }, (_, index) => reserveModelRoute({ capacity, ticket: index + 1, order: ["gpt", "claude"], profiles })));
	assert.deepEqual(capacity.occupancy().map(({ class: name, held }) => [name, held]), [["claude-code", 5], ["gpt", 2]]);
	assert.equal(new Set(reservations.map(({ slot }) => slot.name)).size, 7);
	for (const { route, slot } of reservations) {
		assert.equal(slot.class, route.class);
		assert.equal(leases.inspect(slot.name).identity.class, route.pooling.selected.class);
		slot.release({ reason: "test" });
	}
	assert.equal(leases.list("capacity:").length, 0);
});

test("#223: all-busy scheduler waits without claims, launches, or budgets and stop wakes it", async (t) => {
	const { capacity, store } = await openCapacityPool(t, { plan });
	const held = [];
	for (const entry of plan.classes) for (let index = 0; index < entry.size; index++) held.push(capacity.acquireModel({ ticket: 90 + index, resourceClass: entry.class }));
	let claiming = true;
	let launches = 0;
	let reads = 0;
	const running = schedule({ capacity, frontier: async () => { reads++; return { claimable: [1, 2] }; }, dispatch: () => dispatch(capacity),
		claiming: () => claiming, execute: () => { launches++; } });
	await delay(100);
	assert.equal(launches, 0);
	assert.equal(reads, 1);
	assert.equal(capacity.snapshot().ticket.held, 0);
	assert.equal(store.readEvents({ kind: "stage.resolved" }).length, 0);
	claiming = false;
	await running;
	for (const slot of held) slot.release({ reason: "test" });
});

test("#223: a waiting pooled attempt observes abandon and lease loss, without acquiring", async (t) => {
	for (const stop of ["abandon", "lease-loss"]) {
		const fixture = await openCapacityPool(t, { plan });
		let interrupted = false;
		const capacity = openCapacity(fixture.store, { ...fixture, plan, interrupted: () => interrupted });
		const slots = [];
		for (const entry of plan.classes) for (let index = 0; index < entry.size; index++) slots.push(capacity.acquireModel({ ticket: 90 + index, resourceClass: entry.class }));
		const pending = reserveModelRoute({ capacity, ticket: 1, order: ["gpt", "claude"], profiles });
		const refused = assert.rejects(pending, stop === "abandon" ? { name: "AbortError" } : { reason: "lease-lost" });
		await delay(50);
		if (stop === "abandon") interrupted = true;
		else {
			fixture.store.transaction(({ db }) => db.prepare("UPDATE lease SET holder_token = 'successor' WHERE name = 'controller'").run());
			fixture.hold.renew();
		}
		await refused;
		assert.equal(fixture.store.readEvents({ kind: "attempt.launched" }).length, 0);
	}
});

test("#223: losing the initial acquisition retries on free capacity without a leaked ticket grant", async (t) => {
	const fixture = await openCapacityPool(t, { plan });
	let first = true;
	const competing = [];
	const leases = { ...fixture.leases, acquireAll: (requests) => {
		if (first) {
			first = false;
			for (let index = 0; index < 2; index++) competing.push(fixture.leases.acquire({ name: `capacity:model:gpt:${index}`, identity: { pool: "model", class: "gpt" } }));
		}
		return fixture.leases.acquireAll(requests);
	} };
	const capacity = openCapacity(fixture.store, { ...fixture, leases, plan });
	const launched = [];
	await schedule({ capacity, frontier: async () => ({ claimable: [1] }), dispatch: () => dispatch(capacity),
		execute: ({ route, slots }) => { launched.push(route.profile); assert.equal(slots.model.class, route.class); return { disposition: "published" }; } });
	assert.deepEqual(launched, ["claude"]);
	assert.equal(fixture.store.readEvents({ kind: "capacity.granted" }).filter((event) => event.payload.pool === "ticket").length, 1);
	assert.equal(capacity.snapshot().ticket.held, 0);
	for (const slot of competing) fixture.leases.release(slot);
});

test("#223: capacity planning does not count a default replaced by pooling as implement capacity", () => {
	const onlyClaude = { ...activeRouting, pooling: { implement: ["claude"] } };
	const planned = capacityPlan({ concurrency: { maxTicketExecutions: 6, resources: { gpt: 2, "claude-code": 5 } }, profiles, activeRouting: onlyClaude });
	assert.equal(planned.implementSlots, 5);
	assert.equal(planned.effectiveConcurrency, 5);
});

test("#223: mixed busy/exhausted waiting wakes for a due readmission probe", async (t) => {
	let clock = FIXED_NOW;
	const { capacity } = await openCapacityPool(t, { plan, now: () => clock, probeClass: async () => ({ verdict: "admitted" }) });
	const held = [capacity.acquireModel({ ticket: 90, resourceClass: "gpt" }), capacity.acquireModel({ ticket: 91, resourceClass: "gpt" })];
	capacity.exhaustion.record("claude-code", { until: clock + 100 });
	let claiming = true;
	const launched = [];
	const running = schedule({ capacity, at: () => clock, claiming: () => claiming, frontier: async () => ({ claimable: [1] }),
		dispatch: () => implementDispatch({ profiles, activeRouting }, { ticket: 1 }, { capacity, exhaustion: capacity.exhaustion, at: clock }),
		execute: ({ route }) => { launched.push(route.profile); return { disposition: "published" }; } });
	try {
		await delay(50);
		assert.deepEqual(launched, []);
		clock += 101;
		await delay(80);
		assert.deepEqual(launched, ["claude"]);
	} finally { claiming = false; await running; for (const slot of held) slot.release({ reason: "test" }); }
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
