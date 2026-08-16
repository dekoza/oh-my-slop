import { capacityFor } from "../capacity/report.mjs";

/**
 * `factory status` (§10.2): **the current and recent runs**, and §9.7's
 * saturation numbers beside them.
 *
 * It is a **lock-free read** — §10.5 points an operator here precisely because
 * it works against a live run, where `reconcile` refuses. Like `doctor`, it
 * answers from a read-only handle, so "status never mutates" is a property of
 * the handle rather than a rule this file follows.
 *
 * It carries the verb's own sections and no more. §9.7 is what brought it into
 * existence, #108 added §8.10's outcome chains under the runs that hold them,
 * and the slices that own the rest — the classified drain report (#102), bytes
 * per retention class (#117) — each add their section when they land, the way
 * every other report in this package grew.
 */

/** How many runs "recent" means. Enough to see the last few, not a log viewer. */
const RECENT_RUNS = 10;

/**
 * @param {object | null} store a read-only store handle, or null when this
 *   repository has no factory state yet
 * @param {object} context
 * @param {object} context.config the validated configuration
 * @param {object} context.activeRouting the routing this invocation selected
 * @param {{ path: string, source: string }} context.agentDir §4.1's state root
 * @param {number} [context.at]
 * @returns {Readonly<object>} the one structured value both renderings come from
 */
export function statusReport(store, { config, activeRouting, agentDir, at = Date.now() }) {
	const runs = store === null ? [] : store.readRecentRuns({ limit: RECENT_RUNS });

	return Object.freeze({
		schema_version: 1,
		at,
		store: storeSection(store, agentDir),
		runs: Object.freeze(runs.map((run) => runReport(store, run))),
		// §9.7's numbers, from the same derivation the running controller reports,
		// so a `status` in another terminal and the run's own report cannot
		// disagree about how saturated the pools are. The run whose lanes are
		// counted is picked the way `doctor` picks it — the oldest unended run —
		// because two spellings of "the live run" is two answers to "who is
		// waiting" (§5.4's re-entry order, §14.37).
		capacity: capacityFor(store, { config, activeRouting, run: liveRun(store), at }),
	});
}

/** §5.4's and §10.4's own order: unended runs, oldest first. */
function liveRun(store) {
	return store?.readUnendedRuns()[0]?.run_id ?? null;
}

function storeSection(store, agentDir) {
	if (store === null) {
		return Object.freeze({
			present: false,
			agent_dir: agentDir,
			message: "This repository has no factory state yet; nothing has run here (§4.1).",
		});
	}

	return Object.freeze({ present: true, agent_dir: agentDir, path: store.dbPath, head: store.head() });
}

function runReport(store, run) {
	return Object.freeze({
		run: run.run_id,
		lifecycle: run.lifecycle,
		end_reason: run.end_reason,
		scope: run.scope,
		started_at: run.started_at,
		ended_at: run.ended_at,
		executions: executionsFor(store, run.run_id),
	});
}

/**
 * §8.10's outcome chain, under the run that holds it.
 *
 * It sits here rather than in a section of its own because a ticket execution is
 * `(run, ticket)` (§2.1) and a flat list of them would have to carry the run on
 * every row to stay readable — the same fact, printed twice, and one of the two
 * eventually disagreeing.
 *
 * **The chain is never summarised to its last element.** A ticket that failed
 * verify twice and one that was rejected once both sit at the same disposition,
 * and they need different things from the operator; the shape is what tells them
 * apart, which is why it is read from the tier-2 digest that keeps it (§12.3).
 */
function executionsFor(store, runId) {
	const chains = store.readRunDigest(runId)?.outcome_chains ?? {};

	return Object.freeze(
		store.readTicketExecutions(runId).map((execution) =>
			Object.freeze({
				ticket: execution.ticket,
				phase: execution.phase,
				disposition: execution.disposition,
				attempts: execution.attempt_count,
				chain: Object.freeze(
					(chains[String(execution.ticket)] ?? []).map((step) =>
						Object.freeze({ phase: step.phase, outcome: step.outcome }),
					),
				),
			}),
		),
	);
}

