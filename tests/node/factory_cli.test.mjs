import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_NOT_IMPLEMENTED, EXIT_OK, EXIT_USAGE } from "../../factory/lib/cli/exit-codes.mjs";
import { renderHuman, renderJson, runCli, VERBS } from "../../factory/lib/cli/main.mjs";
import { makeRepo, VALID_CONFIG } from "./helpers/factory-repo.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN_PATH = join(REPO_ROOT, "factory", "bin", "factory.mjs");

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

test("no verb refuses as usage and lists the verb set", (t) => {
	const { exitCode, value } = runCli([], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "usage");
	assert.deepEqual(value.usage.verbs, VERBS);
});

test("an unknown verb refuses as usage and names it", (t) => {
	const { exitCode, value } = runCli(["resume"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "usage");
	assert.equal(value.error.verb, "resume");
});

test("an unknown flag refuses as usage", (t) => {
	const { exitCode, value } = runCli(["status", "--verbose"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--verbose");
});

test("--config is refused, because config is repo-bound", (t) => {
	const { exitCode, value } = runCli(["status", "--config", "/elsewhere/factory.json"], {
		cwd: makeRepo(t),
	});

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.flag, "--config");
	assert.match(value.error.message, /repo-bound/);
});

test("--help lists the verb set and succeeds", (t) => {
	const { exitCode, value } = runCli(["--help"], { cwd: makeRepo(t) });

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.ok, true);
	assert.deepEqual(value.usage.verbs, VERBS);
});

// ── What this slice does not implement, said out loud ────────────────────────

test("every verb this slice does not implement exits typed, naming what is missing", (t) => {
	const cwd = makeRepo(t);

	for (const verb of VERBS) {
		const { exitCode, value } = runCli([verb], { cwd });

		assert.equal(exitCode, EXIT_NOT_IMPLEMENTED, `${verb} exit code`);
		assert.equal(value.error.kind, "not-implemented", `${verb} error kind`);
		assert.equal(value.command, verb);
		assert.ok(value.error.missing.length > 0, `${verb} names what is missing`);
		assert.match(value.error.spec, /^§/, `${verb} cites a spec section`);
	}
});

test("not-implemented is never exit code 1, which belongs to usage and config alone", (t) => {
	const cwd = makeRepo(t);

	for (const verb of VERBS) {
		assert.notEqual(runCli([verb], { cwd }).exitCode, EXIT_USAGE, verb);
	}
});

test("this slice produces no run end-reason exit code", (t) => {
	const cwd = makeRepo(t);
	const runEndCodes = new Set([2, 3, 4, 5, 6]);

	for (const argv of [[], ["--help"], ["nonsense"], ...VERBS.map((verb) => [verb])]) {
		assert.ok(!runEndCodes.has(runCli(argv, { cwd }).exitCode), argv.join(" "));
	}
});

// ── The fail-closed load, reached through the binary ─────────────────────────

test("a config-load failure refuses the verb with exit code 1", (t) => {
	const cwd = makeRepo(t, { config: null });

	const { exitCode, value } = runCli(["status"], { cwd });

	assert.equal(exitCode, EXIT_USAGE);
	assert.equal(value.error.kind, "config-load");
	assert.equal(value.error.reason, "file-missing");
});

test("every config-requiring verb refuses on a bad config rather than running", (t) => {
	const cwd = makeRepo(t, { config: { schemaVersion: 1 } });

	for (const verb of VERBS.filter((candidate) => candidate !== "migrate")) {
		const { exitCode, value } = runCli([verb], { cwd });

		assert.equal(exitCode, EXIT_USAGE, verb);
		assert.equal(value.error.kind, "config-load", verb);
	}
});

test("migrate does not require a loadable config — it is the verb that repairs one", (t) => {
	const cwd = makeRepo(t, { config: { version: 1, tracker: { repo: "acme/widgets" } } });

	const { exitCode, value } = runCli(["migrate"], { cwd });

	assert.equal(exitCode, EXIT_NOT_IMPLEMENTED);
	assert.equal(value.error.kind, "not-implemented");
});

test("no environment variable can redirect the config", (t) => {
	const cwd = makeRepo(t, { config: null });
	const elsewhere = makeRepo(t);

	const { exitCode, value } = runCli(["status"], {
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

test("--json renders the structured value with its published schema_version", (t) => {
	const { value } = runCli(["status", "--json"], { cwd: makeRepo(t) });

	const parsed = JSON.parse(renderJson(value));

	assert.equal(parsed.schema_version, 1);
	assert.deepEqual(parsed, value);
});

test("human output is the default and carries every fact the JSON carries", (t) => {
	const cwd = makeRepo(t, { config: null });
	const cases = [
		runCli([], { cwd }),
		runCli(["--help"], { cwd }),
		runCli(["status"], { cwd }),
		runCli(["start"], { cwd: makeRepo(t) }),
	];

	for (const { value } of cases) {
		const human = renderHuman(value);

		assert.doesNotMatch(human, /^\s*[{[]/, "human output is not JSON");
		for (const [path, leaf] of leaves(value)) {
			// `schema_version`, `command`, and `ok` are envelope: the version is a
			// machine contract, the command is what the operator just typed, and the
			// exit code carries the verdict.
			if (path === "schema_version" || path === "command") continue;
			if (typeof leaf === "boolean" || leaf === null) continue;
			assert.ok(
				human.includes(String(leaf)),
				`human rendering of ${value.command} drops ${path} = ${JSON.stringify(leaf)}`,
			);
		}
	}
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

test("the bin entry prints successful human output on stdout", (t) => {
	const cwd = makeRepo(t);

	const result = spawnSync(process.execPath, [BIN_PATH, "--help"], { cwd, encoding: "utf8" });

	assert.equal(result.status, EXIT_OK);
	assert.match(result.stdout, /cleanup-execute/);
});
