import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { MAX_SUPPORTED_TICKET_CONCURRENCY } from "../../factory/lib/config/concurrency.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { resourceClassOf } from "../../factory/lib/config/profiles.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { cloneValidConfig as clone, factorySources, makeRepo } from "./helpers/factory-repo.mjs";

/**
 * §11.3–§11.6 block semantics: a config that loads is coherent, not merely
 * well-formed. Every refusal here happens at load time, without a ticket, a
 * tracker, or a run.
 */

function loadFailure(t, config, { routingSet = null } = {}) {
	const root = makeRepo(t, { config });
	try {
		loadFactoryConfig({ cwd: root, routingSet });
	} catch (error) {
		return error;
	}
	throw new assert.AssertionError({ message: "expected a load failure" });
}

function loaded(t, config, { routingSet = null } = {}) {
	return loadFactoryConfig({ cwd: makeRepo(t, { config }), routingSet });
}

// ── Checks: five fields, none of them defaulted (§11.6) ──────────────────────

test("every check declares all five fields, and a missing one names itself", (t) => {
	for (const field of ["name", "command", "timeout", "severity", "expectedFailureExitCodes"]) {
		const config = clone();
		delete config.checks[0][field];

		const error = loadFailure(t, config);

		assert.equal(error.reason, "missing-key", `checks[0].${field}`);
		assert.equal(error.details.at, `checks[0].${field}`);
	}
});

test("expectedFailureExitCodes has no default — omitting it is not an empty set", (t) => {
	const config = clone();
	delete config.checks[0].expectedFailureExitCodes;

	const error = loadFailure(t, config);

	assert.match(error.message, /no default/);
	assert.match(error.message, /this check is broken|infrastructure/i);
});

test("a check severity outside required|advisory refuses and names both words", (t) => {
	const config = clone();
	config.checks[0].severity = "blocking";

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "checks[0].severity");
	assert.equal(error.details.expected, "required|advisory");
});

test("an unknown key inside a check refuses and names its path", (t) => {
	const config = clone();
	config.checks[0].parallelSafe = true;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "checks[0].parallelSafe");
});

test("expectedFailureExitCodes must hold distinct non-zero exit codes", (t) => {
	for (const codes of [[0, 1], [1, 1], ["1"], 1]) {
		const config = clone();
		config.checks[0].expectedFailureExitCodes = codes;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "invalid-value", JSON.stringify(codes));
		assert.match(error.details.at, /^checks\[0\]\.expectedFailureExitCodes/);
	}
});

test("an explicitly empty expectedFailureExitCodes set is a visible choice, not a default", (t) => {
	const config = clone();
	config.checks[0].expectedFailureExitCodes = [];

	assert.deepEqual(loaded(t, config).config.checks[0].expectedFailureExitCodes, []);
});

test("a check timeout must be a positive integer of seconds", (t) => {
	for (const timeout of [0, -1, 1.5, "600"]) {
		const config = clone();
		config.checks[0].timeout = timeout;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "invalid-value", String(timeout));
		assert.equal(error.details.at, "checks[0].timeout");
	}
});

test("two checks sharing a name refuse — a check is identified by its name", (t) => {
	const config = clone();
	config.checks.push({ ...config.checks[0], command: "uv run pytest tests/other" });

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "checks[1].name");
});

test("an empty checks list refuses — a run with no declared checks verifies nothing", (t) => {
	const config = clone();
	config.checks = [];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "missing-key");
	assert.equal(error.details.at, "checks");
});

// ── Budgets: 1/1/1, ceiling 2 + 2 (§8.6, §11.6) ──────────────────────────────

test("an omitted budgets block loads as 1 repair, 1 fresh-retry, 1 automation", (t) => {
	const config = clone();
	delete config.budgets;

	assert.deepEqual(loaded(t, config).config.budgets, { repair: 1, freshRetry: 1, automation: 1 });
});

test("a budget declared alone leaves the other two at their upstream-fixed default", (t) => {
	const config = clone();
	config.budgets = { automation: 2 };

	assert.deepEqual(loaded(t, config).config.budgets, { repair: 1, freshRetry: 1, automation: 2 });
});

