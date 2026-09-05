import test from "node:test";
import assert from "node:assert/strict";

import {
	capacityPlan,
	implementDispatch,
	MAX_PANES_PER_TICKET,
} from "../../factory/lib/capacity/plan.mjs";
import { CONCURRENCY_KEYS } from "../../factory/lib/config/concurrency.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { cloneValidConfig, makeRepo } from "./helpers/factory-repo.mjs";

/**
 * §9.1's capacity model: three dimensions, two declared. The plan is what turns
 * the two declared numbers plus the active routing into the pool the scheduler
 * arbitrates over — and into the honest **effective** concurrency §9.2 says the
 * declared ceiling alone cannot state.
 */

/** A validated config, loaded the way the binary loads it. */
function loaded(t, mutate = () => {}) {
	const config = cloneValidConfig();
	mutate(config);
	return loadFactoryConfig({ cwd: makeRepo(t, { config }) });
}

function planOf(t, mutate) {
	const { config, activeRouting } = loaded(t, mutate);
	return capacityPlan({ concurrency: config.concurrency, profiles: config.profiles, activeRouting });
}

// ── Classes are derived, never declared per profile (§9.1) ───────────────────

test("a pi profile's class is the provider segment of its model id", (t) => {
	const plan = planOf(t, (config) => {
		config.profiles.builder.model = "local/thinkingcap-qwen3.6-27b";
	});

	assert.deepEqual(
		plan.classes.map((entry) => entry.class),
		["local"],
	);
});

test("two pi profiles on one provider share a single pool, because they share one GPU", (t) => {
	const plan = planOf(t, (config) => {
		config.profiles.builder.model = "local/qwen3";
		config.profiles.reviewer = { kind: "pi", model: "local/mistral" };
		config.routing.roles.review = ["reviewer", "reviewer"];
	});

	assert.deepEqual(plan.classes, [{ class: "local", size: 1, profiles: ["builder", "reviewer"] }]);
});

test("every claude profile shares the constant claude-code class", (t) => {
	const plan = planOf(t, (config) => {
		config.profiles.reviewer = { kind: "claude", model: "opus" };
		config.profiles.second = { kind: "claude", model: "fable" };
		config.routing.roles.review = ["reviewer", "second"];
		config.concurrency.resources["claude-code"] = 3;
	});

	assert.deepEqual(plan.classes, [
		{ class: "claude-code", size: 3, profiles: ["reviewer", "second"] },
		{ class: "local", size: 1, profiles: ["builder"] },
	]);
});

test("a class only a dormant routing set reaches is not in the plan", (t) => {
	const plan = planOf(t, (config) => {
		config.profiles.cloud = { kind: "claude", model: "opus" };
		config.routing.sets = {
			"post-subscription": {
				roles: { implement: "cloud", freshRetry: "cloud", review: ["cloud", "cloud"] },
				rules: [],
			},
		};
		config.concurrency.resources["claude-code"] = 2;
	});

	assert.deepEqual(
		plan.classes.map((entry) => entry.class),
		["local"],
		"the active routing reaches only local; the dormant set's class is sized but not in play",
	);
});

test("the loader's reachability and the plan's pools name the same endpoint-derived classes (#209)", (t) => {
	// §11.6 asks `classesReachedBy` for reachability across every declared
	// routing; §9.1's plan asks it of the active one. Endpoint-derived classes
	// are the case where the two could drift apart silently — the loader would
	// size a machine the scheduler never arbitrates over — so this asks both.
	const bind = (url) => ({ env: "PI_LOCAL_ROUTER_BASE_URL", url });
	const { config, activeRouting } = loaded(t, (draft) => {
		draft.profiles.builder = { kind: "pi", model: "local/qwen3", endpoint: bind("http://rico:11545") };
		draft.profiles.second = { kind: "pi", model: "local/qwen3", endpoint: bind("http://gerda:11545") };
		draft.routing.roles.review = ["second", "second"];
		draft.concurrency.resources = { "endpoint-rico-11545": 1, "endpoint-gerda-11545": 1 };
	});

	const plan = capacityPlan({ concurrency: config.concurrency, profiles: config.profiles, activeRouting });

	assert.deepEqual(
		plan.classes.map((entry) => entry.class).sort(),
		Object.keys(config.concurrency.resources).sort(),
		"a sized class the plan does not hold is a pool nothing arbitrates over",
	);
	assert.deepEqual(plan.classes, [
		{ class: "endpoint-gerda-11545", size: 1, profiles: ["second"] },
		{ class: "endpoint-rico-11545", size: 1, profiles: ["builder"] },
	]);
});

