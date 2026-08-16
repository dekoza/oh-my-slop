import { FactoryGitError } from "../git/errors.mjs";
import { baselineWorktreePath, privateClonePath } from "../git/isolation.mjs";
import { newUlid } from "../identity/ulid.mjs";
import { CHECK_SELECTIONS, runChecks } from "./run.mjs";

/**
 * §8.3's baseline: **the required set, at the pinned base, before the first
 * claim.**
 *
 * Without it every attempt is blamed for breakage the worker did not cause —
 * the exact conflation §8 exists to prevent. A red baseline aborts the run with
 * the run-scoped reason `baseline-red` and exit 2, naming the specific red
 * check; the caller does the ending, this module does the finding.
 *
 * It runs in a **throwaway worktree inside the factory-private clone, never the
 * operator's checkout** (§10.5, §7.1): protection is topological, and nothing
 * here takes the checkout's path. The worktree is detached, so it writes no ref
 * (§14.11), and its lifetime is §12.7's — **deleted eagerly on success,
 * retained on failure**, because a failing baseline is precisely when an
 * operator wants to `cd` in.
 *
 * > **Differential "no new failures relative to baseline" verification is not
 * > implemented, and this is not an oversight.** §8.3 records it as the **v2
 * > upgrade** and the right answer for repos the operator does not control; it
 * > is rejected for v1 because it requires parsing per-test identity out of
 * > three unrelated runners, and a wrong diff **silently passes a real
 * > regression**. v1's answer is the whole-set gate below: green at base, or the
 * > run does not start. A later reader must not read the absence of a diff as a
 * > missing feature and add one that compares two piles of unparsed output.
 *
 * **This module writes nothing durable.** That is what lets `doctor --baseline`
 * share it verbatim: §14.24 says doctor appends nothing to the journal and
 * writes no projection *in either mode*, and running a declared check in a
 * disposable worktree is explicitly not that mutation. Recording the run — the
 * check-output artifacts, the preflight stage — belongs to the controller path
 * that may write, so the two verbs cannot disagree about what the checks said.
 */

/**
 * @param {object} clone the private clone's handle (`git/clone.mjs`)
 * @param {object} what
 * @param {string} what.storeDir the repository's store directory, which must be
 *   the one this clone belongs to
 * @param {ReadonlyArray<object>} what.checks the validated `checks` block (§11.6)
 * @param {string} what.baseCommit §7.2's pinned base — what the run will build on
 * @param {string} what.baseBranch the branch that commit was pinned from
 * @param {Record<string, string | undefined>} [what.env]
 * @param {number} [what.at] UTC epoch milliseconds
 * @returns {Promise<Readonly<object>>} the verdict, the per-check results with
 *   their captured output, and where the worktree went
 * @throws {FactoryGitError} when the worktree cannot be created at all
 */
export async function runBaseline(clone, { storeDir, checks, baseCommit, baseBranch, env, at = Date.now() }) {
	requireOwnClone(clone, storeDir);

	const baseline = newUlid(at);
	const path = baselineWorktreePath(storeDir, baseline);
	await clone.addDetachedWorktree({ path, at: baseCommit });

	// Removal is on the success path alone, so a throw out of the set leaves the
	// worktree exactly where §12.7 wants a red one: whatever stopped the checks
	// from finishing happened in this copy of the base tree.
	const answer = await runChecks(checks, { select: CHECK_SELECTIONS.required, cwd: path, env });
	if (answer.ok) await clone.removeWorktree({ path });

	return frozen({ baseline, path, retained: !answer.ok, baseCommit, baseBranch, at, answer });
}

function frozen({ baseline, path, retained, baseCommit, baseBranch, at, answer }) {
	return Object.freeze({
		baseline,
		at,
		base_commit: baseCommit,
		base_branch: baseBranch,
		ok: answer.ok,
		red: answer.red,
		results: answer.results,
		skipped: answer.skipped,
		worktree: Object.freeze({ path, retained }),
		message: message(answer, { baseCommit, baseBranch, path, retained }),
	});
}

/**
 * The sentence §8.3 asks for: **naming the specific red check**, not a count.
 * "The baseline failed" sends an operator to read three logs; naming `lint`
 * sends them to one.
 */
function message(answer, { baseCommit, baseBranch, path, retained }) {
	const at = `${baseBranch}@${baseCommit.slice(0, 12)}`;

	if (answer.ok) {
		return `The required set is green at the pinned base ${at} (${answer.results.length} check(s)).`;
	}

	return (
		`The required set is red at the pinned base ${at}: ${answer.red.join(", ")}. ` +
		`No run may start against a red base (§8.3, §14.14).${retained ? ` The worktree is kept at ${path}.` : ""}`
	);
}

/**
 * The worktree root is derived from the store, and the clone handle must be the
 * one that store owns — the same guard `git/attempt.mjs` makes, for the same
 * reason: a caller mixing repo A's store with repo B's clone would scatter
 * worktrees across state areas.
 */
function requireOwnClone(clone, storeDir) {
	if (clone.dir === privateClonePath(storeDir)) return;

	throw new FactoryGitError(
		"clone-unavailable",
		`${clone.dir} is not the private clone of the store at ${storeDir}; the two name different repositories.`,
		{ found: clone.dir, expected: privateClonePath(storeDir) },
	);
}
