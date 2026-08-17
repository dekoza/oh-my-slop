import { effectKey } from "../effects/keys.mjs";
import { requestEffect, resolveEffect } from "../effects/records.mjs";

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
 * so it is opened once and adopted by every later attempt and by every
 * controller that re-enters the run. It is left behind when the run ends, which
 * gives §12.8's cleanup **one durable anchor per run to plan from** — this
 * effect row — instead of one per attempt. Reclaiming it is #118's to define:
 * there is no `workspace-delete` kind here, because nothing in this package
 * deletes one.
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

/**
 * §4.5's identity slots for this effect, named once.
 *
 * The subject is the **run**, so ticket and attempt are both the absent literal.
 * An attempt here would give one workspace a row per attempt that opened a tab
 * in it, and the uniqueness the key exists for would quietly become a
 * per-attempt property with nothing failing (#146).
 */
function runWorkspaceSlots(run) {
	return {
		operation: RUN_WORKSPACE_OPERATION,
		operand: null,
		run,
		ticket: null,
		phase: RUN_WORKSPACE_PHASE,
		attempt: null,
	};
}

/** The run's own effect key — the same slots the request is made under. */
export function runWorkspaceKey(run) {
	return effectKey(runWorkspaceSlots(run));
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
 * @returns {Promise<Readonly<{ ok: true, key: string, workspace: string, label: string, outcome: string }
 *   | { ok: false, command: string, message: string }>>} the workspace, or the
 *   Herdr refusal exactly as the control surface reported it — the caller turns
 *   that into its own typed failure
 */
export async function openRunWorkspace(store, { hold, run, herdr, cwd, actor, at }) {
	const label = runWorkspaceLabel(run);
	const fence = hold.fence();
	const requested = requestEffect(store, {
		...runWorkspaceSlots(run),
		actor,
		fencingGeneration: fence.generation,
		payload: { label, cwd },
		at,
	});

	if (requested.outcome === "already-resolved") {
		return Object.freeze({ ok: true, key: requested.key, outcome: requested.outcome, ...requested.result });
	}

	// A row already standing as `requested` is an intent whose outcome nobody
	// recorded: the process died between the two writes, or Herdr did the work
	// and answered unreadably. Startup reconcile settles that — but it runs once
	// per invocation, and this row can appear *during* a run, where the next
	// attempt would otherwise mint a second workspace under an identical label
	// and make the label ambiguous for every probe afterwards. So the same
	// question the probe asks is asked here, and its answer is the resolution.
	const opened =
		requested.outcome === "already-requested"
			? await theOneAlreadyAskedFor(herdr, { cwd, label })
			: await herdr.openWorkspace({ cwd, label });
	// **The refusal is handed back, not thrown.** The caller is a launch, and a
	// launch has exactly one way of saying "the worker never ran" — carrying the
	// attempt tuple its record is written under. Throwing a second, thinner one
	// from here is how a workspace refusal ends up the only launch failure whose
	// attempt record names no attempt.
	if (!opened.ok) return opened;

	const resolved = resolveEffect(store, {
		key: requested.key,
		actor,
		fencingGeneration: fence.generation,
		// Exactly what `workspace list` can answer with, because reconcile settles
		// this same key from that list and the two must record one shape.
		result: { workspace: opened.workspace, label },
		at,
	});

	return Object.freeze({ ok: true, key: requested.key, outcome: resolved.outcome, ...resolved.result });
}

/**
 * The workspace an unresolved request may already have created, or a new one.
 *
 * **A multiplexer that will not answer refuses rather than creating** (§12.4):
 * "unanswerable" is not "absent", and creating on an unanswerable read is
 * exactly how one run ends up with two workspaces wearing one label — the
 * ambiguity every later probe would then have to resolve and could not.
 */
async function theOneAlreadyAskedFor(herdr, { cwd, label }) {
	const listed = await herdr.workspaceLabelled(label);
	if (!listed.ok) return listed;
	if (listed.workspace !== null) return Object.freeze({ ok: true, workspace: listed.workspace.workspace_id, label });

	return herdr.openWorkspace({ cwd, label });
}
