import { existsSync, rmSync } from "node:fs";

import { PHASE_INTEGRATE } from "../domain/vocabulary.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";
import { FactoryGitError, isMissingRef } from "./errors.mjs";
import {
	assertFactoryRef,
	attemptWorktreePath,
	evidenceRef,
	integrationWorktreePath,
	isAttemptIdFor,
} from "./isolation.mjs";

/**
 * §7.5's git steps, and §7.4's **integration-side** predicates — the controller's
 * own faults, as opposed to the builder's, which `harvest.mjs` owns.
 *
 * Everything here answers with a **typed verdict or a typed refusal, never an
 * §8.10 outcome**, exactly as the harvest predicates and the mutation
 * attestation do. `rebase-conflict` and `predicate-failed` are the pipeline's
 * words for what these functions report, and keeping the two levels apart is
 * what lets `doctor` and an incident review read the same facts without
 * importing the pipeline's vocabulary.
 *
 * **Nothing here resolves a conflict.** §8.10 is explicit that the controller
 * never attempts automatic resolution — that would put a model inside a
 * controller phase — so a conflicting rebase is aborted, reported with the paths
 * git named, and left for §8.5's rebase-repair: a builder attempt from the
 * same tip, told to rebase it (#194), and thereafter the fresh-retry from the
 * new base tip.
 *
 * **Nothing here force-updates anything.** The one local ref move is a
 * compare-and-swap naming the value it replaces, and the one push is plain and
 * of one branch (§14.11).
 */

/** What a rebase did. Git facts, and the vocabulary stops here. */
export const REBASE_RESULTS = Object.freeze({
	/** The attempt's base is already the fresh tip; nothing was rewritten. */
	upToDate: "up-to-date",
	/** The branch was replayed onto the fresh tip. */
	rebased: "rebased",
	/** Git could not replay it, and the rebase was aborted. */
	conflict: "conflict",
});

/**
 * Why a branch is not pushable. Closed, because each one sends an operator
 * somewhere different, and "the predicates failed" sends them to read a diff the
 * controller already read.
 */
export const INTEGRATION_REFUSALS = Object.freeze({
	/** Nothing to publish: the branch is not ahead of the base being published onto. */
	noCommits: "no-commits",
	/** `git diff --check` found whitespace damage or an unfinished merge. */
	diffCheck: "diff-check",
	/** A commit carries no §7.3 correlation trailer for this ticket execution. */
	trailerMissing: "trailer-missing",
});

/** §7.3's trailer key, as `git log --format=%(trailers:key=…)` selects it. */
const TRAILER_KEY = "Factory-Attempt";

/**
 * The ASCII separators the trailer walk parses on — spelled as escapes, because
 * a raw control byte in source is invisible in a review, invisible in a diff,
 * and one editor pass away from being normalised into something else.
 *
 * They are the C0 separators in their intended nesting, and the names say which
 * nesting: a group separator between commits, a unit separator between a sha and
 * its trailer values, and a record separator between those values. No commit
 * message or sha can contain any of them, which is what makes one `git log` call
 * parseable in a single pass.
 */
const BETWEEN_COMMITS = "\x1d";
const BETWEEN_FIELDS = "\x1f";
const BETWEEN_VALUES = "\x1e";

/**
 * §7.5's **controller-owned integration worktree**, opened at the attempt
 * branch's tip.
 *
 * **Detached**, and not merely as a preference: the attempt's own worktree has
 * that branch checked out and git refuses a second worktree on a checked-out
 * branch outright. Detached also means this worktree writes no ref, so §14.11
 * holds without the path having to be blessed, and the branch stays exactly
 * where the worker left it until `adoptRebasedHead` moves it deliberately.
 *
 * **A worktree already on the path is replaced rather than refused** (§7.7:
 * integration is re-runnable end to end). What is on that path is a detached
 * checkout of commits that already exist on a branch, plus whatever a
 * half-finished rebase and the required set left beside them — derived,
 * disposable state (§7.1). The attempt worktree, which is the only copy of a
 * worker's work, is a different path and is never touched here.
 *
 * @param {object} clone the private clone's handle (`clone.mjs`)
 * @param {{ storeDir: string, attempt: string, branch: string }} where
 * @returns {Promise<Readonly<{ path: string, head: string }>>}
 * @throws {FactoryGitError} `ref-outside-namespace` · `identity-path-escape`
 */
