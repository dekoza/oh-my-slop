import { execFile, spawn } from "node:child_process";

/**
 * The real IO behind the runtime probes: run a command, hold a line-oriented
 * stdin/stdout session, fetch a URL. Everything above this file is parsing and
 * judgement, driven in tests by fake transports answering with the shapes
 * these produce — the herdr probe's pattern, one level up.
 */

/**
 * Run to completion. **Exit codes are answers here, not exceptions** — a probe
 * asking `claude plugin validate --strict` needs the 1 — so only a command
 * that could not run at all rejects.
 *
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export function runCommand(command, args, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		execFile(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
			if (error !== null && typeof error.code !== "number") {
				rejectPromise(error);
				return;
			}
			resolvePromise({ status: error === null ? 0 : error.code, stdout, stderr });
		});
	});
}

/**
 * A disposable line session: write the input lines, close stdin, collect
 * stdout until the process exits. Both probed harnesses end their session on
 * EOF — pi's RPC mode answers each request then exits, and Claude's
 * stream-json `--print` run answers the control request then exits — so
 * "session over" is the exit, and the timeout is the guard against a harness
 * that wedges instead.
 *
 * @param {{ binary: string, args: string[], input: string[], timeoutMs: number, env?: object, cwd?: string }} session
 * @returns {Promise<{ status: number | null, lines: string[], stderr: string, timedOut: boolean }>}
 */
export function lineSession({ binary, args, input, timeoutMs, env, cwd }) {
	return new Promise((resolvePromise, rejectPromise) => {
		let child;
		try {
			child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], env, cwd });
		} catch (error) {
			rejectPromise(error);
			return;
		}

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			rejectPromise(error);
		});
		child.once("close", (status) => {
			clearTimeout(timer);
			resolvePromise({
				status,
				lines: stdout.split("\n").filter((line) => line.trim() !== ""),
				stderr,
				timedOut,
			});
		});

		for (const line of input) child.stdin.write(`${line}\n`);
		child.stdin.end();
	});
}

/**
 * One GET, decoded as text. Non-2xx is an answer; only a connection that never
 * happened rejects — and the caller turns both into the same named finding,
 * because the operator's fix is the same sentence either way.
 *
 * @param {string} url
 * @param {{ timeoutMs: number }} options
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpGet(url, { timeoutMs }) {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: abort.signal, headers: { "accept-encoding": "identity" } });
		return { status: response.status, body: await response.text() };
	} finally {
		clearTimeout(timer);
	}
}
