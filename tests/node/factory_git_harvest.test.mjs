import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createAttemptWorktree } from "../../factory/lib/git/attempt.mjs";
import { assessHarvest } from "../../factory/lib/git/harvest.mjs";
import { mintedAttempt, moveRemoteBase, TEST_HOLD } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * §7.4's harvest-side predicates — builder faults, controller-enforced: an
 * attempt is harvestable as completed only if its worktree is clean **and**
 * its branch is ahead of the pinned base. A dirty worktree is a typed verdict,
 * never an auto-commit.
 */

async function attemptFixture(t) {
	const { store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);

	const created = await createAttemptWorktree(store, clone, {
		hold: TEST_HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});
	return { clone, ...created };
}

function commitAll(worktreePath, message) {
	execFileSync("git", ["-C", worktreePath, "add", "--all"]);
	execFileSync("git", ["-C", worktreePath, "commit", "--quiet", "-m", message]);
}

test("an attempt with no commits is not harvestable, even with a clean tree", async (t) => {
	const { clone, worktreePath, branch, baseCommit } = await attemptFixture(t);

	const verdict = await assessHarvest(clone, { worktreePath, branch, baseCommit });

	assert.equal(verdict.harvestable, false);
	assert.equal(verdict.reason, "no-commits");
});

test("a dirty worktree is a typed verdict naming the leftovers, never an auto-commit", async (t) => {
	const { clone, worktreePath, branch, baseCommit } = await attemptFixture(t);
	writeFileSync(join(worktreePath, "feature.txt"), "built\n");
	commitAll(worktreePath, "feat: a wave");
	writeFileSync(join(worktreePath, "untracked.tmp"), "left behind\n");

	const verdict = await assessHarvest(clone, { worktreePath, branch, baseCommit });

	assert.equal(verdict.harvestable, false);
	assert.equal(verdict.reason, "worktree-dirty");
	assert.deepEqual(verdict.leftovers, ["?? untracked.tmp"]);
	// Never auto-committed: the tree is exactly as the worker left it.
	assert.match(
		execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], { encoding: "utf8" }),
		/untracked\.tmp/,
	);
});

test("clean and ahead of the pinned base is harvestable, with the head it will publish", async (t) => {
	const { clone, worktreePath, branch, baseCommit } = await attemptFixture(t);
	writeFileSync(join(worktreePath, "feature.txt"), "built\n");
	commitAll(worktreePath, "feat: the work");

	const verdict = await assessHarvest(clone, { worktreePath, branch, baseCommit });

	assert.equal(verdict.harvestable, true);
	assert.equal(verdict.commitsAhead, 1);
	assert.equal(
		verdict.head,
		execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	);
});

test("#194: under a rebase-repair, commits ahead are read against the merge-base with the base it rebased onto", async (t) => {
	const fixture = await mintedAttempt(t);
	const { clone } = fixture;
	const { worktreePath, branch } = await createAttemptWorktree(fixture.store, fixture.clone, {
		hold: TEST_HOLD,
		run: fixture.run,
		ticket: 42,
		attempt: fixture.attempt,
		phase: "implement",
		baseCommit: fixture.base.commit,
		workerConfig: fixture.workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});
	writeFileSync(join(worktreePath, "feature.txt"), "built\n");
	commitAll(worktreePath, "feat: the work");
	const priorTip = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

	// The base moves by a human merge, and the worker — a rebase-repair, whose
	// branch starts at the prior tip — rebases the work onto the fresh tip.
	moveRemoteBase(t, fixture.remote, { "human.txt": "merged while the attempt ran\n" });
	const fresh = await clone.fetchBase({ baseBranch: "main" });
	execFileSync("git", ["-C", worktreePath, "rebase", "--quiet", fresh.commit]);

	// Against the attempt's own base — the prior tip — the base's commit would
	// count as the worker's: the prior tip is no longer an ancestor at all.
	const naive = await assessHarvest(clone, { worktreePath, branch, baseCommit: priorTip });
	assert.equal(naive.commitsAhead, 2, "the reading #194 corrects: the human's commit credited to the worker");

	const verdict = await assessHarvest(clone, { worktreePath, branch, baseCommit: priorTip, onto: fresh.commit });

	assert.equal(verdict.harvestable, true);
	assert.equal(verdict.commitsAhead, 1, "one commit past the merge-base with the base it rebased onto");
});
