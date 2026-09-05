import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
	adoptRebasedHead,
	assessIntegration,
	INTEGRATION_REFUSALS,
	openIntegrationWorktree,
	preserveEvidence,
	pushAttemptBranch,
	REBASE_RESULTS,
	rebaseAttempt,
	releaseIntegrationWorktree,
} from "../../factory/lib/git/integrate.mjs";
import { evidenceRef, integrationWorktreePath } from "../../factory/lib/git/isolation.mjs";
import {
	commitInto,
	damagedTicketSegment,
	damagedTicketSegmentValue,
	moveRemoteBase,
	repairAttempt,
	TEST_HOLD as HOLD,
	workedAttempt,
} from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * §7.4's integration-side predicates and §7.5's git steps: the controller-owned
 * worktree, the evidence ref written **before** a destructive rebase, the rebase
 * itself and its typed conflict, and the plain push whose SHAs are compared
 * against the ones verification attested.
 */

const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

function effectRows(store) {
	return store
		.read((db) => db.prepare("SELECT effect_key, operation, state FROM effect ORDER BY requested_seq").all())
		.map((row) => ({ ...row }));
}

test("the integration worktree is the controller's own, detached, and never the attempt's (§7.5)", async (t) => {
	const { store, clone, attempt, branch, head, worktreePath } = await workedAttempt(t);

	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	assert.equal(opened.path, integrationWorktreePath(store.storeDir, attempt));
	assert.notEqual(opened.path, worktreePath, "integration reused the worker's worktree");
	assert.equal(opened.head, head);
	// Detached: it writes no ref, so §14.11 holds without the path being blessed —
	// and the attempt branch stays checked out in the worker's worktree, which git
	// would otherwise refuse outright.
	assert.throws(() => git(opened.path, ["symbolic-ref", "--quiet", "HEAD"]), "the integration worktree is on a branch");
	assert.equal(git(opened.path, ["rev-parse", "HEAD"]), head);
});

test("a crashed integration's worktree is replaced, not refused: integration is re-runnable (§7.7)", async (t) => {
	const { store, clone, attempt, branch } = await workedAttempt(t);

	const first = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });
	// Whatever the checks left behind, plus whatever a half-finished rebase did.
	commitInto(first.path, { "detritus.txt": "left by a crash\n" }, { message: "wip", trailer: null });

	const again = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	assert.equal(again.path, first.path);
	assert.equal(again.head, git(clone.dir, ["rev-parse", `refs/heads/${branch}`]));
	assert.equal(git(again.path, ["status", "--porcelain"]), "");
});

test("the pre-rebase head is preserved under an evidence ref, by contract rather than by reflog (§7.5)", async (t) => {
	const { store, clone, run, ticket, attempt, head } = await workedAttempt(t);

	const preserved = await preserveEvidence(store, clone, {
		hold: HOLD,
		run,
		ticket,
		attempt,
		head,
		actor: "controller",
		at: FIXED_NOW,
	});

	assert.equal(preserved.ref, evidenceRef(attempt));
	assert.equal(preserved.sha, head);
	assert.equal(git(clone.dir, ["rev-parse", "--verify", `${preserved.ref}^{commit}`]), head);
	assert.deepEqual(
		effectRows(store).filter((row) => row.operation === "evidence-ref"),
		[
			{
				effect_key: `${run}/${ticket}/integrate/${attempt}/evidence-ref/${evidenceRef(attempt)}`,
				operation: "evidence-ref",
				state: "resolved",
			},
		],
	);
});

test("a rebase onto an unmoved base is up-to-date and rewrites nothing (§7.5)", async (t) => {
	const { store, clone, base, attempt, branch, head } = await workedAttempt(t);
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const rebased = await rebaseAttempt(clone, {
		worktreePath: opened.path,
		onto: base.commit,
	});

	assert.equal(rebased.result, REBASE_RESULTS.upToDate);
	assert.equal(rebased.head, head);
	assert.equal(rebased.previousBase, base.commit);
});

