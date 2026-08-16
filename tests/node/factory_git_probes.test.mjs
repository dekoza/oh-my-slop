import test from "node:test";
import assert from "node:assert/strict";

import { rmSync } from "node:fs";

import { requestEffect, unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { attemptWorktreePath, privateClonePath } from "../../factory/lib/git/isolation.mjs";
import { registerGitProbes } from "../../factory/lib/git/probes.mjs";
import { reconcile } from "../../factory/lib/reconcile/engine.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { mintedAttempt } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * §5.3: the git probes ship with git isolation — the reads that settle
 * `branch-create`, `worktree-create`, and their deletion counterparts by
 * asking the private clone what actually exists.
 *
 * Every scenario is the same crash: the controller asked for a mutation and
 * died before recording what the world did. Only re-probing may settle it.
 */

const AT = FIXED_NOW + 100_000;

async function crashFixture(t) {
	const minted = await mintedAttempt(t);

	const probes = createProbeRegistry();
	registerGitProbes(probes);

	return { ...minted, probes };
}

function requested(store, { run, attempt, operation, operand, payload }) {
	return requestEffect(store, {
		run,
		ticket: 42,
		phase: "implement",
		attempt,
		operation,
		operand,
		actor: "controller",
		fencingGeneration: 1,
		payload,
		at: FIXED_NOW,
	});
}

test("a branch the crash left behind settles its effect from the clone, not from the journal", async (t) => {
	const { store, clone, base, probes, run, attempt, branch } = await crashFixture(t);
	requested(store, { run, attempt, operation: "branch-create", operand: branch, payload: { branch, base_commit: base.commit } });
	await clone.createBranch({ branch, at: base.commit });

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.settled, 1);
	assert.deepEqual(unresolvedEffects(store), []);

	const observed = store.readEvents({}).filter((event) => event.kind === "observation.recorded");
	assert.equal(observed[0].source, "git");
	assert.equal(observed[0].foreign_source_id, `git:${base.commit}`);
	assert.ok(observed[0].payload.occurred_at_raw.length > 0, "a foreign fact keeps its raw timestamp");
});

test("a branch that never landed leaves the intent standing", async (t) => {
	const { store, base, probes, run, attempt, branch } = await crashFixture(t);
	const effect = requested(store, {
		run,
		attempt,
		operation: "branch-create",
		operand: branch,
		payload: { branch, base_commit: base.commit },
	});

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.settled, 0);
	assert.equal(unresolvedEffects(store)[0].effect_key, effect.key);
	assert.equal(report.entities[0].conclusion, "unchanged");
});

test("a worktree is re-found from the attempt id alone, because its path is deterministic", async (t) => {
	const { store, clone, base, probes, run, attempt, branch } = await crashFixture(t);
	const path = attemptWorktreePath(store.storeDir, attempt);
	requested(store, {
		run,
		attempt,
		operation: "worktree-create",
		operand: null,
		payload: { path, branch, base_commit: base.commit },
	});
	await clone.createBranch({ branch, at: base.commit });
	await clone.addWorktree({ path, branch });

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.settled, 1);
	assert.deepEqual(unresolvedEffects(store), []);
});

test("with no clone on disk the probe fails, and the effect is reported rather than guessed", async (t) => {
	const { store, probes, run, attempt, branch } = await crashFixture(t);
	requested(store, { run, attempt, operation: "branch-create", operand: branch, payload: { branch } });
	rmSync(privateClonePath(store.storeDir), { recursive: true, force: true });

	const report = await reconcile(store, { probes, fencingGeneration: 1, at: AT });

	assert.equal(report.settled, 0);
	assert.equal(report.unsettled.length, 1);
	assert.equal(report.unsettled[0].reason, "probe-failed");
	assert.equal(unresolvedEffects(store).length, 1, "an unprobeable effect was settled by reasoning");
});
