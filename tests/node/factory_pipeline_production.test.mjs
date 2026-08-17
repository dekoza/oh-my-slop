import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { EXIT_OK } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { FACTORY_ATTEMPT_TOKEN } from "../../factory/lib/controller/herdr-control.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { privateClonePath } from "../../factory/lib/git/isolation.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { workerConfigRoots } from "../../factory/lib/worker/environment.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { cloneValidConfig, makeRepo } from "./helpers/factory-repo.mjs";
import { makeAgentDir, makeHome, herdrAnswering } from "./helpers/factory-store.mjs";
import { dispositionBlockIn as blockIn, fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";
import { fakeHerdr, workerTransportsAnswering } from "./helpers/factory-worker.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/**
 * `commitsAlways` is #151's builder: one that commits real work and then ends
 * without claiming it — a timeout, a refusal, a dead pane. The commit is in the
 * worktree and nothing in the outbox mentions it.
 */
function workerTurn({ builderStatuses = ["completed"], commitsAlways = false, onAbandon = null } = {}) {
	let builderTurn = 0;
	return async ({ pane, text }) => {
		// The environment the pane's tab was created under (#157) — which is what a
		// real worker reads out of its own process, rather than off the scrollback.
		const identity = pane.env;
		const status =
			identity.FACTORY_PHASE === "implement"
				? (builderStatuses[Math.min(builderTurn++, builderStatuses.length - 1)] ?? "completed")
				: "completed";
		if (status === "abandon") {
			onAbandon?.();
			return;
		}
		// #154's provider refusal, as the worker experiences it: the turn ends,
		// **no outbox is written**, and the provider's error is the last thing on
		// the pane (the test puts it there through the fake's `paneOutput`). The
		// worker is still visibly working when the prompt lands, and settles a
		// beat later — a refusal kills the turn, it does not prevent it starting.
		if (status === "refused") {
			pane.agent_status = "working";
			pane.statusLocked = true;
			setTimeout(() => {
				pane.agent_status = "idle";
			}, 200);
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

		if (identity.FACTORY_PHASE === "implement" && (status === "completed" || commitsAlways)) {
			// Per attempt, because §8.5 branches a repair from the prior attempt's tip:
			// identical content there would leave the repair with nothing to commit.
			writeFileSync(
				join(pane.cwd, "implemented.txt"),
				`production composition reached the builder as ${identity.FACTORY_ATTEMPT}\n`,
				"utf8",
			);
			git(pane.cwd, "add", "implemented.txt");
			git(
				pane.cwd,
				"commit",
				"--quiet",
				"--message",
				`feat: implement ticket ${identity.FACTORY_TICKET}\n\nFactory-Attempt: ${identity.FACTORY_RUN}/${identity.FACTORY_TICKET}/${identity.FACTORY_ATTEMPT}`,
			);
		}

		if (identity.FACTORY_PHASE === "implement" && status === "completed") {
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
		paneOutput = "",
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
	const herdr = fakeHerdr({ onPrompt: turn, paneOutput });
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
	//
	// Three worker panes and **one** workspace: since #156 the run opens a single
	// workspace and every attempt is a tab in it (the fourth pane is that
	// workspace's own root, which no worker occupies).
	const workers = herdr.panes.filter((pane) => pane.tokens[FACTORY_ATTEMPT_TOKEN] !== undefined);
	assert.equal(workers.length, 3);
	assert.equal(herdr.commands().filter((command) => command === "workspace create").length, 1);
	assert.equal(new Set(workers.map((pane) => pane.workspace_id)).size, 1, "one run, one workspace");
	for (const pane of workers) {
		assert.equal(pane.env.PI_CODING_AGENT_DIR, roots.pi, `${pane.pane_id} lacks the controller-owned pi root`);
		assert.equal(pane.env.CLAUDE_CONFIG_DIR, roots.claude, `${pane.pane_id} lacks the controller-owned Claude root`);
		assert.equal(pane.env.FACTORY_TICKET, "147", `${pane.pane_id} lost the identity channel`);
	}

	// #157: and none of it was typed at a pane, so none of it is in the operator's
	// scrollback. The binding names two config roots per worker; a `pane run` here
	// would put both, and the attempt identity, into readable terminal output.
	assert.equal(herdr.commands().includes("pane run"), false);
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
	const { answer, tracker, repoRoot, agentDir } = await runProduction(t, {
		signal,
		turn: workerTurn({ builderStatuses: ["abandon"], onAbandon: () => signal.emit("SIGTERM", "SIGTERM") }),
	});

	assert.equal(answer.report.end_reason, "abandoned");
	assert.equal(answer.report.execution.members[0].disposition, "released");
	assert.equal(answer.report.execution.released, 1);
	// §9.6's boundary records the release in the journal — that is the fact this path
	// does produce, and the one the next reconcile reads.
	const store = await openStore({ repoRoot, agentDir });
	t.after(() => store.close());
	assert.deepEqual(
		store.readEvents({ kind: "ticket.disposition-changed" }).map((event) => event.payload.disposition),
		["released"],
	);
	// It settles nothing on the tracker: no §8.9 comment, and the claim left standing
	// for §3.3's staleness. So there is no disposition block on this path for #151's
	// read to ride — a gap in the boundary's settlement rather than in the read, since
	// a `released` reached through the walk carries it like any other row (#159).
	assert.equal(
		tracker.comments.filter((comment) => comment.body.includes('"disposition"')).length,
		0,
		"the abandon boundary now posts a disposition comment; #151's parked read belongs on it (#159)",
	);
});

test("#151: a ticket execution that harvested nothing names the branch and head SHA its commits are parked on", async (t) => {
	const { answer, tracker, repoRoot, agentDir } = await runProduction(t, {
		// A builder that committed real work and then ended without claiming it,
		// twice — the shape #114 arrived in, where the implementation was recoverable
		// only because an operator went looking inside the private clone by hand.
		turn: workerTurn({ builderStatuses: ["worker-failed", "worker-failed"], commitsAlways: true }),
	});

	assert.equal(answer.report.execution.members[0].disposition, "failed");
	const posted = tracker.comments.at(-1).body;
	const read = blockIn(posted).attempt_branches;
	assert.equal(read.source, "git-local");

	// §7.4: each attempt against its own base, so the repair is credited with its
	// own commit and not with the one it branched from.
	assert.deepEqual(
		read.branches.map((branch) => [branch.branch.endsWith("-a2"), branch.commits_ahead]),
		[
			[false, 1],
			[true, 1],
		],
	);

	// §5.2: the heads are git's answer, not the outbox's — neither of these workers
	// reported a commit at all.
	const store = await openStore({ repoRoot, agentDir });
	t.after(() => store.close());
	for (const branch of read.branches) {
		assert.equal(git(privateClonePath(store.storeDir), "rev-parse", `refs/heads/${branch.branch}`), branch.head);
		assert.ok(posted.includes(branch.head), `attempt ${branch.attempt}'s parked head is not visible to a human`);
	}
	assert.deepEqual(
		store.readEvents({ kind: "attempt.ended" }).map((event) => (event.payload.result?.commits ?? []).length),
		[0, 0],
		"the fixture's builders claimed a commit, so the heads above could have come from the outbox",
	);
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

test("#154: a provider refusal releases the ticket untouched and records the class memo", async (t) => {
	const { answer, tracker, repoRoot, agentDir } = await runProduction(t, {
		turn: workerTurn({ builderStatuses: ["refused"] }),
		paneOutput: "working...\nAPI Error: 429 insufficient_quota: you exceeded your current quota\n",
	});

	// The attempt is typed, and the ticket goes back to the frontier untouched:
	// released, never `factory:failed`, and no budget was spent deciding that.
	assert.equal(answer.report.execution.members[0].disposition, "released");
	assert.ok(
		tracker.writes.some((write) => write.operation === "issue-unassign"),
		"the released claim is dropped on the tracker",
	);
	assert.ok(
		!tracker.writes.some((write) => write.operation === "label-add"),
		"no eligibility label: the provider failed, not the ticket",
	);

	const store = await openStore({ repoRoot, agentDir });
	t.after(() => store.close());

	const [ended] = store.readEvents({ kind: "attempt.ended" });
	assert.equal(ended.payload.outcome, "provider-refused");

	const memos = store.readEvents({ kind: "capacity.exhausted" });
	assert.equal(memos.length, 1, "the observed refusal became the class's time-boxed memo");
	assert.equal(memos[0].payload.class, "local");
	assert.ok(memos[0].payload.until > ended.occurred_at, "the memo outlives the attempt that paid for it");
	assert.equal(memos[0].payload.evidence.source, "herdr");
});