test("a moved base is rebased onto the fresh tip, and the branch adopts it under compare-and-swap (§7.5)", async (t) => {
	const { store, clone, remote, base, attempt, branch, head } = await workedAttempt(t);
	moveRemoteBase(t, remote);
	const fresh = await clone.fetchBase({ baseBranch: "main" });
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const rebased = await rebaseAttempt(clone, {
		worktreePath: opened.path,
		onto: fresh.commit,
	});

	assert.equal(rebased.result, REBASE_RESULTS.rebased);
	assert.equal(rebased.previousBase, base.commit);
	assert.notEqual(rebased.head, head);
	assert.doesNotThrow(
		() => git(opened.path, ["merge-base", "--is-ancestor", fresh.commit, rebased.head]),
		"the rebased head does not sit on the fresh base",
	);

	// The branch is still where the worker left it until the controller moves it,
	// and moving it names the value it expects to replace.
	assert.equal(git(clone.dir, ["rev-parse", `refs/heads/${branch}`]), head);
	const adopted = await adoptRebasedHead(clone, { branch, from: head, to: rebased.head });
	assert.deepEqual({ ...adopted }, { branch, head: rebased.head, moved: true });
	assert.equal(git(clone.dir, ["rev-parse", `refs/heads/${branch}`]), rebased.head);
});

test("a branch that moved under the controller is refused rather than force-updated (§7.5, §14.11)", async (t) => {
	const { store, clone, attempt, branch, head } = await workedAttempt(t);
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	await assert.rejects(
		adoptRebasedHead(clone, { branch, from: `${"0".repeat(39)}1`, to: git(opened.path, ["rev-parse", "HEAD"]) }),
		(error) => error.name === "FactoryGitError" && error.reason === "branch-collision",
	);
	assert.equal(git(clone.dir, ["rev-parse", `refs/heads/${branch}`]), head);
});

test("a rebase conflict is a typed verdict, aborted and never resolved by the controller (§7.5, §8.10)", async (t) => {
	const { store, clone, remote, base, attempt, branch, head } = await workedAttempt(t, {
		files: { "contested.txt": "the attempt's line\n" },
	});
	moveRemoteBase(t, remote, { "contested.txt": "a human's line\n" });
	const fresh = await clone.fetchBase({ baseBranch: "main" });
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const rebased = await rebaseAttempt(clone, {
		worktreePath: opened.path,
		onto: fresh.commit,
	});

	assert.equal(rebased.result, REBASE_RESULTS.conflict);
	assert.deepEqual([...rebased.conflicts], ["contested.txt"]);
	// Aborted: no rebase is left in progress for a second lane, a re-entry, or a
	// human to walk into — and the head is exactly where it was.
	assert.equal(rebased.head, head);
	assert.equal(git(opened.path, ["rev-parse", "HEAD"]), head);
	assert.equal(rebaseInProgress(opened.path), false, "a rebase was left in progress for the next caller to walk into");
});

test("a rebase whose result carries fewer non-base commits than its input is refused, never adopted (#161, §7.5, §11.2)", async (t) => {
	const { store, clone, remote, attempt, branch, head } = await workedAttempt(t);
	// A human cherry-picked the attempt's work onto the default branch: the
	// commit's patch is already upstream, so git's replay drops it and the rebase
	// completes "cleanly" with the work gone. That is the silent case the guard
	// exists to make impossible.
	moveRemoteBase(t, remote, { "worker.txt": "attempt work\n" });
	const fresh = await clone.fetchBase({ baseBranch: "main" });
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	await assert.rejects(
		rebaseAttempt(clone, { worktreePath: opened.path, onto: fresh.commit }),
		(error) => {
			assert.equal(error.name, "FactoryGitError");
			assert.equal(error.reason, "rebase-dropped-commits");
			assert.deepEqual(error.details.expected, [head]);
			assert.deepEqual(error.details.found, []);
			return true;
		},
	);

	// Never performed: the branch still holds exactly what the worker wrote — the
	// shrunken result exists only in the controller's scratch worktree.
	assert.equal(git(clone.dir, ["rev-parse", `refs/heads/${branch}`]), head);
});

