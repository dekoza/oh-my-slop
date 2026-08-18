import test from "node:test";
import assert from "node:assert/strict";

import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { dispatchOrder, selectRoute } from "../../factory/lib/worker/dispatch.mjs";

/**
 * §11.5's dispatch read under §9.8's memo (#155): which profile a role actually
 * runs on when the one it resolves to belongs to an exhausted resource class.
 */

const PROFILES = Object.freeze({
	builder: { kind: "pi", model: "local/qwen3" },
	sibling: { kind: "pi", model: "local/glm" },
	cloud: { kind: "claude", model: "opus" },
	remote: { kind: "pi", model: "openrouter/z-ai/glm" },
});

function routing(overrides = {}) {
	return {
		roles: { implement: "builder", freshRetry: "builder", review: ["builder", "cloud"] },
		rules: [],
		fallbacks: { implement: [], freshRetry: [], review: [[], []] },
		...overrides,
	};
}

/** The `capacity.exhaustion` facet, reduced to the one question a route asks. */
function memo(blocked = {}) {
	return {
		settle: async (className) => blocked[className] ?? Object.freeze({ state: "available", until: null }),
	};
}

// ── The order: what §11.5 dispatches to, then what the config says comes next ──

test("a role's order is the profile it dispatches to, then its declared fallbacks", () => {
	const active = routing({ fallbacks: { implement: ["cloud", "remote"], freshRetry: [], review: [[], []] } });

	assert.deepEqual(dispatchOrder(active, { role: "implement" }), ["builder", "cloud", "remote"]);
});

test("a role with no declared fallbacks has an order of one — today's dispatch, unchanged", () => {
	assert.deepEqual(dispatchOrder(routing(), { role: "freshRetry" }), ["builder"]);
});

test("a matching rule heads the order, and the role's fallbacks still follow it", () => {
	const active = routing({
		rules: [{ labelsAny: ["risk:high"], role: "implement", profile: "cloud" }],
		fallbacks: { implement: ["remote"], freshRetry: [], review: [[], []] },
	});

	assert.deepEqual(dispatchOrder(active, { role: "implement", labels: ["risk:high"] }), ["cloud", "remote"]);
});

test("a fallback that repeats the dispatched profile is visited once, not twice", () => {
	const active = routing({
		rules: [{ labelsAny: ["risk:high"], role: "implement", profile: "cloud" }],
		fallbacks: { implement: ["cloud", "remote"], freshRetry: [], review: [[], []] },
	});

	assert.deepEqual(dispatchOrder(active, { role: "implement", labels: ["risk:high"] }), ["cloud", "remote"]);
});

test("each review axis reads its own half of the pair and its own fallback order", () => {
	const active = routing({ fallbacks: { implement: [], freshRetry: [], review: [["remote"], ["sibling"]] } });

	assert.deepEqual(dispatchOrder(active, { role: "review", axis: 0 }), ["builder", "remote"]);
	assert.deepEqual(dispatchOrder(active, { role: "review", axis: 1 }), ["cloud", "sibling"]);
});

test("asking the review role for an order without naming an axis refuses rather than picking one", () => {
	assert.throws(() => dispatchOrder(routing(), { role: "review" }), (error) => {
		assert.ok(error instanceof FactoryWorkerError);
		assert.equal(error.reason, "routing-ambiguous");
		assert.match(error.message, /axis/);
		return true;
	});
});

// ── The selection: the first candidate whose class the memo has not locked ────

test("an available class runs the declared profile, and nothing is rerouted", async () => {
	const route = await selectRoute({
		order: dispatchOrder(routing({ fallbacks: { implement: ["cloud"], freshRetry: [], review: [[], []] } }), {
			role: "implement",
		}),
		profiles: PROFILES,
		exhaustion: memo(),
	});

	assert.equal(route.profile, "builder");
	assert.equal(route.class, "local");
	assert.equal(route.declared, "builder");
	assert.equal(route.rerouted, false);
	assert.equal(route.reason, null);
});

test("an exhausted class steps to the next routable profile, in the declared order", async () => {
	const order = dispatchOrder(routing({ fallbacks: { implement: ["remote", "cloud"], freshRetry: [], review: [[], []] } }), {
		role: "implement",
	});

	const route = await selectRoute({
		order,
		profiles: PROFILES,
		exhaustion: memo({ local: { state: "blocked", until: 900 }, openrouter: { state: "blocked", until: 800 } }),
	});

	assert.equal(route.profile, "cloud");
	assert.equal(route.class, "claude-code");
	assert.equal(route.declared, "builder");
	assert.equal(route.rerouted, true);
	assert.match(route.reason, /local/);
});

test("the selection records what was declared, what ran, and every candidate it passed over", async () => {
	const order = dispatchOrder(routing({ fallbacks: { implement: ["cloud"], freshRetry: [], review: [[], []] } }), {
		role: "implement",
	});

	const route = await selectRoute({
		order,
		profiles: PROFILES,
		exhaustion: memo({ local: { state: "blocked", until: 900 } }),
	});

	assert.deepEqual(route.considered, [
		{ profile: "builder", class: "local", state: "blocked", until: 900 },
		{ profile: "cloud", class: "claude-code", state: "available", until: null },
	]);
});

test("the memo is class-scoped, so a sibling profile on the exhausted class is no escape", async () => {
	const order = dispatchOrder(routing({ fallbacks: { implement: ["sibling"], freshRetry: [], review: [[], []] } }), {
		role: "implement",
	});

	const route = await selectRoute({
		order,
		profiles: PROFILES,
		exhaustion: memo({ local: { state: "blocked", until: 900 } }),
	});

	assert.equal(route.profile, null);
	assert.deepEqual(
		route.considered.map((entry) => entry.class),
		["local", "local"],
	);
});

test("every routable profile exhausted answers with no route, carrying what it tried", async () => {
	const order = dispatchOrder(routing({ fallbacks: { implement: ["cloud"], freshRetry: [], review: [[], []] } }), {
		role: "implement",
	});

	const route = await selectRoute({
		order,
		profiles: PROFILES,
		exhaustion: memo({ local: { state: "blocked", until: 900 }, "claude-code": { state: "blocked", until: 950 } }),
	});

	assert.equal(route.profile, null);
	assert.equal(route.class, null);
	assert.equal(route.declared, "builder");
	assert.equal(route.rerouted, false);
	assert.deepEqual(
		route.considered.map((entry) => entry.state),
		["blocked", "blocked"],
	);
});

test("a profile this ticket execution already dispatched is not offered again, which bounds the reroute", async () => {
	const order = dispatchOrder(routing({ fallbacks: { implement: ["cloud", "remote"], freshRetry: [], review: [[], []] } }), {
		role: "implement",
	});

	const route = await selectRoute({
		order,
		profiles: PROFILES,
		exhaustion: memo(),
		dispatched: ["builder", "cloud"],
	});

	assert.equal(route.profile, "remote");
	assert.equal(route.rerouted, true);
	assert.deepEqual(
		route.considered.map((entry) => entry.state),
		["already-dispatched", "already-dispatched", "available"],
	);
});
