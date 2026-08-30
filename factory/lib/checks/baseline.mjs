import { FactoryGitError } from "../git/errors.mjs";
import { baselineWorktreePath, privateClonePath } from "../git/isolation.mjs";
import { gitIsolationCheck } from "../git/preflight.mjs";
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
 * @param {string} [what.selection] `required` for run preflight; `all` for the
 *   operator's explicit `doctor --baseline` diagnostic (§10.5)
 * @param {number} [what.at] UTC epoch milliseconds
 * @returns {Promise<Readonly<object>>} the verdict, the per-check results with
 *   their captured output, and where the worktree went
 * @throws {FactoryGitError} when the worktree cannot be created at all
 */
export async function runBaseline(
	clone,
	{ storeDir, checks, baseCommit, baseBranch, env, selection = CHECK_SELECTIONS.required, at = Date.now() },
) {
	requireOwnClone(clone, storeDir);

	// The **execution**'s id: it names this one run of the set, and it is what the
	// output artifacts are keyed by, so two runs of one check are two mutations
	// rather than one key offered two answers (§4.5).
	const execution = newUlid(at);
	const path = baselineWorktreePath(storeDir, execution);
	await clone.addDetachedWorktree({ path, at: baseCommit });

	// Removal is on the success path alone, so a throw out of the set leaves the
	// worktree exactly where §12.7 wants a red one: whatever stopped the checks
	// from finishing happened in this copy of the base tree.
	const answer = await runChecks(checks, { select: selection, cwd: path, env });
	if (answer.ok) await clone.removeWorktree({ path });

	return frozen({ execution, path, retained: !answer.ok, baseCommit, baseBranch, at, answer });
}

function frozen({ execution, path, retained, baseCommit, baseBranch, at, answer }) {
	return Object.freeze({
		execution,
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
 * §8.3's baseline **for a repository**: pin the base, then run the set at it.
 *
 * Both callers go through this one function — a run's preflight and
 * `doctor --baseline` — for the reason §10.5 gives about the package handshake:
 * one code path, so the two verbs cannot answer differently about what the base
 * is or what the checks said. What differs between them is what they do with the
 * answer, and that is all that is left outside.
 *
 * The three ways it can end are a **discriminated answer rather than three
 * exception types**, because a base nobody could pin is a *result* a report has
 * to carry (§14.14 makes it red, never skipped) and not a crash.
 *
 * @param {{ canonicalPath: string, storeDir: string }} where the repository — a
 *   store satisfies this shape, and so does a `doctor` that has none yet
 * @param {object} config the validated configuration
 * @param {{ at?: number, env?: Record<string, string | undefined>, isolation?: object | null,
 *   selection?: string }} [options]
 *   a caller that has **already** run §7's isolation check passes its verdict:
 *   pinning the base again would fetch a second time and could run the set at a
 *   commit the recorded check never saw (§7.2). A caller with none — `doctor` —
 *   lets this pin one.
 * @returns {Promise<Readonly<{ ran: true, baseline: object } |
 *   { ran: false, reason: string, message: string, detail: object }>>}
 */
export async function baselineForRepo(
	{ canonicalPath, storeDir },
	config,
	{ at = Date.now(), env, isolation = null, selection = CHECK_SELECTIONS.required } = {},
) {
	const pinned = isolation ?? (await gitIsolationCheck({ canonicalPath, storeDir }, config));

	if (pinned.clone === undefined) {
		return Object.freeze({
			ran: false,
			reason: "base-unavailable",
			message:
				`The required set was not run: the base commit could not be pinned, so there is nothing to run it at. ` +
				`A run never starts on a baseline nobody ran (§8.3, §14.14). ${pinned.message}`,
			detail: Object.freeze({ reason: "base-unavailable", because: pinned.check }),
		});
	}

	try {
		return Object.freeze({
			ran: true,
			baseline: await runBaseline(pinned.clone, {
				storeDir,
				checks: config.checks,
				baseCommit: pinned.base.commit,
				baseBranch: config.git.baseBranch,
				env,
				selection,
				at,
			}),
		});
	} catch (error) {
		// A worktree the clone refuses to create is an automation failure, and both
		// callers report one rather than dying with a stack trace.
		if (!(error instanceof FactoryGitError)) throw error;
		return Object.freeze({
			ran: false,
			reason: error.reason,
			message: `The baseline could not be set up: ${error.message}`,
			detail: Object.freeze({ reason: error.reason, base_commit: pinned.base.commit, ...error.details }),
		});
	}
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