test("a budget above the hard ceiling of 2 + 2 refuses and names the ceiling", (t) => {
	for (const key of ["repair", "freshRetry", "automation"]) {
		const config = clone();
		config.budgets[key] = 3;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "invalid-value", key);
		assert.equal(error.details.at, `budgets.${key}`);
		assert.match(error.message, /between 1 and 2/);
	}
});

test("a budget of zero refuses — the floor is one attempt, not none", (t) => {
	const config = clone();
	config.budgets.repair = 0;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "budgets.repair");
});

test("an unknown budgets key refuses — replanCount has no home here", (t) => {
	const config = clone();
	config.budgets.replanCount = 5;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "budgets.replanCount");
});

// ── Retention: two numbers, floor 1, no reachable pin (§12.10, §14.32) ───────

test("an omitted retention block loads as 20 runs and 30 days", (t) => {
	const config = clone();
	delete config.retention;

	assert.deepEqual(loaded(t, config).config.retention, { fullDetailRuns: 20, fullDetailDays: 30 });
});

test("a retention number below its floor of 1 refuses and names it", (t) => {
	for (const key of ["fullDetailRuns", "fullDetailDays"]) {
		const config = clone();
		config.retention[key] = 0;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "invalid-value", key);
		assert.equal(error.details.at, `retention.${key}`);
	}
});

test("retention configuration is exactly two numbers — no pin is reachable from it", (t) => {
	for (const key of ["pins", "pinFailedRuns", "artifactStoreRoot", "maxBytes"]) {
		const config = clone();
		config.retention[key] = 1;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "unknown-key", key);
		assert.equal(error.details.at, `retention.${key}`);
	}
});

// ── Profiles: kind, model, and nothing that alters permissions (§11.4) ───────

test("a profile declares kind and model, and a missing one refuses", (t) => {
	for (const key of ["kind", "model"]) {
		const config = clone();
		delete config.profiles.builder[key];

		const error = loadFailure(t, config);

		assert.equal(error.reason, "missing-key", key);
		assert.equal(error.details.at, `profiles.builder.${key}`);
	}
});

test("permissionMode is not author-controllable and refuses by name", (t) => {
	const config = clone();
	config.profiles.builder.permissionMode = "dontAsk";

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "profiles.builder.permissionMode");
	assert.match(error.message, /role/i);
});

test("an empty profiles block refuses — routing has nothing to name", (t) => {
	const config = clone();
	config.profiles = {};

	const error = loadFailure(t, config);

	assert.equal(error.reason, "missing-key");
	assert.equal(error.details.at, "profiles");
});

test("a pi profile carries thinking and a Claude profile carries effort, never the reverse", (t) => {
	const wrong = [
		["profiles.builder.effort", (config) => (config.profiles.builder.effort = "high")],
		[
			"profiles.reviewer.thinking",
			(config) => {
				config.profiles.reviewer = { kind: "claude", model: "opus", thinking: "high" };
			},
		],
	];

	for (const [at, break_] of wrong) {
		const config = clone();
		break_(config);

		const error = loadFailure(t, config);

		assert.equal(error.reason, "unknown-key", at);
		assert.equal(error.details.at, at);
	}
});

test("a pi profile's model must be an exact provider/model selector", (t) => {
	const config = clone();
	config.profiles.builder.model = "qwen3";

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "profiles.builder.model");
});

// ── Opus and Fable are Claude-only, checked at load (§11.5) ──────────────────

test("Opus or Fable on a kind: pi profile refuses and names the offending profile", (t) => {
	for (const model of ["anthropic/claude-opus-5", "openrouter/anthropic/fable-5", "local/OPUS-clone"]) {
		const config = clone();
		config.profiles.builder.model = model;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "model-unsupported", model);
		assert.equal(error.details.at, "profiles.builder.model");
		assert.match(error.message, /builder/);
		assert.match(error.message, /kind: ?claude|Claude/);
	}
});