export async function openIntegrationWorktree(clone, { storeDir, attempt, branch }) {
	assertFactoryRef(branch);
	const path = integrationWorktreePath(storeDir, attempt);
	const head = await clone.git(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);

	const registered = (await clone.listWorktrees()).some((worktree) => worktree.worktree === path);
	if (registered) {
		await clone.removeWorktree({ path });
	} else if (existsSync(path)) {
		// A directory git does not know about — a crash between `mkdir` and the
		// registration, or a registration pruned out from under it. `worktree add`
		// refuses a non-empty path, so the leftover is cleared here rather than
		// turning every retry into the same refusal.
		rmSync(path, { recursive: true, force: true });
	}
	await clone.git(["worktree", "prune"]);

	await clone.addDetachedWorktree({ path, at: head });
	return Object.freeze({ path, head });
}

/**
 * §7.5, step 2: **the pre-rebase head, under a local evidence ref, before
 * anything destructive happens.** Evidence survives by contract, not by reflog.
 *
 * One ref per attempt, holding the head **as the worker left it**. A later pass
 * of §9.5's compare-and-publish loop rebases a result this controller itself
 * produced, and re-pointing the ref at that would overwrite the one thing the
 * reflog cannot be trusted to keep: what the worker actually wrote.
 *
 * The effect's payload is the ref alone and the sha rides the **result**, which
 * is what makes that re-entrant: a second pass offering a different head finds
 * the effect resolved and performs nothing, where a payload carrying the sha
 * would raise §4.5's typed conflict on a path that is working correctly.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt
 * @param {string} context.head the head as it stands before the rebase
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<{ ref: string, sha: string }>>}
 */
export async function preserveEvidence(store, clone, { hold, run, ticket, attempt, head, actor, at }) {
	const ref = evidenceRef(attempt);

	const settled = await asEffect(store, {
		hold,
		run,
		ticket,
		attempt,
		actor,
		at,
		operation: "evidence-ref",
		operand: ref,
		payload: { ref },
		perform: async () => {
			await clone.git(["update-ref", ref, head]);
			return { ref, sha: head };
		},
	});

	return Object.freeze({ ref, sha: settled.result?.sha ?? head });
}

/**
 * Whether the worktree's `HEAD` already sits on `commit` — the commit is `HEAD`
 * itself or an ancestor of it.
 *
 * This is §7.5's "did the base move" question asked of the graph rather than of
 * a recorded value: an attempt's **own** base (§7.3) is the prior attempt's tip
 * for a repair and a since-rebased commit after §9.5's loop has run once, so
 * comparing the fresh tip against it answers a different question.
 *
 * Only git's silent exit-1 — "no is the answer" — reads as `false`; anything
 * with a diagnosis rethrows, because "not an ancestor" and "could not answer"
 * are different facts and the line is drawn where `isMissingRef` draws it
 * (§12.4).
 *
 * @param {object} clone the private clone's handle
 * @param {{ worktreePath: string, commit: string }} what
 * @returns {Promise<boolean>}
 */
