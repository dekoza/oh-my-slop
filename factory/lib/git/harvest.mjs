import { assertFactoryRef } from "./isolation.mjs";

/**
 * §7.4's harvest-side predicates, controller-enforced and deliberately split by
 * fault attribution: these are the **builder's** faults. The integration-side
 * checks — `git diff --check`, pushed-SHA identity — belong to integration
 * (§7.5) and are not here.
 */

/**
 * Assess whether one attempt is harvestable as `completed` (§7.4): the worktree
 * is clean — no uncommitted or untracked leftovers — **and** the branch has at
 * least one commit ahead of the pinned base.
 *
 * The answer is a typed verdict, never an action. A dirty worktree is reported
 * with its leftovers exactly as `git status` names them and is **never
 * auto-committed**; mapping the verdict onto §8.8's outcome taxonomy is the
 * stage machine's job, not this predicate's.
 *
 * @param {object} clone the private clone's handle (`clone.mjs`)
 * @param {object} attempt
 * @param {string} attempt.worktreePath
 * @param {string} attempt.branch the attempt's branch name
 * @param {string} attempt.baseCommit §7.2's pinned base
 * @returns {Promise<Readonly<
 *   { harvestable: true, head: string, commitsAhead: number } |
 *   { harvestable: false, reason: "worktree-dirty", leftovers: ReadonlyArray<string> } |
 *   { harvestable: false, reason: "no-commits", commitsAhead: 0 }>>}
 */
export async function assessHarvest(clone, { worktreePath, branch, baseCommit }) {
	assertFactoryRef(branch);

	const status = await clone.git(["status", "--porcelain"], { cwd: worktreePath });
	if (status !== "") {
		return Object.freeze({
			harvestable: false,
			reason: "worktree-dirty",
			leftovers: Object.freeze(status.split("\n")),
		});
	}

	const ahead = Number.parseInt(
		await clone.git(["rev-list", "--count", `${baseCommit}..refs/heads/${branch}`]),
		10,
	);
	if (ahead === 0) {
		return Object.freeze({ harvestable: false, reason: "no-commits", commitsAhead: 0 });
	}

	return Object.freeze({
		harvestable: true,
		head: await clone.git(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]),
		commitsAhead: ahead,
	});
}
