import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { EXIT_OK } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { workerConfigRoots } from "../../factory/lib/worker/environment.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { cloneValidConfig, makeRepo } from "./helpers/factory-repo.mjs";
import { makeAgentDir, makeHome, herdrAnswering } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";
import { fakeHerdr, workerTransportsAnswering } from "./helpers/factory-worker.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function exported(command) {
	return Object.fromEntries(
		[...command.matchAll(/([A-Z_]+)='([^']*)'/g)].map((match) => [match[1], match[2]]),
	);
}

function workerTurn({ builderStatuses = ["completed"], onAbandon = null } = {}) {
	let builderTurn = 0;
	return async ({ pane, text }) => {
		const identity = exported(pane.exported);
		const status =
			identity.FACTORY_PHASE === "implement"
				? (builderStatuses[Math.min(builderTurn++, builderStatuses.length - 1)] ?? "completed")
				: "completed";
		if (status === "abandon") {
			onAbandon?.();
			return;
		}

		const result = {
			schema_version: 1,
			status,
			run: identity.FACTORY_RUN,
			ticket: Number(identity.FACTORY_TICKET),
			phase: identity.FACTORY_PHASE,
			attempt: identity.FACTORY_ATTEMPT,
			summary: "the fixture worker completed its assigned role",
		};

		if (identity.FACTORY_PHASE === "implement" && status === "completed") {
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
		} else if (status === "needs-human") {
			result.reason_class = "product-ambiguity";
			result.question = "Which behavior should the implementation preserve?";
		} else if (status === "worker-failed") {
			result.classification = "implementation-failure";
			result.explanation = "the builder could not produce a valid change";
		} else {
			assert.match(text, /review-(standards|spec)/, "a review attempt received no axis invocation");
			result.commits = [git(pane.cwd, "rev-parse", "HEAD")];
			result.verdict = "approve";
			result.findings = [];
		}

		writeFileSync(identity.FACTORY_OUTBOX, `${JSON.stringify(result)}\n`, "utf8");
	};
}

async function runProduction(
	t,
	{
		turn = workerTurn(),
		signal = undefined,
		config = undefined,
		issue = giteaIssue({ number: 147, title: "feat: production pipeline" }),
		onTrackerWrite = null,
	} = {},
) {
	const packageRoot = makePackage(t);
	const executable = join(packageRoot, "factory", "bin", "factory.mjs");
	const repoRoot = makeRepo(t, config === undefined ? {} : { config });
	const agentDir = makeAgentDir(t);
	const env = { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" };
	const loaded = loadFactoryConfig({ cwd: repoRoot });
	const tracker = fakeGitea({
		issues: [issue],
		onWrite: (write, world) => onTrackerWrite?.({ write, world, loaded }),
	});
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };
	const herdr = fakeHerdr({ onPrompt: turn });
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
		...(signal === undefined ? {} : { signal }),
	});

	return { answer, tracker, loaded, repoRoot, agentDir, herdr, checkoutBefore };
}

