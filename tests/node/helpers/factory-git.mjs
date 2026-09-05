import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
 * @param {{ ticket?: number, files?: Record<string, string>, trailer?: boolean | ((identity: object) => string) }} [options]
 *   `trailer: false` builds the branch a worker that ignored its prompt would
 *   leave, which §7.3 says integration is where it is caught; a **function**
 *   is handed the minted identity tuple and returns the line verbatim, which is
 *   how a worker that followed the rule and fumbled a token is built (#210)
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
		trailer: trailerLine(trailer, { run: fixture.run, ticket, attempt: fixture.attempt }),
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
 * The trailer #210 is about: §7.3's own line with one segment of the tuple
 * mangled, the way the incident's worker wrote it. Shared, because every test of
 * that path needs the same damage and four spellings of it would be four things
 * to keep in step.
 */
export const damagedTicketSegment = (identity) => `Factory-Attempt: ${damagedTicketSegmentValue(identity)}`;

/** The same line's value alone, which is what a verdict reports. */
export const damagedTicketSegmentValue = ({ run, ticket, attempt }) => `${run}/IÓN${ticket}/${attempt}`;

/**
 * What `workedAttempt`'s `trailer` option means: §7.3's own line, no line at
 * all, or one the caller spells off the minted identity — which is the only way
 * a *damaged* line can be written, since the run and attempt ids do not exist
 * until the attempt is minted.
 */
function trailerLine(trailer, identity) {
	if (trailer === false) return null;
	if (trailer === true) return factoryAttemptTrailer(identity);
	return trailer(identity);
}

/**
 * A §8.5 repair stacked on a worked fixture: a fresh attempt whose branch starts
 * at **the prior attempt's tip**, with its own committed work on top.
 *
 * The chain is real — `attempt.launched` appended, branch and worktree created
 * through the same effects production uses — because #161's defect is only
 * observable on a branch whose own base is another attempt's branch rather than
 * the default branch.
 *
 * @param {Readonly<object>} fixture a `workedAttempt` (or a prior repair's) fixture
 * @param {{ ordinal: number, files: Record<string, string>, message?: string }} what
 * @returns {Promise<Readonly<object>>} the fixture, re-pointed at the repair
 *   attempt: its `attempt`, `branch`, `worktreePath`, `head`, and `ownBase` —
 *   the prior tip its branch starts at
 */
export async function repairAttempt(fixture, { ordinal, files, message = "fix: the repair" }) {
	const { store, clone, run, ticket, workerConfig } = fixture;
	const attempt = `${run}-t${ticket}-a${ordinal}`;
	const ownBase = execFileSync("git", ["-C", clone.dir, "rev-parse", `refs/heads/${fixture.branch}`], {
		encoding: "utf8",
	}).trim();

	store.append(attemptLaunched(run, ticket, ordinal, { at: FIXED_NOW }));
	const { worktreePath, branch } = await createAttemptWorktree(store, clone, {
		hold: TEST_HOLD,
		run,
		ticket,
		attempt,
		phase: "implement",
		baseCommit: ownBase,
		workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});

	commitInto(worktreePath, files, {
		message,
		trailer: factoryAttemptTrailer({ run, ticket, attempt }),
	});

	return {
		...fixture,
		attempt,
		branch,
		worktreePath,
		ownBase,
		head: execFileSync("git", ["-C", clone.dir, "rev-parse", `refs/heads/${branch}`], { encoding: "utf8" }).trim(),
	};
}

/**
 * Move the remote's default branch on, the only way §9.5 says it ever moves: a
 * human merged something. The caller re-fetches to see it.
 *
 * @param {import("node:test").TestContext} t owner of the checkout's lifetime
 * @param {string} remote the bare repository standing in for Gitea
 * @param {Record<string, string>} files the tree of the new commit
 */
export function moveRemoteBase(t, remote, files = { "human.txt": "merged by a human\n" }) {
	const checkout = join(dirname(remote), `mover-${newUlid()}`);
	execFileSync("git", ["clone", "--quiet", remote, checkout]);
	t.after(() => rmSync(checkout, { recursive: true, force: true }));
	commitInto(checkout, files, { message: "chore: a human merge", trailer: null });
	execFileSync("git", ["-C", checkout, "push", "--quiet", "origin", "HEAD:refs/heads/main"]);
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
