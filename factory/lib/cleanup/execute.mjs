import { rmSync } from "node:fs";

import { deleteArtifactBlob } from "../artifacts/blobs.mjs";
import { paneTarget } from "../controller/herdr-control.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";
import { runGit } from "../git/clone.mjs";
import { FactoryGitError } from "../git/errors.mjs";
import { privateClonePath } from "../git/isolation.mjs";
import { FactoryCleanupError } from "./errors.mjs";
import { createPaneReclaimer } from "./panes.mjs";
import { planCleanup } from "./plan.mjs";
import { CLEANUP_KINDS, EXECUTION_ORDER, PRIVATE_CLONE_KIND } from "./targets.mjs";

/**
 * §12.8's execute half: **the plan, applied under the controller lease.**
 *
 * Three rules shape everything here, and each is one of §14's *nevers*:
 *
 * - **`cleanup-execute` never runs without the controller lease, and never on a
 *   plan whose re-derived digest differs** (§14.25). The lease is the caller's to
 *   hold; the re-derivation is this function's first act, and it refuses before
 *   anything is deleted. **Staleness is digest equality, never a clock** — a TTL
 *   either expires a still-correct plan or blesses a stale one (§10.5).
 * - **There is no `--force`** (§14.26). Not as a parameter, not as an option on
 *   the git commands: `worktree remove` is issued *without* it, so the guard the
 *   plan applied is applied a second time by git itself at the moment of
 *   deletion, and a worktree that grew work between the two refuses rather than
 *   losing it.
 * - **Every deletion is an effect with a trivial probe** (§4.5, §12.8), so a
 *   crash mid-execute needs no resume logic at all: it leaves
 *   requested-but-unresolved rows, and the next reconcile settles them by
 *   re-probing. Nothing in this file records progress of its own.
 *
 * **The records are repo-scoped, and that is not an oversight.** §12.8 puts
 * cleanup's own actions on the `controller` stream, and §4.3 refuses a record
 * carrying a run anywhere but that run's stream — so a run-slotted cleanup effect
 * could not land where the specification puts it, and would be deleted by the
 * expiry of the very run whose reclamation it documents. The identity travels in
 * the operand instead, which is also what lets a probe resolve a target whose run
 * no longer has a row.
 */

/**
 * Apply a plan.
 *
 * @param {object} store an open controller store
 * @param {object} options
 * @param {object} options.hold the controller-lease hold (`controller/lease-guard.mjs`)
 * @param {{ run: string | null, kinds: ReadonlyArray<string> }} options.scope the same scope the plan was derived under
 * @param {string} options.digest the digest the operator was handed
 * @param {object | null} [options.herdr] the Herdr control surface
 * @param {object} [options.panes] the pane reclaimer, injectable for the same reason
 * @param {Function} [options.git]
 * @param {string} [options.actor]
 * @param {number} [options.at]
 * @returns {Promise<Readonly<object>>}
 * @throws {FactoryCleanupError} `cleanup-plan-stale`
 */
export async function executeCleanup(
	store,
	{ hold, scope, digest, herdr = null, panes = createPaneReclaimer(), git = runGit, actor = "operator:cleanup-execute", at = Date.now() },
) {
	// The gate before the re-derivation, not after: a hold that has lost the
	// lease or has not reconciled must not even read the world as though it were
	// about to act on it.
	hold.assertMayIssueEffects();

	const plan = await planCleanup(store, { scope, herdr, git, at });
	if (plan.digest !== digest) {
		throw new FactoryCleanupError(
			"cleanup-plan-stale",
			`The plan has changed since it was derived: it now digests to ${plan.digest}, not ${digest}. ` +
				"Nothing was deleted. Re-run `factory cleanup-plan` and execute the digest it prints — staleness " +
				"is decided by equality and never by a clock, so a plan is either still correct or replaced (§10.5, §14.25).",
			{ expected: digest, found: plan.digest, targets: plan.targets.length },
		);
	}

	const performed = [];
	const refused = [];

	for (const target of ordered(plan.targets)) {
		const outcome = await performTarget(store, target, { hold, herdr, panes, git, actor, at });
		(outcome.ok ? performed : refused).push(outcome.entry);
	}

	return Object.freeze({
		spec: "§12.8",
		at,
		digest: plan.digest,
		scope: plan.scope,
		performed: Object.freeze(performed),
		// A target Herdr or git would not act on stays `requested`, which is
		// exactly the state the next reconcile re-probes. It is reported rather
		// than thrown, because one pane the multiplexer will not close must not
		// abandon the worktrees behind it.
		refused: Object.freeze(refused),
		skips: plan.skips,
		unanswerable: plan.unanswerable,
		held: plan.held,
		reclaimed_bytes: performed.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
	});
}

