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
 * least one commit ahead of **the attempt's own base** (§7.3).
 *
 * Its own base, never the run's: a repair branches from the prior attempt's tip
 * (§8.5), so a repair measured against the run's base would be "ahead" by the
 * commits the attempt before it made, and a repair worker that committed nothing
 * would harvest as `completed`.
 *
 * **Under a rebase-repair the boundary is the merge-base with the base the
 * worker was told to rebase onto** (#194). Its own base is the prior tip, and
 * after a rebase the prior tip is no longer an ancestor at all: `rev-list
 * --count priorTip..branch` would count every commit of the base's movement as
 * the worker's, and a rebase-repair that rebased nothing but a branch full of
 * base commits would read as productive. The merge-base with `onto` is the
 * point the worker's own commits — the replayed ones and any it added — sit
 * on, whether the branch was rebased or left where it was.
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
 * @param {string} attempt.baseCommit the attempt's own base — §7.2's pinned base
 *   for a first attempt and a fresh-retry, the prior attempt's tip for a repair (§7.3, §8.5)
 * @param {string | null} [attempt.onto] the base commit a rebase-repair was told
 *   to rebase onto (§8.5, #194); `null` for every other tier, whose boundary is
 *   `baseCommit` itself
 * @returns {Promise<Readonly<
 *   { harvestable: true, head: string, commitsAhead: number } |
 *   { harvestable: false, reason: "worktree-dirty", leftovers: ReadonlyArray<string> } |
 *   { harvestable: false, reason: "no-commits", commitsAhead: 0 }>>}
 */
export async function assessHarvest(clone, { worktreePath, branch, baseCommit, onto = null }) {
	assertFactoryRef(branch);

	const status = await clone.git(["status", "--porcelain"], { cwd: worktreePath });
	if (status !== "") {
		return Object.freeze({
			harvestable: false,
			reason: "worktree-dirty",
			leftovers: Object.freeze(status.split("\n")),
		});
	}

	// A merge-base git cannot find — unrelated histories — is a typed git
	// refusal, left to propagate: a rebase-repair whose branch shares nothing
	// with the base it was told to rebase onto is not a harvest question.
	const boundary =
		onto === null ? baseCommit : await clone.git(["merge-base", onto, `refs/heads/${branch}`]);
	const ahead = Number.parseInt(
		await clone.git(["rev-list", "--count", `${boundary}..refs/heads/${branch}`]),
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