test("Opus on a kind: claude profile is exactly how it is reached", (t) => {
	const config = clone();
	config.profiles.reviewer = { kind: "claude", model: "opus", effort: "high" };
	config.routing.roles.review = ["reviewer", "reviewer"];
	config.concurrency.resources["claude-code"] = 2;

	assert.equal(loaded(t, config).config.profiles.reviewer.model, "opus");
});

// ── Resource classes are derived, never declared per profile (§9.1) ──────────

test("a pi profile's resource class is the provider segment of its model id", () => {
	assert.equal(resourceClassOf({ kind: "pi", model: "local/thinkingcap-qwen3.6-27b" }), "local");
	assert.equal(resourceClassOf({ kind: "pi", model: "openrouter/z-ai/glm-5.2" }), "openrouter");
});

test("every Claude profile shares the one claude-code class, whatever its model", () => {
	assert.equal(resourceClassOf({ kind: "claude", model: "opus" }), "claude-code");
	assert.equal(resourceClassOf({ kind: "claude", model: "fable" }), "claude-code");
});

// ── Routing: three roles, no implicit fallback, review written twice (§11.5) ──

test("all three routing roles are required, and a missing one refuses by name", (t) => {
	for (const role of ["implement", "freshRetry", "review"]) {
		const config = clone();
		delete config.routing.roles[role];

		const error = loadFailure(t, config);

		assert.equal(error.reason, "missing-key", role);
		assert.equal(error.details.at, `routing.roles.${role}`);
	}
});

test("an absent freshRetry is never filled in from implement", (t) => {
	const config = clone();
	delete config.routing.roles.freshRetry;

	const error = loadFailure(t, config);

	assert.match(error.message, /no implicit fallback|never inferred|has no default/i);
});

test("review is two entries, and one entry is not expanded into two", (t) => {
	for (const review of ["builder", ["builder"], ["builder", "builder", "builder"]]) {
		const config = clone();
		config.routing.roles.review = review;

		const error = loadFailure(t, config);

		assert.equal(error.reason, "invalid-value", JSON.stringify(review));
		assert.equal(error.details.at, "routing.roles.review");
		assert.match(error.message, /two/);
	}
});

test("naming the same profile for both review attempts is a legal, visible choice", (t) => {
	const config = clone();
	config.routing.roles.review = ["builder", "builder"];

	assert.deepEqual(loaded(t, config).activeRouting.roles.review, ["builder", "builder"]);
});

test("a role naming a profile the config does not declare refuses", (t) => {
	const config = clone();
	config.routing.roles.implement = "gpt";

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "routing.roles.implement");
	assert.match(error.message, /gpt/);
});

test("repair is not routable — naming it as a role refuses", (t) => {
	const config = clone();
	config.routing.roles.repair = "builder";

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "routing.roles.repair");
});

// ── Rules: labelsAny × role → profile, overlap-free at load (§11.5) ──────────

test("a rule declares exactly labelsAny, role, and profile", (t) => {
	const config = clone();
	config.routing.rules = [{ labelsAny: ["risk:high"], phases: ["implement"], profile: "builder" }];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "routing.rules[0].phases");
});

test("a rule for the review role names two profiles, like the role itself", (t) => {
	const config = clone();
	config.routing.rules = [{ labelsAny: ["risk:high"], role: "review", profile: "builder" }];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "routing.rules[0].profile");
	assert.match(error.message, /two/);
});

test("rules whose labelsAny sets intersect for the same role refuse without any ticket", (t) => {
	const config = clone();
	config.routing.rules = [
		{ labelsAny: ["risk:high", "factory:local"], role: "implement", profile: "builder" },
		{ labelsAny: ["factory:local"], role: "implement", profile: "builder" },
	];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "routing-overlap");
	assert.equal(error.details.at, "routing.rules[1]");
	assert.equal(error.details.role, "implement");
	assert.deepEqual(error.details.labels, ["factory:local"]);
});

