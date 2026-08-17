import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { validateRole } from "../../factory/lib/worker/adapter.mjs";
import {
	CLAUDE_PROBE_ONLY_FLAGS,
	claudeProbeArguments,
	claudeWorkerArguments,
	createClaudeAdapter,
} from "../../factory/lib/worker/claude.mjs";
import {
	createPiAdapter,
	PI_PROBE_ONLY_FLAGS,
	piProbeArguments,
	piWorkerArguments,
} from "../../factory/lib/worker/pi.mjs";
import { claudeSessionArguments } from "../../factory/lib/worker/permissions.mjs";
import { pluginCachePath } from "../../factory/lib/worker/plugin.mjs";
import { PIPELINE_ROLES } from "../../factory/lib/worker/roles.mjs";
import { runCommand } from "../../factory/lib/worker/transports.mjs";
import { makeTree, realGeneratorFiles, skillMarkdown } from "./helpers/factory-package.mjs";
import { FIXED_NOW, manualTimers, openTestStore, runStarted } from "./helpers/factory-store.mjs";
import { fakeHerdr, piTransport, skillCommandsOf } from "./helpers/factory-worker.mjs";

/**
 * #160: the probe and the worker session run the **same** binding. The probe
 * argument builders passed the skill-delivery flags — `--no-skills --skill`
 * for pi, `--plugin-dir` for Claude — and the session builders did not, so
 * every worker ran without its closure while pi additionally discovered the
 * operator's personal skills. §6.2's probe proved a session shape no worker
 * ran in ("a probe that proves a different environment from the one the
 * worker gets proves nothing" — environment.mjs, above `binding()`).
 *
 * These tests hold the restored invariant at both depths: the argument
 * builders share one worker binding by construction, and the adapters hand
 * Herdr exactly what the probe proved, plus nothing but the profile flags.
 */

// ── The worker argument builders (§6.2's production flag set, per runtime) ───

test("a pi worker session suppresses default skill discovery and loads the pinned roots only", () => {
	assert.deepEqual(
		piWorkerArguments(["/pin/skills", "/pin/extra"], ["--exclude-tools", "edit,write"]),
		["--no-skills", "--skill", "/pin/skills", "--skill", "/pin/extra", "--exclude-tools", "edit,write"],
	);
});

test("the pi probe runs the worker binding plus its two disposability flags, and nothing else", () => {
	const worker = piWorkerArguments(["/pin/skills"], ["--extension", "/ext/index.ts"]);

	// The literal spelling, not the composition: if either builder gains or
	// loses an argument the other lacks, exactly one of these two fails.
	assert.deepEqual(piProbeArguments(["/pin/skills"], ["--extension", "/ext/index.ts"]), [
		"--mode",
		"rpc",
		"--no-session",
		...worker,
	]);
	assert.deepEqual(PI_PROBE_ONLY_FLAGS, ["--mode", "rpc", "--no-session"]);
});

test("a Claude worker session loads the §6.3 plugin — the closure's only delivery channel", () => {
	assert.deepEqual(
		claudeWorkerArguments("/store/plugins/rev-1", ["--settings", "/cfg/settings-builder.json"]),
		["--plugin-dir", "/store/plugins/rev-1", "--settings", "/cfg/settings-builder.json"],
	);
});

test("the Claude probe runs the worker binding plus its stream-json flags, and nothing else", () => {
	const worker = claudeWorkerArguments("/store/plugins/rev-1", ["--permission-mode", "dontAsk"]);

	assert.deepEqual(claudeProbeArguments("/store/plugins/rev-1", ["--permission-mode", "dontAsk"]), [
		...worker,
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--print",
		"--verbose",
	]);
	assert.deepEqual(CLAUDE_PROBE_ONLY_FLAGS, [
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--print",
		"--verbose",
	]);
});

// ── The adapters hand Herdr what the probe proved (§6.1, §6.2, #160) ─────────

const ROLE = validateRole({ ...PIPELINE_ROLES[0], closure: ["implement", "tdd"] });

const SNAPSHOT = Object.freeze({
	snapshot_version: 1,
	number: 42,
	title: "Make the thing work",
	body: "It should work.",
	state: "open",
	labels: Object.freeze([]),
	assignees: Object.freeze([]),
	updated_at_raw: "2026-08-15T09:00:00+02:00",
	content_version: 1,
	snapshot_at: FIXED_NOW,
	snapshot_at_raw: "2026-02-12T02:40:00.000Z",
	comments: Object.freeze([]),
});

