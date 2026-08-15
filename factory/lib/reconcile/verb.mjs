import { processIdentity } from "../identity/process.mjs";
import { FactoryStateError } from "../state/errors.mjs";
import { LEASE_NAMES, openLeases } from "../state/leases.mjs";
import { openStore } from "../state/store.mjs";
import { reconcile } from "./engine.mjs";

/**
 * `factory reconcile` (§5.4, §10.5), from the operator's side.
 *
 * The operator's reconcile settles effects, so it **takes the controller
 * lease** — and that is exactly why it refuses against a live holder rather than
 * queueing or reading around it: reconciling from outside the lease would race
 * the run it is describing, and every conclusion it drew would be about a world
 * that was moving underneath it. `status` and `doctor` are the lock-free reads
 * that do work against a live run, and the refusal says so.
 *
 * The lease is released in a `finally`, because a reconcile that crashed while
 * holding it would leave the repository excluded from its own controller until
 * the TTL lapsed.
 *
 * @param {object} invocation
 * @param {string} invocation.repoRoot
 * @param {string | null} [invocation.agentDir]
 * @param {object} [invocation.probes] the §5.3 probe registry
 * @param {number} [invocation.at]
 * @returns {Promise<{ message: string, report: object } | { error: object }>}
 */
export async function runReconcile({ repoRoot, agentDir = null, probes, at = Date.now() }) {
	const store = await openStore({ repoRoot, agentDir });

	try {
		const leases = openLeases(store);
		let held;

		try {
			held = leases.acquire({ name: LEASE_NAMES.controller, identity: processIdentity({ run: null, pane: null }) });
		} catch (error) {
			if (!(error instanceof FactoryStateError) || error.reason !== "lease-held") throw error;
			return { error: refusal(error) };
		}

		try {
			const report = await reconcile(store, {
				probes,
				fencingGeneration: held.fencingGeneration,
				actor: "operator:reconcile",
				at,
			});
			return { message: headline(report), report };
		} finally {
			leases.release(held);
		}
	} finally {
		store.close();
	}
}

/**
 * §10.5's refusal: it **names the holding run and pane**, and points at the two
 * verbs that answer without a lock. "The lease is taken" on its own leaves the
 * operator with nothing to look at and nothing to do next.
 */
function refusal(error) {
	const run = error.details.run ?? null;
	const pane = error.details.pane ?? null;

	return {
		kind: "lease-held",
		message:
			`Run ${run ?? "(unnamed)"} holds the controller lease in pane ${pane ?? "(unknown)"}, so reconcile ` +
			"cannot take it — reconciling from outside the lease would race the run it describes. " +
			"`factory status` and `factory doctor` are lock-free reads and work against a live run (§10.5).",
		...error.details,
	};
}

function headline(report) {
	const unsettled = report.unsettled.length;
	const settled = `settled ${report.settled} effect${report.settled === 1 ? "" : "s"}`;
	const concluded = `concluded about ${report.entities.length} ${report.entities.length === 1 ? "entity" : "entities"}`;

	return unsettled === 0
		? `reconcile ${settled}, ${concluded}.`
		: `reconcile ${settled}, ${concluded}; ${unsettled} could not be settled by any probe in this package.`;
}
