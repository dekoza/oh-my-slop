import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_NOT_IMPLEMENTED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from "../../factory/lib/cli/exit-codes.mjs";
import { renderHuman, renderJson, runCli, VERBS } from "../../factory/lib/cli/main.mjs";
import { VERB_TABLE } from "../../factory/lib/cli/verbs.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { cloneLegacyConfig, makeRepo, VALID_CONFIG } from "./helpers/factory-repo.mjs";
import { herdrAnswering, leaseIdentity, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN_PATH = join(REPO_ROOT, "factory", "bin", "factory.mjs");

/** The §10.2 property: no fact reaches one rendering and misses the other. */
function assertRenderingsAgree(value) {
	const human = renderHuman(value);

	assert.doesNotMatch(human, /^\s*[{[]/, "human output is not JSON");
	for (const [path, leaf] of leaves(value)) {
		// `schema_version`, `command`, `ok`, and `exit_code` are envelope: the
		// version is a machine contract, the command is what the operator just
		// typed, and the exit status *is* the human rendering of the verdict —
		// the shell shows it without the page having to repeat it.
		if (path === "schema_version" || path === "command" || path === "exit_code") continue;
		if (typeof leaf === "boolean" || leaf === null) continue;
		assert.ok(human.includes(String(leaf)), `human rendering of ${value.command} drops ${path} = ${JSON.stringify(leaf)}`);
	}
}

/** Every scalar the structured value carries, with its path, for the drift check. */
function* leaves(value, path = "") {
	if (Array.isArray(value)) {
		for (const [index, element] of value.entries()) yield* leaves(element, `${path}[${index}]`);
		return;
	}
	if (value !== null && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			yield* leaves(child, path === "" ? key : `${path}.${key}`);
		}
		return;
	}
	yield [path, value];
}

// ── The verb set (§10.2) ─────────────────────────────────────────────────────

test("the verb set is exactly the eight §10.2 verbs", () => {
	assert.deepEqual(VERBS, [
		"start",
		"status",
		"doctor",
		"reconcile",
		"stop",
		"cleanup-plan",
		"cleanup-execute",
		"migrate",
	]);
});

test("no verb refuses as usage and lists the verb set", async (t) => {
	const { exitCode, value } = await runCli([], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "usage");
	assert.deepEqual(value.usage.verbs, VERBS);
});

test("an unknown verb refuses as usage and names it", async (t) => {
	const { exitCode, value } = await runCli(["resume"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "usage");
	assert.equal(value.error.verb, "resume");
});

test("an unknown flag refuses as usage", async (t) => {
	const { exitCode, value } = await runCli(["status", "--verbose"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--verbose");
});

test("a flag is named even when the verb is missing too", async (t) => {
	const { exitCode, value } = await runCli(["--verbose"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--verbose", "the operator was told only that a verb was missing");
});

test("--config is refused, because config is repo-bound", async (t) => {
	const { exitCode, value } = await runCli(["status", "--config", "/elsewhere/factory.json"], {
		cwd: makeRepo(t),
	});

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--config");
	assert.match(value.error.message, /repo-bound/);
});

test("--help lists the verb set and succeeds", async (t) => {
	const { exitCode, value } = await runCli(["--help"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.ok, true);
	assert.deepEqual(value.usage.verbs, VERBS);
});

// ── The verb set, and what an unbuilt row would have to say ──────────────────

test("every verb in the set answers rather than reporting a missing subsystem (#118)", async (t) => {
	// §12.8's pair was the last unbuilt row, so `not-implemented` is a state no
	// invocation can now reach. Driven through the binary rather than read off the
	// table, because what an operator relies on is that the verb they typed does
	// something — a table row with a handler that throws on arrival would satisfy
	// any assertion about the table and none about the verb.
	const cwd = makeRepo(t);
	const agentDir = makeAgentDir(t);

	for (const verb of VERBS) {
		const { exitCode, value } = await runCli([verb], { cwd, agentDir, herdr: herdrAnswering(false) });

		assert.notEqual(exitCode, EXIT_NOT_IMPLEMENTED, `${verb} reports a missing subsystem`);
		assert.notEqual(value.error?.kind, "not-implemented", `${verb} reports a missing subsystem`);
	}
});

test("a flag whose subsystem has not landed still refuses before its verb runs", async (t) => {
	// The mechanism outlives the last `missing:` row it was written for: a flag
	// declared but unbuilt must refuse *before* the verb acts, or an operator
	// reads a report that silently left out what they asked for. Exercised
	// through the binary against a table that declares one, since no shipped verb
	// does any more.
	const cwd = makeRepo(t);
	const agentDir = makeAgentDir(t);
	const declared = VERB_TABLE.status.flags;
	VERB_TABLE.status.flags = { "--soon": { missing: "a subsystem that has not landed", spec: "§10.2" } };
	t.after(() => {
		VERB_TABLE.status.flags = declared;
	});

	const { exitCode, value } = await runCli(["status", "--soon"], { cwd, agentDir });

	assert.equal(exitCode, EXIT_NOT_IMPLEMENTED);
	assert.equal(value.error.kind, "not-implemented");
	assert.equal(value.error.missing, "a subsystem that has not landed");
	assert.match(value.error.spec, /^§/);
	// §10.3 reserves 1 for the operator's line being wrong, so a missing
	// subsystem must never arrive as a typo would.
	assert.notEqual(exitCode, EXIT_USAGE);
});

test("this slice produces no run end-reason exit code", async (t) => {
	const cwd = makeRepo(t);
	const agentDir = makeAgentDir(t);
	const runEndCodes = new Set([2, 3, 4, 5, 6]);

	for (const argv of [[], ["--help"], ["nonsense"], ...VERBS.map((verb) => [verb])]) {
		assert.ok(!runEndCodes.has((await runCli(argv, { cwd, agentDir })).exitCode), argv.join(" "));
	}
});

// ── The fail-closed load, reached through the binary ─────────────────────────

test("a config-load failure refuses the verb with exit code 1", async (t) => {
	const cwd = makeRepo(t, { config: null });

	const { exitCode, value } = await runCli(["status"], { cwd });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "config-load");
	assert.equal(value.error.reason, "file-missing");
});

test("every config-requiring verb refuses on a bad config rather than running", async (t) => {
	const cwd = makeRepo(t, { config: { schemaVersion: 1 } });

	for (const verb of VERBS.filter((candidate) => candidate !== "migrate")) {
		const { exitCode, value } = await runCli([verb], { cwd });

		assert.equal(exitCode, EXIT_USAGE, verb);
		assert.equal(value.error.kind, "config-load", verb);
	}
});

test("migrate does not require a loadable config — it is the verb that repairs one", async (t) => {
	const cwd = makeRepo(t, { config: cloneLegacyConfig() });

	const { exitCode, value } = await runCli(["migrate"], { cwd });

	// Every other verb refuses this file at load; this one reads it and rewrites
	// it, which is why its table row is the one with `requiresConfig: false`.
	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.command, "migrate");
	assert.equal(JSON.parse(readFileSync(join(cwd, ".pi", "factory.json"), "utf8")).schemaVersion, 2);
	assert.ok(value.report.holes.length > 0);
});

test("no environment variable can redirect the config", async (t) => {
	const cwd = makeRepo(t, { config: null });
	const elsewhere = makeRepo(t);

	const { exitCode, value } = await runCli(["status"], {
		cwd,
		env: { FACTORY_CONFIG: join(elsewhere, ".pi", "factory.json") },
	});

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.reason, "file-missing");
});

test("a user-level ~/.pi/factory.json is not a defaults layer", (t) => {
	const cwd = makeRepo(t, { config: null });
	const home = mkdtempSync(join(tmpdir(), "factory-home-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	mkdirSync(join(home, ".pi"), { recursive: true });
	writeFileSync(join(home, ".pi", "factory.json"), JSON.stringify(VALID_CONFIG), "utf8");

	const result = spawnSync(process.execPath, [BIN_PATH, "status", "--json"], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
	});

	assert.equal(result.status, EXIT_USAGE);
	assert.equal(JSON.parse(result.stdout).error.reason, "file-missing");
});

// ── One structured value, two renderings (§10.2) ─────────────────────────────

test("--json renders the structured value with its published schema_version", async (t) => {
	const { value } = await runCli(["status", "--json"], { cwd: makeRepo(t) });

	const parsed = JSON.parse(renderJson(value));

	assert.equal(parsed.schema_version, 1);
	assert.deepEqual(parsed, value);
});

test("human output is the default and carries every fact the JSON carries", async (t) => {
	const cwd = makeRepo(t, { config: null });
	const cases = [
		await runCli([], { cwd }),
		await runCli(["--help"], { cwd }),
		await runCli(["status"], { cwd }),
		await runCli(["start"], { cwd: makeRepo(t), agentDir: makeAgentDir(t) }),
	];

	for (const { value } of cases) assertRenderingsAgree(value);
});

// ── doctor and reconcile (§5.4, §10.5) ───────────────────────────────────────

/** The process facts a test drives instead of inheriting from the test runner. */
function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		cwd: makeRepo(t),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t) },
		// §10.3's availability check is a live read of the operator's terminal
		// multiplexer; a suite that only passed on a machine running one would be
		// testing the machine. The run lifecycle's own suite drives both answers.
		herdr: herdrAnswering(),
		// The §6.2 runtime probes are live reads of the harnesses, for the same reason.
		workerTransports: workerTransportsAnswering(root),
		pipeline: null,
	};
}

test("doctor diagnoses the repository and exits zero, having written nothing", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["doctor"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.command, "doctor");
	assert.equal(value.ok, true);
	assert.equal(value.report.store.present, false, "doctor created a store for a repository that never ran");
	assert.equal(value.report.package.ok, true);
});

test("doctor --baseline executes the declared checks; doctor without it re-runs nothing", async (t) => {
	const context = invocation(t);

	const executed = await runCli(["doctor", "--baseline"], context);
	const reported = await runCli(["doctor"], context);

	assert.equal(executed.exitCode, EXIT_OK);
	assert.equal(executed.value.report.baseline.rerun, true);
	assert.equal(executed.value.report.baseline.ok, true);

	assert.equal(reported.value.report.baseline.rerun, false);
	// The expensive mode wrote nothing durable (§14.24), so the default mode has
	// no record of it to report — the two modes are not a cache.
	assert.equal(reported.value.report.baseline.recorded, false);
});

test("--baseline is doctor's flag alone", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["status", "--baseline"], context);

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--baseline");
});