export async function basedOn(clone, { worktreePath, commit }) {
	try {
		await clone.git(["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: worktreePath });
		return true;
	} catch (error) {
		if (!isMissingRef(error)) throw error;
		return false;
	}
}

/**
 * §7.5, step 1: replay the ticket execution's work onto the fresh base tip.
 *
 * **The upstream is the fresh tip itself**, so the replay set is every commit
 * `HEAD` carries that is not already on the base branch — the whole ticket
 * execution's work, however many attempts contributed to it (#161). It is
 * deliberately **not** the attempt's own base (§7.3): that value is the prior
 * attempt's tip for a repair, and using it as the upstream replayed only the
 * repair, excluding the implement commit it depends on — a conflict when the
 * repair touched a file the implement created, and a silently incomplete branch
 * when it did not.
 *
 * **A rebase whose result carries fewer non-base commits than its input is
 * refused, and the shrunken result is never adopted** — the typed refusal that
 * makes the silent case impossible rather than unlikely (§7.5, §11.2). It fires
 * whatever the drop's mechanism: a commit whose patch is already upstream is
 * dropped by git itself, and a branch that quietly lost a commit satisfies every
 * downstream check (§14.13 measures the commit being published, and attestation
 * compares heads) while publishing half the work.
 *
 * **A conflict is aborted here, never resolved and never left in progress.**
 * §8.10 gives the conflict a rebase-repair — the model that resolves it stays
 * inside a worker attempt (#194) — and says plainly that the controller attempts
 * no automatic resolution; a rebase left mid-flight would also be the state a
 * re-entry, a second lane, or a human walks into. The worktree this leaves is
 * therefore the branch's own tip, clean and detached.
 *
 * @param {object} clone the private clone's handle
 * @param {object} what
 * @param {string} what.worktreePath the integration worktree, detached at the branch tip
 * @param {string} what.onto §7.2's freshly fetched tip — the upstream and the target, one value
 * @returns {Promise<Readonly<{ result: string, head: string, previousBase: string | null,
 *   conflicts: ReadonlyArray<string> }>>} `previousBase` is the base-branch
 *   commit the branch sat on before the rebase — the merge base of `HEAD` and
 *   `onto` — kept for the journal, since it is what an incident review reads
 * @throws {FactoryGitError} `rebase-dropped-commits`
 */
export async function rebaseAttempt(clone, { worktreePath, onto }) {
	const before = await clone.git(["rev-parse", "--verify", "HEAD"], { cwd: worktreePath });
	const previousBase = await mergeBase(clone, { worktreePath, onto });
	if (previousBase === onto) {
		return Object.freeze({ result: REBASE_RESULTS.upToDate, head: before, previousBase, conflicts: Object.freeze([]) });
	}

	const expected = await nonBaseCommits(clone, { worktreePath, onto });

	try {
		await clone.git(["rebase", "--onto", onto, onto, "HEAD"], { cwd: worktreePath });
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;

		// The paths git could not merge, read from the index rather than from its
		// message: git's prose is localized, and a controller that parsed it would
		// report an empty conflict set on a machine set to another language.
		const conflicts = (await clone.git(["diff", "--name-only", "--diff-filter=U"], { cwd: worktreePath }))
			.split("\n")
			.filter((path) => path !== "");
		await clone.git(["rebase", "--abort"], { cwd: worktreePath });

		return Object.freeze({
			result: REBASE_RESULTS.conflict,
			head: await clone.git(["rev-parse", "--verify", "HEAD"], { cwd: worktreePath }),
			previousBase,
			conflicts: Object.freeze(conflicts),
		});
	}

	const head = await clone.git(["rev-parse", "--verify", "HEAD"], { cwd: worktreePath });
	const replayed = await nonBaseCommits(clone, { worktreePath, onto });
	if (replayed.length < expected.length) {
		throw new FactoryGitError(
			"rebase-dropped-commits",
			`The rebase onto ${onto} replayed ${replayed.length} of ${expected.length} non-base commit(s), and a result ` +
				"carrying fewer commits than its input is refused rather than adopted (§7.5): every downstream check " +
				"measures the commits being published, so a branch that quietly lost one would verify and publish as " +
				"green (#161). The branch is untouched; the shrunken result sits only in the integration worktree.",
			{ at: "replay", onto, before, after: head, expected, found: replayed },
		);
	}

	return Object.freeze({
		result: REBASE_RESULTS.rebased,
		head,
		previousBase,
		conflicts: Object.freeze([]),
	});
}

/**
 * The merge base of `HEAD` and `onto`, or `null` when the histories are
 * unrelated — git's silent exit 1. A refusal carrying a diagnosis rethrows, so
 * an unanswerable repository is never journaled as unrelated histories (§12.4).
 */
async function mergeBase(clone, { worktreePath, onto }) {
	try {
		return await clone.git(["merge-base", onto, "HEAD"], { cwd: worktreePath });
	} catch (error) {
		if (!isMissingRef(error)) throw error;
		return null;
	}
}

/** The commits `HEAD` carries that are not on the base being rebased onto, oldest first. */
async function nonBaseCommits(clone, { worktreePath, onto }) {
	const listed = await clone.git(["rev-list", "--reverse", `${onto}..HEAD`], { cwd: worktreePath });
	return listed === "" ? [] : listed.split("\n");
}

/**
 * Move the attempt branch onto the rebased result — **a compare-and-swap naming
 * the value it replaces.**
 *
 * `update-ref` rather than `branch -f` for one mechanical reason and one
 * discipline. Git refuses `branch -f` on a branch checked out in another
 * worktree, and the attempt's worktree still has this one; and the three-argument
 * form is the same compare-and-swap §4.6 leans on everywhere else, so a branch
 * that moved under the controller is a typed refusal rather than a silent
 * overwrite of somebody's work.
 *
 * The attempt's worktree is left pointing at the ref rather than at its own old
 * head, which makes it look behind. That is correct and deliberate: its worker
 * has finished, §7.5's evidence ref holds the pre-rebase head by contract, and
 * the alternative — a second copy of the branch — is the force-push §14.11
 * forbids wearing a local disguise.
 *
 * @param {object} clone the private clone's handle
 * @param {{ branch: string, from: string, to: string }} what
 * @returns {Promise<Readonly<{ branch: string, head: string, moved: boolean }>>}
 * @throws {FactoryGitError} `branch-collision` · `ref-outside-namespace`
 */
export async function adoptRebasedHead(clone, { branch, from, to }) {
	assertFactoryRef(branch);
	if (from === to) return Object.freeze({ branch, head: to, moved: false });

	try {
		await clone.git(["update-ref", `refs/heads/${branch}`, to, from]);
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		throw new FactoryGitError(
			"branch-collision",
			`Branch ${branch} is no longer at ${from}, so the rebased result was not adopted: ${error.message}. ` +
				"The move names the value it replaces, so a branch that changed under the controller is refused rather " +
				"than overwritten (§7.5).",
			{ ref: branch, expected: from, found: to, at: "update-ref" },
		);
	}

	return Object.freeze({ branch, head: to, moved: true });
}

/**
 * §7.4's integration-side predicates, over the commits about to be published.
 *
 * Three questions, in the order of how cheaply each is answered and how
 * completely each disqualifies the push:
 *
 * 1. **Is there anything to publish** — a branch not ahead of the base it is
 *    being published onto has nothing on it, whatever an earlier harvest said
 *    about a base that has since moved.
 * 2. **`git diff --check`** — whitespace damage and unfinished merges, which
 *    §7.4 names outright.
 * 3. **§7.3's correlation trailer**, on **every** commit. §7.3 makes it a prompt
 *    obligation "verified at integration", and this is that verification: a
 *    published commit nothing correlates back to a ticket execution is one the
 *    monitor, the attestation, and an incident review all lose.
 *
 * The trailer is matched on **run and ticket**, not on which attempt: §8.5's
 * repair branches from the prior attempt's tip, so its commits are legitimately
 * stamped with the attempt before it. #199 adds one explicit exception across
 * runs: a resumed execution carries the paused history's controller-verified run
 * ids, because those retained commits keep their original trailers. An arbitrary
 * run for the same ticket remains refused.
 *
 * **A damaged trailer is not a missing one** (#210). Where the `<run>/<ticket>`
 * prefix does not match, the attempt segment is read as the identity it is, and
 * a commit it correlates is `misstamped` rather than `untrailed` —
 * `classifyTrailers` holds the whole reading.
 *
 * **It needs no worktree.** Every question here is about commits and trees —
 * `rev-list`, `diff --check` between two revisions, trailers off a log — which
 * the bare clone answers. That is what makes §7.7's "integration is re-runnable
 * end to end" hold after a success has already reclaimed the worktree: a
 * re-entry re-derives the same verdict from refs that are still there.
 *
 * @param {object} clone the private clone's handle
 * @param {object} what
 * @param {string} [what.worktreePath] where to run, when a caller has one open
 * @param {string} what.baseCommit the base these commits are published onto
 * @param {string} what.head the commit that will be pushed
 * @param {string} what.run
 * @param {number} what.ticket
 * @param {ReadonlyArray<string>} [what.acceptedRuns] prior paused executions
 *   whose retained commits are deliberately inherited by #199
 * @returns {Promise<Readonly<object>>} a verdict: `pushable`, the commit list,
 *   the `misstamped` trailers §8.7 records (`null` when an earlier refusal
 *   returned before the trailer walk), and — when it is not — the refusal and
 *   what git said about it
 */
export async function assessIntegration(
	clone,
	{ worktreePath = null, baseCommit, head, run, ticket, acceptedRuns = [] },
) {
	const commits = await commitsBetween(clone, { worktreePath, baseCommit, head });
	if (commits.length === 0) {
		return verdict({
			pushable: false,
			reason: INTEGRATION_REFUSALS.noCommits,
			commits,
			detail: `${head} is not ahead of ${baseCommit}; there is nothing to publish (§7.4).`,
		});
	}

	const damage = await diffCheck(clone, { worktreePath, baseCommit, head });
	if (damage !== null) {
		return verdict({ pushable: false, reason: INTEGRATION_REFUSALS.diffCheck, commits, detail: damage });
	}

	const allowedRuns = [...new Set([run, ...acceptedRuns])];
	const { untrailed, misstamped } = await classifyTrailers(clone, {
		worktreePath,
		baseCommit,
		head,
		runs: allowedRuns,
		ticket,
	});
	if (untrailed.length > 0) {
		return verdict({
			pushable: false,
			reason: INTEGRATION_REFUSALS.trailerMissing,
			commits,
			untrailed,
			misstamped,
			detail:
				`${untrailed.length} commit(s) carry no accepted \`${TRAILER_KEY}\` trailer — neither the ` +
				`\`<run>/${ticket}/…\` prefix nor an attempt segment naming an execution of this ticket. ` +
				"§7.3 makes it mandatory and verified here, so a published commit always names an execution in this ticket's declared continuation chain." +
				// Said out loud, because an operator handed a refusal and a list of
				// shas reads every damaged trailer on the branch as the fault until
				// something tells them it is not (#210).
				(misstamped.length === 0
					? ""
					: ` ${misstamped.length} further commit(s) carry a damaged trailer whose attempt segment still names this ` +
						"execution; those are correlated, and are not why this refused."),
		});
	}

	return verdict({ pushable: true, commits, misstamped });
}

/**
 * §7.5, step 5: **plain push, never force, of the final attempt branch only** —
 * with §7.4's identity check on both sides of it.
 *
 * Before: the commits about to be pushed are compared against the ones
 * verification attested, **by ancestry and identity** — the exact list, in
 * order, ending at the head. §14.13 says verification never attests a commit
 * other than the one being published, and this is where that stops being a
 * property of the control flow and becomes a compare.
 *
 * After: `ls-remote` is read back, because a push that reported success and left
 * the remote elsewhere is the one failure §5.3's whole discipline exists to make
 * impossible, arriving at the moment of the write.
 *
 * The effect payload pins the head, so a **re-entry offering a different head is
 * §4.5's typed conflict** — §14.12's "a published branch is never touched again"
 * as a refusal rather than as a rule somebody follows. A re-entry offering the
 * same head finds the effect resolved and pushes nothing.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle
 * @param {object} context
 * @param {object} context.hold the controller's hold
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.branch the attempt's branch — **the whole subject of
 *   this effect**, and the reason it takes no attempt id (#146)
 * @param {string} context.head the commit verification attested
 * @param {ReadonlyArray<string>} context.verifiedCommits the commits it attested, in order
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<{ branch: string, head: string, remoteSha: string }>>}
 * @throws {FactoryGitError} `identity-mismatch` · `git-command-failed`
 */
export async function pushAttemptBranch(store, clone, { hold, run, ticket, branch, head, verifiedCommits, actor, at }) {
	assertFactoryRef(branch);
	await requireVerifiedCommits(clone, { branch, head, verifiedCommits });

	const settled = await asEffect(store, {
		hold,
		run,
		ticket,
		// **Keyed by the ticket execution, not by the attempt** (§4.5's rule, in
		// `effects/keys.mjs`). The subject is the published branch, and one ticket
		// execution publishes one branch once — §7.5 says so and §14.12 makes it
		// permanent. Keying it by whichever attempt happened to be walking
		// `integrate` would mint a second push effect for one branch the first time
		// the phase was re-entered under another one, which is §4.5's whole-system
		// uniqueness demoted to a per-attempt property (#146). `pr-create` is keyed
		// the same way and for the same reason, which is what makes the pair one
		// convention rather than two.
		//
		// It takes no `attempt` **parameter** either, so the wrong key is not a
		// thing a caller can ask for: §14.12's "a published branch is never touched
		// again" is one branch, one push, and an attempt id here would only ever be
		// a second opinion about which attempt owns a branch §7.3 already names.
		attempt: null,
		actor,
		at,
		operation: "push",
		operand: branch,
		payload: { branch, head },
		perform: async () => {
			// Fully-qualified on both sides and one refspec: no `--force`, no
			// `--force-with-lease`, no configured push default that could widen this
			// into a second ref (§14.11).
			await clone.git(["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
			return { branch, sha: head, remote_sha: await remoteSha(clone, branch) };
		},
	});

	return Object.freeze({
		branch,
		head,
		remoteSha: settled.result?.remote_sha ?? (await remoteSha(clone, branch)),
	});
}

/**
 * §12.7's eager reclamation: **on integrated success the attempt's own worktree
 * goes, immediately.**
 *
 * The branch is pushed, so the worktree holds nothing unique — which is exactly
 * why this is safe here and nowhere else. On failure or pause the same worktree
 * is **the only copy of that work** (§7.7) and is retained and pinned, so this
 * function has one caller and it is on the integrated path.
 *
 * It is an effect because it is a mutation outside the database with a probe
 * that can re-read it, and it is keyed `…/integrate/…` rather than
 * `…/cleanup/…`: §4.5's operation names what is mutated and the key's phase
 * segment says why, so §12.8's planner deleting one later is the same operation
 * under a different reason.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle
 * @param {object} context
 * @param {object} context.hold the controller's hold
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<{ path: string, removed: boolean }>>}
 */
export async function reclaimAttemptWorktree(store, clone, { hold, run, ticket, attempt, actor, at }) {
	const path = attemptWorktreePath(store.storeDir, attempt);

	const settled = await asEffect(store, {
		hold,
		run,
		ticket,
		attempt,
		actor,
		at,
		operation: "worktree-delete",
		operand: null,
		payload: { path },
		perform: async () => {
			const registered = (await clone.listWorktrees()).some((worktree) => worktree.worktree === path);
			if (registered) await clone.removeWorktree({ path });
			// Removed by a previous pass, by an operator, or never created: all three
			// are the state this effect was asking for, so all three resolve it.
			return { path, removed: registered };
		},
	});

	return Object.freeze({ path, removed: settled.result?.removed ?? false });
}

/**
 * Give up the integration worktree (§12.7).
 *
 * **Called only where the outcome says to.** An integrated attempt leaves
 * nothing here worth looking at — the branch is pushed — while a rebase
 * conflict, a red set, or a failed predicate is precisely when an operator wants
 * to `cd` in, so those paths simply do not call it. That is the same rule §12.7
 * gives a baseline worktree, expressed the same way: retention is the absence of
 * a removal, not a flag threaded through one.
 *
 * @param {object} clone the private clone's handle
 * @param {{ path: string }} what
 * @returns {Promise<boolean>} whether there was one to remove
 */
export async function releaseIntegrationWorktree(clone, { path }) {
	if (!(await clone.listWorktrees()).some((worktree) => worktree.worktree === path)) return false;
	await clone.removeWorktree({ path });
	return true;
}

/** The commits one range holds, oldest first — the order they will be pushed in. */
async function commitsBetween(clone, { worktreePath, baseCommit, head }) {
	const listed = await clone.git(["rev-list", "--reverse", `${baseCommit}..${head}`], where(worktreePath));
	return listed === "" ? [] : listed.split("\n");
}

/** The clone's own directory when no worktree is open, which is every read here. */
function where(worktreePath) {
	return worktreePath === null || worktreePath === undefined ? {} : { cwd: worktreePath };
}

/**
 * `git diff --check`, whose diagnosis goes to **stdout** and whose exit code is
 * non-zero when it finds something. So the refusal is the failure, and the
 * detail is what git printed rather than a sentence of ours about it.
 */
async function diffCheck(clone, { worktreePath, baseCommit, head }) {
	try {
		await clone.git(["diff", "--check", `${baseCommit}..${head}`], where(worktreePath));
		return null;
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		return error.details.stdout === "" ? error.message : error.details.stdout;
	}
}

/**
 * Every commit in the range §7.3's trailer does not plainly correlate, split by
 * *which* of the two failures it is — oldest first, in both lists.
 *
 * **`untrailed`**: no `Factory-Attempt:` line at all, or one naming a ticket
 * execution that is not among the accepted ones. Nobody stamped this commit for
 * this ticket, and that is the case a human should look at.
 *
 * **`misstamped`** (#210): a line whose `<run>/<ticket>` prefix is damaged while
 * one of its `/`-separated segments is still an accepted execution's own attempt
 * id. A worker followed the rule and fumbled a token — and the commit is
 * correlated regardless, because the attempt id *is* the identity tuple: §2.1
 * spells it `<run>-t<ticket>-a<n>`, `attemptBranch` refuses a pair that
 * disagrees, and `factoryAttemptTrailer` derives the prefix and the attempt
 * segment from one tuple. The segment that survived therefore answers the
 * question this predicate asks — *which ticket execution produced this commit* —
 * carrying strictly more of the tuple than the prefix does, and reading it as
 * unstamped discards a verified, doubly approved deliverable over a spelling.
 *
 * The two are told apart by `isAttemptIdFor` on a **whole** segment, so nothing
 * but this ticket's own execution can be recognised and a trailer naming
 * somebody else's stays a refusal.
 *
 * **Damage is never repaired here.** §7.5's step 4 verifies at the exact commit
 * that will be pushed, and §7.4 compares the pushed shas against the ones
 * verification attested — so amending a message would move the commit off the
 * one that was measured, which is the whole failure both rules exist to make
 * impossible. The misspelling is therefore published as the worker wrote it,
 * and §8.7's attestation records it beside the commit.
 */
async function classifyTrailers(clone, { worktreePath, baseCommit, head, runs, ticket }) {
	const format = `%H${BETWEEN_FIELDS}%(trailers:key=${TRAILER_KEY},valueonly,separator=${escaped(BETWEEN_VALUES)})${escaped(BETWEEN_COMMITS)}`;
	const listed = await clone.git(["log", "--reverse", `--format=${format}`, `${baseCommit}..${head}`], where(worktreePath));

	const wanted = runs.map((acceptedRun) => `${acceptedRun}/${ticket}/`);
	const untrailed = [];
	const misstamped = [];

	const namesAnAcceptedAttempt = (segment) =>
		runs.some((acceptedRun) => isAttemptIdFor(segment, { run: acceptedRun, ticket }));

	for (const record of listed.split(BETWEEN_COMMITS).map((line) => line.trim())) {
		if (record === "") continue;
		const [sha, values = ""] = record.split(BETWEEN_FIELDS);
		const trailers = values
			.split(BETWEEN_VALUES)
			.map((value) => value.trim())
			.filter((value) => value !== "");

		if (trailers.some((value) => wanted.some((prefix) => value.startsWith(prefix)))) continue;

		const damaged = trailers.find((value) => value.split("/").some((segment) => namesAnAcceptedAttempt(segment)));
		if (damaged === undefined) untrailed.push(sha);
		else misstamped.push(Object.freeze({ commit: sha, trailer: damaged }));
	}

	return Object.freeze({ untrailed, misstamped });
}

/** `%x1d` and friends: the byte a git format string spells in hex. */
function escaped(character) {
	return `%x${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
}

/**
 * §7.4: **the pushed SHAs are exactly the verified branch's commits** — by
 * ancestry (each one reachable from the head, in order) and by identity (the
 * same shas, and no others).
 *
 * Derived from the verified list's own first commit rather than from a base the
 * caller re-states: a second opinion about where the range starts is exactly the
 * kind of agreement §14.13 refuses to rely on.
 */
async function requireVerifiedCommits(clone, { branch, head, verifiedCommits }) {
	const tip = await clone.git(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
	if (tip !== head) {
		throw mismatch(`Branch ${branch} is at ${tip}, and verification attested ${head}.`, {
			at: "head",
			expected: head,
			found: tip,
		});
	}

	if (!Array.isArray(verifiedCommits) || verifiedCommits.length === 0) {
		throw mismatch(
			`Nothing was attested for ${branch}, so there is no list to compare the push against (§14.13, §14.16).`,
			{ at: "verified", expected: "≥1 commit", found: verifiedCommits?.length ?? null },
		);
	}

	let actual;
	try {
		actual = await clone.git(["rev-list", "--reverse", `${verifiedCommits[0]}~1..${head}`]);
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		throw mismatch(
			`The attested commits are not reachable from ${head}: ${error.message}. The branch is not what was verified.`,
			{ at: "ancestry", expected: [...verifiedCommits], found: null },
		);
	}

	const found = actual === "" ? [] : actual.split("\n");
	if (found.length !== verifiedCommits.length || found.some((sha, index) => sha !== verifiedCommits[index])) {
		throw mismatch(
			`${branch} holds ${found.length} commit(s) where verification attested ${verifiedCommits.length}; the pushed ` +
				"SHAs must be exactly the verified branch's commits (§7.4).",
			{ at: "identity", expected: [...verifiedCommits], found },
		);
	}
}

async function remoteSha(clone, branch) {
	const listed = await clone.git(["ls-remote", "origin", `refs/heads/${branch}`]);
	return listed === "" ? null : listed.split("\n")[0].split("\t")[0];
}

/**
 * One requested / performed / resolved cycle, keyed to §2.2's `integrate` phase.
 *
 * The same shape `git/attempt.mjs` uses, and deliberately not shared with it:
 * that one keys every mutation to the phase its caller names, and every mutation
 * here belongs to integration by definition — an evidence ref and a push exist
 * for no other phase.
 */
async function asEffect(store, { hold, run, ticket, attempt, actor, at, operation, operand, payload, perform }) {
	const requested = requestEffect(store, {
		operation,
		operand,
		run,
		ticket,
		phase: PHASE_INTEGRATE,
		attempt,
		actor,
		fencingGeneration: hold.fence().generation,
		payload,
		at,
	});
	if (requested.state === "resolved") return requested;

	const result = await perform();

	return resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: hold.fence().generation,
		result,
		at,
	});
}

function verdict({ pushable, reason = null, commits, untrailed = [], misstamped = null, detail = null }) {
	return Object.freeze({
		pushable,
		reason,
		detail,
		commits: Object.freeze([...commits]),
		untrailed: Object.freeze([...untrailed]),
		// **An empty list and `null` are different answers**, and the earlier
		// refusals are why: `no-commits` and `diff-check` return before the trailer
		// walk runs at all. `[]` is "asked, and every trailer was well spelled";
		// `null` is "never asked" — and a reader that could not tell them apart
		// would record an unclassified range in §8.7 as a clean one.
		misstamped: misstamped === null ? null : Object.freeze(misstamped.map((entry) => Object.freeze({ ...entry }))),
	});
}

function mismatch(sentence, details) {
	return new FactoryGitError("identity-mismatch", sentence, details);
}
