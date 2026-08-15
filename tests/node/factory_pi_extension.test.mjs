import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runCli, renderHuman } from "../../factory/lib/cli/main.mjs";
import {
	FACTORY_RUN_START,
	FACTORY_RUN_START_RESPONSE,
} from "../../factory/lib/monitor-trigger.mjs";
import {
	resolveFactoryBinary,
	runFactoryCommand,
} from "../../extensions/factory/lib/command.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, makeAgentDir } from "./helpers/factory-store.mjs";

/**
 * §10.2, §10.6, §11.7, §11.8: the `/factory` pi extension.
 *
 * The extension is a front over the binary's `runCli` — the same code the
 * shell runs — plus one-way monitor coupling through the shared event bus.
 * These tests drive the front's core (the part that is plain ESM, not the
 * TypeScript entry pi loads) against a real fixture repository and a fake
 * event bus, because "same code" and "never fatal" are promises about
 * behavior, not about intent.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A process facts object shaped like the binary's invocation context, plus the
 * two things only the pi session provides: the shared event bus and the
 * display sink.
 */
function invocation(t, { herdr = herdrAnswering() } = {}) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		cwd: makeRepo(t),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable) },
		herdr,
	};
}

function makeBus({ throwOnEmit = false } = {}) {
	const listeners = new Map();
	const emitted = [];

	return {
		emitted,
		emit(channel, data) {
			if (throwOnEmit) throw new Error("event bus down");
			emitted.push({ channel, data });
			for (const listener of listeners.get(channel) ?? []) listener(data);
		},
		on(channel, listener) {
			const current = listeners.get(channel) ?? [];
			current.push(listener);
			listeners.set(channel, current);
			return () =>
				listeners.set(
					channel,
					(listeners.get(channel) ?? []).filter((entry) => entry !== listener),
				);
		},
	};
}

/** The monitor side of §10.6, as a stub: answer the typed request with a URL. */
function attachMonitor(bus, url) {
	bus.on(FACTORY_RUN_START, () => {
		bus.emit(FACTORY_RUN_START_RESPONSE, { url });
	});
}

function makeDisplay() {
	const calls = [];
	return { calls, fn: (text, { isError = false } = {}) => calls.push({ text, isError }) };
}

/**
 * The launcher's Herdr commands, answered without a multiplexer: a workspace
 * is created, the pane run succeeds. Without this, a default `start` on a tree
 * whose default is the detached launcher would spawn the operator's real herdr
 * — machine-dependent, and with side effects.
 */
function fakeRunHerdr() {
	const calls = [];
	return {
		calls,
		fn: async (args) => {
			calls.push(args);
			if (args[0] === "workspace" && args[1] === "create") {
				return {
					exitCode: 0,
					stdout: JSON.stringify({
						id: "cli:workspace:create",
						result: {
							type: "workspace_created",
							workspace: { workspace_id: "w99", label: "factory-test", number: 1 },
							tab: { tab_id: "w99:t1" },
							root_pane: { pane_id: "w99:p1", workspace_id: "w99", tab_id: "w99:t1" },
						},
					}),
					stderr: "",
				};
			}
			if (args[0] === "pane" && args[1] === "run") {
				return {
					exitCode: 0,
					stdout: JSON.stringify({ id: "cli:pane:run", result: { type: "pane_run" } }),
					stderr: "",
				};
			}
			return { exitCode: 1, stdout: "", stderr: `unscheduled: ${args.join(" ")}` };
		},
	};
}

/** The report names a run: a foreground run, re-entry against a live holder, or a detached launch. */
function namesARun(report) {
	return report.detached === true || report.run !== undefined || report.live === true;
}

// ── §10.2: a thin wrapper over the same code ─────────────────────────────────

test("the front answers with exactly the value the binary answers, rendered the same way", async (t) => {
	const context = invocation(t);
	const events = makeBus();
	const display = makeDisplay();

	const code = await runFactoryCommand(["doctor"], { ...context, events, display: display.fn });
	const direct = await runCli(["doctor"], context);

	assert.equal(code, direct.exitCode);
	assert.equal(display.calls.length, 1);
	// The doctor stamps `at` from the wall clock, so the two invocations differ
	// by that line alone; everything else must be byte-identical.
	const stripClock = (text) =>
		text.split("\n").filter((line) => !/^\s*at: \d+$/.test(line.trim())).join("\n");
	assert.equal(stripClock(display.calls[0].text), stripClock(renderHuman(direct.value)));
	assert.equal(display.calls[0].isError, direct.exitCode !== 0);
});

test("a refusal renders as an error and triggers nothing", async (t) => {
	const context = invocation(t);
	const events = makeBus();
	const display = makeDisplay();

	const code = await runFactoryCommand(["frobnicate"], { ...context, events, display: display.fn });
	const direct = await runCli(["frobnicate"], context);

	assert.equal(code, direct.exitCode);
	assert.equal(direct.exitCode, 1);
	assert.equal(display.calls[0].isError, true);
	assert.match(display.calls[0].text, /Unknown verb "frobnicate"/);
	assert.equal(events.emitted.length, 0);
});

// ── §10.6: the monitor trigger ───────────────────────────────────────────────

