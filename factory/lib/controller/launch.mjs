import { spawn } from "node:child_process";
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from "../cli/exit-codes.mjs";
import { newUlid } from "../identity/ulid.mjs";
import { openLeases } from "../state/leases.mjs";
import { openStore } from "../state/store.mjs";
import { CONTROLLER_LEASE } from "../domain/vocabulary.mjs";
import { liveRunAnswer } from "./entry.mjs";
import { probeHerdr } from "./herdr.mjs";

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
 * @param {object} invocation as the CLI assembles it
 * @param {string} invocation.repoRoot
 * @param {object | null} invocation.requested §3.1's parsed selector, or null
 * @param {string[]} invocation.rawArgs the scope exactly as the line carried it
 * @param {object} invocation.config the validated configuration
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
	rawArgs,
	agentDir = null,
	executable,
	env,
	herdr = probeHerdr,
	runHerdr = spawnHerdr,
	now = Date.now,
	mint = newUlid,
}) {
	const store = await openStore({ repoRoot, agentDir });
	try {
		// The lock-free read: the launcher takes no lease. §10.4's resolution is
		// a read, and a launcher that raced the controller for the lease would
		// refuse precisely when a run is already doing the job.
		const row = openLeases(store).inspect(CONTROLLER_LEASE);
		const live = row !== null && !isLapsed(row, now());

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
						`\`${FOREGROUND_FLAG}\` runs the run in this terminal instead: ` +
						`factory start ${FOREGROUND_FLAG} ${rawArgs.join(" ")}`,
				},
				exitCode: EXIT_REFUSED,
			};
		}

		// A dedicated workspace, labelled for the operator's workspace list. The
		// label is a ULID, not a ticket: the label is per multiplexer, not per
		// repository, and two repositories' ticket 42 must not be indistinguishable.
		const label = `factory-${mint()}`;
		const created = await runHerdr(
			["workspace", "create", "--cwd", repoRoot, "--label", label, "--no-focus"],
			{ env, binary: availability.binary },
		);
		if (created.exitCode !== 0) {
			return commandFailure("workspace create", created, { workspace: null });
		}

		const result = parseResult(created.stdout, "workspace create");
		if (result === null) {
			return {
				error: {
					kind: "herdr-unreadable-response",
					message:
						"Herdr's workspace create answered exit 0 but no readable `result.root_pane`; " +
						"no pane was run in. Nothing was closed, because nothing here closes anything (§13.B).",
				},
				exitCode: EXIT_REFUSED,
			};
		}

		const command = [executable, "start", FOREGROUND_FLAG, ...rawArgs];
		const ran = await runHerdr(["pane", "run", result.root_pane.pane_id, ...command], {
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
				foreground_alternative: `factory start ${FOREGROUND_FLAG} ${rawArgs.join(" ")}`,
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

/** The `result` object of a CLI JSON answer, or null when it is not there. */
function parseResult(stdout, command) {
	let answer;
	try {
		answer = JSON.parse(stdout);
	} catch {
		return null;
	}

	const result = answer?.result;
	if (result?.workspace?.workspace_id === undefined || result?.root_pane?.pane_id === undefined) {
		return null;
	}
	return result;
}

/** The row's own expiry, the same check the stop verb uses: the clock belongs to the row. */
function isLapsed(row, at) {
	return row.expiresAt !== null && row.expiresAt <= at;
}

/** The lease row as §10.4's resolution reads it: the identity's run and pane, plus the generation. */
function liveOf(row) {
	return {
		run: row.identity?.run ?? null,
		pane: row.identity?.pane ?? null,
		fencing_generation: row.fencingGeneration,
	};
}

/** The real runner: the resolved binary, the operator's environment, captured output. */
function spawnHerdr(args, { env, binary }) {
	return new Promise((resolve) => {
		const child = spawn(binary, args, {
			env: { ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) => resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }));
		child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
	});
}
