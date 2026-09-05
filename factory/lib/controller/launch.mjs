import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from "../cli/exit-codes.mjs";
import { JSON_FLAG } from "../cli/flags.mjs";
import { newUlid } from "../identity/ulid.mjs";
import { hasLapsed, openLeases } from "../state/leases.mjs";
import { openStore } from "../state/store.mjs";
import { CONTROLLER_LEASE } from "../domain/vocabulary.mjs";
import { liveRunAnswer } from "./entry.mjs";
import { probeHerdr } from "./herdr.mjs";
import { herdrResult, runHerdr } from "./herdr-control.mjs";

/**
 * §10.1's process shape, the half the controller does not have: **the default
 * launch is detached into a Herdr pane.**
 *
 * The dominant case is SSH in, start, walk away for hours — a foreground run
 * dies with the connection. So the default hands the run to a controller in a
 * dedicated workspace, and `--foreground` is the flag that says "no, this
 * terminal is the controller". The two are the same verb because they are the
 * same job with one process-shape decision between them.
 *
 * **Live-run resolution happens before any Herdr contact.** A start that
 * resolves against a live run claims nothing and opens no second run (§10.4);
 * creating a workspace for such a start would leave a pane nobody asked for.
 * And a repository with a live run is a repository the operator is already
 * watching, so the refusal or the "already in scope" answer goes out without
 * touching the multiplexer at all.
 *
 * **The pane survives the run.** Nothing here, or anywhere in this package,
 * issues a close for it: the controller's pane is the classified drain report's
 * screen (§10.1), and pane reclamation is cleanup-plan's exclusively (§13.B).
 */

/** The flag that runs the invocation as the controller rather than detaching it (§10.1). */
export const FOREGROUND_FLAG = "--foreground";

/**
 * How the controller learns that **the factory made the pane it is sitting in**
 * — which is the whole of what §12.8's sixth target kind needs and the whole of
 * what §14.27 forbids getting wrong.
 *
 * `HERDR_PANE_ID` says *which* pane, and Herdr sets it in every pane it manages,
 * including the one an operator ran `--foreground` from. Reclaiming a pane on
 * that evidence would close the operator's own terminal, so the discriminator
 * has to come from the side that created the pane: this launcher, which is the
 * one place a factory-owned controller pane comes into existence. The controller
 * stamps its run onto the pane only when it reads this, and a pane with no stamp
 * is never a target under any circumstance (§14.27).
 *
 * It rides the workspace's declared environment rather than the command line for
 * the reason #157 moved the worker's binding there: the shell Herdr launches for
 * the pane carries it, and a value in `argv` would be re-typed into scrollback by
 * every `pane run` that follows.
 */
export const CONTROLLER_PANE_ENV = "FACTORY_CONTROLLER_PANE";

/**
 * The operator's invocation as the relaunched controller receives it: **every
 * flag they typed, not the scope alone.**
 *
 * #213: the relaunch carried the positionals only, so `factory start --parent 75`
 * reached the pane as `factory start --foreground 75` and the controller claimed
 * ticket 75 rather than the members of its scope, while `--new-run`, dropped the
 * same way, re-entered the run it was told to refuse. Neither process refused,
 * because neither compared what was asked with what was run.
 *
 * **It forwards by exclusion**, and the exclusion is one flag long. `cli/main.mjs`
 * has already judged every flag on the line against the verb table's declaration
 * for `start` and refused the unknown and the misshapen, so what arrives here is
 * exactly the operator's flags — and forwarding all of them is what makes a flag
 * added to that table reach the pane without a second edit here. Naming the
 * forwarded ones instead would be a second declaration of the verb's flags, and a
 * per-flag fix closes one dropped flag while leaving the next to be found the
 * same way.
 *
 * Every flag has to be re-typed rather than inherited, `--routing-set` included:
 * the controller is a separate process that resolves its scope and loads its
 * config again from its own argv, so a flag left behind here runs the whole run
 * under a default nobody asked for (§11.5). The one exception is `JSON_FLAG`,
 * which selects a rendering rather than a run — of *this* process's report, which
 * the pane's controller does not print. `FOREGROUND_FLAG` needs no exclusion: the
 * caller reaches this only on the branch where the operator did not type it.
 *
 * A value rides its flag as `--name=value`, the one form `parseArgv` reads back.
 * Flags lead and the scope follows: `parseArgv` sorts the two apart before either
 * is used, so this is one deterministic rendering of the invocation rather than a
 * transcript of the operator's keystrokes.
 *
 * @param {object} typed the invocation's line, as the CLI parsed it
 * @param {string[]} typed.args the positional scope
 * @param {ReadonlySet<string>} typed.flags the flags the line carried, in the order typed
 * @param {ReadonlyMap<string, string>} typed.flagValues the values riding them
 * @returns {string[]} the arguments after `start`
 */