test("reconcile settles what it can under the lease, and releases it", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["reconcile"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.mode, "settle");
	assert.equal(value.report.actor, "operator:reconcile");

	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	t.after(() => store.close());
	assert.equal(openLeases(store).inspect("controller"), null, "reconcile kept the controller lease");
});

test("reconcile against a live lease-holder refuses, and points at the lock-free reads", async (t) => {
	const context = invocation(t);
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	openLeases(store).acquire({
		name: "controller",
		identity: leaseIdentity({ run: "01JRUN0000000000000000000A", pane: "herdr:2" }),
	});
	store.close();

	const { exitCode, value } = await runCli(["reconcile"], context);

	assert.notEqual(exitCode, EXIT_OK);
	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "lease-held");
	assert.equal(value.error.run, "01JRUN0000000000000000000A");
	assert.equal(value.error.pane, "herdr:2");
	assert.match(value.error.message, /status/);
	assert.match(value.error.message, /doctor/);
});

test("start runs a whole run and answers with its end reason's exit code", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "--foreground", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.command, "start");
	assert.equal(value.report.end_reason, "drained");
	assertRenderingsAgree(value);
});

test("start's own flags are start's alone, and are not read as unknown", async (t) => {
	const context = invocation(t);

	assert.equal((await runCli(["start", "--foreground", "--parent", "75"], context)).exitCode, EXIT_OK);
	assert.equal((await runCli(["start", "--foreground", "--new-run", "42"], context)).exitCode, EXIT_OK);

	const { exitCode, value } = await runCli(["doctor", "--new-run"], context);
	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--new-run");
});

