import test from "node:test";
import assert from "node:assert/strict";

import { FactoryGitError, createGitRuntime } from "../../extensions/software-factory/lib/git.mjs";

function ok(stdout = "") {
	return { code: 0, stdout, stderr: "" };
}

function createRuntime(handler) {
	const calls = [];
	return {
		calls,
		git: createGitRuntime({
			cwd: "/repo",
			baseBranch: "main",
			remote: "gitea",
			exec: async (command, args, options) => {
				calls.push([command, args, options]);
				return handler(command, args, options);
			},
		}),
	};
}

test("preflight protects dirty repositories before creating factory branches", async () => {
	const { git, calls } = createRuntime(async () => ok(" M src/app.ts\n"));

	await assert.rejects(git.preflight(), FactoryGitError);
	assert.deepEqual(calls[0].slice(0, 2), ["git", ["status", "--porcelain"]]);
	assert.equal(calls.length, 1);
});

test("preflight requires the protected .worktrees location to be ignored", async () => {
	const { git } = createRuntime(async (_command, args) => {
		if (args[0] === "status") return ok();
		if (args[0] === "check-ignore") return { code: 1, stdout: "", stderr: "" };
		return ok();
	});

	await assert.rejects(
		git.preflight(),
		(error) => error instanceof FactoryGitError && error.message.includes(".worktrees"),
	);
});

test("createRun and createTicket use isolated branches under .worktrees", async () => {
	const { git, calls } = createRuntime(async () => ok());

	const run = await git.createRun("factory-20260812-a1");
	const ticket = await git.createTicket(run, 42);

	assert.deepEqual(run, {
		id: "factory-20260812-a1",
		integrationBranch: "factory/factory-20260812-a1/integration",
		integrationPath: "/repo/.worktrees/factory-20260812-a1-integration",
	});
	assert.deepEqual(ticket, {
		branch: "factory/factory-20260812-a1/ticket-42",
		path: "/repo/.worktrees/factory-20260812-a1-ticket-42",
	});
	assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
		["git", ["worktree", "add", "-b", run.integrationBranch, run.integrationPath, "main"]],
		["git", ["worktree", "add", "-b", ticket.branch, ticket.path, run.integrationBranch]],
	]);
});

test("verifyTicket rejects uncommitted worker changes", async () => {
	const { git } = createRuntime(async (_command, args) => {
		if (args.includes("status")) return ok("?? result.tmp\n");
		return ok("1\n");
	});

	await assert.rejects(
		git.verifyTicket(
			{ integrationBranch: "factory/run/integration" },
			{ branch: "factory/run/ticket-1", path: "/repo/.worktrees/run-ticket-1" },
		),
		(error) => error instanceof FactoryGitError && error.message.includes("uncommitted"),
	);
});
