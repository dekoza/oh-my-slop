import { existsSync, rmSync } from "node:fs";

import { PHASE_INTEGRATE } from "../domain/vocabulary.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";
import { FactoryGitError } from "./errors.mjs";
import { assertFactoryRef, attemptWorktreePath, evidenceRef, integrationWorktreePath } from "./isolation.mjs";

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
 * git named, and left for §8.5's fresh-retry from the new base tip.
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

/** Record separators no commit message or SHA can contain, for one-call parsing. */
const RECORD = "";
const FIELD = "";
const VALUE = "";

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
 * §7.5, step 1: replay the attempt onto the fresh base tip.
 *
 * `--onto` with the attempt's **own** base as the upstream, so exactly the
 * commits this attempt is ahead by are replayed — a repair branches from the
 * prior attempt's tip (§8.5), and rebasing against the run's pin instead would
 * try to replay the prior attempt's commits a second time.
 *
 * **A conflict is aborted here, never resolved and never left in progress.**
 * §8.10 gives the conflict a fresh-retry from the new base tip and says plainly
 * that the controller attempts no automatic resolution; a rebase left mid-flight
 * would also be the state a re-entry, a second lane, or a human walks into.
 *
 * @param {object} clone the private clone's handle
 * @param {object} what
 * @param {string} what.worktreePath the integration worktree, detached at the branch tip
 * @param {string} what.baseCommit the attempt's own base (§7.3)
 * @param {string} what.onto §7.2's freshly fetched tip
 * @returns {Promise<Readonly<{ result: string, head: string, conflicts: ReadonlyArray<string> }>>}
 */
export async function rebaseAttempt(clone, { worktreePath, baseCommit, onto }) {
	const before = await clone.git(["rev-parse", "--verify", "HEAD"], { cwd: worktreePath });
	if (baseCommit === onto) {
		return Object.freeze({ result: REBASE_RESULTS.upToDate, head: before, conflicts: Object.freeze([]) });
	}

	try {
		await clone.git(["rebase", "--onto", onto, baseCommit, "HEAD"], { cwd: worktreePath });
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
			conflicts: Object.freeze(conflicts),
		});
	}

	return Object.freeze({
		result: REBASE_RESULTS.rebased,
		head: await clone.git(["rev-parse", "--verify", "HEAD"], { cwd: worktreePath }),
		conflicts: Object.freeze([]),
	});
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
 * The trailer is matched on **run and ticket**, not on the attempt: §8.5's
 * repair branches from the prior attempt's tip, so its commits are legitimately
 * stamped with the attempt before it. What must never appear is a commit
 * belonging to a different ticket execution.
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
 * @returns {Promise<Readonly<object>>} a verdict: `pushable`, the commit list,
 *   and — when it is not — the refusal and what git said about it
 */
export async function assessIntegration(clone, { worktreePath = null, baseCommit, head, run, ticket }) {
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

	const untrailed = await untrailedCommits(clone, { worktreePath, baseCommit, head, run, ticket });
	if (untrailed.length > 0) {
		return verdict({
			pushable: false,
			reason: INTEGRATION_REFUSALS.trailerMissing,
			commits,
			untrailed,
			detail:
				`${untrailed.length} commit(s) carry no \`${TRAILER_KEY}: ${run}/${ticket}/…\` trailer. §7.3 makes it ` +
				"mandatory and verified here, so a published commit always names the ticket execution that produced it.",
		});
	}

	return verdict({ pushable: true, commits });
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
 * @param {string} context.attempt
 * @param {string} context.branch the attempt's branch
 * @param {string} context.head the commit verification attested
 * @param {ReadonlyArray<string>} context.verifiedCommits the commits it attested, in order
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<{ branch: string, head: string, remoteSha: string }>>}
 * @throws {FactoryGitError} `identity-mismatch` · `git-command-failed`
 */
export async function pushAttemptBranch(
	store,
	clone,
	{ hold, run, ticket, attempt, branch, head, verifiedCommits, actor, at },
) {
	assertFactoryRef(branch);
	await requireVerifiedCommits(clone, { branch, head, verifiedCommits });

	const settled = await asEffect(store, {
		hold,
		run,
		ticket,
		attempt,
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

/** The commits with no §7.3 trailer naming this ticket execution, oldest first. */
async function untrailedCommits(clone, { worktreePath, baseCommit, head, run, ticket }) {
	const format = `%H${FIELD}%(trailers:key=${TRAILER_KEY},valueonly,separator=${escaped(VALUE)})${escaped(RECORD)}`;
	const listed = await clone.git(["log", "--reverse", `--format=${format}`, `${baseCommit}..${head}`], where(worktreePath));

	const wanted = `${run}/${ticket}/`;
	return listed
		.split(RECORD)
		.map((record) => record.trim())
		.filter((record) => record !== "")
		.map((record) => record.split(FIELD))
		.filter(([, values = ""]) => !values.split(VALUE).some((value) => value.trim().startsWith(wanted)))
		.map(([sha]) => sha);
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

function verdict({ pushable, reason = null, commits, untrailed = [], detail = null }) {
	return Object.freeze({
		pushable,
		reason,
		detail,
		commits: Object.freeze([...commits]),
		untrailed: Object.freeze([...untrailed]),
	});
}

function mismatch(sentence, details) {
	return new FactoryGitError("identity-mismatch", sentence, details);
}