test("sizing the old provider class after an endpoint is bound refuses, naming the new one (#209)", (t) => {
	const config = cloneValidConfig();
	config.profiles.builder = {
		kind: "pi",
		model: "local/qwen3",
		endpoint: { env: "PI_LOCAL_ROUTER_BASE_URL", url: "http://rico:11545" },
	};

	assert.throws(
		() => loadFactoryConfig({ cwd: makeRepo(t, { config }) }),
		(error) => {
			// The class the routing reaches is unsized, and the sentence names the
			// key an operator migrating a `resources` map has to write instead.
			assert.equal(error.reason, "resource-unsized");
			assert.equal(error.details.class, "endpoint-rico-11545");
			return true;
		},
	);
});

// ── Effective concurrency (§9.2, §15 case 19) ────────────────────────────────

test("effective concurrency is the declared ceiling when the pools can carry it", (t) => {
	const { config, activeRouting } = loaded(t, (config) => {
		config.profiles.cloud = { kind: "claude", model: "opus" };
		config.routing.roles = { implement: "cloud", freshRetry: "cloud", review: ["cloud", "cloud"] };
		config.concurrency.resources = { "claude-code": 4 };
	});

	// The ceiling is raised **after** the load, because §9.3 enforces it in the
	// loader only: there is no override seam to reach for, and the scheduler's
	// inputs are ordinary numbers.
	const plan = capacityPlan({
		concurrency: { ...config.concurrency, maxTicketExecutions: 2 },
		profiles: config.profiles,
		activeRouting,
	});

	assert.equal(plan.declaredCeiling, 2);
	assert.equal(plan.effectiveConcurrency, 2);
});

test("effective concurrency is bounded by the implement pools, not by review's idle slots", (t) => {
	const { config, activeRouting } = loaded(t, (config) => {
		config.profiles.cloud = { kind: "claude", model: "opus" };
		config.routing.roles.review = ["cloud", "cloud"];
		config.concurrency.resources["claude-code"] = 8;
	});

	const plan = capacityPlan({
		concurrency: { ...config.concurrency, maxTicketExecutions: 4 },
		profiles: config.profiles,
		activeRouting,
	});

	assert.equal(plan.resourceSlots, 9, "nine slots are reachable in total");
	assert.equal(plan.implementSlots, 1, "but a ticket starts on the one that implements it");
	assert.equal(
		plan.effectiveConcurrency,
		1,
		"§9.4 holds an implement slot before the claim, so the cloud's parallelism is not this run's (§9.7)",
	);
});

test("routing that resolves entirely to a size-1 class reports effective concurrency 1 whatever the ceiling says", (t) => {
	const { config, activeRouting } = loaded(t);

	const plan = capacityPlan({
		concurrency: { ...config.concurrency, maxTicketExecutions: 4 },
		profiles: config.profiles,
		activeRouting,
	});

	assert.equal(plan.declaredCeiling, 4, "the comfortable lie is still reported as declared");
	assert.equal(plan.effectiveConcurrency, 1, "and the truth beside it (§9.2)");
	assert.equal(plan.resourceSlots, 1);
});

// ── The pane bound is derived, never configured (§9.1) ───────────────────────

