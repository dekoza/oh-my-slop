import { SOURCE_GIT_LOCAL } from "../effects/catalogue.mjs";
import { isMissingRef } from "./errors.mjs";

/**
 * #151: **what an attempt left on its branch, read at settlement time.**
 *
 * §8.10 harvests what an outbox claims. An attempt that never wrote one has still
 * created a branch, and that branch routinely carries real commits — a complete
 * implementation, in the case this module exists for. §7.7 makes that branch **the
 * only copy of that work**, since nothing non-integrated is ever pushed, so the
 * work is discoverable only by someone who knows to look inside the factory-private
 * clone. Naming it costs one read per attempt and is the difference between a
 * failed run that lost its work and one that parked it.
 *
 * **The identities come from somewhere else on purpose.** §5.2 makes the journal
 * intent only, so `worker/attempt.mjs`'s `mintedAttemptBranches` says *which*
 * attempts exist and what base each was pinned to, and this function says what the
 * refs are *now*. Two functions, composed at the call site, so the seam between
 * intent and fact is visible rather than buried.
 *
 * **This is not §7.4's harvest predicate, and does not become it.** That one opens
 * the attempt's worktree to judge whether the work is clean, and refuses when a ref
 * it needs is missing — both correct for deciding whether to publish, and both
 * wrong here: integration may already have removed the worktree (§8.9), and a
 * settlement that failed because an evidence read failed would lose the evidence
 * *and* the disposition.
 *
 * **The remote is deliberately not consulted.** §7.7's "nothing non-integrated is
 * ever pushed" makes an attempt branch absent from the remote by construction, so
 * an `ls-remote` would answer "absent" for exactly the attempts this read is for,
 * while adding a network round trip to the path that settles a ticket execution.
 * §5.4's evidence classes name `git-local` for this reason.
 */

/**
 * What the private clone holds for each minted attempt, right now.
 *
 * **It never throws.** Every partial answer is reported as one: an absent ref is
 * `head: null`, an uncountable one is `commits_ahead: null`, and the reason rides
 * the entry as `unreadable` — git's own words where git refused, and the missing
 * base where the mint recorded none. **What is never reported is a guess**: no
 * absence stands in for zero (§11.2).
 *
 * @param {object} clone the private clone's handle (`clone.mjs`)
 * @param {ReadonlyArray<{ attempt: string, role: string, branch: string, baseCommit: string | null }>} minted
 *   `worker/attempt.mjs`'s `mintedAttemptBranches`
 * @returns {Promise<Readonly<{ source: string, branches: ReadonlyArray<Readonly<object>>, unreadable: string | null }>>}
 */
export async function readAttemptBranches(clone, minted) {
	const branches = [];
	for (const record of minted) {
		branches.push(await readOne(clone, record));
	}
	return Object.freeze({ source: SOURCE_GIT_LOCAL, branches: Object.freeze(branches), unreadable: null });
}

/**
 * The read as a refusal: **the attempts could not even be listed.**
 *
 * A caller composing the journal half can be refused before any ref is looked at
 * — a corrupt identity, an unreadable journal — and that is neither "no branches"
 * nor "nobody looked". Named here so the shape has one home and a reader branches
 * on a field rather than on an empty list (§11.2).
 *
 * @param {string} reason in the refusing subsystem's own words
 */
export function unreadableAttemptBranches(reason) {
	return Object.freeze({ source: SOURCE_GIT_LOCAL, branches: Object.freeze([]), unreadable: reason });
}

async function readOne(clone, { attempt, role, branch, baseCommit }) {
	const identity = { attempt, role, branch, base_commit: baseCommit ?? null };
	const head = await revParse(clone, branch);

	// No head is either of two facts, and the `unreadable` field is which: a branch
	// the clone no longer holds is **absent** — §12.8 whitelists local
	// `factory/t*/a*` branches, so a terminal attempt's branch is a cleanup target
	// once its PR is no longer open, and git answered cleanly — while a repository
	// that could not answer is **unanswerable** (§12.4).
	if (head.sha === null) {
		return Object.freeze({ ...identity, head: null, commits_ahead: null, unreadable: head.error });
	}

	if (baseCommit === null) {
		return Object.freeze({
			...identity,
			head: head.sha,
			commits_ahead: null,
			unreadable: `the mint recorded no base commit for ${attempt}, so there is nothing to count this branch against (§7.2)`,
		});
	}

	return Object.freeze({ ...identity, head: head.sha, ...(await countAhead(clone, branch, baseCommit)) });
}

/**
 * How far the branch is ahead of the base the mint pinned for it.
 *
 * The parse is checked rather than trusted: `rev-list --count` answers one
 * integer, and a reader that took `NaN` for the answer would render it as a
 * commit count and, worse, read it as "not ahead" (§11.2).
 */
async function countAhead(clone, branch, baseCommit) {
	let answer;
	try {
		answer = await clone.git(["rev-list", "--count", `${baseCommit}..refs/heads/${branch}`]);
	} catch (error) {
		return { commits_ahead: null, unreadable: error.message };
	}

	const ahead = Number.parseInt(answer, 10);
	if (!Number.isInteger(ahead)) {
		return { commits_ahead: null, unreadable: `git rev-list --count answered ${JSON.stringify(answer)}, which is not a count` };
	}
	return { commits_ahead: ahead, unreadable: null };
}

/**
 * The ref, as three answers rather than two: `{ sha }` for a branch that is
 * there, `{ sha: null, error: null }` for one that is not, and
 * `{ sha: null, error }` for a repository that could not say.
 */
async function revParse(clone, branch) {
	try {
		return { sha: await clone.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]), error: null };
	} catch (error) {
		return { sha: null, error: isMissingRef(error) ? null : error.message };
	}
}
