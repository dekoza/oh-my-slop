import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { EXIT_OK } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { makeAgentDir, makeHome, herdrAnswering } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";
import { fakeHerdr, workerTransportsAnswering } from "./helpers/factory-worker.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function exported(command) {
	return Object.fromEntries(
		[...command.matchAll(/([A-Z_]+)='([^']*)'/g)].map((match) => [match[1], match[2]]),
	);
}

function workerTurn() {
	return async ({ pane, text }) => {
		const identity = exported(pane.exported);
		const result = {
			schema_version: 1,
			status: "completed",
			run: identity.FACTORY_RUN,
			ticket: Number(identity.FACTORY_TICKET),
			phase: identity.FACTORY_PHASE,
			attempt: identity.FACTORY_ATTEMPT,
			summary: "the fixture worker completed its assigned role",
		};

		if (identity.FACTORY_PHASE === "implement") {
			writeFileSync(join(pane.cwd, "implemented.txt"), "production composition reached the builder\n", "utf8");
			git(pane.cwd, "add", "implemented.txt");
			git(
				pane.cwd,
				"commit",
				"--quiet",
				"--message",
				`feat: implement ticket ${identity.FACTORY_TICKET}\n\nFactory-Attempt: ${identity.FACTORY_RUN}/${identity.FACTORY_TICKET}/${identity.FACTORY_ATTEMPT}`,
			);
			result.commits = [git(pane.cwd, "rev-parse", "HEAD")];
		} else {
			assert.match(text, /review-(standards|spec)/, "a review attempt received no axis invocation");
			result.commits = [git(pane.cwd, "rev-parse", "HEAD")];
			result.verdict = "approve";
			result.findings = [];
		}

		writeFileSync(identity.FACTORY_OUTBOX, `${JSON.stringify(result)}\n`, "utf8");
	};
}

test("runStart composes the production pipeline through publication without injected pipeline or execute (#147)", async (t) => {
	const packageRoot = makePackage(t);
	const executable = join(packageRoot, "factory", "bin", "factory.mjs");
	const repoRoot = makeRepo(t);
	const agentDir = makeAgentDir(t);
	const env = { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" };
	const loaded = loadFactoryConfig({ cwd: repoRoot });
	const tracker = fakeGitea({ issues: [giteaIssue({ number: 147, title: "feat: production pipeline" })] });
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };
	const herdr = fakeHerdr({ onPrompt: workerTurn() });
	const checkoutBefore = git(repoRoot, "status", "--porcelain=v1", "--untracked-files=all");

	const answer = await runStart({
		...loaded,
		agentDir,
		executable,
		env,
		args: ["147"],
		flags: new Set([FOREGROUND_FLAG]),
		herdr: herdrAnswering(true),
		runHerdr: herdr.run,
		workerTransports: workerTransportsAnswering(packageRoot),
		tracker: createGiteaReader({ ...where, request: tracker.request }),
		trackerWriter: createGiteaWriter({ ...where, request: tracker.write }),
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.execution.missing ?? null, null);
	assert.equal(
		answer.report.execution.members[0].disposition,
		"published",
		JSON.stringify({ member: answer.report.execution.members[0], comments: tracker.comments }, null, 2),
	);
	assert.equal(tracker.writes.filter((write) => write.operation === "push").length, 0);
	assert.equal(tracker.writes.filter((write) => write.operation === "pr-create").length, 1);
	assert.equal(tracker.pulls.length, 1);
	assert.equal(
		execFileSync("git", ["ls-remote", loaded.remote.url, `refs/heads/${tracker.pulls[0].head.ref}`], { encoding: "utf8" })
			.trim()
			.split("\t").length,
		2,
		"the published branch was not pushed once to the configured remote",
	);
	assert.equal(git(repoRoot, "status", "--porcelain=v1", "--untracked-files=all"), checkoutBefore);
});