test("the same label routed for two different roles is not an overlap", (t) => {
	const config = clone();
	config.routing.rules = [
		{ labelsAny: ["risk:high"], role: "implement", profile: "builder" },
		{ labelsAny: ["risk:high"], role: "freshRetry", profile: "builder" },
		{ labelsAny: ["risk:high"], role: "review", profile: ["builder", "builder"] },
	];

	assert.equal(loaded(t, config).activeRouting.rules.length, 3);
});

test("a rule naming an undeclared profile refuses", (t) => {
	const config = clone();
	config.routing.rules = [{ labelsAny: ["risk:high"], role: "implement", profile: "glm" }];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "routing.rules[0].profile");
});

test("a rule with an empty labelsAny refuses — it would match every ticket", (t) => {
	const config = clone();
	config.routing.rules = [{ labelsAny: [], role: "implement", profile: "builder" }];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "routing.rules[0].labelsAny");
});

// ── Named sets: first-class, never dormant (§11.5) ───────────────────────────

test("a named set is selectable per run and becomes the active routing", (t) => {
	const config = clone();
	config.profiles.remote = { kind: "pi", model: "openrouter/glm-5.2" };
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "remote", freshRetry: "remote", review: ["remote", "remote"] },
			rules: [],
		},
	};
	config.concurrency.resources.openrouter = 2;

	const root = makeRepo(t, { config });
	const active = loadFactoryConfig({ cwd: root, routingSet: "post-subscription" });
	const default_ = loadFactoryConfig({ cwd: root });

	assert.equal(active.activeRouting.set, "post-subscription");
	assert.equal(active.activeRouting.roles.implement, "remote");
	assert.equal(default_.activeRouting.set, null);
	assert.equal(default_.activeRouting.roles.implement, "builder");
});

test("selecting a set the config does not declare refuses and lists the declared ones", (t) => {
	const config = clone();
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "builder", freshRetry: "builder", review: ["builder", "builder"] },
			rules: [],
		},
	};

	const error = loadFailure(t, config, { routingSet: "pre-subscription" });

	assert.equal(error.reason, "unknown-routing-set");
	assert.match(error.message, /post-subscription/);
});

test("a named set is validated as strictly as the active one — dormant config still refuses", (t) => {
	const config = clone();
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "builder", freshRetry: "builder", review: ["builder", "builder"] },
			rules: [
				{ labelsAny: ["risk:high"], role: "implement", profile: "builder" },
				{ labelsAny: ["risk:high"], role: "implement", profile: "builder" },
			],
		},
	};

	const error = loadFailure(t, config);

	assert.equal(error.reason, "routing-overlap");
	assert.match(error.details.at, /^routing\.sets\.post-subscription\.rules\[1\]$/);
});

test("a named set missing a role refuses like the active routing does", (t) => {
	const config = clone();
	config.routing.sets = {
		"post-subscription": { roles: { implement: "builder", review: ["builder", "builder"] }, rules: [] },
	};

	const error = loadFailure(t, config);

	assert.equal(error.reason, "missing-key");
	assert.equal(error.details.at, "routing.sets.post-subscription.roles.freshRetry");
});

// ── Concurrency: both keys declared, the ceiling enforced here only (§9.3) ────

test("both concurrency keys are required with no default", (t) => {
	for (const key of ["maxTicketExecutions", "resources"]) {
		const config = clone();
		delete config.concurrency[key];

		const error = loadFailure(t, config);

		assert.equal(error.reason, "missing-key", key);
		assert.equal(error.details.at, `concurrency.${key}`);
	}
});

test("MAX_SUPPORTED_TICKET_CONCURRENCY is 1 in v1", () => {
	assert.equal(MAX_SUPPORTED_TICKET_CONCURRENCY, 1);
});

test("maxTicketExecutions of 2 is a hard load failure naming the constant and the suite that raises it", (t) => {
	const config = clone();
	config.concurrency.maxTicketExecutions = 2;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "concurrency-ceiling");
	assert.equal(error.details.at, "concurrency.maxTicketExecutions");
	assert.equal(error.details.expected, MAX_SUPPORTED_TICKET_CONCURRENCY);
	assert.match(error.message, /MAX_SUPPORTED_TICKET_CONCURRENCY/);
	assert.match(error.message, /acceptance suite|§15/);
});

