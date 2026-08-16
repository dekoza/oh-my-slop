import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createAttemptWorktree } from "../../factory/lib/git/attempt.mjs";
import { assessMutation, captureWorktreeState } from "../../factory/lib/git/attestation.mjs";
import { mintedAttempt } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * §6.8's mutation attestation, over a real worktree.
 *
 * The guard is the reason §8.4 can hand a model a checkout at all, so it is
 * exercised against git rather than against a stub: what makes it work is that
 * `git status --porcelain` and `rev-parse HEAD` between them see every way a
 * worktree can change, and that is a fact about git.
 */

/** A real attempt worktree, created from the pinned base as the controller would. */
async function reviewerWorktree(t) {
	const context = await mintedAttempt(t);
	const created = await createAttemptWorktree(context.store, context.clone, {
		hold: { fence: () => ({ token: "pinned", generation: 1 }) },
		run: context.run,
		ticket: context.ticket,
		attempt: context.attempt,
		phase: "review",
		baseCommit: context.base.commit,
		workerConfig: context.workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});

	return { ...context, ...created };
}

test("a freshly created worktree is clean, and its HEAD is the commit it was made from (§6.8)", async (t) => {
	const context = await reviewerWorktree(t);

	const captured = await captureWorktreeState(context.clone, context);

	assert.equal(captured.clean, true);
	assert.deepEqual(captured.leftovers, []);
	assert.equal(captured.head, context.base.commit);
});

test("a reviewer that edited without committing is caught by the status half (§6.8)", async (t) => {
	const context = await reviewerWorktree(t);
	const before = await captureWorktreeState(context.clone, context);

	writeFileSync(join(context.worktreePath, "README.md"), "a reviewer's helpful fix\n");
	const guard = assessMutation({ before, after: await captureWorktreeState(context.clone, context) });

	assert.equal(guard.mutated, true);
	assert.deepEqual(guard.reasons, ["dirty-after"]);
	assert.equal(guard.after.head, before.head, "the head did not move; the working tree did");
	assert.ok(guard.after.leftovers.some((line) => line.includes("README.md")));
});

test("a reviewer that committed is caught by the HEAD half (§6.8)", async (t) => {
	const context = await reviewerWorktree(t);
	const before = await captureWorktreeState(context.clone, context);

	writeFileSync(join(context.worktreePath, "fix.txt"), "and I committed it\n");
	execFileSync("git", ["-C", context.worktreePath, "add", "-A"]);
	execFileSync("git", ["-C", context.worktreePath, "commit", "-m", "helpful"]);
	const guard = assessMutation({ before, after: await captureWorktreeState(context.clone, context) });

	assert.equal(guard.mutated, true);
	assert.deepEqual(guard.reasons, ["head-moved"], "a commit leaves the tree clean, which is why one half is not enough");
	assert.notEqual(guard.after.head, before.head);
});

test("a reviewer that only read leaves both halves unchanged (§6.8)", async (t) => {
	const context = await reviewerWorktree(t);
	const before = await captureWorktreeState(context.clone, context);

	execFileSync("git", ["-C", context.worktreePath, "log", "--oneline"]);
	execFileSync("git", ["-C", context.worktreePath, "diff", context.base.commit]);
	const guard = assessMutation({ before, after: await captureWorktreeState(context.clone, context) });

	assert.equal(guard.mutated, false);
	assert.deepEqual(guard.reasons, []);
});

test("an opening capture that is already dirty is a mutation, not a third answer (§14.19)", async (t) => {
	const context = await reviewerWorktree(t);
	writeFileSync(join(context.worktreePath, "left-behind.txt"), "from a crashed pass\n");

	const before = await captureWorktreeState(context.clone, context);
	const guard = assessMutation({ before, after: before });

	assert.equal(guard.mutated, true);
	assert.deepEqual(
		guard.reasons,
		["dirty-before", "dirty-after"],
		"the opening capture compared against itself: it was dirty when the controller looked, and still is",
	);
});

test("a deletion is a mutation too: the guard is not watching for new files (§6.8)", async (t) => {
	const context = await reviewerWorktree(t);
	const before = await captureWorktreeState(context.clone, context);

	rmSync(join(context.worktreePath, "README.md"));
	const guard = assessMutation({ before, after: await captureWorktreeState(context.clone, context) });

	assert.equal(guard.mutated, true);
	assert.deepEqual(guard.reasons, ["dirty-after"]);
});

test("the guard refuses a branch outside the factory's namespace (§14.11)", async (t) => {
	const context = await reviewerWorktree(t);

	await assert.rejects(
		() => captureWorktreeState(context.clone, { worktreePath: context.worktreePath, branch: "main" }),
		(error) => {
			assert.equal(error.reason, "ref-outside-namespace");
			return true;
		},
	);
});
