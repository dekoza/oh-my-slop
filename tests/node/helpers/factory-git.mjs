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