test("maxTicketExecutions below 1 refuses too", (t) => {
	const config = clone();
	config.concurrency.maxTicketExecutions = 0;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "concurrency.maxTicketExecutions");
});

test("the ceiling constant is read by the loader and by nothing else", () => {
	const readers = factorySources()
		.filter(([, source]) => source.includes("MAX_SUPPORTED_TICKET_CONCURRENCY"))
		.map(([path]) => path);

	assert.deepEqual(readers, ["lib/config/concurrency.mjs"]);
});

// ── Resource classes: sized where they run, declared only where reachable ────

test("every declared resource size is at least 1", (t) => {
	const config = clone();
	config.concurrency.resources.local = 0;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "concurrency.resources.local");
});

test("a class the active routing reaches with no declared size refuses — never an assumed 1", (t) => {
	const config = clone();
	config.profiles.reviewer = { kind: "claude", model: "opus" };
	config.routing.roles.review = ["reviewer", "reviewer"];

	const error = loadFailure(t, config);

	assert.equal(error.reason, "resource-unsized");
	assert.equal(error.details.at, "concurrency.resources.claude-code");
	assert.match(error.message, /reviewer/);
});

test("a class no declared set reaches refuses — dead config lies about what will run", (t) => {
	const config = clone();
	config.concurrency.resources.openrouter = 2;

	const error = loadFailure(t, config);

	assert.equal(error.reason, "resource-unreachable");
	assert.equal(error.details.at, "concurrency.resources.openrouter");
});

test("a class only a dormant named set reaches may be sized today", (t) => {
	const config = clone();
	config.profiles.remote = { kind: "pi", model: "openrouter/glm-5.2" };
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "remote", freshRetry: "remote", review: ["remote", "remote"] },
			rules: [],
		},
	};
	config.concurrency.resources.openrouter = 2;

	assert.equal(loaded(t, config).config.concurrency.resources.openrouter, 2);
});

test("a class only a dormant named set reaches may also stay unsized", (t) => {
	const config = clone();
	config.profiles.remote = { kind: "pi", model: "openrouter/glm-5.2" };
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "remote", freshRetry: "remote", review: ["remote", "remote"] },
			rules: [],
		},
	};

	assert.deepEqual(loaded(t, config).config.concurrency.resources, { local: 1 });
});

test("selecting a set makes its classes the ones that must be sized", (t) => {
	const config = clone();
	config.profiles.remote = { kind: "pi", model: "openrouter/glm-5.2" };
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "remote", freshRetry: "remote", review: ["remote", "remote"] },
			rules: [],
		},
	};

	const error = loadFailure(t, config, { routingSet: "post-subscription" });

	assert.equal(error.reason, "resource-unsized");
	assert.equal(error.details.at, "concurrency.resources.openrouter");
});

// ── The label vocabulary is code, not configuration (§3.2, §11.3) ────────────

test("the factory's label vocabulary is a frozen constant naming every tracker marker", () => {
	assert.deepEqual({ ...FACTORY_LABELS }, {
		implementation: "workflow:implement",
		readyForAgent: "ready-for-agent",
		readyForHuman: "ready-for-human",
		needsHuman: "factory:needs-human",
		failed: "factory:failed",
		awaitingMerge: "factory:awaiting-merge",
	});
	assert.ok(Object.isFrozen(FACTORY_LABELS));
});

test("tracker.labels refuses by pointing at the constants that replaced it", (t) => {
	const config = clone();
	config.tracker.labels = { readyForAgent: "agent-ready" };

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "tracker.labels");
	assert.match(error.message, /constants in code/);
});

test("no label string reaches the factory from anywhere but the vocabulary module", () => {
	for (const [path, source] of factorySources()) {
		if (path === "lib/tracker/labels.mjs") continue;

		for (const label of Object.values(FACTORY_LABELS)) {
			assert.ok(
				!source.includes(`"${label}"`),
				`${path} hardcodes the label "${label}" outside lib/tracker/labels.mjs`,
			);
		}
	}
});

