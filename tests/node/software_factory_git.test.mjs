import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { FactoryGitError, createGitRuntime } from "../../extensions/software-factory/lib/git.mjs";

const execFileAsync = promisify(execFile);

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

test("real Git worktrees integrate a committed ticket and pass post-merge verification", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "software-factory-git-real-"));
	const rawExec = async (command, args, options = {}) => {
		try {
			const output = await execFileAsync(command, args, { cwd: options.cwd });
			return { code: 0, stdout: output.stdout, stderr: output.stderr };
		} catch (error) {
			return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message };
		}
	};
	await rawExec("git", ["init", "-q", "-b", "main"], { cwd });
	await rawExec("git", ["config", "user.name", "Factory Test"], { cwd });
	await rawExec("git", ["config", "user.email", "factory@example.invalid"], { cwd });
	await writeFile(join(cwd, ".gitignore"), ".worktrees/\n");
	await writeFile(join(cwd, "README.md"), "base\n");
	await rawExec("git", ["add", ".gitignore", "README.md"], { cwd });
	await rawExec("git", ["commit", "-qm", "base"], { cwd });

	const git = createGitRuntime({ exec: rawExec, cwd, baseBranch: "main", remote: "origin" });
	const run = await git.createRun("factory-real");
	const ticket = await git.createTicket(run, 42);
	await writeFile(join(ticket.path, "feature.txt"), "working\n");
	await rawExec("git", ["add", "feature.txt"], { cwd: ticket.path });
	await rawExec("git", ["commit", "-qm", "feature"], { cwd: ticket.path });

	await git.verifyTicket(run, ticket);
	await git.integrate(run, ticket, 42);
	await git.verifyIntegration(run, ticket);
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
