import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_OK, EXIT_REFUSED } from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { CONTROLLER_LEASE } from "../../factory/lib/domain/vocabulary.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, leaseIdentity, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";

/**
 * §10.1's process shape, the half #97 did not have: **the default launch is
 * detached into a Herdr pane; `--foreground` runs in the invoking terminal.**
 *
 * The launcher resolves against a live run *before any Herdr contact* — a
 * workspace created for a start that resolves to "already in scope" would be a
 * pane nobody asked for — and fails closed with the exact remedy when Herdr is
 * not there, naming `--foreground` as the alternate rather than dying on the
 * operator's SSH connection's terms.
 */

const AVAILABLE = herdrAnswering();
const UNAVAILABLE = herdrAnswering(false);

function invocation(t, { herdr = AVAILABLE, runHerdr = null } = {}) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	const context = {
		cwd: makeRepo(t),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr,
		workerTransports: workerTransportsAnswering(root),
		pipeline: null,
	};
	if (runHerdr !== null) context.runHerdr = runHerdr;
	return context;
}

/**
 * A herdr command runner that records its calls and answers as scripted. The
 * unscheduled `workspace create` answers the real shape with the label it was
 * given, so a test that does not script one is not scripting a broken one.
 */
function scriptedHerdr(script = {}) {
	const calls = [];
	const runner = async (args) => {
		calls.push(args);
		const key = `${args[0]} ${args[1]}`;
		if (script[key] !== undefined) return script[key];
		if (key === "workspace create") {
			return createdWorkspace(args[args.indexOf("--label") + 1]);
		}
		return { exitCode: 0, stdout: "{}", stderr: "" };
	};
	return { runner, calls };
}

function createdWorkspace(label) {
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			id: "cli:workspace:create",
			result: {
				type: "workspace_created",
				workspace: { workspace_id: "w9", label, number: 9 },
				tab: { tab_id: "w9:t1", workspace_id: "w9" },
				root_pane: { pane_id: "w9:p1", workspace_id: "w9", tab_id: "w9:t1" },
			},
		}),
		stderr: "",
	};
}

/** A live lease-holder the way a controller mid-run leaves it. */
async function liveRunIn(context, { runId, scope }) {
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	store.append({
		kind: "run.started",
		source: "controller",
		run: runId,
		occurredAt: Date.now(),
		observedAt: Date.now(),
		payload: { scope, mode: "started", pane: "w1:p3" },
	});
	openLeases(store).acquire({ name: "controller", identity: leaseIdentity({ run: runId, pane: "w1:p3" }) });
	store.close();
}

test("--foreground runs the invocation as the controller: today's inline behaviour, exit 0", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["start", "42", "--foreground"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.end_reason, "drained");
	assert.equal(value.report.detached, false);

	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	const started = store.readEvents({ kind: "run.started" });
	assert.equal(started.length, 1, "the foreground start drove its run in this process");
	store.close();
});

test("the default start launches detached and drives no run in the invoking process", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.detached, true);
	assert.equal(value.report.workspace, "w9");
	assert.equal(value.report.pane, "w9:p1");
	assert.match(value.report.label, /^factory-/);
	assert.deepEqual(value.report.command, [context.executable, "start", "--foreground", "42"]);

	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	assert.equal(store.readEvents({ kind: "run.started" }).length, 0, "the launcher opened a run of its own");
	store.close();
});

test("the launcher creates the workspace and runs the foreground start in its root pane", async (t) => {
	const { runner, calls } = scriptedHerdr();
	const context = invocation(t, { runHerdr: runner });

	await runCli(["start", "42"], context);

	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0], [
		"workspace",
		"create",
		"--cwd",
		context.cwd,
		"--label",
		calls[0][5],
		"--no-focus",
	]);
	assert.match(calls[0][5], /^factory-[0-9A-HJKMNP-TV-Z]{26}$/);
	assert.equal(calls[1][0], "pane");
	assert.equal(calls[1][1], "run");
	assert.equal(calls[1][2], "w9:p1");
	assert.deepEqual(calls[1].slice(3), [context.executable, "start", "--foreground", "42"]);
});

test("a live run containing the scope resolves before any Herdr contact", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });
	await liveRunIn(context, { runId: "live-run-1", scope: { kind: "direct-ticket", tickets: [40, 42] } });

	const { exitCode, value, herdrCalls } = await withCalls(context, ["start", "42"]);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, "live-run-1");
	assert.equal(value.report.queued, false);
	assert.match(value.message, /already in scope/);
	assert.equal(herdrCalls, 0, "a live run made the launcher touch Herdr");
});

test("a live run that does not cover the scope refuses before any Herdr contact", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });
	await liveRunIn(context, { runId: "live-run-2", scope: { kind: "direct-ticket", tickets: [40] } });

	const { exitCode, value, herdrCalls } = await withCalls(context, ["start", "42"]);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.match(value.error.message, /live-run-2/);
	assert.equal(herdrCalls, 0);
});

test("a live holder that has not recorded its run refuses before any Herdr contact", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	openLeases(store).acquire({
		name: "controller",
		identity: leaseIdentity({ run: null, pane: "w1:p3" }),
	});
	store.close();

	const { exitCode, value, herdrCalls } = await withCalls(context, ["start", "42"]);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "scope-unresolvable");
	assert.equal(herdrCalls, 0);
});

