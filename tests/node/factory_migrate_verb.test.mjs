import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { EXIT_USAGE } from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { PRESERVED_LEGACY_BASENAME } from "../../factory/lib/migrate/document.mjs";
import { runMigrate } from "../../factory/lib/migrate/verb.mjs";
import { cloneLegacyConfig, cloneValidConfig, factorySources, makeRepo } from "./helpers/factory-repo.mjs";

const AGENTS = `## Mandatory commands

- Node extension tests: \`node --test tests/node/*.mjs\`
`;

/** A repository holding the legacy file, plus the matrix §11.6 generates checks from. */
function legacyRepo(t, { config = cloneLegacyConfig(), agents = AGENTS } = {}) {
	const root = makeRepo(t, { config });
	if (agents !== null) writeFileSync(join(root, "AGENTS.md"), agents, "utf8");
	return root;
}

function configAt(root) {
	return JSON.parse(readFileSync(join(root, ".pi", "factory.json"), "utf8"));
}

/**
 * The five §11.8 holes, resolved the way a human would — which is the only
 * evidence that what migration wrote is otherwise a loadable v2 config.
 */
function resolveHoles(document) {
	document.checks = [
		{ name: "node", command: "node --test tests/node/*.mjs", timeout: 600, severity: "required", expectedFailureExitCodes: [1] },
	];
	document.budgets.automation = 1;
	document.concurrency = { maxTicketExecutions: 1, resources: { local: 1, "claude-code": 1 } };
	document.routing.rules = [];
	document.routing.sets["post-subscription"] = {
		roles: { implement: "builder", freshRetry: "builder", review: ["builder", "builder"] },
		rules: [],
	};
	return document;
}

// ── The rewrite (§11.8) ──────────────────────────────────────────────────────

test("§11.8: migrate rewrites the config as schemaVersion 2 and preserves the file it replaced", async (t) => {
	const root = legacyRepo(t);

	const answered = await runMigrate({ cwd: root });

	assert.equal(answered.error, undefined);
	assert.equal(configAt(root).schemaVersion, 2);
	// The v1 file is the only record of the rules and the dormant set a human now
	// has to re-author, so migration keeps it rather than consuming it.
	const preserved = JSON.parse(readFileSync(join(root, ".pi", PRESERVED_LEGACY_BASENAME), "utf8"));
	assert.deepEqual(preserved, cloneLegacyConfig());
	assert.equal(answered.report.preserved.endsWith(PRESERVED_LEGACY_BASENAME), true);
});

test("§11.2: the file migrate writes does not load — the holes hard-fail until a human resolves them", async (t) => {
	const root = legacyRepo(t);

	await runMigrate({ cwd: root });

	assert.throws(() => loadFactoryConfig({ cwd: root }), { name: "FactoryConfigError", reason: "todo-sentinel" });
});

test("§11.8: with every hole resolved, what migrate wrote is a config that loads", async (t) => {
	const root = legacyRepo(t);

	await runMigrate({ cwd: root });
	writeFileSync(join(root, ".pi", "factory.json"), JSON.stringify(resolveHoles(configAt(root)), null, 2), "utf8");

	const loaded = loadFactoryConfig({ cwd: root });

	assert.equal(loaded.config.tracker.repo, "acme/widgets");
	assert.deepEqual(loaded.config.routing.roles.review, ["reviewer", "reviewer"]);
	assert.equal(loaded.config.budgets.repair, 2);
	assert.equal(loaded.config.profiles.builder.thinking, "high");
});

test("§8.6: a legacy budget the new ceiling forbids is carried, never clamped, and the loader says so", async (t) => {
	const legacy = cloneLegacyConfig();
	legacy.retry.freshAgentRetries = 3;
	const root = legacyRepo(t, { config: legacy });

	await runMigrate({ cwd: root });
	writeFileSync(join(root, ".pi", "factory.json"), JSON.stringify(resolveHoles(configAt(root)), null, 2), "utf8");

	// Clamping to the ceiling would be the run behaving differently from what the
	// operator can read on disk — §11.2's silent guess, wearing a helpful face.
	assert.throws(() => loadFactoryConfig({ cwd: root }), (error) => {
		assert.equal(error.name, "FactoryConfigError");
		assert.equal(error.details.at, "budgets.freshRetry");
		assert.equal(error.details.found, 3);
		return true;
	});
});