test("herdr.maxWorkers is not an accepted key — §9 replaced it", (t) => {
	const config = clone();
	config.herdr = { maxWorkers: 2 };

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "herdr");
});

// ── The package expectation is declared; the digest is observed (§11.7) ──────

test("package.expect declares a name and a version, and refuses anything else", (t) => {
	const config = clone();
	config.package = { expect: { name: "oh-my-slop", version: ">=0.1.0", digest: "sha256:beef" } };

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "package.expect.digest");
	assert.match(error.message, /observ/i);
});

test("a package block with a name and version loads", (t) => {
	const config = clone();
	config.package = { expect: { name: "oh-my-slop", version: "0.1.0" } };

	assert.deepEqual(loaded(t, config).config.package, { expect: { name: "oh-my-slop", version: "0.1.0" } });
});

test("a version expectation the factory cannot compare against is a load failure, not a preflight surprise", (t) => {
	const config = clone();
	config.package = { expect: { name: "oh-my-slop", version: "1.2.3 - 2.0.0" } };

	// §11.2: the loader is where a declaration nobody can act on stops. Left to
	// preflight, a hyphen range would match nothing and reach the operator as a
	// version mismatch they cannot fix by changing the version.
	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "package.expect.version");
});

test("a package block with no expectation refuses — it declares nothing", (t) => {
	const config = clone();
	config.package = {};

	const error = loadFailure(t, config);

	assert.equal(error.reason, "missing-key");
	assert.equal(error.details.at, "package.expect");
});

// ── The worker block: §6.8's declared per-run overrides ──────────────────────

test("an absent worker block is no overrides, spelled once so no caller branches on undefined", (t) => {
	const { config } = loaded(t, clone());

	assert.deepEqual(config.worker, { denies: [], contextFile: null, piExtensions: [] });
});

test("declared overrides survive the load exactly as written", (t) => {
	const config = clone();
	config.worker = { denies: ["Bash(curl:*)"], contextFile: "docs/worker-context.md", piExtensions: ["/ext/index.ts"] };

	const loadedConfig = loaded(t, config);

	assert.deepEqual(loadedConfig.config.worker.denies, ["Bash(curl:*)"]);
	assert.equal(loadedConfig.config.worker.contextFile, "docs/worker-context.md");
	assert.deepEqual(loadedConfig.config.worker.piExtensions, ["/ext/index.ts"]);
	// Unlike `budgets`, these need no declared-key list: the absent form of each
	// is empty, so the validated value already says whether anything was declared.
	assert.equal(loadedConfig.declared.worker, undefined);
});

test("a cwd-relative extension path is refused: config takes no ambient input", (t) => {
	const config = clone();
	config.worker = { piExtensions: ["extensions/local-router/index.ts"] };

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "worker.piExtensions[0]");
	assert.match(error.message, /where the binary was invoked from/);
});

test("a per-run override that is really a subtraction is refused at load, in the deny floor's own words", (t) => {
	const config = clone();
	config.worker = { denies: ["!Bash(git push:*)"] };

	const error = loadFailure(t, config);

	assert.equal(error.reason, "invalid-value");
	assert.equal(error.details.at, "worker.denies");
	assert.match(error.message, /there is no channel for one/);
});

test("a context file pointing outside the repository is refused: evidence has to be part of the repository", (t) => {
	for (const path of ["/etc/passwd", "../elsewhere/rules.md"]) {
		const config = clone();
		config.worker = { contextFile: path };

		const error = loadFailure(t, config);

		assert.equal(error.details.at, "worker.contextFile", path);
	}
});

test("an unknown key in the worker block refuses, like every other block", (t) => {
	const config = clone();
	config.worker = { permissionMode: "bypassPermissions" };

	const error = loadFailure(t, config);

	assert.equal(error.reason, "unknown-key");
	assert.equal(error.details.at, "worker.permissionMode");
});
