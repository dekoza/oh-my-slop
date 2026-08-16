import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { runCli } from "../../factory/lib/cli/main.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { cloneValidConfig, makeRepo } from "./helpers/factory-repo.mjs";
import {
	FIXED_NOW,
	attemptLaunched,
	herdrAnswering,
	makeAgentDir,
	makeHome,
	openTestStore,
	runStarted,
} from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";

/**
 * `factory status` (§10.2), and §9.7's saturation numbers on it: **the declared
 * ceiling, the effective concurrency, and per class size, held and waiting**.
 *
 * "The run is slow" looks identical whether lanes are working or all of them are
 * queued behind one slot, and a config saying 4 while routing resolves entirely
 * to `local` is a comfortable lie. These are the numbers that tell them apart.
 */

function invocation(t, { config } = {}) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");

	return {
		cwd: makeRepo(t, config === undefined ? {} : { config }),
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr: herdrAnswering(),
		workerTransports: workerTransportsAnswering(root),
		pipeline: null,
	};
}

test("status answers in a repository the factory has never run in", async (t) => {
	const context = invocation(t);

	const { exitCode, value } = await runCli(["status"], context);

	assert.equal(exitCode, 0);
	assert.equal(value.report.store.present, false);
	assert.deepEqual(value.report.runs, []);
});

test("status prints the declared ceiling, the effective concurrency, and per class size, held and waiting", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["status"], context);

	assert.equal(value.report.capacity.declared_ceiling, 1);
	assert.equal(value.report.capacity.effective_concurrency, 1);
	assert.deepEqual(value.report.capacity.classes, [
		{ class: "local", size: 1, held: 0, waiting: 0, superseded: 0 },
	]);
});

test("a local-only routing reports effective concurrency 1 whatever the ceiling declares", async (t) => {
	const config = cloneValidConfig();
	config.profiles.cloud = { kind: "claude", model: "opus" };
	config.routing.sets = {
		cloud: { roles: { implement: "cloud", freshRetry: "cloud", review: ["cloud", "cloud"] }, rules: [] },
	};
	config.concurrency.resources["claude-code"] = 4;
	const context = invocation(t, { config });

	const { value } = await runCli(["status"], context);

	assert.equal(
		value.report.capacity.effective_concurrency,
		1,
		"the dormant cloud set's four slots are not this run's; the active routing is local, size 1 (§9.2)",
	);
	assert.deepEqual(
		value.report.capacity.classes.map((entry) => entry.class),
		["local"],
	);
});

test("status reports the run a start left behind, and the slots it no longer holds", async (t) => {
	const context = invocation(t);
	const loaded = loadFactoryConfig({ cwd: context.cwd });

	const started = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		herdr: context.herdr,
		workerTransports: context.workerTransports,
		pipeline: context.pipeline,
		args: ["42"],
		flags: new Set(["--foreground"]),
	});

	const { value } = await runCli(["status"], context);

	assert.deepEqual(
		value.report.runs.map((run) => [run.run, run.lifecycle, run.end_reason]),
		[[started.report.run, "ended", "drained"]],
	);
	assert.deepEqual(value.report.capacity.ticket, { size: 1, held: 0, waiting: 0, superseded: 0 });
	assert.deepEqual(value.report.capacity.holders, []);
});

test("status carries the sections this slice owes and no speculative others", async (t) => {
	const context = invocation(t);

	const { value } = await runCli(["status"], context);

	assert.deepEqual(Object.keys(value.report), ["schema_version", "at", "store", "runs", "capacity"]);
});

test("status shows a ticket execution's outcome chain (§8.10)", async (t) => {
	const context = invocation(t);
	const store = await openTestStore(t, { repoRoot: context.cwd, agentDir: context.agentDir });
	const opened = runStarted();
	store.append(opened);
	store.append(attemptLaunched(opened.run, 42, 1));
	const resolved = (phase, outcome) => ({
		kind: "stage.resolved",
		source: "controller",
		run: opened.run,
		ticket: 42,
		phase,
		attempt: `${opened.run}-t42-a1`,
		occurredAt: FIXED_NOW,
		observedAt: FIXED_NOW,
		payload: { outcome, action: "advance", budget: null, detail: null, anomaly: null, result_digest: "d" },
	});
	store.append(resolved("implement", "completed"));
	store.append(resolved("harvest", "passed"));
	store.append(resolved("verify", "failed"));
	store.close();

	const { value } = await runCli(["status"], context);

	assert.deepEqual(value.report.runs[0].executions, [
		{
			ticket: 42,
			phase: "verify",
			disposition: null,
			attempts: 1,
			// The shape, never summarised to its last element: what an operator does
			// next depends on how a ticket execution got here (§8.10).
			chain: [
				{ phase: "implement", outcome: "completed" },
				{ phase: "harvest", outcome: "passed" },
				{ phase: "verify", outcome: "failed" },
			],
		},
	]);
});
