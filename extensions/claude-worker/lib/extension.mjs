import { stripVTControlCharacters } from "node:util";
import { runClaude } from "./worker.mjs";

const STATE_ENTRY = "cc-worker-session";
const DISPLAY_LIMIT = 64_000;

function safeText(text) {
	return stripVTControlCharacters(String(text)).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

function report(result) {
	const text = safeText(result.text);
	const truncated = text.length > DISPLAY_LIMIT;
	return [
		`Claude Code session: ${result.sessionId}`,
		text.slice(0, DISPLAY_LIMIT),
		truncated ? "[Output truncated. Open the Claude Code session to read the full result.]" : "",
		result.permissionDenials.length ? `Warning: ${result.permissionDenials.length} tool permission(s) were denied; work may be incomplete.` : "",
	].filter(Boolean).join("\n\n");
}

export function registerClaudeWorker(pi, parameters, { run = runClaude } = {}) {
	let active;
	let lastSession;
	let lastStatus = "No worker started.";
	let billingConfirmed = false;

	function remember(sessionId, cwd) {
		lastSession = { sessionId, cwd };
		pi.appendEntry(STATE_ENTRY, lastSession);
	}

	function restore(ctx) {
		lastSession = ctx.sessionManager.getBranch()
			.filter((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY)
			.at(-1)?.data;
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
		const job = { controller, done: undefined };
		active = job;
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) controller.abort();
		let preview = "";
		const work = async () => {
			try {
				if (!billingConfirmed) {
					const accepted = await ctx.ui.confirm("Claude Code subscription worker", [
						"The worker runs the installed Claude Code binary using your subscription login.",
						"Disable extra usage in your Claude account to stop at the allowance rather than incur additional charges.",
						"Claude Code uses auto mode: routine actions can run without prompting. Its hooks and permission checks remain active; it can change files and run commands in this project.",
						`Working directory: ${ctx.cwd}`,
					].join("\n\n"), { signal: controller.signal });
					if (!accepted) throw new Error("Claude Code delegation cancelled.");
					billingConfirmed = true;
				}
				controller.signal.throwIfAborted();
				if (!resume) remember(undefined, ctx.cwd);
				lastStatus = "Running";
				ctx.ui.setStatus("cc-worker", "CC: running");
				const result = await run({
					cwd: ctx.cwd, prompt, sessionId, signal: controller.signal,
					onPermission: (request, permissionSignal) => ctx.ui.confirm(
						`Claude Code: allow ${safeText(request.tool_name)}?`,
						safeText([request.decision_reason, request.blocked_path, JSON.stringify(request.input, null, 2)].filter(Boolean).join("\n\n")), { signal: permissionSignal, timeout: 60_000 },
					),
					onProgress: (event) => {
						if (event.type === "system" && event.subtype === "init" && event.session_id) remember(event.session_id, ctx.cwd);
						const delta = event.type === "stream_event" && event.event?.delta;
						if (delta?.type === "text_delta") preview = (preview + safeText(delta.text)).slice(-2_000);
						if (event.type === "assistant") {
							const blocks = event.message?.content || [];
							preview = safeText(blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n")).slice(-2_000) || preview;
						}
						ctx.ui.setWidget("cc-worker", ["Claude Code worker", ...preview.split("\n").slice(-4)]);
						onUpdate?.({ content: [{ type: "text", text: preview || "Claude Code is working…" }], details: { sessionId: lastSession?.sessionId } });
					},
				});
				remember(result.sessionId, ctx.cwd);
				lastStatus = result.permissionDenials.length ? "Finished with permission denials" : "Finished";
				return result;
			} catch (error) {
				lastStatus = controller.signal.aborted ? "Stopped" : `Failed: ${safeText(error.message)}`;
				throw error;
			} finally {
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
				// Direct commands display the result without starting a Pi model turn.
				void start(args, resume, ctx).then((result) => {
					pi.sendMessage({ customType: "cc-worker", content: report(result), display: true }, { triggerTurn: false });
				}).catch((error) => ctx.ui.notify(safeText(error.message), "error"));
			},
		});
	}

	pi.registerCommand("cc-status", {
		description: "Show Claude Code worker status and the saved session ID",
		handler: async (_args, ctx) => ctx.ui.notify([
			active ? "Claude Code worker: running" : `Claude Code worker: ${lastStatus}`,
			lastSession?.sessionId ? `Session: ${lastSession.sessionId}` : "",
		].filter(Boolean).join("\n"), "info"),
	});
	pi.registerCommand("cc-stop", {
		description: "Stop the active Claude Code worker; preserve its session and existing file changes",
		handler: async (_args, ctx) => {
			if (!active) return ctx.ui.notify("No Claude Code worker is running.", "info");
			active.controller.abort();
			ctx.ui.notify("Stopping Claude Code. Existing file changes are not rolled back.", "warning");
		},
	});

	pi.registerTool({
		name: "claude_worker", label: "Claude Code worker",
		description: "Delegate one bounded task to the real Claude Code CLI using the user's subscription. Requires human consent; keeps Claude Code tools, hooks and permission checks. Runs in the current project: do not concurrently modify the same files. Set resume=true to continue the saved worker session. Pi's coordinating model still uses its own provider. No worktree or automatic commit/push is created by this integration.",
		parameters,
		async execute(_id, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI || !await ctx.ui.confirm("Delegate task to Claude Code?", safeText(params.prompt), { signal })) {
				throw new Error("Claude Code delegation was not approved.");
			}
			const result = await start(params.prompt, params.resume === true, ctx, signal, onUpdate);
			return { content: [{ type: "text", text: report(result) }], details: { sessionId: result.sessionId, permissionDenials: result.permissionDenials } };
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
