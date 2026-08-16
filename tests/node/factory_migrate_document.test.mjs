import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG_SCHEMA_VERSION } from "../../factory/lib/config/load.mjs";
import { LEGACY_SCHEMA_VERSION, migrateDocument } from "../../factory/lib/migrate/document.mjs";
import { cloneLegacyConfig } from "./helpers/factory-repo.mjs";

function migrate(overrides = {}, options = {}) {
	return migrateDocument({ ...cloneLegacyConfig(), ...overrides }, options);
}

/** A row by its §11.8 identity: the legacy path, or the v2 path for a hole no legacy key feeds. */
function rowFor(dispositions, key) {
	const row = dispositions.find((candidate) => (candidate.from ?? candidate.to) === key);
	assert.ok(
		row !== undefined,
		`no disposition row for "${key}"; got ${dispositions.map((r) => r.from ?? r.to).join(", ")}`,
	);
	return row;
}

// ── The version itself (§11.8) ───────────────────────────────────────────────

test("§11.8: a v1 document becomes a schemaVersion 2 document, and the version is reported", () => {
	const { document, dispositions } = migrate();

	assert.equal(LEGACY_SCHEMA_VERSION, 1);
	assert.equal(document.schemaVersion, CONFIG_SCHEMA_VERSION);
	assert.equal(document.version, undefined);
	assert.equal(rowFor(dispositions, "version").disposition, "mapped");
	assert.equal(rowFor(dispositions, "version").to, "schemaVersion");
});

test("§11.8: a document that is not v1 refuses rather than being migrated twice", () => {
	assert.throws(() => migrate({ version: undefined, schemaVersion: 2 }), {
		name: "FactoryConfigError",
		reason: "schema-version",
	});
});

// ── Mapped keys (§11.8's first row) ──────────────────────────────────────────

test("§11.8: tracker survives minus its labels, which are reported and dropped", () => {
	const { document, dispositions } = migrate();

	assert.deepEqual(document.tracker, {
		kind: "gitea",
		repo: "acme/widgets",
		remote: "gitea",
		login: "gitea",
		assignee: "factory-bot",
	});
	assert.equal(rowFor(dispositions, "tracker").disposition, "mapped");
	assert.equal(rowFor(dispositions, "tracker.labels").disposition, "dropped");
});

test("§11.8: git carries over whole", () => {
	const { document, dispositions } = migrate();

	assert.deepEqual(document.git, { baseBranch: "main", remote: "gitea" });
	assert.equal(rowFor(dispositions, "git").disposition, "mapped");
});

test("§11.8: workers.profiles becomes profiles, and every permissionMode is reported and dropped", () => {
	const { document, dispositions } = migrate();

	assert.deepEqual(document.profiles, {
		builder: { kind: "pi", model: "local/qwen3", thinking: "high" },
		reviewer: { kind: "claude", model: "opus", effort: "high" },
	});
	assert.equal(rowFor(dispositions, "workers.profiles").disposition, "mapped");

	// Named by profile: the author made a permissions decision §11.4 moved to the
	// dispatch role, and "a key vanished" is not what they need to be told.
	const permissions = rowFor(dispositions, "workers.profiles.*.permissionMode");
	assert.equal(permissions.disposition, "dropped");
	assert.match(permissions.why, /builder, reviewer/);
});

test("§11.8: a profile with no permissionMode leaves no permissions row to read", () => {
	const legacy = cloneLegacyConfig();
	for (const profile of Object.values(legacy.workers.profiles)) delete profile.permissionMode;

	const { dispositions } = migrateDocument(legacy);

	assert.equal(
		dispositions.find((row) => row.from === "workers.profiles.*.permissionMode"),
		undefined,
	);
});

// ── Reported and dropped (§11.8's second row) ────────────────────────────────

test("§11.8: herdr.maxWorkers and completion are reported and dropped, reaching no v2 key", () => {
	const { document, dispositions } = migrate();

	assert.equal(document.herdr, undefined);
	assert.equal(document.completion, undefined);
	for (const key of ["herdr.maxWorkers", "completion"]) {
		assert.equal(rowFor(dispositions, key).disposition, "dropped", key);
		assert.equal(rowFor(dispositions, key).to, null, key);
	}
});

// ── Routing (§11.5, §11.8) ───────────────────────────────────────────────────

test("§11.5: the three surviving routing defaults become roles, with review written out twice", () => {
	const { document, dispositions } = migrate();

	assert.deepEqual(document.routing.roles, {
		implement: "builder",
		freshRetry: "builder",
		// §11.5 requires two attempts written out. One legacy reviewer cannot say
		// who the second is, so the duplication is reported rather than assumed.
		review: ["reviewer", "reviewer"],
	});
	assert.equal(rowFor(dispositions, "workers.routing.defaults.review").disposition, "mapped");
	assert.match(rowFor(dispositions, "workers.routing.defaults.review").why, /twice/);
});

test("§11.5: finalReview is reported and dropped — §8.1's pipeline has no such phase", () => {
	const { document, dispositions } = migrate();

	assert.equal(document.routing.roles.finalReview, undefined);
	assert.equal(rowFor(dispositions, "workers.routing.defaults.finalReview").disposition, "dropped");
});

