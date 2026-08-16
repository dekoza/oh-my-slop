import { join } from "node:path";

import { IDENTITY_CHARSET } from "../domain/vocabulary.mjs";
import { containPath, PATH_REFUSALS } from "../identity/paths.mjs";
import { FactoryGitError } from "./errors.mjs";

/**
 * §7.1's topology, as names: where the factory-private bare clone and the
 * per-attempt worktrees live inside the controller-owned state area, and what
 * the refs the factory writes may be called.
 *
 * Everything here is **derived deterministically from the minted identity
 * tuple** (§7.3), which is what makes collisions impossible, force-push
 * unnecessary, and a probe able to re-find an attempt's worktree from its
 * effect key alone — the effect row carries no payload, so the path has to be
 * recomputable.
 */

/** The clone and the worktrees are peers of `state.db`, per repository (§4.1, §7.1). */
const CLONE_SEGMENT = "clone.git";
const WORKTREES_SEGMENT = "worktrees";

/**
 * §8.3's baseline and `doctor --baseline` run in a **throwaway** worktree, and
 * it hangs off its own root rather than sharing the attempt worktrees'.
 *
 * The two have opposite lifetimes and §12.8 lists them as two of its six target
 * kinds: a failed attempt's worktree is **the only copy of that work** and is
 * pinned (§12.7), while a baseline worktree holds a checkout of an
 * already-published commit and whatever the suite left beside it. Telling them
 * apart by path is what keeps a cleanup plan from having to ask which is which.
 */
const BASELINES_SEGMENT = "baselines";

/**
 * §7.5's **controller-owned integration worktree**, which hangs off a root of
 * its own for the same reason the baselines do: its lifetime is not an attempt
 * worktree's.
 *
 * An attempt worktree is the worker's and, when an attempt fails, **the only
 * copy of that work** (§7.7). This one is a detached checkout of commits that
 * already exist on a branch, plus whatever the required set left beside them —
 * derived, disposable state, replaceable at any moment (§7.1). Telling them
 * apart by path is what keeps that difference from having to be re-derived by
 * whoever reclaims one.
 */
const INTEGRATION_SEGMENT = "integration";

/**
 * §7.3: the `factory/` branch namespace and `refs/factory/*` belong to the
 * factory alone; it never writes any ref outside them (§14.11).
 */
export const FACTORY_BRANCH_PREFIX = "factory/";
export const FACTORY_REF_PREFIX = "refs/factory/";

/** Where the factory-private bare clone of one repository lives (§7.1). */
export function privateClonePath(storeDir) {
	return join(storeDir, CLONE_SEGMENT);
}

/** The directory every attempt worktree of one repository hangs under (§7.1). */
export function worktreesRoot(storeDir) {
	return join(storeDir, WORKTREES_SEGMENT);
}

/** The directory every throwaway baseline worktree hangs under (§10.5, §12.7). */
export function baselinesRoot(storeDir) {
	return join(storeDir, BASELINES_SEGMENT);
}

/** The directory every controller-owned integration worktree hangs under (§7.5). */
export function integrationsRoot(storeDir) {
	return join(storeDir, INTEGRATION_SEGMENT);
}

/**
 * One attempt's integration worktree, contained exactly as its attempt worktree
 * is — the containment belongs to every derived path, not to the first one that
 * asked for it.
 *
 * Keyed by the attempt rather than by "the integration", though §7.7's lease
 * means only one exists at a time: a path an operator finds on disk says whose
 * publication it belongs to, and §14.23's "two attempts never share a worktree"
 * stays true of this kind by construction rather than by the lease alone.
 *
 * @param {string} storeDir the repository's store directory
 * @param {string} attempt the attempt being integrated
 * @returns {string}
 * @throws {FactoryGitError} `identity-charset` · `identity-path-escape`
 */
export function integrationWorktreePath(storeDir, attempt) {
	return containedPath(integrationsRoot(storeDir), attempt, "attempt");
}

/**
 * §7.5's evidence ref: where an attempt's **pre-rebase head** is preserved
 * before the rebase rewrites it.
 *
 * "Evidence survives by contract, not by reflog" is what this name buys. A
 * reflog entry is per-worktree, expires on a schedule nobody set deliberately,
 * and is gone the moment the worktree is reclaimed; a ref under the factory's
 * own namespace is an object nothing collects and every probe can read.
 *
 * @param {string} attempt
 * @returns {string} a full ref under `refs/factory/`
 */
export function evidenceRef(attempt) {
	requireIdentitySegment(attempt, "attempt");
	return assertFactoryRef(`${FACTORY_REF_PREFIX}evidence/${attempt}`);
}

/**
 * One attempt's worktree path, contained twice over (§2.1): the attempt id is
 * charset-validated, **and** the joined path is canonicalized and asserted to
 * sit under the worktrees root — both, not either.
 *
 * @param {string} storeDir the repository's store directory (`store.storeDir`)
 * @param {string} attempt the attempt id, `<run>-t<ticket>-a<n>`
 * @returns {string}
 * @throws {FactoryGitError} `identity-charset` · `identity-path-escape`
 */
