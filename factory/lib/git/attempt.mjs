import { requestEffect, resolveEffect } from "../effects/records.mjs";
import { FactoryGitError } from "./errors.mjs";
import { attemptBranch, attemptWorktreePath, privateClonePath } from "./isolation.mjs";

/**
 * §7.3: one branch and one fresh worktree per attempt, created at claim time
 * from the base commit §7.2 pinned — and both as **effects** (§4.5), so a crash
 * between the git mutation and its durable resolution is settled by reconcile's
 * probes rather than by guessing.
 */

/**
 * §7.3's dedicated factory git identity. It lives in code, not configuration:
 * "factory commits are never authored as the operator" is an invariant, and an
 * identity someone can configure back to their own is a preference. The domain
 * is RFC 2606-reserved, so the address can never route anywhere.
 */
export const FACTORY_GIT_IDENTITY = Object.freeze({
	name: "Software Factory",
	email: "factory@software-factory.invalid",
});

/**
 * §7.3's mandatory correlation trailer, `Factory-Attempt: <run>/<ticket>/<attempt>`.
 *
 * The obligation to *carry* it rides the worker's prompt (#107) and the check
 * that it arrived rides integration (#113); what belongs here is the one
 * spelling both sides share. Two independent formatters would be the drift
 * §7.3's "verified at integration" cannot survive.
 *
 * @param {{ run: string, ticket: number, attempt: string }} identity
 * @returns {string} the full trailer line
 * @throws {FactoryGitError} `identity-charset` · `identity-mismatch`
 */
export function factoryAttemptTrailer({ run, ticket, attempt }) {
	// The same tuple-consistency rule the branch is minted under: a trailer
	// naming a mismatched pair would correlate an attempt with somebody else's
	// ticket in every commit it stamps.
	attemptBranch({ ticket, attempt });
	if (typeof run !== "string" || !attempt.startsWith(`${run}-t`)) {
		throw new FactoryGitError(
			"identity-mismatch",
			`Attempt id ${attempt} does not name run ${JSON.stringify(run ?? null)} (§2.1).`,
			{ at: "run", found: run ?? null, expected: `${attempt.split("-t")[0]}` },
		);
	}
	return `Factory-Attempt: ${run}/${ticket}/${attempt}`;
}

/**
 * Create — or find already created — the attempt's branch and worktree.
 *
 * The base commit is **pinned by the first request**: it rides both effect
 * payloads, so a re-entry offering a different base is §4.5's typed payload
 * conflict — §7.2's "the base is never chased mid-attempt" arriving as a
 * refusal rather than as a rule anyone follows. A re-entry offering the same
 * base finds both effects resolved and performs nothing.
 *
 * The caller fetches immediately before calling (§7.2); this function never
 * fetches, so what it pins is exactly what the caller saw.
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {object} clone the private clone's handle (`clone.mjs`)
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt the attempt id, `<run>-t<ticket>-a<n>`
 * @param {string} context.phase §2.2's phase this claim serves
 * @param {string} context.baseCommit §7.2's freshly fetched tip
 * @param {object} context.workerConfig §6.8's worker config environment
 *   (`worker/environment.mjs`). Required, not optional: an attempt worktree is
 *   not usable by a worker until it is both push-disabled and pre-trusted, and
 *   leaving either to a second caller is how one of them gets forgotten
 * @param {string} context.actor `controller`, or `operator:<verb>`
 * @param {number} context.at
 * @returns {Promise<Readonly<{ branch: string, worktreePath: string, baseCommit: string }>>}
 *   the git facts the attempt manifest records (§6.5)
 */