test("§11.8: the full disposition list is the report, and the holes are named", async (t) => {
	const root = legacyRepo(t);

	const { message, report } = await runMigrate({ cwd: root });

	assert.equal(report.dispositions.length, 19);
	assert.deepEqual(report.holes, [
		"routing.rules",
		"routing.sets.post-subscription",
		"budgets.automation",
		"checks",
		"concurrency",
	]);
	assert.match(message, /schemaVersion 2/);
	// A count an operator can act on: what moved, what went, what is still owed.
	assert.match(message, /5 TODO/);
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test("§11.8: a v2 config refuses, leaving the file exactly as it was", async (t) => {
	const root = legacyRepo(t, { config: cloneValidConfig() });
	const before = readFileSync(join(root, ".pi", "factory.json"), "utf8");

	const { error, exitCode } = await runMigrate({ cwd: root });

	assert.equal(error.kind, "schema-version");
	assert.notEqual(exitCode, 0);
	assert.equal(readFileSync(join(root, ".pi", "factory.json"), "utf8"), before);
});

test("a preserved copy that already exists refuses rather than being overwritten", async (t) => {
	const root = legacyRepo(t);
	writeFileSync(join(root, ".pi", PRESERVED_LEGACY_BASENAME), '{"mine": true}\n', "utf8");
	const before = readFileSync(join(root, ".pi", "factory.json"), "utf8");

	const { error } = await runMigrate({ cwd: root });

	assert.equal(error.kind, "preserved-copy-exists");
	assert.equal(readFileSync(join(root, ".pi", PRESERVED_LEGACY_BASENAME), "utf8"), '{"mine": true}\n');
	assert.equal(readFileSync(join(root, ".pi", "factory.json"), "utf8"), before);
});

test("no config file is a refusal naming the path, not an invented one", async (t) => {
	const root = makeRepo(t, { config: null });

	const { error } = await runMigrate({ cwd: root });

	assert.equal(error.kind, "file-missing");
});

test("§11.2: a legacy key §11.8's table does not name refuses before anything is written", async (t) => {
	const legacy = cloneLegacyConfig();
	legacy.deploy = { target: "prod" };
	const root = legacyRepo(t, { config: legacy });

	const { error } = await runMigrate({ cwd: root });

	assert.equal(error.kind, "unknown-key");
	assert.equal(error.at, "deploy");
	assert.throws(() => readFileSync(join(root, ".pi", PRESERVED_LEGACY_BASENAME), "utf8"));
});

// ── Where migration sits (§10.2, §11.6) ──────────────────────────────────────

test("§10.2: migrate is its own verb, never a flag on doctor", async (t) => {
	const root = legacyRepo(t, { config: cloneValidConfig() });

	const { exitCode, value } = await runCli(["doctor", "--migrate"], { cwd: root });

	// Doctor's invariant is that it appends nothing in either mode; migration
	// writes the operator's own config file. One verb for both would mean
	// doctor's read-only reputation needed an asterisk.
	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--migrate");
});

test("§11.6: AGENTS.md is named in code by migration alone — never parsed at runtime", () => {
	const named = factorySources()
		.filter(([, source]) => source.includes('"AGENTS.md"'))
		.map(([path]) => path)
		.sort();

	// Two files, for two unrelated reasons, and neither is an agreement check:
	// migration reads the matrix **once, for human review**, and the worker
	// environment *writes* the isolated harness its own context file. A third
	// name here would be the runtime parser §8.2 ruled out.
	assert.deepEqual(named, [join("lib", "migrate", "matrix.mjs"), join("lib", "worker", "environment.mjs")]);
});

// ── Legacy run artifacts (§11.8, §12.8) ──────────────────────────────────────

test("§11.8: legacy run artifacts are neither imported nor deleted", async (t) => {
	const root = legacyRepo(t);
	const worktree = join(root, ".worktrees", "factory-20260101-abc123");
	mkdirSync(worktree, { recursive: true });
	writeFileSync(join(worktree, "keep.txt"), "operator's\n", "utf8");

	const { report } = await runMigrate({ cwd: root });

	assert.equal(readFileSync(join(worktree, "keep.txt"), "utf8"), "operator's\n");
	// And nothing in the new config points at them: reporting them is `doctor`'s
	// job, and reclaiming them is `cleanup-plan`'s reviewed decision (§12.8).
	assert.equal(JSON.stringify(configAt(root)).includes("factory-20260101"), false);
	assert.equal(JSON.stringify(report).includes("factory-20260101"), false);
});
