import { runClaude } from "./worker.mjs";
import { createActivityLog, formatActivityLog, formatRunReport, readActivityLog, safeText } from "./activity.mjs";

const STATE_ENTRY = "cc-worker-session";
const RUN_ENTRY = "cc-worker-run";

export function registerClaudeWorker(pi, parameters, { run = runClaude } = {}) {
	let active;
	let lastSession;
	let lastRun;
	let billingConfirmed = false;

	function remember(sessionId, cwd) {
		lastSession = { sessionId, cwd };
		pi.appendEntry(STATE_ENTRY, lastSession);
	}

	function persistRun(snapshot) {
		lastRun = snapshot;
		pi.appendEntry(RUN_ENTRY, snapshot);
	}

	function restore(ctx) {
		const branch = ctx.sessionManager.getBranch();
		lastSession = branch.filter((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY).at(-1)?.data;
		lastRun = branch.filter((entry) => entry.type === "custom" && entry.customType === RUN_ENTRY).at(-1)?.data;
		if (lastRun && !lastRun.endedAt) lastRun = { ...lastRun, status: "Interrupted; no terminal outcome retained", endedAt: Date.now() };
	}

	async function start(prompt, resume, ctx, signal, onUpdate) {
		if (active) throw new Error("A Claude Code worker is already running. Use /cc-stop before starting another task.");
		if (!prompt.trim()) throw new Error("Usage: /cc <task> or /cc-followup <instruction>");
		if (!ctx.hasUI) throw new Error("Claude Code delegation requires a UI for consent and permission prompts.");
		if (!ctx.isProjectTrusted()) throw new Error("Trust this project before starting Claude Code.");
		if (resume && (!lastSession?.sessionId || lastSession.cwd !== ctx.cwd)) {
			throw new Error("No saved Claude Code session for this project. Start one with /cc <task>.");
		}
		const sessionId = resume ? lastSession.sessionId : undefined;
		const controller = new AbortController();
		const job = { controller, done: undefined, log: undefined };
		active = job;
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) controller.abort();
		let preview = "";
		let refreshTimer;

		const refresh = () => {
			if (!job.log) return;
			const state = job.log.snapshot();
			const elapsed = Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1_000);
			const idle = Math.floor((Date.now() - (state.lastActivityAt || state.startedAt)) / 1_000);
			const status = controller.signal.aborted && !state.endedAt ? "Stopping" : state.status;
			ctx.ui.setStatus("cc-worker", `CC: ${status} · ${elapsed}s`);
			ctx.ui.setWidget("cc-worker", [
				`Claude Code: ${status} · elapsed ${elapsed}s · last activity ${idle}s ago`,
				`Activity: ${state.currentActivity || "Waiting for Claude Code"}`,
				`Tools: ${state.stats.toolCalls} calls / ${state.stats.toolResults} results · reported active tasks: ${state.backgroundTasks.length}`,
				...preview.split("\n").slice(-3),
			]);
		};

		const work = async () => {
			let result;
			try {
				if (!billingConfirmed) {
					const accepted = await ctx.ui.confirm("Claude Code subscription worker", [
						"The worker runs the installed Claude Code binary using your subscription login.",
						"Disable extra usage in your Claude account to stop at the allowance rather than incur additional charges.",
						"Claude Code uses auto mode: routine actions can run without prompting. Its hooks and permission checks remain active; it can change files and run commands in this project.",
						"Activity is retained in a private local log. Common secrets are redacted, but logs may contain project source and tool output.",
						`Working directory: ${ctx.cwd}`,
					].join("\n\n"), { signal: controller.signal });
					if (!accepted) throw new Error("Claude Code delegation cancelled.");
					billingConfirmed = true;
				}
				controller.signal.throwIfAborted();
				job.log = createActivityLog({ cwd: ctx.cwd, prompt, sessionId });
				if (!resume) remember(undefined, ctx.cwd);
				job.log.setStatus("Running");
				persistRun(job.log.snapshot());
				refresh();
				refreshTimer = setInterval(refresh, 1_000);
				refreshTimer.unref();
				result = await run({
					cwd: ctx.cwd, prompt, sessionId, signal: controller.signal,
					onPermission: async (request, permissionSignal) => {
						job.log.record({ type: "worker_permission", status: "waiting", toolName: request.tool_name, input: request.input, reason: request.decision_reason });
						refresh();
						try {
							const allowed = await ctx.ui.confirm(`Claude Code: allow ${safeText(request.tool_name)}?`,
								safeText([request.decision_reason, request.blocked_path, JSON.stringify(request.input, null, 2)].filter(Boolean).join("\n\n")), { signal: permissionSignal, timeout: 60_000 });
							job.log.record({ type: "worker_permission", status: permissionSignal.aborted ? "cancelled" : allowed ? "allowed" : "denied", toolName: request.tool_name });
							return allowed;
						} catch (error) {
							job.log.record({ type: "worker_permission", status: "error", toolName: request.tool_name, error: error.message });
							throw error;
						} finally { refresh(); }
					},
					onProgress: (event) => {
						job.log.record(event);
						if (event.type === "system" && event.subtype === "init" && event.session_id) {
							remember(event.session_id, ctx.cwd);
							persistRun(job.log.snapshot());
						}
						const delta = event.type === "stream_event" && event.event?.delta;
						if (delta?.type === "text_delta") preview = (preview + safeText(delta.text)).slice(-2_000);
						if (event.type === "assistant") {
							const blocks = event.message?.content || [];
							preview = safeText(blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n")).slice(-2_000) || preview;
						}
						refresh();
						onUpdate?.({ content: [{ type: "text", text: `${job.log.snapshot().currentActivity || "Claude Code is working…"}\n${preview}` }], details: { sessionId: lastSession?.sessionId, logPath: job.log.snapshot().logPath } });
					},
				});
				controller.signal.throwIfAborted();
				remember(result.sessionId, ctx.cwd);
				job.log.finish({ ...result, status: "Turn ended; completion unverified" });
				persistRun(job.log.snapshot());
				return { ...result, activity: lastRun };
			} catch (error) {
				if (job.log) {
					const outcome = { ...(error.outcome || result), status: controller.signal.aborted ? "Stopped" : "Failed", error: safeText(error.message) };
					try { job.log.finish(outcome); } catch (logError) {
						// Preserve a visible Pi report even if the retained file cannot be written.
						outcome.error += `\nActivity log write failed: ${safeText(logError.message)}`;
					}
					persistRun({ ...job.log.snapshot(), ...outcome, endedAt: Date.now() });
					pi.sendMessage({ customType: "cc-worker", content: formatRunReport(lastRun), details: { activity: lastRun }, display: true }, { triggerTurn: false });
				}
				throw error;
			} finally {
				clearInterval(refreshTimer);
				signal?.removeEventListener("abort", abort);
				ctx.ui.setStatus("cc-worker", undefined);
				ctx.ui.setWidget("cc-worker", undefined);
				if (active === job) active = undefined;
			}
		};
		job.done = work();
		return job.done;
	}

	for (const [name, resume] of [["cc", false], ["cc-followup", true]]) {
		pi.registerCommand(name, {
			description: resume ? "Resume the last Claude Code worker with a follow-up instruction" : "Delegate a task to subscription-authenticated Claude Code",
			async handler(args, ctx) {
				void start(args, resume, ctx).then((result) => {
					pi.sendMessage({ customType: "cc-worker", content: formatRunReport(result.activity, result.text), details: { activity: result.activity }, display: true }, { triggerTurn: false });
				}).catch((error) => ctx.ui.notify(safeText(error.message), "error"));
			},
		});
	}

	pi.registerCommand("cc-status", {
		description: "Show worker activity, elapsed time and retained terminal diagnostics",
		handler: async (_args, ctx) => {
			const state = active?.log?.snapshot() || lastRun;
			ctx.ui.notify(state ? formatRunReport(state, "") : `No worker activity recorded.${lastSession?.sessionId ? `\nSession: ${lastSession.sessionId}` : ""}`, "info");
		},
	});
	pi.registerCommand("cc-log", {
		description: "Inspect the latest worker's retained activity timeline; expand it for tool inputs/results",
		handler: async (_args, ctx) => {
			const state = active?.log?.snapshot() || lastRun;
			if (!state) return ctx.ui.notify("No worker activity recorded.", "info");
			try {
				const records = readActivityLog(state.logPath);
				pi.sendMessage({ customType: "cc-worker-log", content: formatActivityLog(state, records),
					details: { expandedText: formatActivityLog(state, records, { expanded: true }), logPath: state.logPath }, display: true }, { triggerTurn: false });
			} catch (error) { ctx.ui.notify(`Cannot read worker activity log: ${safeText(error.message)}`, "error"); }
		},
	});
	pi.registerCommand("cc-stop", {
		description: "Stop the active worker; preserve its session, activity log and existing file changes",
		handler: async (_args, ctx) => {
			if (!active) return ctx.ui.notify("No Claude Code worker is running.", "info");
			active.controller.abort();
			ctx.ui.notify("Stopping Claude Code. Existing file changes are not rolled back.", "warning");
		},
	});

	pi.registerTool({
		name: "claude_worker", label: "Claude Code worker",
		description: "Delegate one bounded task to Claude Code using the user's subscription and native auto permissions. Requires human consent. Returns turn output and diagnostics, not proof of task completion; activity is retained in a private local log. Do not concurrently modify the same files. Set resume=true to continue the saved session. Pi's coordinating model still uses its own provider. No worktree or automatic commit/push is created.",
		parameters,
		async execute(_id, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI || !await ctx.ui.confirm("Delegate task to Claude Code?", safeText(params.prompt), { signal })) throw new Error("Claude Code delegation was not approved.");
			const result = await start(params.prompt, params.resume === true, ctx, signal, onUpdate);
			return { content: [{ type: "text", text: formatRunReport(result.activity, result.text) }], details: { sessionId: result.sessionId, permissionDenials: result.permissionDenials, activity: result.activity } };
		},
	});

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	// The launching command/tool reports failures; cleanup only waits for it to settle.
	pi.on("session_tree", async (_event, ctx) => {
		if (active) { active.controller.abort(); await active.done.catch(() => {}); }
		restore(ctx);
	});
	pi.on("session_shutdown", async () => {
		if (active) { active.controller.abort(); await active.done.catch(() => {}); }
	});
}
