import test from "node:test";
import assert from "node:assert/strict";
import { implementDispatch, capacityPlan } from "../../factory/lib/capacity/plan.mjs";
import { dispatchOrder, selectRoute } from "../../factory/lib/worker/dispatch.mjs";
import { openCapacityPool, capacityPlanOf } from "./helpers/factory-store.mjs";

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