function fixturePackage(t, { withGenerator = false } = {}) {
	return makeTree(t, {
		"package.json": JSON.stringify({
			name: "oh-my-slop",
			version: "9.9.9",
			description: "fixture",
			author: "Fixture",
		}),
		"skills/workflow/implement/SKILL.md": skillMarkdown("implement", { requires: ["tdd"] }),
		"skills/practice/tdd/SKILL.md": skillMarkdown("tdd"),
		...(withGenerator ? realGeneratorFiles() : {}),
	});
}

/** A store with a run open, a lease held, and a fake Herdr — one launch's worth. */
async function launchable(t, herdr) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	const opened = runStarted();

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(opened.run);

	return (overrides = {}) => ({
		store,
		hold,
		identity: { run: opened.run, ticket: 42, phase: "implement", attempt: `${opened.run}-t42-a1` },
		role: ROLE,
		packageRev: "rev-1",
		worktreePath: "/state/worktrees/attempt",
		branch: "factory/t42/a1",
		ticketSnapshot: SNAPSHOT,
		herdr: herdr.control,
		recheck: () => {},
		actor: "controller",
		now: () => FIXED_NOW,
		sleep: async () => {},
		...overrides,
	});
}

/** The argv Herdr's `agent start` received after `--` — the session as launched. */
function startedArguments(herdr) {
	const started = herdr.calls.find((args) => args[0] === "agent" && args[1] === "start");
	return started.slice(started.indexOf("--") + 1);
}

test("a pi worker is started with exactly the binding the probe proved, plus the profile flags", async (t) => {
	const root = fixturePackage(t);
	const skillsRoots = [join(root, "skills")];
	const fake = piTransport({ commands: skillCommandsOf(root) });
	const herdr = fakeHerdr();
	const sessionArgs = ["--extension", "/ext/index.ts"];
	const adapter = createPiAdapter({
		skillsRoots,
		profiles: [{ name: "builder", model: "local/qwen3" }],
		declaredResources: { local: 1 },
		requiredClasses: ["local"],
		session: { sessionArgs },
		transport: fake.transport,
	});

	const preflighted = await adapter.preflight(ROLE, "rev-1");
	assert.equal(preflighted.ok, true);

	const attempt = await launchable(t, herdr);
	await adapter.launch(attempt({ profile: { name: "builder", model: "local/qwen3" }, sessionArgs }));

	// The probe's session is the worker's session: strip the probe-only flags,
	// append the profile's, and the argv Herdr got must be exactly what remains.
	const probeArgs = fake.calls.lineSession[0].args;
	assert.deepEqual(probeArgs.slice(0, PI_PROBE_ONLY_FLAGS.length), [...PI_PROBE_ONLY_FLAGS]);
	assert.deepEqual(startedArguments(herdr), [
		...probeArgs.slice(PI_PROBE_ONLY_FLAGS.length),
		"--model",
		"local/qwen3",
	]);
});

/** A Claude transport whose plugin build is the real generator (probe test's shape). */
function claudeTransport(skills) {
	const calls = { runCommand: [], lineSession: [] };
	return {
		calls,
		transport: {
			runCommand: async (command, args, options) => {
				calls.runCommand.push([command, ...args]);
				if (command !== "claude") return runCommand(command, args, options);
				if (args[0] === "--version") return { status: 0, stdout: "2.1.233-test", stderr: "" };
				if (args[0] === "plugin" && args[1] === "validate") return { status: 0, stdout: "✔", stderr: "" };
				return {
					status: 0,
					stdout: `Component inventory\n  Skills (${skills.length})  ${skills.join(", ")}\n`,
					stderr: "",
				};
			},
			lineSession: async (session) => {
				calls.lineSession.push(session);
				const request = JSON.parse(session.input[0]);
				return {
					status: 0,
					timedOut: false,
					stderr: "",
					lines: [
						JSON.stringify({
							type: "control_response",
							response: {
								subtype: "success",
								request_id: request.request_id,
								response: {
									commands: skills.map((name) => ({ name: `oh-my-slop:${name}` })),
									models: [{ value: "opus", resolvedModel: "claude-opus-5-test" }],
								},
							},
						}),
					],
				};
			},
		},
	};
}

