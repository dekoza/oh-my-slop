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
 * It carries the verb's own two sections and no more. §9.7 is what brought it
 * into existence, and the slices that own the rest — the classified drain report
 * (#102), a ticket execution's outcome chain (#108), bytes per retention class
 * (#117) — each add their section when they land, the way every other report in
 * this package grew.
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
		runs: Object.freeze(runs.map(runReport)),
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

function runReport(run) {
	return Object.freeze({
		run: run.run_id,
		lifecycle: run.lifecycle,
		end_reason: run.end_reason,
		scope: run.scope,
		started_at: run.started_at,
		ended_at: run.ended_at,
	});
}

