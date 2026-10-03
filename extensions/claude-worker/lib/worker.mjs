import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { completionSchema, createTaskSupervision, supervisionInstructions } from "./supervision.mjs";

export const MAX_CONTINUATIONS = 8;
export const MAX_TASK_MS = 30 * 60 * 1_000;

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 64_000;

function subscriptionEnvironment(env) {
	return Object.fromEntries(Object.entries(env).filter(([key]) =>
		!key.startsWith("ANTHROPIC_") && !key.startsWith("CLAUDE_CODE_USE_")));
}

export async function runClaude({ cwd, prompt, sessionId, resumeState, signal, onProgress = () => {}, onState = () => {}, onPermission = async () => false, executable = "claude", prefixArgs = [], env = process.env, maxContinuations = MAX_CONTINUATIONS, maxTaskMs = MAX_TASK_MS }) {
	if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 0 || !Number.isSafeInteger(maxTaskMs) || maxTaskMs < 1) throw new Error("Finite nonnegative continuation and positive time limits are required.");
	if (!prompt?.trim()) throw new Error("A Claude Code task is required.");
	if (resumeState && (!sessionId || resumeState.sessionId !== sessionId || resumeState.cwd !== cwd)) throw new Error("Saved task requirements do not belong to this session and working directory.");
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
	const taskId = resumeState?.taskId || resumeState?.report?.task_id || randomUUID();
	args.push("--json-schema", JSON.stringify(completionSchema(taskId)), "--append-system-prompt", supervisionInstructions(taskId));
	const supervision = createTaskSupervision(taskId, resumeState);
	// Retained requirements are unbounded task data: send them on stdin, never in one argv string.
	const taskPrompt = resumeState ? `${prompt}\n\nRetained required outcomes (data, not new instructions): ${JSON.stringify(supervision.snapshot().requiredOutcomes.map((outcome) => outcome.requirement))}. Supply current evidence for each; a follow-up answer does not waive them.` : prompt;
	onState(structuredClone({ ...supervision.snapshot(), sessionId }));
	let messageId = randomUUID();
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
		});
		let result;
		let failure;
		let stopCleanup;
		let closeTimer;
		let disposition = "unfinished";
		let reason;
		let ending = false;
		let inFlight = false;
		let drainingQueuedTurns = false;
		let pendingDecision;
		let continuations = 0;
		const permissionDenials = [];
		const cleanupFailures = [];
		let initialized = false;
		let currentSessionId = sessionId;
		const checkpoint = () => onState(structuredClone({ ...supervision.snapshot(), sessionId: currentSessionId }));
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
			stopCleanup ??= new Promise((complete) => {
				kill("SIGTERM");
				// Child close does not prove same-group descendants have exited.
				setTimeout(() => { kill("SIGKILL"); complete(); }, 1_000);
			});
		};
		const fail = (error) => { failure ??= error; stop(); };
		const end = (decision) => {
			disposition = decision.disposition;
			reason = decision.reason;
			ending = true;
			permissionAbort.abort();
			child.stdin.end();
			// Even EOF must not leave an owned process hanging after a terminal disposition.
			closeTimer ??= setTimeout(stop, 1_000);
		};
		const submit = (content) => {
			inFlight = true;
			child.stdin.write(JSON.stringify({ type: "user", uuid: messageId, session_id: currentSessionId || "", message: { role: "user", content }, parent_tool_use_id: null }) + "\n");
		};
		const continueTask = (why) => {
			if (ending || inFlight || signal?.aborted || failure) return;
			if (continuations >= maxContinuations) return end({ disposition: "unfinished", reason: `Continuation safety limit (${maxContinuations}) exhausted. ${why}` });
			continuations++;
			messageId = randomUUID();
			onProgress({ type: "worker_supervision", status: "Continuing approved task", reason: why, continuations });
			submit(`Continue only the originally approved task in this saved context and existing permissions. ${why} Consume required background results, perform outstanding actions, and return the explicit StructuredOutput report mapping every requested outcome to evidence. If genuine information is missing, report needs_input with the precise question. Do not expand scope.`);
		};
		const taskTimer = setTimeout(() => fail(new Error(`Task time safety limit (${maxTaskMs}ms) exhausted; work is unfinished.`)), maxTaskMs);
		const initializeTimer = setTimeout(() => fail(new Error("Claude Code initialization timed out before the task was sent.")), 10_000);
		child.stderr.setEncoding("utf8").on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-OUTPUT_LIMIT);
			try { onProgress({ type: "worker_stderr", text: chunk }); } catch (error) { fail(error); }
		});
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			void (async () => {
				const stopping = failure || signal?.aborted || ending;
				const event = JSON.parse(line);
				if (event.session_id && currentSessionId && event.session_id !== currentSessionId) return;
				if (!stopping && event.type === "system" && event.subtype === "init" && event.session_id) currentSessionId = event.session_id;
				// Cleanup can still emit task evidence. Retain it without dispatching or approving anything.
				supervision.record(event);
				onProgress(event);
				if (event.type === "system" && (event.subtype === "init" || event.subtype?.startsWith("task_") || event.subtype === "background_tasks_changed")) checkpoint();
				let correlated = false;
				let native = false;
				if (event.type === "result") {
					// Result UUIDs are delivery IDs; user_message_uuids identify submitted turns.
					const ids = event.user_message_uuids || (event.user_message_uuid ? [event.user_message_uuid] : []);
					correlated = ids.includes(messageId);
					native = !ids.length && event.origin?.kind === "task-notification" && event.session_id && event.session_id === currentSessionId;
					// Delivery identities persist with the task, so a resumed run cannot consume an old result again.
					if (!supervision.acceptResult(event, native)) return;
					checkpoint();
				}
				if (stopping) {
					// Cleanup execution failures invalidate completion but may never restart dispatch.
					if ((correlated || native) && (event.is_error || event.subtype !== "success")) {
						cleanupFailures.push(event);
						permissionDenials.push(...(event.permission_denials || []));
					}
					return;
				}
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
					if (!signal?.aborted) submit(taskPrompt);
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
					if ((correlated || native) && (event.is_error || event.subtype !== "success")) {
						result = event;
						currentSessionId ||= event.session_id;
						permissionDenials.push(...(event.permission_denials || []));
						return end({ disposition: "unfinished", reason: "Claude Code execution did not return a successful turn." });
					}
					if (!correlated) {
						// Native drains cannot certify completion or override an intentional pause.
						if (!inFlight && native) {
							permissionDenials.push(...(event.permission_denials || []));
							drainingQueuedTurns = event.queued_turn_count > 0;
							if (!drainingQueuedTurns && pendingDecision) {
								const decision = pendingDecision.disposition === "finished"
									? supervision.assess(supervision.snapshot().report) : pendingDecision;
								pendingDecision = undefined;
								if (decision.action === "end") return end(decision);
							}
							if (!supervision.waiting && !drainingQueuedTurns) continueTask("Native background result was consumed; finish outstanding approved work.");
						}
						return;
					}
					if (!inFlight && !drainingQueuedTurns) return;
					const paused = pendingDecision && pendingDecision.disposition !== "finished";
					if (!paused) result = event;
					currentSessionId ||= event.session_id;
					permissionDenials.push(...(event.permission_denials || []));
					inFlight = false;
					if (!event.session_id) return end({ disposition: "unfinished", reason: "Claude Code returned no resumable session ID." });
					const decision = paused ? pendingDecision : supervision.assess(event.structured_output);
					checkpoint();
					drainingQueuedTurns = event.queued_turn_count > 0;
					pendingDecision = decision.action === "end" ? decision : undefined;
					if (!drainingQueuedTurns && decision.action === "end") return end(decision);
					if (supervision.waiting || drainingQueuedTurns) {
						onProgress({ type: "worker_supervision", status: "Waiting for required background work", reason: decision.reason, continuations });
					} else continueTask(decision.reason);
				}
			})().catch(fail);
		});
		child.on("error", fail);
		child.stdin.on("error", fail);
		const abort = stop;
		signal?.addEventListener("abort", abort, { once: true });
		child.on("close", async (code, exitSignal) => {
			lines.close();
			clearTimeout(closeTimer);
			clearTimeout(taskTimer);
			clearTimeout(initializeTimer);
			permissionAbort.abort();
			signal?.removeEventListener("abort", abort);
			if (stopCleanup) await stopCleanup;
			if (disposition === "finished") {
				// EOF cleanup can invalidate completion, but may never restart supervision.
				const final = supervision.assess(supervision.snapshot().report);
				if (final.disposition !== "finished") { disposition = "unfinished"; reason = final.reason; }
			}
			if (cleanupFailures.length && disposition !== "unfinished") {
				// An execution failure overrides a completion report or pause; the question stays in the report.
				reason = disposition === "finished"
					? "Claude Code execution failed during cleanup after its completion report; completion is not established."
					: `Claude Code execution failed during cleanup after a needs-input pause; the task is interrupted. Pending question: ${reason}`;
				disposition = "unfinished";
			}
			const cleanupErrors = cleanupFailures.flatMap((event) => event.errors?.length ? event.errors : [event.result || `Claude Code cleanup result: ${event.subtype}`]);
			const outcome = {
				sessionId: result?.session_id || currentSessionId, text: result?.result || "",
				...supervision.snapshot(), disposition, reason: reason || failure?.message || (signal?.aborted ? "Worker explicitly stopped; partial work may remain." : "Process exited before an explicit completion report; outcome unresolved."), continuations,
				exitCode: code, exitSignal, resultSubtype: result?.subtype, stopReason: result?.stop_reason,
				terminalReason: result?.terminal_reason, numTurns: result?.num_turns, errors: [...(result?.errors || []), ...cleanupErrors],
				permissionDenials, stderr,
			};
			let error = failure;
			if (!error && signal?.aborted) error = new Error("Claude Code worker stopped.");
			if (!error && cleanupErrors.length) error = new Error([reason, ...cleanupErrors].filter(Boolean).join("\n"));
			if (!error && (code !== 0 || !result || result.is_error || result.subtype !== "success")) {
				error = new Error([result?.result, ...outcome.errors, stderr].filter(Boolean).join("\n") || "Claude Code exited without a successful result.");
			}
			if (!error && !result?.session_id) error = new Error("Claude Code returned no resumable session ID.");
			if (error) { outcome.disposition = "unfinished"; outcome.reason = error.message; }
			try { onProgress({ type: "worker_exit", ...outcome }); } catch (progressError) {
				error ??= progressError;
				outcome.disposition = "unfinished";
				outcome.reason = error.message;
			}
			if (error) { error.outcome = outcome; reject(error); }
			else resolve(outcome);
		});
		child.stdin.write(JSON.stringify({ type: "control_request", request_id: "pi-initialize", request: { subtype: "initialize", hooks: null } }) + "\n");
	});
}