test("/factory start publishes the typed request carrying the run's report, and prints the monitor URL when a listener responds", async (t) => {
	const context = invocation(t);
	const events = makeBus();
	attachMonitor(events, "http://127.0.0.1:48080/");
	const display = makeDisplay();

	const code = await runFactoryCommand(["start", "42"], {
		...context,
		runHerdr: fakeRunHerdr().fn,
		events,
		display: display.fn,
	});

	assert.equal(code, 0);
	const requests = events.emitted.filter((entry) => entry.channel === FACTORY_RUN_START);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].data.repo, context.cwd);
	assert.deepEqual(requests[0].data.argv, ["start", "42"]);
	// The report is whatever the binary's start answered with — a foreground
	// run, a live-run resolution, or a detached launch — and the trigger
	// carries it whole.
	assert.ok(namesARun(requests[0].data.report), "the trigger must carry a run-naming report");
	// Column 0: the report's own `monitor:` section is nested, the trigger's
	// line is not.
	assert.match(display.calls[0].text, /^monitor: http:\/\/127.0.0.1:48080\//m);
});

test("/factory start prints no monitor line when nothing listens", async (t) => {
	const context = invocation(t);
	const events = makeBus();
	const display = makeDisplay();

	const code = await runFactoryCommand(["start", "42"], {
		...context,
		runHerdr: fakeRunHerdr().fn,
		events,
		display: display.fn,
	});

	assert.equal(code, 0);

	const requests = events.emitted.filter((entry) => entry.channel === FACTORY_RUN_START);
	assert.equal(requests.length, 1);
	assert.doesNotMatch(display.calls[0].text, /^monitor: /m);
});

test("a broken event bus never fails the command (never fatal)", async (t) => {
	const context = invocation(t);
	const events = makeBus({ throwOnEmit: true });
	const display = makeDisplay();

	const code = await runFactoryCommand(["start", "42"], {
		...context,
		runHerdr: fakeRunHerdr().fn,
		events,
		display: display.fn,
	});

	assert.equal(code, 0);
	assert.equal(display.calls.length, 1);
	assert.doesNotMatch(display.calls[0].text, /^monitor: /m);
});

test("only a start that produced a run publishes the request", async (t) => {
	const context = invocation(t);
	const events = makeBus();
	const display = makeDisplay();

	// `start` with a config that refuses never reaches a run.
	await runFactoryCommand(["start"], {
		...context,
		herdr: undefined,
		events,
		display: display.fn,
	});

	assert.equal(events.emitted.filter((entry) => entry.channel === FACTORY_RUN_START).length, 0);
});

// ── §11.7: one package, the binary resolved from the extension's own place ──

test("the extension resolves the package binary from its own location", () => {
	const resolved = resolveFactoryBinary(import.meta.url);

	assert.equal(resolved, realpathSync(join(REPO_ROOT, "factory", "bin", "factory.mjs")));
	assert.ok(existsSync(resolved));
});

test("resolving the binary fails closed above a tree with no factory package", (t) => {
	const bare = mkdtempSync(join(tmpdir(), "factory-bare-"));
	t.after(() => rmSync(bare, { recursive: true, force: true }));

	// Walk the temp file up to the filesystem root: no package.json with a
	// `bin.factory` entry anywhere on the way.
	assert.throws(
		() => resolveFactoryBinary(pathToFileURL(join(bare, "orphan.mjs"))),
		/bin\.factory/,
	);
});

// ── §10.6: the dependency is one-way ─────────────────────────────────────────

test("the factory extension never imports the monitor", () => {
	const sources = listSources(join(REPO_ROOT, "extensions", "factory"));

	for (const [name, text] of sources) {
		assert.doesNotMatch(
			text,
			/(?:from\s+|import\s*\()\s*["'][^"']*factory-monitor[^"']*["']/,
			`${name} reaches for the monitor; §10.6's dependency is one-way`,
		);
	}
});

// ── §11.8: the name is the whole legacy promise ──────────────────────────────

test("/factory keeps its name and fronts the binary's verb set", () => {
	const entry = readFileSync(join(REPO_ROOT, "extensions", "factory", "index.ts"), "utf8");

	assert.match(entry, /registerCommand\(\s*["']factory["']/);
});

// ── §11.7: declared in the root manifest, never separately installable ──────

test("the root manifest declares the factory extension with a reachable entrypoint", () => {
	const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
	const declared = manifest.pi.extensions;

	assert.ok(declared.includes("./extensions/factory"), "pi.extensions is missing ./extensions/factory");
	const entry = join(REPO_ROOT, "extensions", "factory");
	const nested = JSON.parse(readFileSync(join(entry, "package.json"), "utf8"));
	for (const nestedEntry of nested.pi.extensions) {
		const resolved = nestedEntry.startsWith("./") ? nestedEntry.slice(2) : nestedEntry;
		assert.ok(existsSync(join(entry, resolved)), `nested entrypoint ${nestedEntry} is missing`);
	}
	assert.ok(existsSync(join(entry, "index.ts")));
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Every source file under a directory, as `[path relative to it, text]`. */
function listSources(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => {
			const path = join(entry.parentPath, entry.name);
			return [relative(dir, path), readFileSync(path, "utf8")];
		});
}
