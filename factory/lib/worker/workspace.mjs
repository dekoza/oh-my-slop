import { effectKey } from "../effects/keys.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";
import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.4's topology: **one Herdr workspace per run, and a tab in it per attempt**
 * (#156).
 *
 * A workspace rather than a split of the controller's own pane is settled — a
 * `--foreground` start may run in a terminal that is not a Herdr pane at all,
 * and a topology that only works for a detached start fails on the operator's
 * second invocation. What that argument never established is a workspace *per
 * attempt*: the workspace list is the operator's top-level navigation, and one
 * run on one ticket filed four of them among their real projects. A workspace
 * the **run** owns satisfies the same constraint and makes watching a worker a
 * tab switch.
 *
 * **Run-scoped, not persistent.** A workspace that outlived its run would
 * accumulate tabs across runs and would need a reconciliation question of its
 * own — *is this workspace mine, or a dead run's?* This one is keyed by the run,
 * so it is opened once, adopted by every later attempt and by every controller
 * that re-enters the run, and left behind for `cleanup-plan` as a single anchor
 * rather than one per attempt (§12.8).
 *
 * **The cost is accepted rather than discovered:** an operator who closes the
 * factory workspace used to lose one attempt and now loses every live lane of
 * that run at once. Each pane's loss is still §6.6's `dead-worker` and §5.5's
 * adoption makes re-entry cheap, so it is recoverable — but it is a real
 * robustness cost traded for the navigation, and §6.4 records it.
 *
 * **It is opened by the first attempt that needs one, not by run startup.** Two
 * reasons, both about what a failure would mean. Herdr refusing this command is
 * an automation failure with a home in §8.10 — `worker-launch-failed`, budgeted
 * and counted by §8.6's breaker — while the same refusal during run startup
 * would have no §10.3 end reason to be reported as. And a run that launches no
 * worker leaves nothing behind: an empty workspace for a red preflight or an
 * empty frontier would spend the one resource this ticket exists to conserve.
 * The record is the run's either way, which is what the acceptance criterion is
 * about — it is opened once per run and never per attempt.
 */

/** §4.5's operation: the mutation is *a workspace exists for this run*. */
export const RUN_WORKSPACE_OPERATION = "workspace-open";

/**
 * The key's phase segment. §2.2's enum has no run-scoped member, and
 * `preflight` is the one every run-scoped effect already carries — the run
 * manifest and the package handshake are both keyed with it. Naming the phase
 * that happened to launch first would claim the workspace belongs to a phase it
 * outlives.
 */
export const RUN_WORKSPACE_PHASE = "preflight";

/**
 * How a run's workspace is recognised in Herdr's own list.
 *
 * Herdr carries no metadata tokens on a workspace the way `pane report-metadata`
 * does on a pane, so this label is the **only** handle a probe has on a
 * workspace whose id was never recorded — which is exactly the crash §5.3 has to
 * settle. It is derived from the run and nothing else, so the question the probe
 * asks the world is the same one every controller asks.
 */
export function runWorkspaceLabel(run) {
	return `factory-run-${run}`;
}

/** The run's own effect key, built in one place so probe and opener agree. */
export function runWorkspaceKey(run) {
	return effectKey({
		run,
		ticket: null,
		phase: RUN_WORKSPACE_PHASE,
		attempt: null,
		operation: RUN_WORKSPACE_OPERATION,
	});
}

/**
 * The run's workspace: the committed one, or one opened now (§4.5's pair).
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold — §4.5's fencing generation
 * @param {string} context.run
 * @param {object} context.herdr the Herdr control surface
 * @param {string} context.cwd where the workspace's root pane starts. The store
 *   directory: it is the run's own ground, it outlives every attempt worktree
 *   §12.7 deletes, and it is the same path on every re-entry, so the payload
 *   digest cannot make a re-entry a §4.5 conflict
 * @param {string} context.actor `controller`, or `operator:<verb>`
 * @param {number} context.at
 * @returns {Promise<Readonly<{ key: string, workspace: string, label: string, outcome: string }>>}
 * @throws {FactoryWorkerError} `worker-launch-failed`
 */
export async function openRunWorkspace(store, { hold, run, herdr, cwd, actor, at }) {
	const label = runWorkspaceLabel(run);
	const fence = hold.fence();
	const requested = requestEffect(store, {
		operation: RUN_WORKSPACE_OPERATION,
		operand: null,
		run,
		ticket: null,
		phase: RUN_WORKSPACE_PHASE,
		// The subject is the run, so the attempt slot is §4.5's absent literal. An
		// attempt here would give one workspace a row per attempt that opened a tab
		// in it, and the uniqueness the key exists for would quietly become a
		// per-attempt property with nothing failing (#146).
		attempt: null,
		actor,
		fencingGeneration: fence.generation,
		payload: { label, cwd },
		at,
	});

	if (requested.outcome === "already-resolved") {
		return Object.freeze({ key: requested.key, outcome: requested.outcome, ...requested.result });
	}

	const opened = await herdr.openWorkspace({ cwd, label });
	if (!opened.ok) {
		throw new FactoryWorkerError(
			"worker-launch-failed",
			`${opened.message} Run ${run} has no workspace to open a tab in, so no worker can be launched for it ` +
				`(§6.4). Nothing was closed (§13.B).`,
			{ run, command: opened.command, exit_code: opened.exit_code ?? null },
		);
	}

	const resolved = resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: fence.generation,
		// Exactly what `workspace list` can answer with, because reconcile settles
		// this same key from that list and the two must record one shape.
		result: { workspace: opened.workspace, label },
		at,
	});

	return Object.freeze({ key: requested.key, outcome: resolved.outcome, ...resolved.result });
}
