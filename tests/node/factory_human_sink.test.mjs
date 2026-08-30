import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { EXIT_OK } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { PARENT_FLAG } from "../../factory/lib/controller/scope.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { runDoctor } from "../../factory/lib/doctor/verb.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";

/**
 * #183: **every map ends in a `ready-for-human` review ticket, and the run
 * reports it as the sink.**
 *
 * A parent-scoped run with no `ready-for-human` member would go quiet when it
 * drains; the run and `doctor` warn. When everything else is closed, the drain
 * report leads with the sink — the one ticket that asks the operator to look.
 */

const SINK = () =>
	giteaIssue({
		number: 199,
		title: "Review the delivered Software Factory",
		body: "Part of #75\n",
		labels: [FACTORY_LABELS.implementation, FACTORY_LABELS.readyForHuman],
	});
const CLOSED = (number) => giteaIssue({ number, body: "Part of #75\n", state: "closed" });
const PAUSED = (number) =>
	giteaIssue({
		number,
		title: `paused ${number}`,
		body: "Part of #75\n",
		labels: [FACTORY_LABELS.implementation, FACTORY_LABELS.readyForAgent, FACTORY_LABELS.needsHuman],
	});

function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");
	const repoRoot = makeRepo(t);

	return {
		repoRoot,
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr: herdrAnswering(true),
		workerTransports: workerTransportsAnswering(root),
	};
}

async function runParent(t, { issues, parent = 75 }) {
	const context = invocation(t);
	const gitea = fakeGitea({ issues });
	const loaded = loadFactoryConfig({ cwd: context.repoRoot });
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };
	const lanes = [];

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		herdr: context.herdr,
		workerTransports: context.workerTransports,
		args: [String(parent)],
		flags: new Set([FOREGROUND_FLAG, PARENT_FLAG]),
		tracker: createGiteaReader({ ...where, request: gitea.request }),
		trackerWriter: createGiteaWriter({ ...where, request: gitea.write }),
		pipeline: async (lane) => {
			lanes.push(lane);
			return { disposition: "published", pr: { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" } };
		},
	});

	return { answer, lanes, context };
}

test("a parent scope with no ready-for-human member warns no-human-sink, and still runs", async (t) => {
	const { answer } = await runParent(t, { issues: [CLOSED(120), giteaIssue({ number: 121, body: "Part of #75\n" })] });

	assert.equal(answer.exitCode, EXIT_OK);
	assert.deepEqual(
		answer.report.warnings.map((warning) => warning.reason),
		["no-human-sink"],
	);
	assert.match(answer.report.warnings[0].message, /ready-for-human/);
	assert.match(answer.message, /nothing will ask for your review/);
	assert.deepEqual(answer.report.execution.sink, []);
});

test("a delivered scope leads with the sink: everything else closed, one ticket waiting on the operator", async (t) => {
	const { answer, lanes } = await runParent(t, { issues: [CLOSED(120), CLOSED(121), SINK()] });

	assert.equal(answer.exitCode, EXIT_OK);
	assert.deepEqual(answer.report.warnings, []);
	assert.deepEqual(lanes, [], "the sink was claimed");
	assert.deepEqual(answer.report.execution.sink, [199]);
	assert.match(answer.message, /^Delivered\. Waiting on you: Review the delivered Software Factory \(#199\)\./);
});

test("with other human-action members the sink comes last, not first", async (t) => {
	const { answer } = await runParent(t, { issues: [CLOSED(120), PAUSED(121), SINK()] });

	assert.equal(answer.exitCode, EXIT_OK);
	assert.deepEqual(answer.report.execution.sink, [199]);
	assert.doesNotMatch(answer.message, /^Delivered/);
	assert.match(answer.message, /#121/);
	assert.match(answer.message, /waiting on you last: Review the delivered Software Factory \(#199\)\.$/);
});

async function doctorParent(t, issues) {
	const context = invocation(t);
	const gitea = fakeGitea({ issues });
	const { config, activeRouting } = loadFactoryConfig({ cwd: context.repoRoot });

	return runDoctor({
		repoRoot: context.repoRoot,
		agentDir: context.agentDir,
		config,
		activeRouting,
		args: ["75"],
		flags: new Set([PARENT_FLAG]),
		tracker: createGiteaReader({ repo: config.tracker.repo, login: config.tracker.login, request: gitea.request }),
		probes: createProbeRegistry(),
		executable: context.executable,
		env: context.env,
	});
}

test("doctor --parent lists the sinks by name, and warns without failing when there are none", async (t) => {
	const withSink = await doctorParent(t, [CLOSED(120), SINK()]);
	assert.deepEqual(
		withSink.report.scope.sinks.map((sink) => [sink.ticket, sink.title]),
		[[199, "Review the delivered Software Factory"]],
	);
	assert.deepEqual(withSink.report.warnings, []);

	const without = await doctorParent(t, [CLOSED(120), giteaIssue({ number: 121, body: "Part of #75\n" })]);
	assert.deepEqual(without.report.scope.sinks, []);
	assert.deepEqual(
		without.report.warnings.map((warning) => warning.reason),
		["no-human-sink"],
	);
	// A warning, not an alarm: the diagnosis is still a clean bill for everything it checked.
	assert.equal(without.report.alarms.some((alarm) => alarm.reason === "no-human-sink"), false);
	assert.match(without.message, /no-human-sink/);
});
