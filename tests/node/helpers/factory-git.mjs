import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createAttemptWorktree, factoryAttemptTrailer } from "../../../factory/lib/git/attempt.mjs";
import { openPrivateClone } from "../../../factory/lib/git/clone.mjs";
import { newUlid } from "../../../factory/lib/identity/ulid.mjs";
import { prepareWorkerEnvironment } from "../../../factory/lib/worker/environment.mjs";
import { makeRemote, makeRepo } from "./factory-repo.mjs";
import { attemptLaunched, FIXED_NOW, makeHome, openTestStore, runStarted } from "./factory-store.mjs";

/**
 * Fixtures for the §7 git-isolation suites: a real remote, a real store, the
 * private clone opened against it, and one minted attempt — `run.started` and
 * `attempt.launched` appended, because the projections refuse attempt-scoped
 * effects for a tuple nothing minted (§6.5).
 *
 * This file lives one level down so `node --test tests/node/*.mjs` does not
 * pick it up as a test file of its own.
 */

/** A holder whose fence always opens — the §4.6 hold, as a test stands it up. */
export const TEST_HOLD = Object.freeze({ fence: () => ({ token: "pinned", generation: 1 }) });

/**
 * @param {import("node:test").TestContext} t
 * @param {{ ticket?: number }} [options]
 */
export async function mintedAttempt(t, { ticket = 42 } = {}) {
	const remote = makeRemote(t);
	const repoRoot = makeRepo(t, { remotes: { gitea: remote } });
	const store = await openTestStore(t, { repoRoot });
	const clone = await openPrivateClone({ storeDir: store.storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });

	const run = newUlid(FIXED_NOW);
	store.append(runStarted(run, { at: FIXED_NOW }));
	store.append(attemptLaunched(run, ticket, 1, { at: FIXED_NOW }));

	// §6.8's environment, which an attempt worktree cannot be created without:
	// it is where the pre-trust lands, beside the disabled pushurl.
	const workerConfig = prepareWorkerEnvironment({
		storeDir: store.storeDir,
		repoRoot,
		worker: { denies: [], contextFile: null, piExtensions: [] },
		env: { HOME: makeHome(t) },
	});

	const attempt = `${run}-t${ticket}-a1`;
	return {
		remote,
		store,
		clone,
		base,
		run,
		ticket,
		attempt,
		workerConfig,
		branch: `factory/t${ticket}/a${attempt}`,
	};
}

/**
 * A minted attempt whose worker has already finished: the branch and worktree
 * exist and carry committed work, stamped with §7.3's correlation trailer.
 *
 * The commits are real because §7.5's every step is a statement about git —
 * a rebase, a `diff --check`, a trailer read off a commit message, an
 * `ls-remote` identity compare — and none of them is observable through a stub.
 *
 * @param {import("node:test").TestContext} t
 * @param {{ ticket?: number, files?: Record<string, string>, trailer?: boolean }} [options]
 *   `trailer: false` builds the branch a worker that ignored its prompt would
 *   leave, which §7.3 says integration is where it is caught
 */
export async function workedAttempt(t, { ticket = 42, files = { "worker.txt": "attempt work\n" }, trailer = true } = {}) {
	const fixture = await mintedAttempt(t, { ticket });
	const { worktreePath, branch } = await createAttemptWorktree(fixture.store, fixture.clone, {
		hold: TEST_HOLD,
		run: fixture.run,
		ticket,
		attempt: fixture.attempt,
		phase: "implement",
		baseCommit: fixture.base.commit,
		workerConfig: fixture.workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});

	commitInto(worktreePath, files, {
		message: "feat: the work",
		trailer: trailer ? factoryAttemptTrailer({ run: fixture.run, ticket, attempt: fixture.attempt }) : null,
	});

	return {
		...fixture,
		branch,
		worktreePath,
		head: execFileSync("git", ["-C", fixture.clone.dir, "rev-parse", `refs/heads/${branch}`], {
			encoding: "utf8",
		}).trim(),
	};
}

/**
 * Move the remote's default branch on, the only way §9.5 says it ever moves: a
 * human merged something. The caller re-fetches to see it.
 *
 * @param {string} remote the bare repository standing in for Gitea
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} files the tree of the new commit
 * @returns {string} the new tip
 */
export function moveRemoteBase(t, remote, files = { "human.txt": "merged by a human\n" }) {
	const checkout = join(dirname(remote), `mover-${Math.random().toString(36).slice(2)}`);
	execFileSync("git", ["clone", "--quiet", remote, checkout]);
	t.after(() => execFileSync("rm", ["-rf", checkout]));
	commitInto(checkout, files, { message: "chore: a human merge", trailer: null });
	execFileSync("git", ["-C", checkout, "push", "--quiet", "origin", "HEAD:refs/heads/main"]);
	return execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

/** One commit, written into a worktree the way a worker writes one. */
export function commitInto(worktreePath, files, { message, trailer }) {
	for (const [path, body] of Object.entries(files)) {
		mkdirSync(dirname(join(worktreePath, path)), { recursive: true });
		writeFileSync(join(worktreePath, path), body, "utf8");
	}
	execFileSync("git", ["-C", worktreePath, "add", "--all"]);
	execFileSync("git", [
		"-C",
		worktreePath,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"commit",
		"--quiet",
		"-m",
		trailer === null ? message : `${message}\n\n${trailer}`,
	]);
	return execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}
