import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

/**
 * Git facts the factory needs before a run exists. Both are read through git
 * itself rather than by parsing `.git/`: the binary is expected to run from
 * attempt worktrees, where `.git` is a file and the layout is git's business.
 */

function git(args, { cwd }) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/**
 * The repo root reached by walking up from `startDir`, or null when the
 * directory belongs to no repository.
 * @returns {string | null}
 */
export function resolveRepoRoot(startDir) {
	try {
		const root = git(["rev-parse", "--show-toplevel"], { cwd: startDir });
		return root === "" ? null : root;
	} catch {
		return null;
	}
}

/**
 * The configured URL of one named remote, or null when the remote is absent.
 * @returns {string | null}
 */
export function resolveRemoteUrl(repoRoot, remoteName) {
	try {
		const url = git(["remote", "get-url", remoteName], { cwd: repoRoot });
		return url === "" ? null : url;
	} catch {
		return null;
	}
}

/**
 * §11.7's checkout metadata for a directory: the commit it sits on and whether
 * its worktree is dirty. **Metadata only** — the tree digest is what is
 * authoritative, uniformly for every install shape, because special-casing
 * checkouts would make dev runs incomparable to installed runs and dirty
 * checkouts are the common case.
 *
 * Both are null unless `directory` is *itself* a repository root. A package
 * installed under somebody else's `node_modules` would otherwise report that
 * repository's commit, which is a fact about the consumer and pins nothing
 * about the package.
 *
 * @param {string} directory
 * @returns {{ commit: string | null, dirty: boolean | null }}
 */
export function describeCheckout(directory) {
	const top = resolveRepoRoot(directory);
	if (top === null || realpathOrNull(top) !== realpathOrNull(directory)) return { commit: null, dirty: null };

	let commit;
	try {
		commit = git(["rev-parse", "HEAD"], { cwd: directory });
	} catch {
		// An unborn HEAD: a checkout with no commit yet. It still has a worktree,
		// and "no commit" is the honest answer rather than a refusal.
		commit = null;
	}

	return { commit: commit === "" ? null : commit, dirty: git(["status", "--porcelain"], { cwd: directory }) !== "" };
}

function realpathOrNull(path) {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

/**
 * The `owner/repository` a remote URL points at, or null when the URL carries
 * no such pair. Handles the three shapes a Gitea remote actually takes: scp
 * (`git@host:owner/repo.git`), ssh/https URLs, and local paths.
 * @returns {string | null}
 */
export function remoteUrlToRepoSlug(url) {
	if (typeof url !== "string" || url.trim() === "") return null;

	let path = url.trim();
	const scp = /^[^/]+@([^/:]+):(.+)$/.exec(path);
	if (scp && !path.includes("://")) {
		path = scp[2];
	} else {
		const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.*)$/.exec(path);
		if (scheme) {
			const afterAuthority = scheme[1].replace(/^[^/]*/, "");
			path = afterAuthority;
		}
	}

	path = path.replace(/\.git$/, "").replace(/\/+$/, "");
	const segments = path.split("/").filter((segment) => segment !== "");
	if (segments.length < 2) return null;

	return `${segments.at(-2)}/${segments.at(-1)}`;
}