export function relaunchArgs({ args, flags, flagValues }) {
	const forwarded = [...flags]
		.filter((flag) => flag !== JSON_FLAG)
		.map((flag) => (flagValues.has(flag) ? `${flag}=${flagValues.get(flag)}` : flag));
	return [...forwarded, ...args];
}

/**
 * @param {object} invocation as the CLI assembles it
 * @param {string} invocation.repoRoot
 * @param {object | null} invocation.requested §3.1's parsed selector, or null
 * @param {string[]} invocation.args the scope exactly as the line carried it
 * @param {ReadonlySet<string>} [invocation.flags] the flags the line carried
 * @param {ReadonlyMap<string, string>} [invocation.flagValues] the values riding them
 * @param {string | null} [invocation.agentDir]
 * @param {string} [invocation.executable] the running binary — §11.7's anchor
 * @param {Record<string, string | undefined>} [invocation.env]
 * @param {(options: object) => Promise<object>} [invocation.herdr] §10.3's availability probe
 * @param {(args: string[], options: object) => Promise<{ exitCode: number, stdout: string, stderr: string }>} [invocation.runHerdr]
 *   the Herdr command runner, injectable so a test drives both answers without a
 *   terminal multiplexer on the machine
 * @param {() => number} [invocation.now]
 * @param {() => string} [invocation.mint] the workspace-label source, injectable for tests
 * @returns {Promise<{ message: string, report: object, exitCode: number } | { error: object, exitCode: number }>}
 */