/**
 * §12.8's order, applied: worktrees before the branches checked out in them, and
 * the private clone after everything registered inside it.
 */
function ordered(targets) {
	return [...targets].sort((left, right) => EXECUTION_ORDER.indexOf(left.kind) - EXECUTION_ORDER.indexOf(right.kind));
}

/**
 * One target: request, perform, resolve (§4.5).
 *
 * The request comes first and the resolution last, with the mutation between
 * them, because that is the only order in which a crash is recoverable — a
 * resolution written first would be the journal establishing a fact about the
 * world (§14.1), and a mutation with no request would be one nothing can find
 * again.
 */
async function performTarget(store, target, { hold, herdr, panes, git, actor, at }) {
	const requested = requestEffect(store, {
		operation: target.operation,
		operand: target.operand,
		phase: "cleanup",
		actor,
		fencingGeneration: hold.fence().generation,
		// Identity only, and stable: a payload carrying a byte count would make
		// the second run of a plan a §4.5 payload conflict over the same deletion.
		payload: { kind: target.kind, subject: target.subject },
		at,
	});

	if (requested.state === "resolved") {
		return performedEntry(target, { done: false, note: "already-resolved", result: requested.result });
	}

	const done = await mutate(target, { herdr, panes, git, store, at });
	if (!done.ok) {
		return {
			ok: false,
			entry: Object.freeze({
				kind: target.kind,
				subject: target.subject,
				effect: requested.key,
				message: done.message,
				...(done.detail ?? {}),
			}),
		};
	}

	const resolved = resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: hold.fence().generation,
		result: done.result,
		at,
	});

	return performedEntry(target, { done: true, note: resolved.outcome, result: resolved.result });
}

function performedEntry(target, { done, note, result }) {
	return {
		ok: true,
		entry: Object.freeze({
			kind: target.kind,
			subject: target.subject,
			outcome: note,
			// A target the world had already lost reclaims nothing, and reporting
			// its planned bytes would tell an operator space was freed that never
			// was (§12.10 accounts, it does not flatter).
			bytes: done ? (target.bytes ?? null) : null,
			result: result ?? null,
		}),
	};
}

/**
 * The mutation itself, per kind.
 *
 * A refusal is **data** rather than an exception: `cleanup-execute` is settling a
 * list, and the effect row it leaves `requested` is what the next reconcile
 * re-probes. An exception here would abandon every target after it and lose the
 * reason for the one that failed.
 */
async function mutate(target, { herdr, panes, git, store, at }) {
	switch (target.kind) {
		case CLEANUP_KINDS.attemptWorktree:
		case CLEANUP_KINDS.baselineWorktree:
			return removeWorktree(target, { git, store });
		case CLEANUP_KINDS.attemptBranch:
			return deleteBranch(target, { git, store });
		case CLEANUP_KINDS.workerPane:
		case CLEANUP_KINDS.controllerPane:
			return closePane(target, { herdr, panes, at });
		case CLEANUP_KINDS.orphanedBlob:
			return Object.freeze({
				ok: true,
				result: { ...target.address, removed: deleteArtifactBlob(store.storeDir, target.address) },
			});
		case PRIVATE_CLONE_KIND:
			return removeClone(target);
		default:
			// Unreachable while the planner is the only source of targets, and a
			// refusal rather than a silent success if it ever stops being.
			return Object.freeze({ ok: false, message: `"${target.kind}" is not a §12.8 target kind this can perform.` });
	}
}

/**
 * §12.8's non-default target, removed as a directory rather than through git:
 * the clone is what git would be reading *from*, and there is no repository
 * command for "cease to exist".
 *
 * A clone that is already gone answers as reclaimed rather than as an error —
 * its probe is `absent` and that is what absent looks like. The removal itself
 * is **not** told to ignore anything: this module reads every deletion's outcome,
 * which is the difference between a reclamation and a silence.
 */
function removeClone(target) {
	try {
		rmSync(target.path, { recursive: true });
	} catch (error) {
		if (error?.code !== "ENOENT") {
			return Object.freeze({ ok: false, message: `${target.path} was not reclaimed: ${error.message}` });
		}
		return Object.freeze({ ok: true, result: { clone: target.path, removed: false } });
	}

	return Object.freeze({ ok: true, result: { clone: target.path, removed: true } });
}