test("the replay set is derived from the graph, so a repair's own base never bounds it (#161, §7.5)", async (t) => {
	// The seam itself: `rebaseAttempt` takes one base — the fresh tip that is both
	// the upstream and the target — so there is no argument through which an
	// attempt's own base (§7.3) could shrink the replay set.
	const fixture = await workedAttempt(t, { files: { "worker.txt": "the implement's work\n" } });
	const repaired = await repairAttempt(fixture, { ordinal: 2, files: { "repair.txt": "the repair\n" } });
	moveRemoteBase(t, repaired.remote);
	const fresh = await repaired.clone.fetchBase({ baseBranch: "main" });
	const opened = await openIntegrationWorktree(repaired.clone, {
		storeDir: repaired.store.storeDir,
		attempt: repaired.attempt,
		branch: repaired.branch,
	});

	const rebased = await rebaseAttempt(repaired.clone, { worktreePath: opened.path, onto: fresh.commit });

	assert.equal(rebased.result, REBASE_RESULTS.rebased);
	// Both commits — the implement's and the repair's — sit on the fresh tip.
	assert.equal(git(opened.path, ["rev-list", "--count", `${fresh.commit}..${rebased.head}`]), "2");
	assert.doesNotThrow(() => git(opened.path, ["cat-file", "-e", `${rebased.head}:worker.txt`]));
	assert.doesNotThrow(() => git(opened.path, ["cat-file", "-e", `${rebased.head}:repair.txt`]));
	// And the recorded previous base is the base-branch commit the chain sat on,
	// not the repair's own base (the prior attempt's tip).
	assert.equal(rebased.previousBase, repaired.base.commit);
	assert.notEqual(rebased.previousBase, repaired.ownBase);
});

function rebaseInProgress(worktreePath) {
	try {
		execFileSync("git", ["-C", worktreePath, "rev-parse", "--verify", "REBASE_HEAD"], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

test("§7.4's integration-side predicates pass on the branch the worker actually built", async (t) => {
	const { store, clone, base, run, ticket, attempt, branch, head } = await workedAttempt(t);
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, true);
	assert.deepEqual([...verdict.commits], [head]);
	// Asked, and every trailer was well spelled — which is not the same answer as
	// the `null` an earlier refusal returns without asking (#210).
	assert.deepEqual([...verdict.misstamped], []);
});

test("whitespace damage the worker committed stops the push (§7.4)", async (t) => {
	const { store, clone, base, run, ticket, attempt, branch } = await workedAttempt(t);
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });
	// A conflict marker, which `git diff --check` reports as damage even though
	// the file is committed and the tree is clean.
	const head = commitInto(
		opened.path,
		{ "broken.txt": "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> other\n" },
		{ message: "fix: a merge nobody finished", trailer: null },
	);

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, false);
	assert.equal(verdict.reason, INTEGRATION_REFUSALS.diffCheck);
	assert.ok(verdict.detail.length > 0, "git's own diagnosis was dropped");
	// This refusal returns before the trailer walk, so it reports no reading at
	// all rather than a clean one (#210).
	assert.equal(verdict.misstamped, null);
});

test("a commit missing §7.3's correlation trailer is caught at integration, where §7.3 says it is", async (t) => {
	const { store, clone, base, run, ticket, attempt, branch, head } = await workedAttempt(t, { trailer: false });
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, false);
	assert.equal(verdict.reason, INTEGRATION_REFUSALS.trailerMissing);
	assert.deepEqual([...verdict.untrailed], [head]);
});

test("a fumbled ticket segment is still the execution its attempt segment names (§7.3, #210)", async (t) => {
	// The incident: a worker stamped two commits correctly and mangled one segment
	// of the third. The attempt id it still carries is the whole identity tuple,
	// so the commit correlates — it is misspelled, not unstamped.
	const { store, clone, base, run, ticket, attempt, branch, head } = await workedAttempt(t, {
		trailer: damagedTicketSegment,
	});
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, true);
	assert.deepEqual([...verdict.untrailed], []);
	assert.deepEqual(
		verdict.misstamped.map((entry) => ({ ...entry })),
		[{ commit: head, trailer: damagedTicketSegmentValue({ run, ticket, attempt }) }],
	);
});

test("a damaged run segment is read the same way: the attempt id carries the run too (§7.3, #210)", async (t) => {
	const damaged = ({ run, ticket, attempt }) => `Factory-Attempt: xx${run}/${ticket}/${attempt}`;
	const { store, clone, base, run, ticket, attempt, branch, head } = await workedAttempt(t, { trailer: damaged });
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, true);
	assert.deepEqual([...verdict.untrailed], []);
	assert.equal(verdict.misstamped.length, 1);
});

test("an unstamped commit beside a misspelled one is still the refusal, and names only itself (§7.4, #210)", async (t) => {
	const { store, clone, base, run, ticket, attempt, branch } = await workedAttempt(t, {
		trailer: damagedTicketSegment,
	});
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });
	const head = commitInto(opened.path, { "loose.txt": "nobody stamped this\n" }, { message: "chore: loose", trailer: null });

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, false);
	assert.equal(verdict.reason, INTEGRATION_REFUSALS.trailerMissing);
	// The operator is sent to the commit that is genuinely unstamped, and told
	// which of the others is not why the push refused.
	assert.deepEqual([...verdict.untrailed], [head]);
	assert.equal(verdict.misstamped.length, 1);
	assert.match(verdict.detail, /damaged trailer/);
});

