import { join } from "node:path";

export class FactoryGitError extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "FactoryGitError";
	}
}

export function createGitRuntime({ exec, cwd, baseBranch, remote }) {
	async function run(args, purpose, options = {}) {
		const response = await exec("git", args, { cwd, ...options });
		if (response.code !== 0) {
			throw new FactoryGitError(
				`Git failed while ${purpose}: ${response.stderr.trim() || `exit ${response.code}`}`,
			);
		}
		return response.stdout;
	}

	async function preflight() {
		const status = await run(["status", "--porcelain"], "checking repository status");
		if (status.trim() !== "") {
			throw new FactoryGitError(
				"The repository has uncommitted or untracked work. Commit or move it before starting the factory; the factory will not hide or overwrite it.",
			);
		}

		const ignored = await exec("git", ["check-ignore", "-q", ".worktrees"], { cwd });
		if (ignored.code !== 0) {
			throw new FactoryGitError(
				"The required .worktrees directory is not ignored. Add it to the repository's ignore rules before starting the factory.",
			);
		}
		await run(["rev-parse", "--verify", baseBranch], `verifying base branch ${baseBranch}`);
		await run(["remote", "get-url", remote], `verifying remote ${remote}`);
	}

	async function createRun(id) {
		const integrationBranch = `factory/${id}/integration`;
		const integrationPath = join(cwd, ".worktrees", `${id}-integration`);
		await run([
			"worktree", "add", "-b", integrationBranch, integrationPath, baseBranch,
		], `creating integration branch ${integrationBranch}`);
		return { id, integrationBranch, integrationPath };
	}

	async function createTicket(runState, ticketIndex) {
		const branch = `factory/${runState.id}/ticket-${ticketIndex}`;
		const path = join(cwd, ".worktrees", `${runState.id}-ticket-${ticketIndex}`);
		await run([
			"worktree", "add", "-b", branch, path, runState.integrationBranch,
		], `creating worktree for ticket #${ticketIndex}`);
		return { branch, path };
	}

	async function verifyTicket(runState, ticketState) {
		const status = await run([
			"-C", ticketState.path, "status", "--porcelain",
		], `checking ticket branch ${ticketState.branch}`);
		if (status.trim() !== "") {
			throw new FactoryGitError(`Worker left uncommitted changes on ${ticketState.branch}.`);
		}
		const count = await run([
			"rev-list", "--count", `${runState.integrationBranch}..${ticketState.branch}`,
		], `checking commits on ${ticketState.branch}`);
		if (!Number.isInteger(Number(count.trim())) || Number(count.trim()) < 1) {
			throw new FactoryGitError(`Worker produced no commits on ${ticketState.branch}.`);
		}
	}

	async function integrate(runState, ticketState, ticketIndex) {
		await run([
			"-C", runState.integrationPath,
			"merge", "--no-ff", ticketState.branch,
			"-m", `feat(factory): integrate ticket #${ticketIndex}`,
		], `integrating ticket #${ticketIndex}`);
	}

	async function verifyIntegration(runState, ticketState) {
		const status = await run([
			"-C", runState.integrationPath, "status", "--porcelain",
		], `checking integrated branch ${runState.integrationBranch}`);
		if (status.trim() !== "") {
			throw new FactoryGitError(`Integration branch ${runState.integrationBranch} is not clean.`);
		}
		await run([
			"-C", runState.integrationPath,
			"merge-base", "--is-ancestor", ticketState.branch, "HEAD",
		], `verifying ${ticketState.branch} is integrated`);
		await run([
			"-C", runState.integrationPath,
			"diff", "--check", `${baseBranch}...HEAD`,
		], `checking integrated diff for whitespace errors`);
	}

	async function publish(runState) {
		await run([
			"push", "--set-upstream", remote, runState.integrationBranch,
		], `publishing ${runState.integrationBranch}`);
	}

	return { preflight, createRun, createTicket, verifyTicket, integrate, verifyIntegration, publish };
}