/**
 * **`git worktree remove`, without `--force`** — the second half of §14.26.
 *
 * The plan already refused a worktree carrying uncommitted or untracked files;
 * issuing the deletion without the flag makes git apply the same guard at the
 * moment it acts, so work that arrived in the window between reviewing and
 * executing is refused rather than lost. That window is exactly why there is no
 * force flag to pass here, and why one must never be added: this call is the last
 * thing standing between an operator's `cd` and their work.
 */
async function removeWorktree(target, { git, store }) {
	try {
		await git(["worktree", "remove", target.path], { cwd: privateClonePath(store.storeDir) });
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		return gitRefusal(error, target.path);
	}

	return Object.freeze({ ok: true, result: { path: target.path, removed: true } });
}

/**
 * `git branch -D`, on a **local ref inside the factory's disposable private
 * clone**.
 *
 * `-D` rather than `-d`, and the difference is the point: an attempt branch that
 * was never integrated is unmerged by construction, so `-d` would refuse every
 * branch this kind exists to reclaim. What makes forcing it safe is not this
 * call — it is that the branch got here at all. A failed attempt's branch is
 * retained *and pinned* while its run is (§12.7), and a published one is held by
 * its open PR's pin, so the only branches that reach this line belong to runs
 * whose evidence has already been released. Reclaiming a local ref inside a
 * disposable clone is not "touching a published branch" (§12.7, §14.12).
 */
async function deleteBranch(target, { git, store }) {
	try {
		await git(["branch", "-D", target.subject], { cwd: privateClonePath(store.storeDir) });
	} catch (error) {
		if (!(error instanceof FactoryGitError)) throw error;
		return gitRefusal(error, target.subject);
	}

	return Object.freeze({ ok: true, result: { branch: target.subject, deleted: true } });
}

/**
 * §12.8's execute-time re-probe, immediately before the close.
 *
 * > At execute time each pane is **re-probed for its `FACTORY_ATTEMPT` token**
 * > and refused if that token now belongs to a non-terminal attempt.
 *
 * The sentence names two questions with two different answering systems, and
 * only one of them can have changed since the plan was re-derived.
 *
 * **Which pane** is asked of Herdr, and it is asked *again* because the
 * multiplexer is the one thing under this plan that can move while the plan is
 * being executed: between the re-derivation and this call lies every earlier
 * target's deletion. The question is put as *which panes carry this token*
 * rather than *is pane `w1:p1` still ours*, so a recycled pane id is not
 * something this code can reach — a pane the factory did not stamp is not in the
 * answer. That is §14.27 as a property of the call rather than as a check inside
 * it, and it is the form the guard has to take, because a pane id read back from
 * the plan is exactly the handle Herdr is entitled to reuse.
 *
 * **Whether the attempt is terminal** is asked of the journal, and it is *not*
 * re-asked: it cannot have changed. `cleanup-execute` holds the controller lease,
 * so nothing is writing run state while this runs, and an attempt ends exactly
 * once — §6.6's projector refuses a second `attempt.ended`. The re-derivation a
 * moment ago is therefore the same answer this call would get, and a second
 * evaluation of it would be unreachable code that looked like a guard. What makes
 * the terminality check real is that the plan **is** re-derived here, under the
 * lease, rather than trusted from the operator's line.
 *
 * A pane the plan named and nothing now carries is **gone**, not refused:
 * `pane-delete`'s probe is `absent`, so the mutation has already happened.
 * Resolving it is the honest record, and it is what stops a vanished pane from
 * pinning its run forever.
 */
async function closePane(target, { herdr, panes, at }) {
	if (herdr === null) {
		return Object.freeze({
			ok: false,
			message: "Herdr did not answer, so no pane was closed: an unanswered multiplexer is not an absent one (§5.2).",
		});
	}

	const subject = paneTarget(target.operand);
	const listed = await herdr.panesTokened({ token: subject.token, value: subject.id });
	if (!listed.ok) return Object.freeze({ ok: false, message: listed.message });

	if (listed.panes.length === 0) {
		return Object.freeze({ ok: true, result: { pane: target.pane, present: false, closed: false, at } });
	}

	const closed = [];
	for (const pane of listed.panes) {
		const answer = await panes.close(pane.pane_id);
		if (!answer.ok) return Object.freeze({ ok: false, message: answer.message, detail: { pane: pane.pane_id } });
		closed.push(pane.pane_id);
	}

	return Object.freeze({ ok: true, result: { panes: closed, closed: closed.length, token: subject.token } });
}

function gitRefusal(error, subject) {
	return Object.freeze({
		ok: false,
		message: `${subject} was not reclaimed: ${error.message}`,
		detail: { reason: error.reason },
	});
}