test("a Claude worker is started with exactly the binding the probe proved, plus the profile flags", async (t) => {
	const packageRoot = fixturePackage(t, { withGenerator: true });
	const cacheRoot = makeTree(t, {});
	const fake = claudeTransport(["implement", "tdd"]);
	const herdr = fakeHerdr();
	const sessionArgs = ["--settings", "/cfg/settings-builder.json", "--permission-mode", "dontAsk"];
	const adapter = createClaudeAdapter({
		packageRoot,
		cacheRoot,
		expectedSkills: ["implement", "tdd"],
		declaredSize: 2,
		pluginDir: pluginCachePath({ cacheRoot, treeDigest: "rev-1" }),
		session: { sessionArgs },
		transport: fake.transport,
	});

	const preflighted = await adapter.preflight(ROLE, "rev-1");
	assert.equal(preflighted.ok, true);

	const attempt = await launchable(t, herdr);
	await adapter.launch(
		attempt({ profile: { name: "big", model: "opus", effort: "high" }, sessionArgs, plugin: "oh-my-slop" }),
	);

	const probeArgs = fake.calls.lineSession[0].args;
	assert.deepEqual(probeArgs.slice(-CLAUDE_PROBE_ONLY_FLAGS.length), [...CLAUDE_PROBE_ONLY_FLAGS]);
	assert.deepEqual(startedArguments(herdr), [
		...probeArgs.slice(0, -CLAUDE_PROBE_ONLY_FLAGS.length),
		"--model",
		"opus",
		"--effort",
		"high",
	]);
});

test("a Claude reviewer gets the plugin and still gets its withheld tools", async (t) => {
	const packageRoot = fixturePackage(t, { withGenerator: true });
	const cacheRoot = makeTree(t, {});
	const fake = claudeTransport(["implement", "tdd"]);
	const herdr = fakeHerdr();
	const pluginDir = pluginCachePath({ cacheRoot, treeDigest: "rev-1" });
	const adapter = createClaudeAdapter({
		packageRoot,
		cacheRoot,
		expectedSkills: ["implement", "tdd"],
		pluginDir,
		transport: fake.transport,
	});
	await adapter.preflight(ROLE, "rev-1");

	const attempt = await launchable(t, herdr);
	await adapter.launch(
		attempt({
			profile: { name: "reader", model: "opus" },
			sessionArgs: claudeSessionArguments({ posture: "reviewer", settingsPath: "/cfg/settings-reviewer.json" }),
			plugin: "oh-my-slop",
		}),
	);

	const started = startedArguments(herdr);
	assert.deepEqual(started.slice(0, 2), ["--plugin-dir", pluginDir]);
	const withheld = started.indexOf("--disallowedTools");
	assert.notEqual(withheld, -1, "the reviewer lost its command-line tool withholding (§6.8)");
	assert.equal(started[withheld + 1], "Edit,Write,NotebookEdit");
});

// ── A worker that cannot invoke its closure never launches (§6.2, #160) ──────

test("a Claude launch with no proven plugin directory is a typed refusal before a pane exists", async (t) => {
	const herdr = fakeHerdr();
	const adapter = createClaudeAdapter({ launch: {} });
	const attempt = await launchable(t, herdr);

	await assert.rejects(
		() => adapter.launch(attempt({ profile: { name: "big", model: "opus" }, plugin: "oh-my-slop" })),
		(error) => {
			assert.equal(error.reason, "worker-launch-failed");
			assert.match(error.message, /no proven §6\.3 plugin directory/);
			return true;
		},
	);
	assert.deepEqual(herdr.calls, [], "a refused launch reached the multiplexer anyway");
});

test("a plugin cache wiped since preflight is a typed refusal, never a worker without skills", async (t) => {
	const herdr = fakeHerdr();
	const adapter = createClaudeAdapter({ pluginDir: join(makeTree(t, {}), "plugins", "gone") });
	const attempt = await launchable(t, herdr);

	await assert.rejects(
		() => adapter.launch(attempt({ profile: { name: "big", model: "opus" }, plugin: "oh-my-slop" })),
		(error) => {
			assert.equal(error.reason, "plugin-build-failed");
			return true;
		},
	);
	assert.deepEqual(herdr.calls, [], "a refused launch reached the multiplexer anyway");
});

test("a pi launch with no pinned skills roots is a typed refusal before a pane exists", async (t) => {
	const herdr = fakeHerdr();
	const adapter = createPiAdapter({ skillsRoots: [] });
	const attempt = await launchable(t, herdr);

	await assert.rejects(
		() => adapter.launch(attempt({ profile: { name: "builder", model: "local/qwen3" } })),
		(error) => {
			assert.equal(error.reason, "worker-launch-failed");
			assert.match(error.message, /no pinned skills roots/);
			return true;
		},
	);
	assert.deepEqual(herdr.calls, [], "a refused launch reached the multiplexer anyway");
});