test("doctor's human rendering carries every fact its JSON carries", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["doctor"], context);

	assertRenderingsAgree(value);
});

// ── The binary itself ────────────────────────────────────────────────────────

test("the bin entry runs as a program and reports its refusals on stderr", (t) => {
	const cwd = makeRepo(t, { config: null });

	const result = spawnSync(process.execPath, [BIN_PATH, "status"], { cwd, encoding: "utf8" });

	assert.equal(result.status, EXIT_USAGE);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /factory\.json/);
});

test("the bin entry prints machine output on stdout under --json", (t) => {
	const cwd = makeRepo(t, { config: null });

	const result = spawnSync(process.execPath, [BIN_PATH, "status", "--json"], { cwd, encoding: "utf8" });

	assert.equal(result.status, EXIT_USAGE);
	assert.equal(JSON.parse(result.stdout).error.reason, "file-missing");
});

test("the bin entry diagnoses with the agent directory it resolves for itself", (t) => {
	const cwd = makeRepo(t);

	// No injected `agentDir`: this is the path the operator's `factory doctor`
	// actually takes, and the only place §4.1's resolution is exercised.
	const result = spawnSync(process.execPath, [BIN_PATH, "doctor", "--json"], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, PI_CODING_AGENT_DIR: makeAgentDir(t) },
	});

	assert.equal(result.status, EXIT_OK, result.stderr);
	const value = JSON.parse(result.stdout);
	assert.equal(value.report.store.present, false);
	assert.ok(value.report.store.agent_dir.path.length > 0, "doctor cannot say where the state root is");
	assert.ok(["pi-sdk", "env", "default"].includes(value.report.store.agent_dir.source));
});

test("the bin entry prints successful human output on stdout", (t) => {
	const cwd = makeRepo(t);

	const result = spawnSync(process.execPath, [BIN_PATH, "--help"], { cwd, encoding: "utf8" });

	assert.equal(result.status, EXIT_OK);
	assert.match(result.stdout, /cleanup-execute/);
});
