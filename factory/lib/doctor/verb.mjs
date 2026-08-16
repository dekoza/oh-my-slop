import { resolveAgentDir } from "../state/location.mjs";
import { openRepoStoreReadOnly } from "../state/store.mjs";
import { doctorReport } from "./report.mjs";

/**
 * `factory doctor` (§10.5), from the operator's side.
 *
 * It takes the **read-only** handle and nothing else, so §14.24 is settled
 * before the diagnosis begins rather than by the diagnosis behaving itself. A
 * repository with no state is diagnosed too: the moment `doctor` matters most is
 * when the controller is dead, and a diagnostic that requires a healthy store is
 * the Babysitter failure again.
 *
 * @param {object} invocation
 * @param {string} invocation.repoRoot
 * @param {object} invocation.config the validated configuration
 * @param {object} invocation.activeRouting the routing this invocation selected
 * @param {string | null} [invocation.agentDir]
 * @param {object | null} [invocation.expect] `package.expect` from config (§11.7)
 * @param {string} [invocation.executable] the running binary (§11.7's anchor)
 * @param {Record<string, string | undefined>} [invocation.env]
 * @param {object} [invocation.probes] the §5.3 probe registry
 * @param {number} [invocation.at]
 * @returns {Promise<{ message: string, report: object }>}
 */
export async function runDoctor({
	repoRoot,
	config,
	activeRouting,
	agentDir = null,
	expect = null,
	executable,
	env,
	probes,
	at = Date.now(),
}) {
	// Resolved **once, here**, because the diagnosis reports where §4.1's state
	// root came from as well as reading from it — and a `null` handed onward as
	// "the default" is a path nothing can print and `join` refuses outright.
	const agent = agentDir === null ? await resolveAgentDir() : { path: agentDir, source: "caller" };
	const store = await openRepoStoreReadOnly({ repoRoot, agentDir: agent.path });

	try {
		const report = await doctorReport(store, {
			repoRoot,
			agentDir: agent,
			config,
			activeRouting,
			expect,
			executable,
			env,
			probes,
			at,
		});
		return { message: headline(report), report };
	} finally {
		store?.close();
	}
}

/**
 * The one sentence an operator reads first. It counts the alarms rather than
 * ranking them: §12.4's pin and §4.7's quarantine are the same class of "nothing
 * can settle this", and a ladder between them would invite ignoring the lower
 * rung.
 */
function headline(report) {
	if (report.alarms.length === 0) return "doctor found nothing to raise.";

	return `doctor raises ${report.alarms.length} ${report.alarms.length === 1 ? "alarm" : "alarms"}: ${report.alarms
		.map((alarm) => alarm.reason)
		.join(", ")}.`;
}