test("the pane bound is maxTicketExecutions × MAX_PANES_PER_TICKET", (t) => {
	const { config, activeRouting } = loaded(t);

	const plan = capacityPlan({
		concurrency: { ...config.concurrency, maxTicketExecutions: 3 },
		profiles: config.profiles,
		activeRouting,
	});

	assert.equal(MAX_PANES_PER_TICKET, 2, "§8.4's review fan-out owns this number");
	assert.equal(plan.paneBound, 6);
});

test("no configuration key anywhere bounds panes", (t) => {
	const config = cloneValidConfig();
	config.concurrency.maxWorkerPanes = 2;

	assert.throws(
		() => loadFactoryConfig({ cwd: makeRepo(t, { config }) }),
		(error) => error.reason === "unknown-key" && error.details.at === "concurrency.maxWorkerPanes",
	);

	assert.deepEqual(
		CONCURRENCY_KEYS,
		["maxTicketExecutions", "resources"],
		"a pane knob would deadlock the review phase at 2, 2 (§9.1)",
	);
});

// ── The route an implement attempt runs (§9.4, §11.5, §9.8) ──────────────────

/** The memo facet, reduced to the one question a route asks of it (#154). */
function memo(blocked = {}) {
	return { settle: async (className) => blocked[className] ?? { state: "available", until: null } };
}

test("the implement route is the role's own profile when no rule matches the ticket", async (t) => {
	const { config, activeRouting } = loaded(t);

	const route = await implementDispatch(
		{ profiles: config.profiles, activeRouting },
		{ labels: ["workflow:implement"] },
		{ exhaustion: memo() },
	);

	assert.equal(route.profile, "builder");
	assert.equal(route.class, "local");
	assert.equal(route.rerouted, false);
});

test("a matching rule routes the ticket to its own profile's class", async (t) => {
	const { config, activeRouting } = loaded(t, (config) => {
		config.profiles.cloud = { kind: "claude", model: "opus" };
		config.routing.rules = [{ labelsAny: ["area:ui"], role: "implement", profile: "cloud" }];
		config.concurrency.resources["claude-code"] = 1;
	});

	const route = await implementDispatch(
		{ profiles: config.profiles, activeRouting },
		{ labels: ["area:ui"] },
		{ exhaustion: memo() },
	);

	assert.equal(route.class, "claude-code");
});

test("an exhausted class steps the ticket onto the declared fallback, before any claim (#155)", async (t) => {
	const { config, activeRouting } = loaded(t, (config) => {
		config.profiles.cloud = { kind: "claude", model: "opus" };
		config.routing.fallbacks = { implement: ["cloud"] };
		config.concurrency.resources["claude-code"] = 1;
	});

	const route = await implementDispatch(
		{ profiles: config.profiles, activeRouting },
		{ ticket: 42, labels: [] },
		{ exhaustion: memo({ local: { state: "blocked", until: 900 } }) },
	);

	assert.equal(route.declared, "builder");
	assert.equal(route.profile, "cloud");
	assert.equal(route.class, "claude-code");
	assert.equal(route.rerouted, true);
});

test("a ticket matching two implement rules is refused before any work, naming both rules", async (t) => {
	const { config, activeRouting } = loaded(t, (config) => {
		config.profiles.cloud = { kind: "claude", model: "opus" };
		config.routing.rules = [
			{ labelsAny: ["area:ui"], role: "implement", profile: "cloud" },
			{ labelsAny: ["area:api"], role: "implement", profile: "builder" },
		];
		config.concurrency.resources["claude-code"] = 1;
	});

	await assert.rejects(
		() =>
			implementDispatch(
				{ profiles: config.profiles, activeRouting },
				{ ticket: 42, labels: ["area:ui", "area:api"] },
				{ exhaustion: memo() },
			),
		(error) => {
			assert.equal(error.reason, "routing-ambiguous");
			assert.equal(error.details.role, "implement");
			assert.equal(error.details.ticket, 42);
			assert.deepEqual([...error.details.profiles].sort(), ["builder", "cloud"]);
			return true;
		},
	);
});
