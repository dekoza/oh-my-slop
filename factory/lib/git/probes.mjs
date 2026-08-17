import { statSync } from "node:fs";

import { runGit } from "./clone.mjs";
import { FactoryGitError, isMissingRef } from "./errors.mjs";
import { attemptWorktreePath, privateClonePath } from "./isolation.mjs";

/**
 * §5.3: each effect kind's probe ships with the subsystem that introduces the
 * kind, and git isolation introduces `branch-create`, `evidence-ref`,
 * `worktree-create`, and their deletion counterparts. Two reads serve all of
 * them: `git.rev-parse` for refs, `git.worktree-list` for worktrees.
 *
 * An effect row carries no payload — only its key — so both probes recompute
 * their target from the identity: the ref from the operand, the worktree path
 * from the attempt id. That is the reason §7.3 makes both deterministic.
 *
 * Git answers "what exists", never "when it changed": an absent ref has no
 * commit to date the observation with. The raw timestamp of an absence is the
 * repository directory's own mtime — the filesystem's record of the state that
 * answered — kept verbatim as §4.3 asks.
 */

/**
 * Register the git reads on a probe registry. The shipped `PROBES` registry is
 * populated once, from the binary's composition root (`cli/main.mjs`); a test
 * hands over its own registry.
 */
export function registerGitProbes(registry) {
	registry.register("git.rev-parse", probeRevParse);
	registry.register("git.worktree-list", probeWorktreeList);
	registry.register("git.ls-remote", probeLsRemote);
}

/** `branch-create` · `evidence-ref` · `branch-delete`: does the ref exist, and where. */
async function probeRevParse({ effect, probe, store }) {
	const cloneDir = privateClonePath(store.storeDir);
	const ref = refOf(effect);

	let sha = null;
	try {
		sha = await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: cloneDir });
	} catch (error) {
		if (!isMissingRef(error)) throw error;
	}

	const present = sha !== null;
	return {
		matched: probe.match === "absent" ? !present : present,
		result: { ref, sha },
		foreignSourceId: present ? `git:${sha}` : `git:${ref}`,
		occurredAtRaw: present
			? await runGit(["show", "--no-patch", "--format=%cI", sha], { cwd: cloneDir })
			: mtimeOf(cloneDir),
		detail: { clone: cloneDir, ref, present },
	};
}

/** `worktree-create` · `worktree-delete`: is the attempt's worktree registered. */
async function probeWorktreeList({ effect, probe, store }) {
	if (effect.attempt_id === null) {
		throw new FactoryGitError(
			"identity-mismatch",
			`Effect ${effect.effect_key} names no attempt; a worktree probe has no path to look for (§7.3).`,
			{ key: effect.effect_key },
		);
	}

	const cloneDir = privateClonePath(store.storeDir);
	const path = attemptWorktreePath(store.storeDir, effect.attempt_id);
	const listed = await runGit(["worktree", "list", "--porcelain"], { cwd: cloneDir });
	const present = listed.split("\n").includes(`worktree ${path}`);

	return {
		matched: probe.match === "absent" ? !present : present,
		result: { path, present },
		foreignSourceId: `git:worktree:${path}`,
		occurredAtRaw: present ? mtimeOf(path) : mtimeOf(cloneDir),
		detail: { clone: cloneDir, path, present },
	};
}

/**
 * `push`: does the remote carry this branch, at the commit the local branch is
 * at (§4.5's `sha-equals`).
 *
 * The comparison is against the **local** branch rather than against a sha in
 * the record, for the reason the other two probes recompute their targets: an
 * effect row carries no payload. That is also the right comparison — §7.5 pushes
 * one branch and never touches it again (§14.12), so local and remote agreeing
 * *is* the fact "this push landed", and a remote ahead of the local branch is
 * something this factory did not do.
 */
async function probeLsRemote({ effect, store }) {
	const cloneDir = privateClonePath(store.storeDir);
	const branch = refOf(effect);
	const listed = await runGit(["ls-remote", "origin", branch], { cwd: cloneDir });
	const remote = listed === "" ? null : listed.split("\n")[0].split("\t")[0];

	let local = null;
	try {
		local = await runGit(["rev-parse", "--verify", "--quiet", `${branch}^{commit}`], { cwd: cloneDir });
	} catch (error) {
		if (!isMissingRef(error)) throw error;
	}

	// A remote carrying a branch the clone has lost is **unanswerable, not
	// matched**: §12.8 makes a published attempt's local branch cleanup-eligible,
	// so this is a state the system creates on purpose, and dating the answer
	// from a commit that is not there would be a crash where §12.4 wants an
	// alarm. `absent` and `unanswerable` are different facts.
	const equal = remote !== null && local !== null && remote === local;
	return {
		matched: equal,
		// The same shape `git/integrate.mjs` writes when it performs the push, and
		// the same meanings: `sha` is the local branch and `remote_sha` is what the
		// remote answered. They are equal whenever this probe matches, which is the
		// only case the engine commits.
		result: { branch, sha: local, remote_sha: remote },
		foreignSourceId: `git:remote:${branch}@${remote ?? "absent"}`,
		occurredAtRaw:
			local === null ? mtimeOf(cloneDir) : await runGit(["show", "--no-patch", "--format=%cI", local], { cwd: cloneDir }),
		detail: { clone: cloneDir, ref: branch, remote_sha: remote, local_sha: local },
	};
}

/**
 * The operand names what was written: a branch for `branch-create`, a full ref
 * for `evidence-ref`. A ref-shaped operand is used verbatim; anything else is a
 * branch under `refs/heads/`.
 */
function refOf(effect) {
	if (effect.operand === null || effect.operand === "") {
		throw new FactoryGitError(
			"identity-mismatch",
			`Effect ${effect.effect_key} carries no operand; a ref probe has nothing to resolve (§4.5).`,
			{ key: effect.effect_key },
		);
	}
	return effect.operand.startsWith("refs/") ? effect.operand : `refs/heads/${effect.operand}`;
}

function mtimeOf(path) {
	return statSync(path).mtime.toISOString();
}