test("§11.8: the legacy rules are a TODO hole naming how many there were, never auto-carried", () => {
	const { document, dispositions } = migrate();

	assert.match(document.routing.rules, /^TODO\b/);
	// The count is what tells a human the re-authoring is not finished; a machine
	// cannot pick which ticket labels were meant to survive.
	assert.match(document.routing.rules, /1 legacy rule/);
	assert.equal(rowFor(dispositions, "workers.routing.rules").disposition, "todo");
});

test("§11.5: _postSubscription becomes a first-class named set, left as a TODO hole", () => {
	const { document, dispositions } = migrate();

	assert.match(document.routing.sets["post-subscription"], /^TODO\b/);
	const row = rowFor(dispositions, "_postSubscription");
	assert.equal(row.disposition, "todo");
	assert.equal(row.to, "routing.sets.post-subscription");
});

test("§11.8: a legacy file with no _postSubscription gets no named set and no row", () => {
	const legacy = cloneLegacyConfig();
	delete legacy._postSubscription;

	const { document, dispositions } = migrateDocument(legacy);

	assert.equal(document.routing.sets, undefined);
	assert.equal(dispositions.find((row) => row.from === "_postSubscription"), undefined);
});

// ── Budgets, concurrency, checks (§11.6, §11.8) ──────────────────────────────

test("§11.8: retry becomes budgets, and the automation budget is a TODO hole", () => {
	const { document, dispositions } = migrate();

	assert.equal(document.budgets.repair, 2);
	assert.equal(document.budgets.freshRetry, 3);
	assert.match(document.budgets.automation, /^TODO\b/);

	assert.equal(rowFor(dispositions, "retry.repairAttempts").to, "budgets.repair");
	assert.equal(rowFor(dispositions, "retry.freshAgentRetries").to, "budgets.freshRetry");
	assert.equal(rowFor(dispositions, "budgets.automation").disposition, "todo");
	assert.equal(rowFor(dispositions, "budgets.automation").from, null);
});

test("§11.8: concurrency is a TODO hole — a machine cannot pick the sizes", () => {
	const { document, dispositions } = migrate();

	assert.match(document.concurrency, /^TODO\b/);
	assert.equal(rowFor(dispositions, "concurrency").disposition, "todo");
});

test("§11.6: checks are generated from the mandatory-commands matrix, every judgement left open", () => {
	const { document, dispositions } = migrate(
		{},
		{
			matrix: {
				path: "AGENTS.md",
				commands: [
					{ label: "Full Python test suite", command: "uv run pytest" },
					{ label: "Node extension tests", command: "node --test tests/node/*.mjs" },
				],
			},
		},
	);

	assert.equal(document.checks.length, 2);
	assert.equal(document.checks[0].name, "full-python-test-suite");
	assert.equal(document.checks[0].command, "uv run pytest");
	// The three fields no matrix can answer stay holes: a defaulted
	// `expectedFailureExitCodes` misclassifies infrastructure breakage as worker
	// blame on exactly the check nobody thought about (§11.6).
	for (const field of ["timeout", "severity", "expectedFailureExitCodes"]) {
		assert.match(document.checks[0][field], /^TODO\b/, field);
	}

	const row = rowFor(dispositions, "checks");
	assert.equal(row.disposition, "todo");
	assert.match(row.why, /AGENTS\.md/);
	assert.match(row.why, /human review/);
});

test("§11.6: with no matrix to read, checks is a bare TODO hole rather than an invented list", () => {
	const { document, dispositions } = migrate({}, { matrix: null });

	assert.match(document.checks, /^TODO\b/);
	assert.equal(rowFor(dispositions, "checks").disposition, "todo");
});

// ── Keys the table does not name (§11.2) ─────────────────────────────────────

test("§11.2: a legacy key the table does not name refuses the migration rather than vanishing", () => {
	assert.throws(() => migrate({ mystery: { size: 3 } }), {
		name: "FactoryConfigError",
		reason: "unknown-key",
		details: { at: "mystery" },
	});
});

test("§11.8: the whole disposition list is the report — every tabulated key, once", () => {
	const { dispositions } = migrate({}, { matrix: { path: "AGENTS.md", commands: [] } });

	assert.deepEqual(
		dispositions.map((row) => [row.from ?? row.to, row.disposition]),
		[
			["version", "mapped"],
			["tracker", "mapped"],
			["tracker.labels", "dropped"],
			["git", "mapped"],
			["herdr.maxWorkers", "dropped"],
			["workers.profiles", "mapped"],
			["workers.profiles.*.permissionMode", "dropped"],
			["workers.routing.defaults.implement", "mapped"],
			["workers.routing.defaults.freshRetry", "mapped"],
			["workers.routing.defaults.review", "mapped"],
			["workers.routing.defaults.finalReview", "dropped"],
			["workers.routing.rules", "todo"],
			["_postSubscription", "todo"],
			["retry.repairAttempts", "mapped"],
			["retry.freshAgentRetries", "mapped"],
			["completion", "dropped"],
			["budgets.automation", "todo"],
			["checks", "todo"],
			["concurrency", "todo"],
		],
	);
});

test("§11.2: an unnamed key inside a container the migration reads refuses too", () => {
	const legacy = cloneLegacyConfig();
	legacy.retry.giveUpAfter = 5;

	assert.throws(() => migrateDocument(legacy), {
		name: "FactoryConfigError",
		reason: "unknown-key",
		details: { at: "retry.giveUpAfter" },
	});
});
