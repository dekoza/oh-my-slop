import { artifactOperand } from "../artifacts/blobs.mjs";
import { paneOperand, PANE_OPERAND_KINDS } from "../controller/herdr-control.mjs";
import { worktreeOperand, WORKTREE_OPERAND_KINDS } from "../git/isolation.mjs";
import { FactoryCleanupError } from "./errors.mjs";

/**
 * §12.8's whitelist, named once.
 *
 * > **Whitelist — six target kinds:** attempt worktrees under the
 * > factory-private clone; local `factory/t<ticket>/a<attempt>` branches; worker Herdr panes;
 * > the controller's own pane from a finished run; `doctor --baseline`
 * > throwaway worktrees; and orphaned artifact blobs.
 *
 * A **whitelist**, not a filter over everything reachable: what is not named
 * here is not a target, and there is no branch anywhere in this subsystem that
 * decides otherwise. Live attempts, the published branch of an open PR, any ref
 * outside `factory/` and `refs/factory/*`, and the operator's own repositories
 * are not excluded by a check — they have no entry.
 *
 * The kinds are **not** the effect kinds. §4.5's catalogue keys deletions by the
 * *class of thing deleted*, because that is the granularity at which the probe
 * differs — a worktree is a path, a branch is a ref, a pane is a pane — so six
 * plan kinds map onto four operations, and the mapping lives here.
 */
export const CLEANUP_KINDS = Object.freeze({
	attemptWorktree: "attempt-worktree",
	attemptBranch: "attempt-branch",
	workerPane: "worker-pane",
	controllerPane: "controller-pane",
	baselineWorktree: "baseline-worktree",
	orphanedBlob: "orphaned-blob",
});

/**
 * §12.8's non-default target, and the whole of why it is not one of the six:
 *
 * > **The factory-private bare clone itself is not a default target** — a
 * > separate explicit invocation, because re-cloning is expensive and its
 * > deletion is never routine.
 *
 * It is reachable only by naming it in `--kind`, which is what makes the
 * invocation separate: no default plan contains it, and no plan that contains it
 * contains anything else.
 */
export const PRIVATE_CLONE_KIND = "private-clone";

/** The six, in the order §12.8 lists them — which is the order a plan renders. */
export const DEFAULT_CLEANUP_KINDS = Object.freeze([
	CLEANUP_KINDS.attemptWorktree,
	CLEANUP_KINDS.attemptBranch,
	CLEANUP_KINDS.workerPane,
	CLEANUP_KINDS.controllerPane,
	CLEANUP_KINDS.baselineWorktree,
	CLEANUP_KINDS.orphanedBlob,
]);

/** Every kind an operator may name, the non-default one included. */
export const CLEANUP_KIND_NAMES = Object.freeze([...DEFAULT_CLEANUP_KINDS, PRIVATE_CLONE_KIND]);

/**
 * The §4.5 operation each kind is performed as. Two kinds share
 * `worktree-delete` and two share `pane-delete`, which is the catalogue's own
 * decision restated in code rather than a second opinion about it.
 */
export const OPERATION_BY_KIND = Object.freeze({
	[CLEANUP_KINDS.attemptWorktree]: "worktree-delete",
	[CLEANUP_KINDS.baselineWorktree]: "worktree-delete",
	[CLEANUP_KINDS.attemptBranch]: "branch-delete",
	[CLEANUP_KINDS.workerPane]: "pane-delete",
	[CLEANUP_KINDS.controllerPane]: "pane-delete",
	[CLEANUP_KINDS.orphanedBlob]: "artifact-delete",
	[PRIVATE_CLONE_KIND]: "clone-delete",
});

/**
 * The order `cleanup-execute` performs them in, and it is **load-bearing rather
 * than tidy**.
 *
 * A branch checked out in a worktree cannot be deleted — git refuses, and the
 * refusal would arrive as an automation failure over a target that was never
 * wrong, only early. Worktrees therefore go first, and the private clone last,
 * because deleting it takes every worktree registered in it with it and would
 * leave the plan's other entries unprobeable.
 */
