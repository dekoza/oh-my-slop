import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { readArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { recordCheckOutputs } from "../../factory/lib/checks/artifacts.mjs";
import { runBaseline } from "../../factory/lib/checks/baseline.mjs";
import { openPrivateClone } from "../../factory/lib/git/clone.mjs";
import { baselinesRoot } from "../../factory/lib/git/isolation.mjs";
import { makeRemote, makeRepo } from "./helpers/factory-repo.mjs";
import { FIXED_NOW, openTestStore } from "./helpers/factory-store.mjs";

/**
 * §8.3: **green at base, or the run does not start** — and §10.5's
 * `doctor --baseline` executes the same set in a **throwaway worktree inside the
 * factory-private clone, never the operator's checkout**, deleted eagerly on
 * success and retained on failure (§12.7).
 *
 * Everything here is real: a real remote, a real private clone, real worktrees,
 * real processes. "It ran at the pinned base and not in your checkout" is a
 * statement about a filesystem.
 */

function check({ name = "unit", command, severity = "required", timeout = 30, expectedFailureExitCodes = [1] }) {
	return { name, command, timeout, severity, expectedFailureExitCodes };
}

/** A runner result, minus the bytes each recording test supplies itself. */
const resultShape = Object.freeze({
	command: "true",
	severity: "required",
	result: "passed",
	reason: null,
	exit_code: 0,
	signal: null,
	duration_ms: 4,
	output_bytes: 0,
	truncated: false,
	message: "unit passed.",
});

async function fixture(t) {
	const remote = makeRemote(t);
	const repoRoot = makeRepo(t, { remotes: { gitea: remote } });
	const store = await openTestStore(t, { repoRoot });
	const clone = await openPrivateClone({ storeDir: store.storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });

	return { remote, repoRoot, store, clone, base };
}

test("the required set runs at the pinned base, in a throwaway worktree inside the private clone", async (t) => {
	const { store, clone, base } = await fixture(t);

	const answer = await runBaseline(clone, {
		storeDir: store.storeDir,
		checks: [check({ command: "git rev-parse HEAD && pwd" })],
		baseCommit: base.commit,
		baseBranch: "main",
	});

	assert.equal(answer.ok, true);
	assert.equal(answer.base_commit, base.commit);
	const output = answer.results[0].output.toString("utf8");
	assert.match(output, new RegExp(base.commit), "the checks did not run at the pinned base commit");
	assert.ok(
		output.includes(baselinesRoot(store.storeDir)),
		`the checks ran outside the baselines root: ${output}`,
	);
});

test("a green baseline deletes its worktree eagerly (§12.7)", async (t) => {
	const { store, clone, base } = await fixture(t);

	const answer = await runBaseline(clone, {
		storeDir: store.storeDir,
		checks: [check({ command: "exit 0" })],
		baseCommit: base.commit,
		baseBranch: "main",
	});

	assert.equal(answer.worktree.retained, false);
	assert.equal(existsSync(answer.worktree.path), false, "a green baseline kept its throwaway worktree");
	assert.deepEqual(await clone.listWorktrees(), [], "the removed worktree stayed registered");
});

test("a red baseline is retained, and names the specific red check (§8.3)", async (t) => {
	const { store, clone, base } = await fixture(t);

	const answer = await runBaseline(clone, {
		storeDir: store.storeDir,
		checks: [check({ name: "unit", command: "exit 0" }), check({ name: "lint", command: "exit 1" })],
		baseCommit: base.commit,
		baseBranch: "main",
	});

	assert.equal(answer.ok, false);
	assert.deepEqual(answer.red, ["lint"]);
	assert.equal(answer.worktree.retained, true);
	assert.equal(existsSync(answer.worktree.path), true, "a failing baseline is exactly when an operator wants to cd in");
	assert.match(answer.message, /lint/);
});

test("a baseline runs the required set alone — advisory checks never gate a run (§8.2, §8.3)", async (t) => {
	const { store, clone, base } = await fixture(t);

	const answer = await runBaseline(clone, {
		storeDir: store.storeDir,
		checks: [check({ name: "unit", command: "exit 0" }), check({ name: "e2e", command: "exit 1", severity: "advisory" })],
		baseCommit: base.commit,
		baseBranch: "main",
	});

	assert.equal(answer.ok, true);
	assert.deepEqual(
		answer.results.map((result) => result.name),
		["unit"],
	);
	assert.deepEqual(answer.skipped, ["e2e"]);
});

test("the throwaway worktree writes no ref, so §14.11 holds without blessing one", async (t) => {
	const { store, clone, base } = await fixture(t);
	const refs = () => clone.git(["for-each-ref", "--format=%(refname)"]);
	const before = await refs();

	await runBaseline(clone, {
		storeDir: store.storeDir,
		checks: [check({ command: "exit 1" })],
		baseCommit: base.commit,
		baseBranch: "main",
	});

	assert.equal(await refs(), before, "the baseline wrote a ref into the private clone");
});

test("the operator's checkout is neither read nor written — protection is topological (§7.1)", async (t) => {
	const { repoRoot, store, clone, base } = await fixture(t);
	const snapshot = () => ({
		status: execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }),
		refs: execFileSync("git", ["-C", repoRoot, "for-each-ref"], { encoding: "utf8" }),
	});
	const before = snapshot();

	await runBaseline(clone, {
		storeDir: store.storeDir,
		checks: [check({ command: "echo touched > touched-the-checkout" })],
		baseCommit: base.commit,
		baseBranch: "main",
	});

	assert.deepEqual(snapshot(), before);
	assert.equal(existsSync(`${repoRoot}/touched-the-checkout`), false);
});

