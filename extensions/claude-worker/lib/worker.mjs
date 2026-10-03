import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 64_000;

function subscriptionEnvironment(env) {
	return Object.fromEntries(Object.entries(env).filter(([key]) =>
		!key.startsWith("ANTHROPIC_") && !key.startsWith("CLAUDE_CODE_USE_")));
}

export async function runClaude({ cwd, prompt, sessionId, signal, onProgress = () => {}, onPermission = async () => false, executable = "claude", prefixArgs = [], env = process.env }) {
	if (!prompt?.trim()) throw new Error("A Claude Code task is required.");
	const childEnv = subscriptionEnvironment(env);
	const auth = await execFileAsync(executable, [...prefixArgs, "auth", "status", "--json"], {
		cwd, env: childEnv, signal, timeout: 10_000, maxBuffer: OUTPUT_LIMIT,
	});
	const account = JSON.parse(auth.stdout);
	if (!account.loggedIn || account.authMethod !== "claude.ai" || account.apiProvider !== "firstParty" ||
		!["pro", "max", "team", "enterprise"].includes(account.subscriptionType?.toLowerCase()) ||
		(account.apiKeySource && account.apiKeySource !== "none")) {
		throw new Error("Claude Code subscription login required. Run claude auth login, then check /status in Claude Code.");
	}
	signal?.throwIfAborted();
	const args = [...prefixArgs, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "auto", "--permission-prompt-tool", "stdio", "--permission-prompts", "host"];
	if (sessionId) args.push("--resume", sessionId);
	const messageId = randomUUID();
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
		});
		let result;
		let failure;
		let killTimer;
		let initialized = false;
		let currentSessionId = sessionId;
		let stderr = "";
		const permissionAbort = new AbortController();
		const pendingPermissions = new Map();
		const seenPermissions = new Set();
		let permissionQueue = Promise.resolve();
		const kill = (terminationSignal) => {
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, terminationSignal);
				else child.kill(terminationSignal);
			} catch (error) {
				if (error.code !== "ESRCH") failure ??= error;
			}
		};
		const stop = () => {
			permissionAbort.abort();
			kill("SIGTERM");
			killTimer ??= setTimeout(() => kill("SIGKILL"), 1_000);
		};
		const fail = (error) => { failure ??= error; stop(); };
		const initializeTimer = setTimeout(() => fail(new Error("Claude Code initialization timed out before the task was sent.")), 10_000);
		child.stderr.setEncoding("utf8").on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-OUTPUT_LIMIT);
			try { onProgress({ type: "worker_stderr", text: chunk }); } catch (error) { fail(error); }
		});
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			void (async () => {
				if (failure || signal?.aborted) return;
				const event = JSON.parse(line);
				if (event.session_id) currentSessionId = event.session_id;
				onProgress(event);
				if (event.type === "control_response" && event.response?.request_id === "pi-initialize") {
					const response = event.response;
					const account = response.response?.account;
					if (initialized) throw new Error("Duplicate Claude Code initialization response.");
					if (response.subtype !== "success" || account?.apiProvider !== "firstParty" ||
						!/^Claude (Pro|Max|Team|Enterprise)$/i.test(account.subscriptionType || "") ||
						(account.apiKeySource && account.apiKeySource !== "none") ||
						(account.tokenSource && account.tokenSource !== "claude.ai")) {
						throw new Error("Claude Code did not initialize with a verified subscription; no task prompt was sent.");
					}
					initialized = true;
					clearTimeout(initializeTimer);
					if (!signal?.aborted && !result) child.stdin.write(JSON.stringify({
						type: "user", uuid: messageId, session_id: "", message: { role: "user", content: prompt }, parent_tool_use_id: null,
					}) + "\n");
				}
				if (event.type === "control_cancel_request") {
					seenPermissions.add(event.request_id);
					pendingPermissions.get(event.request_id)?.abort();
					pendingPermissions.delete(event.request_id);
				}
				if (event.type === "control_request") {
					if (seenPermissions.has(event.request_id)) return;
					seenPermissions.add(event.request_id);
					const request = event.request;
					const controller = new AbortController();
					pendingPermissions.set(event.request_id, controller);
					const permissionSignal = AbortSignal.any([permissionAbort.signal, controller.signal]);
					permissionQueue = permissionQueue.then(async () => {
						if (permissionSignal.aborted) return;
						const allowed = request?.subtype === "can_use_tool" && !request.requires_user_interaction &&
							await onPermission(request, permissionSignal);
						if (!child.stdin.destroyed && !child.stdin.writableEnded && !permissionSignal.aborted) {
							const response = request?.subtype === "can_use_tool"
								? { subtype: "success", request_id: event.request_id, response: allowed === true
									? { behavior: "allow", updatedInput: request.input }
									: { behavior: "deny", message: "Permission denied by the Pi host; specialized interactions are not supported." } }
								: { subtype: "error", request_id: event.request_id, error: "Unsupported control request." };
							child.stdin.write(JSON.stringify({ type: "control_response", response }) + "\n");
						}
					}).catch((error) => { if (!permissionSignal.aborted) fail(error); })
						.finally(() => pendingPermissions.delete(event.request_id));
				}
				if (event.type === "result") {
					// A task-notification turn is not the reply to our submitted task.
					const ids = event.user_message_uuids || (event.user_message_uuid ? [event.user_message_uuid] : []);
					if (event.origin?.kind === "task-notification" || (ids.length && !ids.includes(messageId))) return;
					result = event;
					permissionAbort.abort();
					child.stdin.end();
				}
			})().catch(fail);
		});
		child.on("error", fail);
		child.stdin.on("error", fail);
		const abort = stop;
		signal?.addEventListener("abort", abort, { once: true });
		child.on("close", (code, exitSignal) => {
			lines.close();
			clearTimeout(killTimer);
			clearTimeout(initializeTimer);
			permissionAbort.abort();
			signal?.removeEventListener("abort", abort);
			const outcome = {
				sessionId: result?.session_id || currentSessionId, text: result?.result || "",
				disposition: "unfinished", reason: "No explicit evidence-backed completion report was received.",
				exitCode: code, exitSignal, resultSubtype: result?.subtype, stopReason: result?.stop_reason,
				terminalReason: result?.terminal_reason, numTurns: result?.num_turns, errors: result?.errors || [],
				permissionDenials: result?.permission_denials || [], stderr,
			};
			try { onProgress({ type: "worker_exit", ...outcome }); } catch (error) { failure ??= error; }
			let error = failure;
			if (!error && signal?.aborted) error = new Error("Claude Code worker stopped.");
			if (!error && (code !== 0 || !result || result.is_error || result.subtype !== "success")) {
				error = new Error([result?.result, ...outcome.errors, stderr].filter(Boolean).join("\n") || "Claude Code exited without a successful result.");
			}
			if (!error && !result?.session_id) error = new Error("Claude Code returned no resumable session ID.");
			if (error) { error.outcome = outcome; reject(error); }
			else resolve(outcome);
		});
		child.stdin.write(JSON.stringify({ type: "control_request", request_id: "pi-initialize", request: { subtype: "initialize", hooks: null } }) + "\n");
	});
}