export const EXECUTION_ORDER = Object.freeze([
	CLEANUP_KINDS.attemptWorktree,
	CLEANUP_KINDS.baselineWorktree,
	CLEANUP_KINDS.attemptBranch,
	CLEANUP_KINDS.workerPane,
	CLEANUP_KINDS.controllerPane,
	CLEANUP_KINDS.orphanedBlob,
	PRIVATE_CLONE_KIND,
]);

/**
 * Why a whitelisted thing is in the plan but **not** a target.
 *
 * A skip is not an omission: §12.8 wants the operator to see it "rather than
 * wondering why bytes did not drop", and the whole eligible set — skips included
 * — is what a default plan covers.
 */
export const CLEANUP_SKIPS = Object.freeze({
	/** §14.26's guard: the worktree holds work nothing else has a copy of. */
	uncommittedWork: "retained-uncommitted-work",
	/** §12.4's pins, which cleanup obeys exactly as expiry does. */
	pinned: "pinned",
	/** §12.6's "never mid-run", read of the run rather than of the invocation. */
	liveRun: "live-run",
	/** An attempt with no recorded outcome: §12.8 derives from terminality alone. */
	liveAttempt: "live-attempt",
	/** A branch whose worktree is retained; git would refuse the deletion anyway. */
	worktreeRetained: "worktree-retained",
	/** The clone still has worktrees registered in it, or a run still needs it. */
	cloneInUse: "clone-in-use",
});

/**
 * The **operand** each kind names its subject by (§4.5).
 *
 * Cleanup's effects are repo-scoped — §12.8 lands their records on the
 * `controller` stream, and §4.3 refuses a run-slotted record anywhere but that
 * run's own stream — so every identity a probe needs has to travel in the
 * operand. Each grammar is built by the module that owns the subject, so a probe
 * resolves a target through the very code that created it.
 *
 * @param {{ kind: string, attempt?: string | null, run?: string | null,
 *           baseline?: string | null, branch?: string | null, address?: object | null }} target
 * @returns {string | null}
 */
export function cleanupOperand(target) {
	switch (target.kind) {
		case CLEANUP_KINDS.attemptWorktree:
			return worktreeOperand({ kind: WORKTREE_OPERAND_KINDS.attempt, id: target.attempt });
		case CLEANUP_KINDS.baselineWorktree:
			return worktreeOperand({ kind: WORKTREE_OPERAND_KINDS.baseline, id: target.baseline });
		case CLEANUP_KINDS.attemptBranch:
			return target.branch;
		case CLEANUP_KINDS.workerPane:
			return paneOperand({ kind: PANE_OPERAND_KINDS.attempt, id: target.attempt });
		case CLEANUP_KINDS.controllerPane:
			return paneOperand({ kind: PANE_OPERAND_KINDS.run, id: target.run });
		case CLEANUP_KINDS.orphanedBlob:
			return artifactOperand(target.address);
		case PRIVATE_CLONE_KIND:
			// The clone is the repository's one private clone: there is nothing to
			// discriminate between, and an operand repeating a path the probe already
			// derives from the store would be noise in a key an operator reads (§4.5).
			return null;
		default:
			throw unknownKind(target.kind);
	}
}

/**
 * The kinds an invocation covers, given what the operator asked for.
 *
 * `--kind` narrows; naming none is §12.8's default, and **the default being
 * everything matters**: an operator reclaiming space should see the full picture
 * including the skips. The private clone is the one kind a default never
 * contains, so asking for it is asking for a plan of exactly that.
 *
 * @param {string | null} requested a single `--kind` value, or null
 * @returns {ReadonlyArray<string>}
 * @throws {FactoryCleanupError} `cleanup-kind-unknown`
 */
export function kindsFor(requested) {
	if (requested === null || requested === undefined) return DEFAULT_CLEANUP_KINDS;

	if (!CLEANUP_KIND_NAMES.includes(requested)) {
		throw unknownKind(requested);
	}

	return Object.freeze([requested]);
}

function unknownKind(kind) {
	return new FactoryCleanupError(
		"cleanup-kind-unknown",
		`"${kind}" is not one of §12.8's target kinds; the whitelist is ${CLEANUP_KIND_NAMES.join(", ")}.`,
		{ at: "kind", found: kind ?? null, expected: CLEANUP_KIND_NAMES.join("|") },
	);
}
