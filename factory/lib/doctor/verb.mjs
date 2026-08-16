import { EXIT_REFUSED, EXIT_USAGE } from "../cli/exit-codes.mjs";
import { FactoryRunError, isUsageRefusal } from "../controller/errors.mjs";
import { PARENT_FLAG, parseScope } from "../controller/scope.mjs";
import { resolveAgentDir } from "../state/location.mjs";
import { openRepoStoreReadOnly } from "../state/store.mjs";
import { createGiteaReader } from "../tracker/gitea.mjs";
import { doctorReport } from "./report.mjs";

/**
 * §10.5's flag that turns the reported baseline into an executed one. It lives
 * here rather than in the verb table because the table declares what the CLI
 * accepts and this module is what acts on it.
 */
export const BASELINE_FLAG = "--baseline";

/**
 * `factory doctor` (§10.5), from the operator's side.
 *
 * It takes the **read-only** handle and nothing else, so §14.24 is settled
 * before the diagnosis begins rather than by the diagnosis behaving itself. A
 * repository with no state is diagnosed too: the moment `doctor` matters most is
 * when the controller is dead, and a diagnostic that requires a healthy store is
 * the Babysitter failure again.
 *
 * A scope may be named, in §3.1's two forms and no third — the same `parseScope`
 * `start` uses, so `doctor #42` and `start #42` can never disagree about what
 * was asked for. What comes back is the classified member list, read live and
 * claiming nothing.
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
 * @param {string[]} [invocation.args] §3.1's scope, if one was named
 * @param {Set<string>} [invocation.flags]
 * @param {object | null} [invocation.tracker] the §5.1 read client, injectable so
 *   a suite drives real answer shapes without a Gitea
 * @param {number} [invocation.at]
 * @returns {Promise<{ message: string, report: object } | { error: object, exitCode: number }>}
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
	args = [],
	flags = new Set(),
	tracker = null,
	at = Date.now(),
}) {
	// A scope that will not parse is a refusal about the arguments, before any
	// store is opened: an operator who mistyped a ticket number should read that
	// rather than a clean bill of health for a scope they did not ask about.
	//
	// Classified by `isUsageRefusal` rather than by a code chosen here, so
	// `doctor 4x` and `start 4x` exit the same way — §10.3 reserves `1` for the
	// operator's line being wrong, and the same mistyped argument reaching two
	// different exit codes is a shell script's bug waiting to happen.
	let scope;
	try {
		scope = parseScope(args, { parent: flags.has(PARENT_FLAG) });
	} catch (error) {
		if (!(error instanceof FactoryRunError)) throw error;
		return {
			error: { kind: error.reason, message: error.message, ...error.details },
			exitCode: isUsageRefusal(error.reason) ? EXIT_USAGE : EXIT_REFUSED,
		};
	}
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
			scope,
			// Built only when there is a scope to spend it on: a `doctor` with no
			// scope makes no tracker read, so it needs no credentials either.
			tracker: scope === null ? null : (tracker ?? trackerFor(config)),
			// §10.5's expensive mode, asked for explicitly. Without the flag the last
			// recorded result is reported and nothing is executed.
			baseline: flags.has(BASELINE_FLAG),
			at,
		});
		return { message: headline(report), report };
	} finally {
		store?.close();
	}
}

/**
 * The read client this repository's config describes. `tracker.login` names a
 * `tea` login and `tea` holds the instance and the token (§6.8), so there is
 * nothing here to configure and nothing to leak.
 */
function trackerFor(config) {
	if (config === null) return null;
	return createGiteaReader({ repo: config.tracker.repo, login: config.tracker.login });
}

/**
 * The one sentence an operator reads first. It counts the alarms rather than
 * ranking them: §12.4's pin and §4.7's quarantine are the same class of "nothing
 * can settle this", and a ladder between them would invite ignoring the lower
 * rung.
 */
function headline(report) {
	const scope = scopeHeadline(report.scope);

	if (report.alarms.length === 0) return `doctor found nothing to raise.${scope}`;

	return (
		`doctor raises ${report.alarms.length} ${report.alarms.length === 1 ? "alarm" : "alarms"}: ` +
		`${report.alarms.map((alarm) => alarm.reason).join(", ")}.${scope}`
	);
}

/**
 * The frontier, in the first sentence, when one was asked for — because an
 * operator who typed a ticket number asked about that ticket, and making them
 * read to the bottom for the answer is making them read the wrong report.
 */
function scopeHeadline(scope) {
	if (!scope.requested || scope.ok !== true) return "";

	return scope.claimable.length === 0
		? ` ${scope.described}: nothing is claimable of ${scope.members.length} member(s).`
		: ` ${scope.described}: ${scope.claimable.length} claimable of ${scope.members.length} member(s), starting at #${scope.claimable[0]}.`;
}