test("Herdr unavailable fails closed with the exact command and names --foreground", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE, runHerdr: scriptedHerdr().runner });

	const { exitCode, value, herdrCalls } = await withCalls(context, ["start", "42"]);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.match(value.error.message, /herdr/);
	assert.match(value.error.message, /--foreground/);
	assert.equal(herdrCalls, 0, "the refusal happened before any command was issued");
});

test("a failed workspace create reports the failure and issues no pane run", async (t) => {
	const { runner, calls } = scriptedHerdr({
		"workspace create": { exitCode: 1, stdout: "", stderr: "workspace creation refused" },
	});
	const context = invocation(t, { runHerdr: runner });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.match(value.error.message, /workspace create/);
	assert.match(value.error.message, /workspace creation refused/);
	assert.equal(calls.length, 1, "the half-launch went on to run the command anyway");
});

test("a workspace create that answers exit 0 without a readable pane refuses, typed", async (t) => {
	const { runner, calls } = scriptedHerdr({
		"workspace create": { exitCode: 0, stdout: "not json", stderr: "" },
	});
	const context = invocation(t, { runHerdr: runner });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.equal(value.error.kind, "herdr-unreadable-response");
	assert.equal(value.error.command, "workspace create");
	assert.match(value.error.message, /workspace create/);
	assert.equal(calls.length, 1, "the unreadable answer went on to run the command anyway");
});

test("a failed pane run names the workspace it created", async (t) => {
	const { runner, calls } = scriptedHerdr({
		"pane run": { exitCode: 1, stdout: "", stderr: "pane vanished" },
	});
	const context = invocation(t, { runHerdr: runner });

	const { exitCode, value } = await runCli(["start", "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.match(value.error.message, /pane run/);
	assert.equal(value.error.workspace, "w9", "the operator cannot find what exists");
	assert.equal(calls.length, 2);
});

// ── The structural guard (§13.B, §14.27) ─────────────────────────────────────

test("no factory module issues a Herdr pane, tab, or workspace close (§13.B)", () => {
	// The invariant is about the tree, not only about the launcher: a `pane
	// close` added to a future retry path would pass every behavioural test in
	// this file while destroying the classified drain report §10.1 leaves on
	// screen. The command-builder place is launch.mjs; the close verbs are
	// simply not a shape it or any sibling may build.
	const pattern = /["'](pane|workspace|tab|session)["']\s*,\s*["']close["']|(pane|workspace|tab|session)\s+close\b/i;
	for (const [file, source] of factorySources()) {
		assert.equal(pattern.test(source), false, `${file} builds a Herdr close command`);
	}
});

test("only the controller's own detach builds a Herdr `pane run` (§6.5, #157)", () => {
	// Also a tree invariant rather than a launcher one. §6.8's closed pane set is
	// declared on `tab create`; a future path that typed it into a shell instead
	// would pass every behavioural test here while putting the run's config roots
	// and the attempt identity back into scrollback anything can `pane read`.
	//
	// The shape ruled out is the *command*, not the word `export`: what this
	// replaced was `call(["pane", "run", pane, `export ${…}`])`, whose literal
	// text is an interpolation and which a search for `export NAME=` would miss.
	// One module may build it — launch.mjs runs the factory binary in the
	// controller's own pane and carries no worker environment (§10.1).
	const pattern = /["']pane["']\s*,\s*["']run["']|\bpane\s+run\b/;
	for (const [file, source] of factorySources()) {
		if (file.endsWith("controller/launch.mjs")) continue;
		assert.equal(pattern.test(source), false, `${file} builds a Herdr pane run`);
	}
});

// ── The run.started payload carries the controller's pane ────────────────────

test("the foreground run records the pane it runs in on run.started", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["start", "42", "--foreground"], context);

	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	const [started] = store.readEvents({ kind: "run.started" });
	assert.equal(started.run, value.report.run);
	assert.equal(started.payload.pane, "w1:p7", "the pane is not read back from the lease alone");
	store.close();
});

test("a run started outside a pane records no pane rather than guessing one", async (t) => {
	const context = invocation(t);
	delete context.env.HERDR_PANE_ID;

	const { value } = await runCli(["start", "42", "--foreground"], context);

	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	const [started] = store.readEvents({ kind: "run.started" });
	assert.equal(started.payload.pane, null);
	store.close();
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Run the CLI with the herdr command runner counting its calls. */
async function withCalls(context, argv) {
	const calls = { n: 0 };
	const original = context.runHerdr;
	context.runHerdr = async (...args) => {
		calls.n += 1;
		return original(...args);
	};
	try {
		const { exitCode, value } = await runCli(argv, context);
		return { exitCode, value, herdrCalls: calls.n };
	} finally {
		context.runHerdr = original;
	}
}

/** Every module the binary ships, as `[path, source]`. */
function factorySources(dir = fileURLToPath(new URL("../../factory", import.meta.url))) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return factorySources(path);
		return entry.name.endsWith(".mjs") ? [[path, readFileSync(path, "utf8")]] : [];
	});
}