export function attemptWorktreePath(storeDir, attempt) {
	return containedPath(worktreesRoot(storeDir), attempt, "attempt");
}

/**
 * One baseline run's throwaway worktree path, contained exactly as an attempt's
 * is — the containment is a property of every derived path, not a courtesy this
 * one is granted because a baseline id happens to be minted here.
 *
 * @param {string} storeDir the repository's store directory
 * @param {string} baseline the baseline run's id
 * @returns {string}
 * @throws {FactoryGitError} `identity-charset` · `identity-path-escape`
 */
export function baselineWorktreePath(storeDir, baseline) {
	return containedPath(baselinesRoot(storeDir), baseline, "baseline");
}

/**
 * §2.1's containment, twice over — charset validation **and**
 * canonicalize-and-assert-prefix — from the one predicate both subsystems that
 * derive a path from an identity share (`identity/paths.mjs`). The verdict
 * arrives as data and becomes this subsystem's own typed refusal here.
 */
function containedPath(root, segment, field) {
	const contained = containPath(root, segment);
	if (contained.ok) return contained.path;

	if (contained.reason === PATH_REFUSALS.charset) requireIdentitySegment(segment, field);

	throw new FactoryGitError(
		PATH_REFUSALS.escape,
		`${field} ${segment} derives a worktree outside ${root} (§2.1); refusing ${contained.found}.`,
		{ at: field, found: contained.found, expected: root },
	);
}

/**
 * §7.3's one branch per attempt: `factory/t<ticket>/a<attempt_id>`, globally
 * unique because the attempt id already is (§2.1) — run 2's attempt 1 on the
 * same ticket names a different branch than run 1's ever did.
 *
 * The tuple consistency check is not decoration: the ticket is readable
 * straight off the branch during an incident, so a branch minted from a
 * mismatched pair would lie to the person reading it.
 *
 * @param {{ ticket: number, attempt: string }} identity
 * @returns {string}
 * @throws {FactoryGitError} `identity-charset` · `identity-mismatch`
 */
export function attemptBranch({ ticket, attempt }) {
	if (!Number.isSafeInteger(ticket) || ticket <= 0) {
		throw new FactoryGitError(
			"identity-mismatch",
			`Ticket must be a positive issue number; found ${JSON.stringify(ticket ?? null)}.`,
			{ at: "ticket", found: ticket ?? null },
		);
	}
	requireIdentitySegment(attempt, "attempt");
	if (!new RegExp(`-t${ticket}-a\\d+$`).test(attempt)) {
		throw new FactoryGitError(
			"identity-mismatch",
			`Attempt id ${attempt} does not name ticket ${ticket} (§2.1); the tuple must be readable off the branch.`,
			{ at: "attempt", found: attempt, expected: `*-t${ticket}-a<n>` },
		);
	}
	return `${FACTORY_BRANCH_PREFIX}t${ticket}/a${attempt}`;
}

/** §7.2's pin lands here: where one base branch's fetched tip is kept (§14.11). */
export function baseRef(baseBranch) {
	return assertFactoryRef(`${FACTORY_REF_PREFIX}base/${baseBranch}`);
}

/**
 * §14.11's gate, in code every ref-writing call goes through: the factory
 * writes no ref outside `factory/` and `refs/factory/*`. A full ref is allowed
 * under `refs/factory/`; a branch name is allowed under `factory/`.
 *
 * @param {string} ref a full ref (`refs/...`) or a branch name
 * @returns {string} the same ref, proven writable
 * @throws {FactoryGitError} `ref-outside-namespace`
 */
export function assertFactoryRef(ref) {
	const branchOwned = !ref.startsWith("refs/") && ref.startsWith(FACTORY_BRANCH_PREFIX);
	const refOwned = ref.startsWith(FACTORY_REF_PREFIX) || ref.startsWith(`refs/heads/${FACTORY_BRANCH_PREFIX}`);
	if (branchOwned || refOwned) return ref;

	throw new FactoryGitError(
		"ref-outside-namespace",
		`The factory writes no ref outside factory/ and refs/factory/* (§14.11); refusing ${JSON.stringify(ref)}.`,
		{ at: "ref", found: ref, expected: `${FACTORY_BRANCH_PREFIX}* | ${FACTORY_REF_PREFIX}*` },
	);
}

function requireIdentitySegment(value, field) {
	if (typeof value !== "string" || !IDENTITY_CHARSET.test(value)) {
		throw new FactoryGitError(
			PATH_REFUSALS.charset,
			`${field} must match ${IDENTITY_CHARSET} (§2.1); found ${JSON.stringify(value ?? null)}.`,
			{ at: field, found: value ?? null },
		);
	}
}
