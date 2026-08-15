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
	agentDir = null,
	expect = null,
	executable,
	env,
	probes,
	at = Date.now(),
}) {
	const store = await openRepoStoreReadOnly({ repoRoot, agentDir });

	try {
		const report = await doctorReport(store, { repoRoot, agentDir, expect, executable, env, probes, at });
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