test("a trailer naming somebody else's ticket execution is not this attempt's correlation (§6.5)", async (t) => {
	const { store, clone, base, run, ticket, attempt, branch } = await workedAttempt(t);
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });
	const head = commitInto(
		opened.path,
		{ "smuggled.txt": "from another lane\n" },
		{ message: "feat: elsewhere", trailer: `Factory-Attempt: ${run}/9999/${run}-t9999-a1` },
	);

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, false);
	assert.equal(verdict.reason, INTEGRATION_REFUSALS.trailerMissing);
});

test("a branch with nothing on it is never pushed (§7.4)", async (t) => {
	const { store, clone, base, run, ticket, attempt } = await workedAttempt(t);
	// The base itself, checked out detached: zero commits ahead.
	const opened = await openIntegrationWorktree(clone, {
		storeDir: store.storeDir,
		attempt,
		branch: `factory/t${ticket}/a${attempt}`,
	});
	execFileSync("git", ["-C", opened.path, "checkout", "--quiet", "--detach", base.commit]);

	const verdict = await assessIntegration(clone, {
		worktreePath: opened.path,
		baseCommit: base.commit,
		head: base.commit,
		run,
		ticket,
	});

	assert.equal(verdict.pushable, false);
	assert.equal(verdict.reason, INTEGRATION_REFUSALS.noCommits);
});

test("the push is plain, and the pushed SHAs are compared against the ones verification attested (§7.4, §14.11)", async (t) => {
	const { store, clone, remote, run, ticket, branch, head } = await workedAttempt(t);

	const pushed = await pushAttemptBranch(store, clone, {
		hold: HOLD,
		run,
		ticket,
		branch,
		head,
		verifiedCommits: [head],
		actor: "controller",
		at: FIXED_NOW,
	});

	assert.equal(pushed.head, head);
	assert.equal(git(remote, ["rev-parse", `refs/heads/${branch}`]), head);
	assert.deepEqual(
		effectRows(store).filter((row) => row.operation === "push"),
		[
			{
				// §4.5's attempt slot is the reserved absent literal: the subject of a
				// push is the **published branch**, which one ticket execution publishes
				// once — not the attempt that happened to be walking (#146).
				effect_key: `${run}/${ticket}/integrate/-/push/${branch}`,
				operation: "push",
				state: "resolved",
			},
		],
	);

	// §7.7: the push of a unique branch retries cleanly, and the effect is the
	// committed one rather than a second mutation.
	const again = await pushAttemptBranch(store, clone, {
		hold: HOLD,
		run,
		ticket,
		branch,
		head,
		verifiedCommits: [head],
		actor: "controller",
		at: FIXED_NOW,
	});
	assert.equal(again.head, head);
	assert.equal(effectRows(store).filter((row) => row.operation === "push").length, 1);
});

test("a head that is not the verified commit list is refused before the remote hears about it (§14.13)", async (t) => {
	const { store, clone, remote, run, ticket, branch, head } = await workedAttempt(t);

	await assert.rejects(
		pushAttemptBranch(store, clone, {
			hold: HOLD,
			run,
			ticket,
			branch,
			head,
			// What verification attested, before something moved underneath it.
			verifiedCommits: [`${"0".repeat(39)}1`],
			actor: "controller",
			at: FIXED_NOW,
		}),
		(error) => error.name === "FactoryGitError" && error.reason === "identity-mismatch",
	);

	assert.throws(() => git(remote, ["rev-parse", "--verify", `refs/heads/${branch}`]));
	assert.deepEqual(effectRows(store).filter((row) => row.operation === "push"), []);
});

test("releasing the integration worktree removes it, and asking twice is not an error (§12.7)", async (t) => {
	const { store, clone, attempt, branch } = await workedAttempt(t);
	const opened = await openIntegrationWorktree(clone, { storeDir: store.storeDir, attempt, branch });

	assert.equal(await releaseIntegrationWorktree(clone, { path: opened.path }), true);
	assert.equal(existsSync(opened.path), false);

	// §7.7's re-entry: a step that already reclaimed it runs again and finds
	// nothing to do, rather than failing an integration that succeeded.
	assert.equal(await releaseIntegrationWorktree(clone, { path: opened.path }), false);
});
