import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createAttemptWorktree } from "../../factory/lib/git/attempt.mjs";
import { openPrivateClone } from "../../factory/lib/git/clone.mjs";
import { assessHarvest } from "../../factory/lib/git/harvest.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { makeRemote, makeRepo } from "./helpers/factory-repo.mjs";
import { attemptLaunched, FIXED_NOW, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §7.4's harvest-side predicates — builder faults, controller-enforced: an
 * attempt is harvestable as completed only if its worktree is clean **and**
 * its branch is ahead of the pinned base. A dirty worktree is a typed verdict,
 * never an auto-commit.
 */

async function attemptFixture(t) {
	const remote = makeRemote(t);
	const store = await openTestStore(t, { repoRoot: makeRepo(t, { remotes: { gitea: remote } }) });
	const clone = await openPrivateClone({ storeDir: store.storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });
	const run = newUlid(FIXED_NOW);
	store.append(runStarted(run, { at: FIXED_NOW }));
	store.append(attemptLaunched(run, 42, 1, { at: FIXED_NOW }));

	const created = await createAttemptWorktree(store, clone, {
		hold: { fence: () => ({ token: "pinned", generation: 1 }) },
		run,
		ticket: 42,
		attempt: `${run}-t42-a1`,
		phase: "implement",
		baseCommit: base.commit,
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
