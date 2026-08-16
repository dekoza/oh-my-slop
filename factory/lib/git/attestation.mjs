import { assertFactoryRef } from "./isolation.mjs";

/**
 * §6.8's mutation attestation: **the authoritative guard on a read-only role.**
 *
 * Permissions are belt and suspenders — plan mode, withheld edit tools, a deny
 * floor, and pi's excluded `edit,write` — and §6.8 says plainly that on this host
 * worker permissions constrain behavior rather than capability. What actually
 * decides whether a reviewer stayed read-only is this: capture the worktree's
 * clean state and HEAD **before** the review, verify both unchanged **after**,
 * and call a mismatch what it is.
 *
 * The module answers with a **typed verdict and never an outcome**, exactly as
 * §7.4's harvest predicates do: `mutated: true` is a fact about a worktree, and
 * `mutation-detected` is §8.8's word for it — a different level, owned by
 * `pipeline/review.mjs`. Keeping them apart is what lets `doctor` or an incident
 * review read the same fact without importing the pipeline's vocabulary.
 */

/**
 * One worktree's state, as the guard reads it.
 *
 * Both halves are read, not one: a reviewer that committed leaves a clean
 * worktree at a different HEAD, and a reviewer that edited without committing
 * leaves the same HEAD with a dirty tree. A guard watching either alone is a
 * guard with a documented way through it.
 *
 * @param {object} clone the private clone's handle (`clone.mjs`)
 * @param {{ worktreePath: string, branch: string }} where
 * @returns {Promise<Readonly<{ head: string, clean: boolean, leftovers: ReadonlyArray<string> }>>}
 * @throws {FactoryGitError} `ref-outside-namespace`
 */
export async function captureWorktreeState(clone, { worktreePath, branch }) {
	assertFactoryRef(branch);

	const status = await clone.git(["status", "--porcelain"], { cwd: worktreePath });
	return Object.freeze({
		// The worktree's own HEAD rather than the branch ref: they are the same
		// while nothing has moved, and a reviewer that detached or reset is exactly
		// the case where they stop being.
		head: await clone.git(["rev-parse", "--verify", "HEAD"], { cwd: worktreePath }),
		clean: status === "",
		leftovers: Object.freeze(status === "" ? [] : status.split("\n")),
	});
}

/**
 * The two captures, compared (§6.8, §8.4).
 *
 * **An opening capture that is already dirty is a mutation too**, not a separate
 * "cannot attest" answer. The controller creates the worktree from a commit and
 * hands it straight to one read-only role, so the only thing that can have
 * written to it is that role — and reading a leftover as an automation problem
 * would hand back the second go §14.19 refuses, to the attempt that earned the
 * refusal. Comparing an opening capture against itself is therefore meaningful:
 * the only reason it can report is `dirty-before`.
 *
 * @param {{ before: Readonly<object>, after: Readonly<object> }} captures
 * @returns {Readonly<{ mutated: boolean, reasons: ReadonlyArray<string>,
 *   before: object, after: object }>}
 */
export function assessMutation({ before, after }) {
	const reasons = [];
	if (!before.clean) reasons.push("dirty-before");
	if (after.head !== before.head) reasons.push("head-moved");
	if (!after.clean) reasons.push("dirty-after");

	return Object.freeze({
		mutated: reasons.length > 0,
		reasons: Object.freeze(reasons),
		before: capture(before),
		after: capture(after),
	});
}

function capture({ head, clean, leftovers }) {
	return Object.freeze({ head, clean, leftovers: Object.freeze([...leftovers]) });
}