export async function createAttemptWorktree(
	store,
	clone,
	{ hold, run, ticket, attempt, phase, baseCommit, workerConfig, actor, at },
) {
	const branch = attemptBranch({ ticket, attempt });
	const worktreePath = attemptWorktreePath(storeDirOf(store, clone), attempt);
	const identity = { run, ticket, phase, attempt, actor, at };

	if (typeof workerConfig?.pretrust !== "function") {
		throw new FactoryGitError(
			"worktree-unusable",
			`Creating an attempt worktree needs §6.8's worker config environment: the worktree is where the deny floor's ` +
				`disabled pushurl and the runtimes' pre-trust are written, and a worktree missing either hands a worker a ` +
				`pane that can push or one that hangs on a trust dialog.`,
			{ at: "workerConfig", attempt },
		);
	}

	await asEffect(store, {
		...identity,
		hold,
		operation: "branch-create",
		operand: branch,
		payload: { branch, base_commit: baseCommit },
		perform: async () => {
			const { sha } = await clone.createBranch({ branch, at: baseCommit });
			return { branch, sha };
		},
	});

	await asEffect(store, {
		...identity,
		hold,
		operation: "worktree-create",
		operand: null,
		payload: { path: worktreePath, branch, base_commit: baseCommit },
		perform: async () => {
			await clone.addWorktree({ path: worktreePath, branch });
			await configureIdentity(clone, worktreePath);
			return { path: worktreePath };
		},
	});

	// Outside the effect, and therefore on every re-entry.
	//
	// Both are idempotent convergence rather than mutations to be performed once:
	// an effect that already resolved would skip them, and the two things they
	// guard — a worker that cannot push, a pane that never meets a trust dialog —
	// have to be true of a re-entered attempt exactly as much as a fresh one. The
	// trust store in particular is derived, disposable state; a run rebuilding it
	// would otherwise leave every adopted worktree untrusted.
	await disablePush(clone, worktreePath);
	workerConfig.pretrust({ worktreePath, gitCommonDir: clone.dir });

	return Object.freeze({ branch, worktreePath, baseCommit });
}

/**
 * One requested / performed / resolved cycle. An already-resolved effect skips
 * the mutation — the world already answered — and an already-requested one
 * re-performs it: both git mutations are idempotent under their deterministic
 * names, which is what makes a crash between request and resolution repairable
 * by simply running again.
 */
async function asEffect(store, { hold, run, ticket, phase, attempt, actor, at, operation, operand, payload, perform }) {
	const requested = requestEffect(store, {
		operation,
		operand,
		run,
		ticket,
		phase,
		attempt,
		actor,
		fencingGeneration: hold.fence().generation,
		payload,
		at,
	});
	if (requested.state === "resolved") return requested;

	const result = await perform();

	return resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: hold.fence().generation,
		result,
		at,
	});
}

/**
 * §6.8's deny floor, in the half that is not a permission rule: **a disabled
 * `pushurl` in every attempt worktree.**
 *
 * The rule lists deny `Bash(git push*)`, and pi has no command-level permission
 * system at all — so the mechanical half is here, in the worktree's own config,
 * where it holds for every process the worker starts rather than only for the
 * ones its harness classified as a Bash tool call.
 *
 * The URL names its own reason: git answers `Unable to find remote helper for
 * 'factory-deny-floor'`, which is the sentence a worker reads. Every configured
 * remote is covered, not only `origin`, because a remote the clone gained is a
 * remote a push could name.
 */
const DISABLED_PUSH_URL = "factory-deny-floor://push-is-controller-only";

async function disablePush(clone, worktreePath) {
	const remotes = (await clone.git(["remote"], { cwd: worktreePath })).split("\n").filter((name) => name !== "");

	for (const remote of remotes) {
		// `--worktree`, so the private clone's own config keeps the real push URL:
		// §7.5's integration pushes from the clone, and a floor written there would
		// deny the controller the one push the whole pipeline exists to make.
		await clone.git(["config", "--worktree", `remote.${remote}.pushurl`, DISABLED_PUSH_URL], { cwd: worktreePath });
	}
}

/**
 * §7.3's per-worktree git config: the factory identity, and no signature — a
 * commit signed with the operator's key would be authored as the operator in
 * the strongest sense, whatever the name on it says.
 */
async function configureIdentity(clone, worktreePath) {
	for (const [key, value] of [
		["user.name", FACTORY_GIT_IDENTITY.name],
		["user.email", FACTORY_GIT_IDENTITY.email],
		["commit.gpgsign", "false"],
	]) {
		await clone.git(["config", "--worktree", key, value], { cwd: worktreePath });
	}
}

/**
 * The worktree root is derived from the store, and the clone handle must be the
 * one that store owns: a caller mixing repo A's store with repo B's clone would
 * scatter worktrees across state areas and record effects nothing can probe.
 */
function storeDirOf(store, clone) {
	if (clone.dir !== privateClonePath(store.storeDir)) {
		throw new FactoryGitError(
			"clone-unavailable",
			`${clone.dir} is not the private clone of the store at ${store.storeDir}; the two name different repositories.`,
			{ found: clone.dir, expected: privateClonePath(store.storeDir) },
		);
	}
	return store.storeDir;
}
