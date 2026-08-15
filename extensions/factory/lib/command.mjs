import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHuman, renderJson, runCli } from "../../../factory/lib/cli/main.mjs";
import {
	FACTORY_RUN_START,
	FACTORY_RUN_START_RESPONSE,
	MONITOR_RESPONSE_DEADLINE_MS,
} from "../../../factory/lib/monitor-trigger.mjs";

/**
 * §10.2: `/factory` is the binary's code run from a pi session, plus §10.6's
 * one-way monitor trigger. This module is the front's core as plain ESM —
 * injectable with the session's event bus and display sink — so a test drives
 * the real `runCli` against a real repository without loading pi.
 *
 * The binary stays the operator surface: nothing here is reachable only from
 * the pi session, and a run launched from the shell publishes no trigger,
 * because a shell has no bus (§10.2, §10.6).
 *
 * Loopback authentication for `status` and `doctor` is §10.6's ephemeral token
 * from the `0600` discovery file, never the password path; the listener and
 * that file are the monitor's (#120), so this surface only ever receives a URL
 * from it.
 */

/**
 * Run one `/factory <args>` invocation.
 *
 * @param {string[]} argv the verb and its arguments, exactly as typed after
 *   `/factory`
 * @param {object} context the session's facts
 * @param {string} context.cwd the session's working directory — the repository
 * @param {Record<string, string | undefined>} context.env
 * @param {string} context.executable the package's binary (§11.7's anchor)
 * @param {{ emit: (channel: string, data: unknown) => void, on?: (channel: string, listener: (data: unknown) => void) => (() => void) | void }} [context.events]
 *   the shared event bus; its absence means "no monitor", not an error
 * @param {(text: string, options: { isError: boolean }) => void} context.display
 *   the sink for the rendered answer
 * @param {string | null} [context.agentDir]
 * @param {object} [context.probes]
 * @param {(options: object) => Promise<object>} [context.herdr]
 * @param {(args: string[], options: object) => Promise<object>} [context.runHerdr]
 * @returns {Promise<number>} the answer's exit code — reported, never thrown
 */
export async function runFactoryCommand(argv, context) {
	const { display } = context;
	const result = await runCli(argv, {
		cwd: context.cwd,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		probes: context.probes,
		herdr: context.herdr,
		runHerdr: context.runHerdr,
	});

	let text = result.json ? renderJson(result.value) : renderHuman(result.value);
	const isError = result.exitCode !== 0;

	if (argv[0] === "start" && startProducedRun(result.value)) {
		const url = await monitorUrl({ events: context.events, repo: context.cwd, argv, report: result.value.report });
		if (url !== null) text += `monitor: ${url}\n`;
	}

	display(text, { isError });
	return result.exitCode;
}

/**
 * §10.6's trigger, fired **after** the start answered: the payload carries the
 * run's report — facts, not a prediction — and a refusal or a start that never
 * opened a run publishes nothing. The bus is never fatal: any failure in
 * publishing or awaiting the answer degrades to "no monitor line".
 *
 * @returns {Promise<string | null>} the monitor URL, or `null` when nobody
 *   answers within the deadline (the common case: no monitor in the session)
 */
async function monitorUrl({ events, repo, argv, report }) {
	if (typeof events?.emit !== "function") return null;

	let resolveAnswer = null;
	const answered = new Promise((resolve) => {
		resolveAnswer = resolve;
	});
	let off = null;
	let settled = false;
	try {
		off = events.on?.(FACTORY_RUN_START_RESPONSE, (data) => {
			if (settled) return;
			settled = true;
			resolveAnswer(typeof data?.url === "string" && data.url.length > 0 ? data.url : null);
		});
		events.emit(FACTORY_RUN_START, { repo, argv, at: Date.now(), report });
	} catch {
		off?.();
		return null;
	}

	const url = await raceDeadline(answered, MONITOR_RESPONSE_DEADLINE_MS);
	off?.();
	return url;
}

/** `promise`, or `null` when it is still unresolved after `ms`. */
function raceDeadline(promise, ms) {
	return new Promise((resolve) => {
		// The wait is the caller's pending work, not background activity: it is
		// deliberately **not** unref'd, because an unanswered request in a quiet
		// process must still cost its deadline rather than end the process first.
		const timer = setTimeout(() => resolve(null), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(null);
			},
		);
	});
}

/**
 * A start's answer names a run when it opened one (foreground or re-entry
 * against a live holder) or launched one detached. Refusals and unbuilt
 * answers name none.
 */
function startProducedRun(value) {
	if (value.error !== undefined || value.report === null || value.report === undefined) return false;
	const report = value.report;
	return report.detached === true || report.run !== undefined || report.live === true;
}

/**
 * §11.7: the binary is resolved from the extension's own place in the package,
 * walking up to the manifest that declares it — one package, one version,
 * nothing configured. Fails closed when the tree is not a factory package.
 *
 * @param {string} fromUrl a URL inside this extension
 * @returns {string} the absolute path of the package's `factory` binary
 */
export function resolveFactoryBinary(fromUrl) {
	let dir = dirname(fileURLToPath(fromUrl));
	for (;;) {
		const manifestPath = join(dir, "package.json");
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			const bin = manifest.bin?.factory;
			if (typeof bin === "string") {
				const binary = join(dir, bin);
				if (!existsSync(binary)) {
					throw new Error(
						`the package at ${dir} declares bin.factory as ${bin}, but ${binary} does not exist`,
					);
				}
				return realpathSync(binary);
			}
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				`no package.json with a bin.factory entry above ${fileURLToPath(fromUrl)}: not a factory package`,
			);
		}
		dir = parent;
	}
}
