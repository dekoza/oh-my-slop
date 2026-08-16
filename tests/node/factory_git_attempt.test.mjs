import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
	createAttemptWorktree,
	FACTORY_GIT_IDENTITY,
	factoryAttemptTrailer,
} from "../../factory/lib/git/attempt.mjs";
import {
	claudeTrustDecision,
	piTrustDecision,
	readClaudeConfigState,
	readPiTrust,
} from "../../factory/lib/worker/trust.mjs";
import { mintedAttempt, TEST_HOLD as HOLD } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * §7.2, §7.3: an attempt's branch and worktree, created fresh from the pinned
 * base at claim time, as effects the database can enforce unique and reconcile
 * can settle.
 */

function effectRows(store) {
	return store
		.read((db) => db.prepare("SELECT effect_key, operation, state FROM effect ORDER BY requested_seq").all())
		.map((row) => ({ ...row }));
}

test("an attempt gets a fresh worktree on its own branch at the pinned base, as resolved effects", async (t) => {
	const { store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);

	const created = await createAttemptWorktree(store, clone, {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		workerConfig,
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
	const { store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);
	const { worktreePath } = await createAttemptWorktree(store, clone, {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		workerConfig,
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

test("§6.8's deny floor rides the worktree itself: a worker's push has nowhere to go", async (t) => {
	const { remote, store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);
	const { worktreePath, branch } = await createAttemptWorktree(store, clone, {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});

	execFileSync("git", ["-C", worktreePath, "commit", "--quiet", "--allow-empty", "-m", "feat: a wave"]);
	assert.throws(
		() => execFileSync("git", ["-C", worktreePath, "push", "origin", branch], { stdio: "pipe", encoding: "utf8" }),
		// git names the disabled URL's scheme, so the refusal a worker reads says
		// why it was refused rather than looking like a broken remote.
		(error) => /factory-deny-floor/.test(String(error.stderr)),
	);

	// The clone's own push URL is untouched: §7.5's integration is the one push
	// the pipeline exists to make, and it runs from the clone, not the worktree.
	assert.equal(
		execFileSync("git", ["-C", clone.dir, "remote", "get-url", "--push", "origin"], { encoding: "utf8" }).trim(),
		remote,
	);
});

test("an attempt worktree is pre-trusted for both runtimes before any worker sees it", async (t) => {
	const { store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);

	const { worktreePath } = await createAttemptWorktree(store, clone, {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});

	assert.equal(piTrustDecision(readPiTrust(workerConfig.roots.pi), worktreePath), true);
	assert.equal(claudeTrustDecision(readClaudeConfigState(workerConfig.roots.claude), clone.dir), true);
});

test("a worktree asked for without the worker config environment is refused, not created half-safe", async (t) => {
	const { store, clone, base, run, attempt } = await mintedAttempt(t);

	await assert.rejects(
		createAttemptWorktree(store, clone, {
			hold: HOLD,
			run,
			ticket: 42,
			attempt,
			phase: "implement",
			baseCommit: base.commit,
			workerConfig: null,
			actor: "controller",
			at: FIXED_NOW,
		}),
		(error) => error.name === "FactoryGitError" && error.reason === "worktree-unusable",
	);
});

test("re-entering the same attempt is the committed result, not a second mutation", async (t) => {
	const { store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);
	const context = {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		baseCommit: base.commit,
		workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	};

	const first = await createAttemptWorktree(store, clone, context);
	const again = await createAttemptWorktree(store, clone, context);

	assert.deepEqual(again, first);
	assert.equal(effectRows(store).length, 2, "a re-entry minted new effects");
});

test("the base is never chased mid-attempt: a moved base on re-entry is a typed conflict (§7.2)", async (t) => {
	const { store, clone, base, run, attempt, workerConfig } = await mintedAttempt(t);
	const context = {
		hold: HOLD,
		run,
		ticket: 42,
		attempt,
		phase: "implement",
		workerConfig,
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

test("the Factory-Attempt trailer has one spelling, shared by prompt and verifier (§7.3)", async (t) => {
	const { run, attempt } = await mintedAttempt(t);

	assert.equal(factoryAttemptTrailer({ run, ticket: 42, attempt }), `Factory-Attempt: ${run}/42/${attempt}`);

	// A trailer naming a mismatched tuple would correlate every commit it
	// stamps with somebody else's work.
	assert.throws(
		() => factoryAttemptTrailer({ run, ticket: 7, attempt }),
		(error) => error.name === "FactoryGitError" && error.reason === "identity-mismatch",
	);
	assert.throws(
		() => factoryAttemptTrailer({ run: "01OTHERRUN00000000000000AA", ticket: 42, attempt }),
		(error) => error.name === "FactoryGitError" && error.reason === "identity-mismatch",
	);
});
