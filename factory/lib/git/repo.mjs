import { execFileSync } from "node:child_process";

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