test("two baselines never share a worktree (§14.23)", async (t) => {
	const { store, clone, base } = await fixture(t);
	const run = () =>
		runBaseline(clone, {
			storeDir: store.storeDir,
			checks: [check({ command: "exit 1" })],
			baseCommit: base.commit,
			baseBranch: "main",
		});

	const [first, second] = await Promise.all([run(), run()]);

	assert.notEqual(first.worktree.path, second.worktree.path);
	assert.notEqual(first.execution, second.execution);
});

// ── Recording the output (§8.7, §12.1, §4.5) ─────────────────────────────────

test("two executions of one check are two artifacts, not a payload conflict", async (t) => {
	const { store, clone, base } = await fixture(t);
	const record = (execution, text) =>
		recordCheckOutputs(store, [{ ...resultShape, name: "unit", output: Buffer.from(text) }], {
			execution,
			run: null,
			phase: "preflight",
			actor: "controller",
			fencingGeneration: 1,
			at: FIXED_NOW,
		});

	// §10.4 preflights an adopted run again, so one run runs one check twice — and
	// a suite's output is never byte-identical twice. Keyed by the check alone,
	// the second execution would be §4.5's typed conflict, produced by nothing but
	// time passing.
	const first = record("01KGE3H900QBH0XZSPYXWV3T5R", `ran at ${base.commit} in 4s`);
	const second = record("01KGE3H900QBH0XZSPYXWV3T5S", `ran at ${base.commit} in 5s`);

	assert.notEqual(first[0].output.digest, second[0].output.digest);
	assert.match(readArtifact(store, first[0].output).toString("utf8"), /4s/);
	assert.equal(clone.dir.endsWith("clone.git"), true);
});

test("the same execution recorded twice is the same artifact, and disagreeing bytes are a conflict", async (t) => {
	const { store } = await fixture(t);
	const record = (text) =>
		recordCheckOutputs(store, [{ ...resultShape, name: "unit", output: Buffer.from(text) }], {
			execution: "01KGE3H900QBH0XZSPYXWV3T5R",
			run: null,
			phase: "preflight",
			actor: "controller",
			fencingGeneration: 1,
			at: FIXED_NOW,
		});

	const first = record("output");
	const again = record("output");
	assert.equal(again[0].output.digest, first[0].output.digest);

	assert.throws(() => record("a different story about the same run of the same check"), (error) => {
		assert.equal(error.reason, "effect-payload-conflict");
		return true;
	});
});

test("a clone that is not the store's own is refused rather than scattering worktrees", async (t) => {
	const { clone, base } = await fixture(t);

	await assert.rejects(
		() =>
			runBaseline(clone, {
				storeDir: "/somewhere/else",
				checks: [check({ command: "exit 0" })],
				baseCommit: base.commit,
				baseBranch: "main",
			}),
		(error) => {
			assert.equal(error.reason, "clone-unavailable");
			return true;
		},
	);
});