export async function launch({
	repoRoot,
	requested,
	args,
	flags = new Set(),
	flagValues = new Map(),
	agentDir = null,
	executable,
	env,
	herdr = probeHerdr,
	runHerdr: run = runHerdr,
	now = Date.now,
	mint = newUlid,
}) {
	// The controller's own line, minus the binary: §10.1's process-shape flag and
	// then the operator's whole invocation. The **arguments** are built once
	// because they are printed twice — in the `--foreground` advice a refusal
	// carries, and as the launched command — and two spellings of one argument
	// list is how the advice comes to drop a flag.
	//
	// The binary in front of them deliberately differs between the two. The advice
	// is something a human retypes, so it says `factory`; the command is something
	// Herdr execs, so it says the resolved path this process was started from
	// (§11.7). One string for both would be wrong for whichever it was not written
	// for.
	const controllerArgs = [FOREGROUND_FLAG, ...relaunchArgs({ args, flags, flagValues })];
	const foregroundLine = `factory start ${controllerArgs.join(" ")}`;

	const store = await openStore({ repoRoot, agentDir });
	try {
		// The lock-free read: the launcher takes no lease. §10.4's resolution is
		// a read, and a launcher that raced the controller for the lease would
		// refuse precisely when a run is already doing the job.
		const row = openLeases(store).inspect(CONTROLLER_LEASE);
		const live = row !== null && !hasLapsed(row, now());

		if (live) {
			return liveRunAnswer(store, liveOf(row), requested);
		}

		// A scope-less start means re-entry, and re-entry has nothing to re-enter
		// when the repository holds no unended run. The refusal is usage, exit 1,
		// and it happens before any Herdr contact: a workspace for a start that
		// cannot name its scope would be a pane whose controller refuses on arrival.
		if (requested === null && store.readUnendedRuns().length === 0) {
			return {
				error: {
					kind: "scope-required",
					message:
						"No run to re-enter in this repository, and no scope on the line. Usage: " +
						"`factory start <ticket…>` or `factory start --parent <issue>`.",
					at: "scope",
				},
				exitCode: EXIT_USAGE,
			};
		}

		const availability = await herdr({ env });
		if (!availability.available) {
			return {
				error: {
					kind: "herdr-unavailable",
					reason: availability.reason,
					command: availability.command,
					message:
						`${availability.message} The default launch is a detached Herdr pane (§10.1); ` +
						`\`${FOREGROUND_FLAG}\` runs the run in this terminal instead: ${foregroundLine}`,
				},
				exitCode: EXIT_REFUSED,
			};
		}

		// A dedicated workspace, labelled for the operator's workspace list. The
		// label is a ULID, not a ticket: the label is per multiplexer, not per
		// repository, and two repositories' ticket 42 must not be indistinguishable.
		const label = `factory-${mint()}`;
		const created = await run(
			[
				"workspace",
				"create",
				"--cwd",
				repoRoot,
				"--label",
				label,
				// The marker that makes this pane the factory's own, declared to the
				// server so the shell the pane runs in carries it (§12.8, §14.27).
				"--env",
				`${CONTROLLER_PANE_ENV}=${label}`,
				"--no-focus",
			],
			{ env, binary: availability.binary },
		);
		if (created.exitCode !== 0) {
			return commandFailure("workspace create", created, { workspace: null });
		}

		const result = parseResult(created.stdout);
		if (result === null) {
			return {
				error: {
					kind: "herdr-unreadable-response",
					command: "workspace create",
					message:
						"Herdr's workspace create answered exit 0 but no readable `result.root_pane`; " +
						"no pane was run in. Nothing was closed, because nothing here closes anything (§13.B).",
				},
				exitCode: EXIT_REFUSED,
			};
		}

		const command = [executable, "start", ...controllerArgs];
		const ran = await run(["pane", "run", result.root_pane.pane_id, ...command], {
			env,
			binary: availability.binary,
		});
		if (ran.exitCode !== 0) {
			return commandFailure("pane run", ran, { workspace: result.workspace.workspace_id });
		}

		return {
			message:
				`Launched into pane ${result.root_pane.pane_id} of workspace ${result.workspace.workspace_id} ` +
				`(${label}): ${command.join(" ")}. The pane survives the run, leaving the classified drain ` +
				`report on screen (§10.1); it is a cleanup-plan target, not a shutdown side effect.`,
			report: {
				detached: true,
				workspace: result.workspace.workspace_id,
				tab: result.tab?.tab_id ?? null,
				pane: result.root_pane.pane_id,
				label,
				command,
				foreground_alternative: foregroundLine,
			},
			exitCode: EXIT_OK,
		};
	} finally {
		store.close();
	}
}

/**
 * One command the multiplexer refused, named as such: the operator needs the
 * command that failed and the stderr that says why, and — when a workspace
 * exists but its pane run failed — the workspace's id, because that is what is
 * now sitting in their multiplexer waiting for a decision.
 */
function commandFailure(command, answer, { workspace }) {
	return {
		error: {
			kind: "herdr-command-failed",
			command,
			exit_code: answer.exitCode,
			stderr: answer.stderr.trim() || null,
			workspace,
			message:
				`Herdr refused \`${command}\` (exit ${answer.exitCode})${
					answer.stderr.trim() === "" ? "" : `: ${answer.stderr.trim()}`
				}${workspace === null ? "" : `; workspace ${workspace} exists and was left as found`} (§13.B).`,
		},
		exitCode: EXIT_REFUSED,
	};
}

/** The workspace a `workspace create` answered with, or null when it did not. */
function parseResult(stdout) {
	const result = herdrResult(stdout);
	if (result?.workspace?.workspace_id === undefined || result?.root_pane?.pane_id === undefined) {
		return null;
	}
	return result;
}

/** The lease row as §10.4's resolution reads it: the identity's run and pane, plus the generation. */
function liveOf(row) {
	return {
		run: row.identity?.run ?? null,
		pane: row.identity?.pane ?? null,
		fencing_generation: row.fencingGeneration,
	};
}
