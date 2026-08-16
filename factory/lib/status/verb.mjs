import { resolveAgentDir } from "../state/location.mjs";
import { openRepoStoreReadOnly } from "../state/store.mjs";
import { statusReport } from "./report.mjs";

/**
 * `factory status` (§10.2), from the operator's side.
 *
 * It takes the **read-only** handle, like `doctor`: §10.5 sends an operator here
 * against a live run precisely because it takes no lease and writes nothing. A
 * repository with no state answers too — "nothing has run here" is a fact rather
 * than a store to bring into existence.
 *
 * @param {object} invocation
 * @param {string} invocation.repoRoot
 * @param {object} invocation.config the validated configuration
 * @param {object} invocation.activeRouting the routing this invocation selected
 * @param {string | null} [invocation.agentDir]
 * @param {number} [invocation.at]
 * @returns {Promise<{ message: string, report: object }>}
 */
export async function runStatus({ repoRoot, config, activeRouting, agentDir = null, at = Date.now() }) {
	const agent = agentDir === null ? await resolveAgentDir() : { path: agentDir, source: "caller" };
	const store = await openRepoStoreReadOnly({ repoRoot, agentDir: agent.path });

	try {
		const report = statusReport(store, { config, activeRouting, agentDir: agent, at });
		return { message: headline(report), report };
	} finally {
		store?.close();
	}
}

/**
 * The one sentence an operator reads first, and §9.7's answer to "why is this
 * slow" in it: a run with every lane queued behind one slot reads differently
 * from a run with every lane working.
 */
function headline(report) {
	const live = report.runs.filter((run) => run.lifecycle !== "ended");
	// Both numbers come from the snapshot rather than being added up here: a
	// working lane holds a ticket row *and* a model row, so a caller summing the
	// pools would print one lane as two.
	const { lanes } = report.capacity;
	const capacity =
		`capacity ${report.capacity.effective_concurrency} effective of ${report.capacity.declared_ceiling} declared` +
		`, ${lanes.running} running, ${lanes.waiting} waiting`;

	if (report.runs.length === 0) return `no runs recorded in this repository; ${capacity}.`;

	if (live.length === 0) {
		const [latest] = report.runs;
		return `no run is live; the last one, ${latest.run}, ended ${latest.end_reason}. ${capacity}.`;
	}

	return `${live.length} live ${live.length === 1 ? "run" : "runs"}: ${live
		.map((run) => `${run.run} (${run.lifecycle})`)
		.join(", ")}. ${capacity}.`;
}
