import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { FactoryGitError } from "./errors.mjs";
import { assertFactoryRef, baseRef, privateClonePath } from "./isolation.mjs";

const execFileAsync = promisify(execFile);

/**
 * §7.1's factory-private bare clone: the one repository the factory operates
 * on, a peer of `state.db` in the controller-owned state area. The operator's
 * checkout is never read or written — nothing in this module takes its path.
 *
 * It is built by `git init --bare` plus a named remote rather than `git clone`,
 * because a clone would copy the remote's `refs/heads/*` wholesale and §14.11
 * wants the opposite: **every ref in the private clone is one the factory wrote
 * deliberately** — a pinned base under `refs/factory/base/*`, an attempt branch
 * under `factory/`, an evidence ref under `refs/factory/evidence/*`. That makes
 * the invariant observable with one `for-each-ref` instead of a rule about
 * which refs to ignore.
 */

/**
 * Open — creating or replacing as needed — the private clone for one
 * repository. The clone is **derived, disposable state** (§7.1): a directory
 * that is not a bare repository is removed and rebuilt, never repaired in
 * place. A healthy clone whose `origin` no longer matches the configured
 * remote converges by `set-url` instead — drift in a config-derived fact is
 * not corruption, and a rebuild would discard attempt branches that are the
 * only copy of unpushed work (§7.7).
 *
 * @param {object} where
 * @param {string} where.storeDir the repository's store directory (`store.storeDir`)
 * @param {string} where.remoteUrl the configured Gitea remote's URL
 * @param {typeof runGit} [where.git] injectable runner, so a test can observe
 *   serialization or force a failure without breaking a real repository
 * @returns {Promise<Readonly<{ dir: string, fetchBase: Function, createBranch: Function,
 *                              addWorktree: Function, listWorktrees: Function, git: Function }>>}
 */
/**
 * §7.7's serialization is a property of the *repository*, not of whoever asked
 * first: every opener of one clone directory shares one handle and therefore
 * one fetch chain. Keyed by the runner too, because a test that injects an
 * observing runner is asking for a handle whose calls it can see.
 */
const HANDLES = new Map();

export async function openPrivateClone({ storeDir, remoteUrl, git = runGit }) {
	const dir = privateClonePath(storeDir);

	if (!(await isBareRepository(dir, git))) {
		// Missing or corrupt means re-clone, never in-place repair (§7.1).
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dirname(dir), { recursive: true });
		await git(["init", "--bare", "--quiet", dir], { cwd: dirname(dir) });
		// Per-worktree config is where the factory identity lives (§7.3). Git's
		// contract for the extension: `core.bare` moves into the main tree's
		// `config.worktree`, or every linked worktree reads bare=true and
		// refuses to commit.
		await git(["config", "extensions.worktreeConfig", "true"], { cwd: dir });
		await git(["config", "--worktree", "core.bare", "true"], { cwd: dir });
		await git(["config", "--unset", "core.bare"], { cwd: dir });
		await git(["remote", "add", "origin", remoteUrl], { cwd: dir });
		// `remote add` installs `+refs/heads/*:refs/remotes/origin/*`, and git
		// opportunistically updates tracking refs it matches even when the fetch
		// names an explicit refspec. Dropping it keeps §14.11 observable: the
		// only refs a fetch may write are the ones the fetch names.
		await git(["config", "--unset-all", "remote.origin.fetch"], { cwd: dir });
	} else {
		await convergeOrigin(dir, remoteUrl, git);
	}

	const cached = HANDLES.get(dir);
	if (cached !== undefined && cached.git === git) return cached.handle;

	const handle = makeHandle(dir, git);
	HANDLES.set(dir, { git, handle });
	return handle;
}

