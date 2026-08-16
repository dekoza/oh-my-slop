import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

import { createAttemptWorktree } from "../../factory/lib/git/attempt.mjs";
import { harvestPhase, verifyPhase } from "../../factory/lib/pipeline/phases.mjs";
import { mintedAttempt, TEST_HOLD } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * §8.1's controller phases: `harvest` and `verify` have **no model in them**.
 * They are the point at which §7.4's git predicates and §8.2's check results
 * become §8.10's outcomes — the mapping `git/harvest.mjs` and `checks/run.mjs`
 * both deliberately leave to the stage machine.
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

function workspace(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-phases-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

const check = (overrides) => ({
	name: "unit",
	command: "true",
	timeout: 30,
	severity: "required",
	expectedFailureExitCodes: [1],
	...overrides,
});

test("a clean branch ahead of its base harvests as passed, carrying the head it will publish (§7.4)", async (t) => {
	const { clone, worktreePath, branch, baseCommit } = await attemptFixture(t);
	writeFileSync(join(worktreePath, "feature.txt"), "built\n");
	commitAll(worktreePath, "feat: the work");

	const resolved = await harvestPhase(clone, { worktreePath, branch, baseCommit });

	assert.equal(resolved.outcome, "passed");
	assert.equal(resolved.detail.commits_ahead, 1);
	assert.match(resolved.detail.head, /^[0-9a-f]{40}$/);
});

test("a dirty worktree harvests as predicate-failed, naming the leftovers (§7.4, §8.10)", async (t) => {
	const { clone, worktreePath, branch, baseCommit } = await attemptFixture(t);
	writeFileSync(join(worktreePath, "feature.txt"), "built\n");
	commitAll(worktreePath, "feat: a wave");
	writeFileSync(join(worktreePath, "untracked.tmp"), "left behind\n");

	const resolved = await harvestPhase(clone, { worktreePath, branch, baseCommit });

	assert.equal(resolved.outcome, "predicate-failed");
	assert.equal(resolved.detail.reason, "worktree-dirty");
	assert.deepEqual(resolved.detail.leftovers, ["?? untracked.tmp"]);
});

test("a green required set verifies as passed, and every check rides as evidence (§8.2)", async (t) => {
	const resolved = await verifyPhase([check({}), check({ name: "lint", severity: "advisory" })], {
		cwd: workspace(t),
		now: () => FIXED_NOW,
	});

	assert.equal(resolved.outcome, "passed");
	assert.deepEqual(
		resolved.detail.checks.map((entry) => [entry.name, entry.result]),
		[
			["unit", "passed"],
			["lint", "passed"],
		],
	);
	assert.deepEqual(resolved.detail.red, []);
});

test("a required check failing inside its declared codes is the worker's failure (§8.2)", async (t) => {
	const resolved = await verifyPhase([check({ command: "exit 1" })], { cwd: workspace(t), now: () => FIXED_NOW });

	assert.equal(resolved.outcome, "failed");
	assert.deepEqual(resolved.detail.red, ["unit"]);
});

test("a required check nobody could run is unrunnable, and outranks a genuine failure (§8.2, §14.16)", async (t) => {
	const resolved = await verifyPhase(
		[check({ name: "unit", command: "exit 1" }), check({ name: "types", command: "definitely-not-a-command" })],
		{ cwd: workspace(t), now: () => FIXED_NOW },
	);

	assert.equal(
		resolved.outcome,
		"unrunnable",
		"the controller's rerun is the attestation boundary, and an incomplete rerun attests nothing",
	);
	assert.deepEqual(resolved.detail.unrunnable, ["types"]);
});

test("an advisory check records evidence and never blocks (§8.2)", async (t) => {
	const resolved = await verifyPhase([check({}), check({ name: "e2e", command: "exit 3", severity: "advisory" })], {
		cwd: workspace(t),
		now: () => FIXED_NOW,
	});

	assert.equal(resolved.outcome, "passed");
	assert.equal(resolved.detail.checks.find((entry) => entry.name === "e2e").result, "unrunnable");
});
