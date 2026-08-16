import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { IDENTITY_CHARSET } from "../domain/vocabulary.mjs";
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
	requireIdentitySegment(attempt, "attempt");

	const root = worktreesRoot(storeDir);
	const path = join(root, attempt);
	const canonical = canonicalize(path);
	if (!canonical.startsWith(canonicalize(root) + "/")) {
		throw new FactoryGitError(
			"identity-path-escape",
			`Attempt ${attempt} derives a worktree outside ${root} (§2.1); refusing ${canonical}.`,
			{ at: "attempt", found: canonical, expected: root },
		);
	}
	return path;
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
			"identity-charset",
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
			"identity-charset",
			`${field} must match ${IDENTITY_CHARSET} (§2.1); found ${JSON.stringify(value ?? null)}.`,
			{ at: field, found: value ?? null },
		);
	}
}

/**
 * The prefix assertion compares canonical spellings: a symlink planted inside
 * the worktrees root must not launder a path out of it. The path itself may not
 * exist yet — worktrees are asserted before they are created — so resolution
 * walks to the nearest existing ancestor.
 */
function canonicalize(path) {
	const absolute = resolve(path);
	let probe = absolute;
	let suffix = "";
	for (;;) {
		try {
			return join(realpathSync(probe), suffix);
		} catch {
			suffix = join(probe.slice(dirname(probe).length + 1), suffix);
			const parent = dirname(probe);
			if (parent === probe) return absolute;
			probe = parent;
		}
	}
}