function makeHandle(dir, git) {
	// §7.7: fetches into the private clone are serialized by the controller.
	// The controller lease makes this process the only controller, so a
	// per-handle chain is the whole mechanism — no cross-process lock exists
	// to take.
	let fetching = Promise.resolve();
	const serialized = (work) => {
		const turn = fetching.then(work, work);
		fetching = turn.then(
			() => undefined,
			() => undefined,
		);
		return turn;
	};

	return Object.freeze({
		dir,

		/**
		 * §7.2: fetch the remote's base branch and pin its tip under
		 * `refs/factory/base/<branch>` — the only ref a fetch may move, tags
		 * explicitly not followed (§14.11).
		 *
		 * @param {{ baseBranch: string }} what
		 * @returns {Promise<{ commit: string, ref: string }>}
		 */
		fetchBase: ({ baseBranch }) =>
			serialized(async () => {
				const ref = baseRef(baseBranch);
				await git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${baseBranch}:${ref}`], { cwd: dir });
				const commit = await git(["rev-parse", "--verify", `${ref}^{commit}`], { cwd: dir });
				return Object.freeze({ commit, ref });
			}),

		/**
		 * §7.3: one branch per attempt, at the pinned base. Deterministic naming
		 * makes a collision impossible, so an existing ref at a *different*
		 * commit is a mutation worth a typed refusal, never a force.
		 *
		 * @param {{ branch: string, at: string }} what
		 * @returns {Promise<{ sha: string, created: boolean }>}
		 */
		createBranch: async ({ branch, at }) => {
			assertFactoryRef(branch);
			const existing = await revParse(dir, `refs/heads/${branch}`, git);
			if (existing !== null) {
				if (existing !== at) {
					throw new FactoryGitError(
						"branch-collision",
						`Branch ${branch} already exists at ${existing}, not at the pinned base ${at}; ` +
							"deterministic names make this a mutation, never a race (§7.3).",
						{ ref: branch, expected: at, found: existing },
					);
				}
				return Object.freeze({ sha: existing, created: false });
			}
			await git(["branch", branch, at], { cwd: dir });
			return Object.freeze({ sha: at, created: true });
		},

		/**
		 * §7.3's one worktree per attempt, checked out on the attempt's branch.
		 * A path already registered for this branch is the same worktree asked
		 * for twice; anything else on the path is occupied, and never reused.
		 *
		 * @param {{ path: string, branch: string }} what
		 * @returns {Promise<{ path: string, created: boolean }>}
		 */
		addWorktree: async ({ path, branch }) => {
			assertFactoryRef(branch);
			const existing = (await listWorktrees(dir, git)).find((worktree) => worktree.worktree === path);
			if (existing !== undefined) {
				if (existing.branch !== `refs/heads/${branch}`) {
					throw new FactoryGitError(
						"worktree-occupied",
						`${path} is already a worktree of ${existing.branch ?? "a detached head"}, not of ${branch}; ` +
							"two attempts never share a worktree (§14.23).",
						{ path, expected: branch, found: existing.branch ?? null },
					);
				}
				return Object.freeze({ path, created: false });
			}
			await git(["worktree", "add", "--quiet", path, branch], { cwd: dir });
			return Object.freeze({ path, created: true });
		},

		listWorktrees: () => listWorktrees(dir, git),

		/** Reads and worktree-scoped writes for the modules above this one. */
		git: (args, options = {}) => git(args, { cwd: dir, ...options }),
	});
}

/**
 * Run one git command and answer its stdout, trimmed. Failure is a typed
 * refusal carrying git's own words — the operator debugs git problems with
 * git's diagnostics, not with a paraphrase.
 *
 * @param {string[]} args
 * @param {{ cwd: string }} options
 * @returns {Promise<string>}
 */
export async function runGit(args, { cwd }) {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
		return stdout.trim();
	} catch (error) {
		throw new FactoryGitError("git-command-failed", `git ${args.join(" ")} failed: ${(error.stderr ?? error.message).trim()}`, {
			command: ["git", ...args],
			cwd,
			stderr: (error.stderr ?? "").trim(),
		});
	}
}

async function isBareRepository(dir, git) {
	try {
		return (await git(["rev-parse", "--is-bare-repository"], { cwd: dir })) === "true";
	} catch {
		return false;
	}
}

/** Config drift converges in place; only structural damage rebuilds (§7.1). */
async function convergeOrigin(dir, remoteUrl, git) {
	let current = null;
	try {
		current = await git(["remote", "get-url", "origin"], { cwd: dir });
	} catch {
		await git(["remote", "add", "origin", remoteUrl], { cwd: dir });
		return;
	}
	if (current !== remoteUrl) {
		await git(["remote", "set-url", "origin", remoteUrl], { cwd: dir });
	}
}

async function revParse(dir, ref, git) {
	try {
		return await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: dir });
	} catch {
		return null;
	}
}

/** `git worktree list --porcelain`, parsed into one record per worktree. */
async function listWorktrees(dir, git) {
	const out = await git(["worktree", "list", "--porcelain"], { cwd: dir });
	const entries = [];
	let current = null;
	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			current = { worktree: line.slice("worktree ".length), head: null, branch: null };
			entries.push(current);
		} else if (line.startsWith("HEAD ") && current !== null) {
			current.head = line.slice("HEAD ".length);
		} else if (line.startsWith("branch ") && current !== null) {
			current.branch = line.slice("branch ".length);
		}
	}
	// The bare repository lists itself first; it is not a worktree.
	return Object.freeze(entries.filter((entry) => entry.worktree !== dir).map((entry) => Object.freeze(entry)));
}