test("runStart composes the production pipeline through publication without injected pipeline or execute (#147)", async (t) => {
	const { answer, tracker, loaded, repoRoot, agentDir, checkoutBefore } = await runProduction(t);

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.execution.missing ?? null, null);
	assert.equal(
		answer.report.execution.members[0].disposition,
		"published",
		JSON.stringify({ member: answer.report.execution.members[0], comments: tracker.comments }, null, 2),
	);
	const store = await openStore({ repoRoot, agentDir });
	t.after(() => store.close());
	assert.equal(
		store.readEvents({ kind: "effect.requested" }).filter((event) => event.payload.operation === "push").length,
		1,
		"the production path did not request exactly one push",
	);
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

test("every launched worker pane carries the controller-owned runtime binding, not the source pane's environment (§6.8)", async (t) => {
	const { answer, herdr, repoRoot, agentDir } = await runProduction(t);
	assert.equal(answer.report.execution.members[0].disposition, "published");

	const store = await openStore({ repoRoot, agentDir });
	t.after(() => store.close());
	const roots = workerConfigRoots(store.storeDir);

	// One builder and two review axes launched; the controller's own environment
	// in this test carries neither config-directory variable, so anything the
	// panes have was handed over deliberately rather than inherited.
	assert.equal(herdr.panes.length, 3);
	for (const pane of herdr.panes) {
		const variables = exported(pane.exported);
		assert.equal(variables.PI_CODING_AGENT_DIR, roots.pi, `${pane.pane_id} lacks the controller-owned pi root`);
		assert.equal(variables.CLAUDE_CONFIG_DIR, roots.claude, `${pane.pane_id} lacks the controller-owned Claude root`);
		assert.equal(variables.FACTORY_TICKET, "147", `${pane.pane_id} lost the identity channel`);
	}
});

test("profile model, thinking, and startup timeout reach the worker through its runtime adapter (§6.1, §11.4)", async (t) => {
	const config = cloneValidConfig();
	config.profiles.builder.thinking = "high";
	config.profiles.builder.startupTimeoutMs = 4321;
	const { herdr } = await runProduction(t, {
		config,
		turn: workerTurn({ builderStatuses: ["needs-human"] }),
	});
	const started = herdr.calls.find((args) => args.slice(0, 2).join(" ") === "agent start");

	assert.ok(started.includes("--model"));
	assert.ok(started.includes("local/qwen3"));
	assert.ok(started.includes("--thinking"));
	assert.ok(started.includes("high"));
	assert.deepEqual(started.slice(started.indexOf("--timeout"), started.indexOf("--timeout") + 2), ["--timeout", "4321"]);
});

test("a builder question reaches a durable paused disposition instead of escaping the claimed lane (#147, §8.9)", async (t) => {
	const { answer, tracker } = await runProduction(t, {
		turn: workerTurn({ builderStatuses: ["needs-human"] }),
	});

	assert.equal(answer.report.execution.members[0].disposition, "paused");
	assert.match(tracker.comments.at(-1).body, /Which behavior should the implementation preserve\?/);
	assert.match(tracker.comments.at(-1).body, /product-ambiguity/);
});

test("a repair re-enters through nextAttempt and publishes the repairing builder branch (#147, §8.5)", async (t) => {
	const { answer, tracker } = await runProduction(t, {
		turn: workerTurn({ builderStatuses: ["worker-failed", "completed"] }),
	});

	assert.equal(answer.report.execution.members[0].disposition, "published");
	assert.match(tracker.pulls[0].head.ref, /\/a.*-a2$/);
});

test("an exhausted builder failure reaches a durable failed disposition instead of escaping the claimed lane (#147, §8.10)", async (t) => {
	const { answer, tracker } = await runProduction(t, {
		turn: workerTurn({ builderStatuses: ["worker-failed", "worker-failed"] }),
	});

	assert.equal(answer.report.execution.members[0].disposition, "failed");
	assert.match(tracker.comments.at(-1).body, /repair-budget-exhausted/);
	assert.match(tracker.comments.at(-1).body, /worker-failed/);
});

test("an operator abandon durably releases a claimed production lane without waiting for its worker (#147, §8.9)", async (t) => {
	const signal = new EventEmitter();
	const { answer } = await runProduction(t, {
		signal,
		turn: workerTurn({ builderStatuses: ["abandon"], onAbandon: () => signal.emit("SIGTERM", "SIGTERM") }),
	});

	assert.equal(answer.report.end_reason, "abandoned");
	assert.equal(answer.report.execution.members[0].disposition, "released");
	assert.equal(answer.report.execution.released, 1);
});

test("a subsystem refusal after claim becomes a durable automation failure instead of an unexplained lane (#147, §8.9)", async (t) => {
	const { answer, tracker } = await runProduction(t, {
		onTrackerWrite: ({ write, loaded }) => {
			if (write.operation === "issue-assign") rmSync(loaded.remote.url, { recursive: true, force: true });
		},
	});

	assert.equal(answer.report.execution.members[0].disposition, "failed");
	assert.match(tracker.comments.at(-1).body, /cannot pin|git|fetch/i);
});
