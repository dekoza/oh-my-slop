import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_OK, EXIT_REFUSED } from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { VERB_TABLE } from "../../factory/lib/cli/verbs.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { ENTRY_MODES } from "../../factory/lib/controller/entry.mjs";
import { CONTROLLER_PANE_ENV, FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { PARENT_FLAG, parseScope, SCOPE_FORMS } from "../../factory/lib/controller/scope.mjs";
import { NEW_RUN_FLAG } from "../../factory/lib/controller/start.mjs";
import { CONTROLLER_LEASE } from "../../factory/lib/domain/vocabulary.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, leaseIdentity, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";
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

/**
 * A run in the repository: with the lease, the live holder a controller mid-run
 * leaves; without it, the orphan §10.4 re-enters and `--new-run` refuses to.
 */
async function runIn(context, { runId, scope, lease = true }) {
	const store = await openStore({ repoRoot: context.cwd, agentDir: context.agentDir });
	store.append({
		kind: "run.started",
		source: "controller",
		run: runId,
		occurredAt: Date.now(),
		observedAt: Date.now(),
		payload: { scope, mode: ENTRY_MODES.started, pane: "w1:p3" },
	});
	if (lease) {
		openLeases(store).acquire({ name: "controller", identity: leaseIdentity({ run: runId, pane: "w1:p3" }) });
	}
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
		// The marker that tells the controller the factory made this pane, so its
		// run may be stamped onto it and cleanup may later reclaim it (§12.8,
		// §14.27). A pane the operator ran `--foreground` from carries no such
		// declaration and is never a target.
		"--env",
		`${CONTROLLER_PANE_ENV}=${calls[0][5]}`,
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
	await runIn(context, { runId: "live-run-1", scope: { kind: "direct-ticket", tickets: [40, 42] } });

	const { exitCode, value, herdrCalls } = await withCalls(context, ["start", "42"]);

	assert.equal(exitCode, EXIT_OK);
	assert.equal(value.report.run, "live-run-1");
	assert.equal(value.report.queued, false);
	assert.match(value.message, /already in scope/);
	assert.equal(herdrCalls, 0, "a live run made the launcher touch Herdr");
});

test("a live run that does not cover the scope refuses before any Herdr contact", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });
	await runIn(context, { runId: "live-run-2", scope: { kind: "direct-ticket", tickets: [40] } });

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

// ── The relaunched line carries the whole invocation (§10.1, #213) ───────────

/**
 * #213: the relaunch used to carry the positional scope alone, so every flag the
 * operator typed was dropped between the two processes and neither refused. The
 * tests below run the line the launcher *says* it ran, which is the only way the
 * disagreement shows: `--parent 75` reaching the pane as a bare `75` is a
 * perfectly ordinary invocation of a different scope.
 */

/**
 * A tracker and a pipeline for the tests that follow the relaunched line into a
 * run. The rest of this file drives the launcher alone and keeps `pipeline:
 * null`, which is what stops those tests reading a tracker at all.
 */
function executing(context, world, lanes) {
	const gitea = fakeGitea(world);
	const { config } = loadFactoryConfig({ cwd: context.cwd });
	const where = { repo: config.tracker.repo, login: config.tracker.login };

	return {
		tracker: createGiteaReader({ ...where, request: gitea.request }),
		trackerWriter: createGiteaWriter({ ...where, request: gitea.write }),
		pipeline: async (lane) => {
			lanes.push(lane);
			return { disposition: "published", pr: { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" } };
		},
	};
}

/** The scope a line resolves to, read the way `main.mjs` sorts its tokens. */
function scopeOf(argv) {
	const flags = argv.filter((token) => token.startsWith("-"));
	const args = argv.slice(1).filter((token) => !token.startsWith("-"));
	return parseScope(args, { parent: flags.includes(PARENT_FLAG) });
}

test("a detached --parent start runs the parent's members in the pane, not the parent (#213)", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });
	const lanes = [];
	// #213's case: a parent carrying no `wayfinder:map`, so #182's resolution
	// cannot recover the membership a dropped `--parent` lost.
	const world = { issues: [giteaIssue({ number: 75 }), giteaIssue({ number: 120, body: "Part of #75" })] };
	Object.assign(context, executing(context, world, lanes));

	const { value } = await runCli(["start", PARENT_FLAG, "75"], context);
	assert.deepEqual(value.report.command, [context.executable, "start", FOREGROUND_FLAG, PARENT_FLAG, "75"]);

	// The line the launcher reported, run: the controller resolves it again, and
	// must reach the same scope the launcher did.
	const relaunched = await runCli(value.report.command.slice(1), context);

	assert.equal(relaunched.exitCode, EXIT_OK);
	assert.equal(relaunched.value.report.scope.kind, SCOPE_FORMS.parent);
	assert.equal(relaunched.value.report.scope.parent, 75);
	assert.deepEqual(
		lanes.map((lane) => lane.ticket),
		[120],
		"the pane claimed the parent itself rather than the members of its scope",
	);
});

