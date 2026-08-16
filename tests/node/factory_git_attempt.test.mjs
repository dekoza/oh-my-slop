import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { openPrivateClone } from "../../factory/lib/git/clone.mjs";
import { createAttemptWorktree, FACTORY_GIT_IDENTITY } from "../../factory/lib/git/attempt.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { makeRemote, makeRepo } from "./helpers/factory-repo.mjs";
import { attemptLaunched, FIXED_NOW, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * §7.2, §7.3: an attempt's branch and worktree, created fresh from the pinned
 * base at claim time, as effects the database can enforce unique and reconcile
 * can settle.
 */

const HOLD = { fence: () => ({ token: "pinned", generation: 1 }) };

async function fixture(t) {
	const remote = makeRemote(t);
	const store = await openTestStore(t, { repoRoot: makeRepo(t, { remotes: { gitea: remote } }) });
	const clone = await openPrivateClone({ storeDir: store.storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });
	const run = newUlid(FIXED_NOW);
	store.append(runStarted(run, { at: FIXED_NOW }));
	// The tuple is minted before anything git happens (§6.5): the attempt's
	// journal record is what lets its effects carry the attempt id at all.
	store.append(attemptLaunched(run, 42, 1, { at: FIXED_NOW }));
	return { store, clone, base, run, attempt: `${run}-t42-a1` };
}

function effectRows(store) {
	return store
		.read((db) => db.prepare("SELECT effect_key, operation, state FROM effect ORDER BY requested_seq").all())
		.map((row) => ({ ...row }));
}

test("an attempt gets a fresh worktree on its own branch at the pinned base, as resolved effects", async (t) => {
	const { store, clone, base, run, attempt } = await fixture(t);

	const created = await createAttemptWorktree(store, clone, {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		actor: "controller",
		at: FIXED_NOW,
	});

	assert.equal(created.branch, `factory/t42/a${attempt}`);
	assert.equal(created.baseCommit, base.commit);
	assert.ok(existsSync(created.worktreePath), "no worktree on disk");
	assert.equal(
		execFileSync("git", ["-C", created.worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		base.commit,
	);
	assert.equal(
		execFileSync("git", ["-C", created.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		created.branch,
	);

	// §4.5: both mutations are requested/resolved pairs keyed by the tuple.
	assert.deepEqual(effectRows(store), [
		{
			effect_key: `${run}/42/implement/${attempt}/branch-create/${created.branch}`,
			operation: "branch-create",
			state: "resolved",
		},
		{
			effect_key: `${run}/42/implement/${attempt}/worktree-create`,
			operation: "worktree-create",
			state: "resolved",
		},
	]);
});

test("factory commits are authored as the factory identity, never as the operator (§7.3)", async (t) => {
	const { store, clone, base, run, attempt } = await fixture(t);
	const { worktreePath } = await createAttemptWorktree(store, clone, {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		actor: "controller",
		at: FIXED_NOW,
	});

	// A worker committing with no -c overrides — exactly how a worker commits —
	// picks up the per-worktree identity, whatever the machine's global config.
	execFileSync("git", ["-C", worktreePath, "commit", "--quiet", "--allow-empty", "-m", "feat: a wave"]);
	const author = execFileSync("git", ["-C", worktreePath, "log", "-1", "--format=%an <%ae>"], {
		encoding: "utf8",
	}).trim();

	assert.equal(author, `${FACTORY_GIT_IDENTITY.name} <${FACTORY_GIT_IDENTITY.email}>`);
});

test("re-entering the same attempt is the committed result, not a second mutation", async (t) => {
	const { store, clone, base, run, attempt } = await fixture(t);
	const context = {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		actor: "controller",
		at: FIXED_NOW,
	};

	const first = await createAttemptWorktree(store, clone, context);
	const again = await createAttemptWorktree(store, clone, context);

	assert.deepEqual(again, first);
	assert.equal(effectRows(store).length, 2, "a re-entry minted new effects");
});

test("the base is never chased mid-attempt: a moved base on re-entry is a typed conflict (§7.2)", async (t) => {
	const { store, clone, base, run, attempt } = await fixture(t);
	const context = {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		actor: "controller",
		at: FIXED_NOW,
	};
	await createAttemptWorktree(store, clone, { ...context, baseCommit: base.commit });

	const moved = execFileSync("git", ["-C", clone.dir, "commit-tree", `${base.commit}^{tree}`, "-m", "moved"], {
		encoding: "utf8",
	}).trim();

	await assert.rejects(
		createAttemptWorktree(store, clone, { ...context, baseCommit: moved }),
		(error) => error.name === "FactoryEffectError" && error.reason === "effect-payload-conflict",
	);
});
