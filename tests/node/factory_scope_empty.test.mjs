import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { EXIT_OK, EXIT_REFUSED } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { PARENT_FLAG } from "../../factory/lib/controller/scope.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";

/**
 * #181: **a parent-scoped selector that resolves to no member is a refusal,
 * never a clean drain.**
 *
 * §3.1's membership is the literal first body line `Part of #N`. Every
 * implementation ticket this repository had published opened with a `## Parent`
 * heading instead, so `factory start --parent 75` covered nothing and reported
 * a drained scope — the plausible zero §11.2 refuses everywhere else. A scope
 * whose members are all *closed* is not empty: that is a delivered scope, and it
 * still drains.
 */

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

async function runParent(t, { world, parent, lanes = [] }) {
	const context = invocation(t);
	const gitea = fakeGitea(world);
	const loaded = loadFactoryConfig({ cwd: context.repoRoot });
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };

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

	return { answer, gitea, context, lanes };
}

async function runsRecorded(t, context) {
	const store = await openStore({ repoRoot: context.repoRoot, agentDir: context.agentDir });
	t.after(() => store.close());
	return store.readEvents({}).filter((event) => event.kind === "run.started");
}

test("a parent whose candidates all lack the `Part of #N` first line is refused, and no run is opened", async (t) => {
	const { answer, gitea, context, lanes } = await runParent(t, {
		parent: 75,
		world: {
			issues: [
				// The shape `to-tickets` used to publish: the parent named, but as a heading.
				giteaIssue({ number: 120, body: "## Parent\n\nSpecify a reliable Software Factory (#75)" }),
				// Someone else's child, correctly declared.
				giteaIssue({ number: 121, body: "Part of #76\n" }),
			],
		},
	});

	assert.equal(answer.exitCode, EXIT_REFUSED);
	assert.equal(answer.error.kind, "scope-empty");
	// The refusal names what the operator has to fix: the parent, the label the
	// candidates came from, and the line a candidate must open with.
	assert.match(answer.error.message, /#75/);
	assert.match(answer.error.message, /workflow:implement/);
	assert.match(answer.error.message, /Part of #75/);
	assert.equal(answer.error.parent, 75);
	// Both carry the label, so both were candidates; neither declared #75.
	assert.equal(answer.error.candidates, 2);

	assert.deepEqual(lanes, [], "a lane ran over an empty scope");
	assert.deepEqual(gitea.writes, [], "an empty scope wrote to the tracker");
	assert.deepEqual(await runsRecorded(t, context), [], "an empty scope opened a run");
});

test("a parent whose members are all closed is delivered, not empty: the run drains cleanly", async (t) => {
	const { answer, lanes } = await runParent(t, {
		parent: 75,
		world: {
			issues: [
				giteaIssue({ number: 120, body: "Part of #75\n", state: "closed" }),
				giteaIssue({ number: 121, body: "Part of #75\n\nwork", state: "closed" }),
			],
		},
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.end_reason, "drained");
	assert.equal(answer.report.execution.counts.closed, 2);
	assert.deepEqual(lanes, []);
});