test("a detached --new-run start opens a fresh run in the pane rather than re-entering (#213)", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });
	await runIn(context, { runId: "orphan-run-1", scope: { kind: "direct-ticket", tickets: [42] }, lease: false });

	const { value } = await runCli(["start", NEW_RUN_FLAG, "43"], context);
	assert.deepEqual(value.report.command, [context.executable, "start", FOREGROUND_FLAG, NEW_RUN_FLAG, "43"]);

	const relaunched = await runCli(value.report.command.slice(1), context);

	assert.equal(relaunched.exitCode, EXIT_OK);
	assert.equal(relaunched.value.report.entry.mode, ENTRY_MODES.forced);
	assert.notEqual(relaunched.value.report.run, "orphan-run-1", "the pane re-entered the run it was told to refuse");
});

test("every flag `start` declares reaches the relaunched line, and both sides resolve one scope (#213)", async (t) => {
	for (const [flag, declared] of Object.entries(VERB_TABLE.start.flags)) {
		// `--foreground` is what the relaunch adds; a flag whose subsystem has not
		// landed refuses in the CLI, above the launcher, and has no line to reach.
		if (flag === FOREGROUND_FLAG || declared.missing !== undefined) continue;

		const typed = declared.value === undefined ? flag : `${flag}=v`;
		const operator = ["start", typed, "42"];
		const context = invocation(t, { runHerdr: scriptedHerdr().runner });

		const { value } = await runCli(operator, context);

		assert.deepEqual(
			value.report.command,
			[context.executable, "start", FOREGROUND_FLAG, typed, "42"],
			`${flag} did not reach the relaunched line`,
		);
		assert.deepEqual(
			scopeOf(value.report.command.slice(1)),
			scopeOf(operator),
			`the launcher and the pane resolve different scopes for ${flag}`,
		);
	}
});

test("the report's command is the command Herdr was given, and the foreground remedy repeats it (#213)", async (t) => {
	const { runner, calls } = scriptedHerdr();
	const context = invocation(t, { runHerdr: runner });

	const { value } = await runCli(["start", NEW_RUN_FLAG, "42", "43"], context);

	assert.deepEqual(calls[1].slice(3), value.report.command, "the report named a command other than the one run");
	assert.equal(value.report.foreground_alternative, `factory start ${FOREGROUND_FLAG} ${NEW_RUN_FLAG} 42 43`);
});

test("--json renders the launcher's own report and is the one flag left behind (#213)", async (t) => {
	const context = invocation(t, { runHerdr: scriptedHerdr().runner });

	const { json, value } = await runCli(["start", NEW_RUN_FLAG, "42", "--json"], context);

	assert.equal(json, true, "the launcher rendered the shape the operator asked for");
	assert.deepEqual(value.report.command, [context.executable, "start", FOREGROUND_FLAG, NEW_RUN_FLAG, "42"]);
});

test("the Herdr-unavailable remedy repeats every flag the operator typed (#213)", async (t) => {
	const context = invocation(t, { herdr: UNAVAILABLE, runHerdr: scriptedHerdr().runner });

	const { exitCode, value } = await runCli(["start", NEW_RUN_FLAG, "42"], context);

	assert.equal(exitCode, EXIT_REFUSED);
	assert.match(value.error.message, /factory start --foreground --new-run 42/);
});

// ── The structural guard (§13.B, §14.27) ─────────────────────────────────────

test("only cleanup's own reclaimer issues a Herdr pane close, and nothing closes a tab or workspace (§13.B, §12.8)", () => {
	// The invariant is about the tree, not only about the launcher: a `pane
	// close` added to a future retry path would pass every behavioural test in
	// this file while destroying the classified drain report §10.1 leaves on
	// screen. The close verbs are simply not a shape the controller's modules
	// may build.
	//
	// §12.8 whitelists two pane kinds as cleanup targets, so exactly one module
	// may build the command — `cleanup/panes.mjs`, which nothing on a run loop's
	// path imports. The exemption is a **file**, not a relaxation of the
	// pattern: a close reappearing anywhere else still fails here, which is what
	// keeps "the controller never closes a pane" a property of the tree.
	//
	// Containers stay off-limits everywhere. §12.8's whitelist has six entries
	// and none of them is a tab, a workspace, or a session, so no exemption
	// widens past `pane`.
	const anyClose = /["'](pane|workspace|tab|session)["']\s*,\s*["']close["']|(pane|workspace|tab|session)\s+close\b/i;
	const containerClose = /["'](workspace|tab|session)["']\s*,\s*["']close["']|(workspace|tab|session)\s+close\b/i;

	for (const [file, source] of factorySources()) {
		const pattern = file.endsWith("cleanup/panes.mjs") ? containerClose : anyClose;
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
