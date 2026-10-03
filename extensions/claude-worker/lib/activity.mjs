import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const MAX_TEXT = 16_000;
const MAX_REPORT_BYTES = 50 * 1024;
const MAX_REPORT_LINES = 2_000;

function boundReport(text) {
	const full = safeText(text);
	if (Buffer.byteLength(full) <= MAX_REPORT_BYTES && full.split("\n").length <= MAX_REPORT_LINES) return full;
	const directory = mkdtempSync(join(tmpdir(), "pi-cc-report-"));
	const path = join(directory, "report.txt");
	writeFileSync(path, full, { flag: "wx", mode: 0o600 });
	const notice = `\n[Output truncated to 50 KiB / 2000 lines. Full report: ${path}]`;
	const prefix = Buffer.from(full.split("\n").slice(0, MAX_REPORT_LINES - 1).join("\n"));
	let end = Math.min(prefix.length, MAX_REPORT_BYTES - Buffer.byteLength(notice));
	// Back up to the start of a split UTF-8 code point instead of emitting replacement text.
	while (end < prefix.length && (prefix[end] & 0xc0) === 0x80) end--;
	return prefix.subarray(0, end).toString("utf8") + notice;
}

export function safeText(value) {
	return stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
		.replace(/\bBearer\s+[\w.+/=:-]+/gi, "Bearer [redacted]")
		.replace(/\bsk-(?:ant-)?[\w-]{12,}/g, "[redacted]")
		.replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi, "$1[redacted]");
}

function scrub(value, key = "") {
	if (/token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key/i.test(key)) return "[redacted]";
	if (typeof value === "string") {
		const text = safeText(value);
		return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT) + "\n[truncated]";
	}
	if (Array.isArray(value)) return value.map((item) => scrub(item));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrub(item, name)]));
	return value;
}

export function createActivityLog({ cwd, prompt, sessionId, resumeState, maxBytes = 8 * 1024 * 1024 }) {
	const directory = mkdtempSync(join(tmpdir(), "pi-cc-worker-"));
	const logPath = join(directory, "activity.jsonl");
	writeFileSync(logPath, "", { flag: "wx", mode: 0o600 });
	const startedAt = Date.now();
	let state = { cwd, prompt: scrub(prompt), sessionId, logPath, startedAt, status: "Starting", omittedEvents: 0, stats: { toolCalls: 0, toolResults: 0, toolErrors: 0 } };
	const tools = new Map();
	const pendingTools = new Map();
	const tasks = new Map();
	const taskOutcomes = new Map((resumeState?.taskOutcomes || []).map((task) => [task.taskId, scrub(task)]));
	if (resumeState) {
		state.taskId = resumeState.taskId || resumeState.report?.task_id;
		state.requiredOutcomes = scrub(resumeState.requiredOutcomes || [...(resumeState.report?.outcomes || []), ...(resumeState.omittedOutcomes || [])]);
	}
	let bytes = 0;
	const activity = (summary) => {
		state.lastActivity = safeText(summary);
		state.lastActivityAt = Date.now();
	};
	const append = (kind, summary, details) => {
		const text = JSON.stringify({ at: Date.now(), kind, summary: safeText(summary), details: scrub(details) }) + "\n";
		if (kind !== "finished" && bytes + Buffer.byteLength(text) > maxBytes) {
			if (state.omittedEvents++ === 0) appendFileSync(logPath, JSON.stringify({ at: Date.now(), kind: "truncated", summary: "Activity log cap reached; subsequent details omitted. Terminal outcome will still be retained." }) + "\n");
			return;
		}
		bytes += Buffer.byteLength(text);
		appendFileSync(logPath, text);
	};
	append("started", "Worker requested", { cwd, prompt, sessionId });
	return {
		append,
		setStatus(status) { state.status = status; },
		record(event) {
			if (state.endedAt) return;
			if (event.type === "system" && event.subtype === "init") {
				state.sessionId = event.session_id;
				append("initialized", "Claude Code initialized", { sessionId: event.session_id });
			}
			if (event.type === "worker_supervision") {
				state.status = safeText(event.status);
				state.reason = safeText(event.reason || "");
				state.continuations = event.continuations;
				activity(state.reason || state.status);
				append("worker_supervision", state.lastActivity, event);
			}
			if (event.type === "worker_permission") {
				state.status = event.status === "waiting" ? "Awaiting approval" : "Running";
				activity(`${event.toolName}: permission ${event.status}`);
				append("permission", state.lastActivity, event);
			}
			if (event.type === "worker_stderr") {
				activity("Claude Code stderr");
				append("stderr", state.lastActivity, { text: event.text });
			}
			if (event.type === "tool_progress") {
				activity(`${event.tool_name || "Tool"} running (${event.elapsed_time_seconds ?? "?"}s)`);
				append("tool_progress", state.lastActivity, { id: event.tool_use_id, name: event.tool_name, elapsedSeconds: event.elapsed_time_seconds });
			}
			if (event.type === "system" && event.subtype?.startsWith("task_") && !event.ambient) {
				if (event.subtype === "task_started") tasks.set(event.task_id, { id: event.task_id, type: event.task_type, description: scrub(event.description) });
				if (event.subtype === "task_notification") {
					taskOutcomes.set(event.task_id, scrub({ taskId: event.task_id, taskType: event.task_type || tasks.get(event.task_id)?.type, description: event.description || tasks.get(event.task_id)?.description, status: event.status || "unknown", summary: event.summary, outputFile: event.output_file }));
					tasks.delete(event.task_id);
				}
				activity(event.summary || event.description || `${event.task_id}: ${event.status || event.subtype}`);
				append(event.subtype, state.lastActivity, { taskId: event.task_id, taskType: event.task_type, status: event.status, summary: event.summary, description: event.description, outputFile: event.output_file });
			}
			if (event.type === "system" && event.subtype === "background_tasks_changed") {
				tasks.clear();
				for (const task of event.tasks || []) if (!task.ambient) tasks.set(task.task_id, { id: task.task_id, type: task.task_type, description: scrub(task.description) });
				append("background_tasks", `${tasks.size} reported active task(s)`, [...tasks.values()]);
			}
			if (event.type === "system" && ["hook_started", "hook_progress", "hook_response", "permission_denied"].includes(event.subtype)) {
				activity(`${event.subtype}: ${event.hook_name || event.tool_name || "Claude Code"}`);
				append(event.subtype, state.lastActivity, { hookName: event.hook_name, hookEvent: event.hook_event, toolName: event.tool_name, stdout: event.stdout, stderr: event.stderr, exitCode: event.exit_code });
			}
			if (event.type === "rate_limit_event") append("rate_limit", "Claude Code rate-limit update", event.rate_limit_info);
			if (event.type === "result") append("turn_result", `Claude turn result: ${event.subtype} (not a completion check)`, {
				subtype: event.subtype, stopReason: event.stop_reason, terminalReason: event.terminal_reason,
				origin: event.origin, errors: event.errors, result: event.result, permissionDenials: event.permission_denials,
				queuedTurns: event.queued_turn_count,
			});
			for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
				if (block.type === "tool_use") {
					if (tools.has(block.id)) continue;
					tools.set(block.id, block.name);
					pendingTools.set(block.id, block.name);
					state.stats.toolCalls++;
					activity(`${block.name} requested`);
					append("tool_call", state.lastActivity, { id: block.id, name: block.name, input: block.input });
				}
				if (block.type === "tool_result") {
					const name = tools.get(block.tool_use_id) || block.tool_use_id;
					state.stats.toolResults++;
					if (block.is_error) state.stats.toolErrors++;
					pendingTools.delete(block.tool_use_id);
					activity(`${name} ${block.is_error ? "failed" : "returned"}`);
					append("tool_result", state.lastActivity, { id: block.tool_use_id, name, content: block.content, isError: block.is_error === true });
				}
				if (block.type === "text" && event.type === "assistant") append("assistant", "Claude response", { text: block.text, parentToolUseId: event.parent_tool_use_id });
			}
			state.currentActivity = [...pendingTools.values()].join(", ") || state.lastActivity || "Waiting for Claude Code";
		},
		finish(outcome) {
			const fields = Object.fromEntries(Object.entries(outcome).filter(([, value]) => value !== undefined));
			for (const task of outcome.taskOutcomes || []) taskOutcomes.set(task.taskId || task.task_id || task.id, scrub(task));
			state = { ...state, ...scrub(fields), endedAt: Date.now(), backgroundTasks: [...tasks.values()], pendingTools: [...pendingTools.values()] };
			state.taskOutcomes = [...taskOutcomes.values()];
			append("finished", state.status, state);
		},
		snapshot() { return structuredClone({ ...state, backgroundTasks: [...tasks.values()], taskOutcomes: [...taskOutcomes.values()], pendingTools: [...pendingTools.values()] }); },
	};
}

export function activityMessageText(message, { expanded }) {
	if (expanded && message.details?.expandedText) return message.details.expandedText;
	return safeText(message.content) + "\n[Expand this message to inspect tool inputs and results.]";
}

export function readActivityLog(logPath, limit = 200) {
	const records = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	return { records: records.slice(-limit), omittedRecords: Math.max(0, records.length - limit) };
}

export function formatRunReport(state, text = state.text || "") {
	const duration = Math.max(0, Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1_000));
	const output = safeText(text);
	return boundReport([
		`Claude Code: ${state.status}`,
		`Session: ${state.sessionId || "not assigned"} · Elapsed: ${duration}s`,
		`Started: ${new Date(state.startedAt).toISOString()} · Ended: ${state.endedAt ? new Date(state.endedAt).toISOString() : "not recorded"}`,
		`Exit code: ${state.exitCode ?? "not reported"} · Signal: ${state.exitSignal || "none reported"}`,
		`Result subtype: ${state.resultSubtype || "not reported"} · Stop reason: ${state.stopReason || "not reported"}`,
		state.terminalReason ? `Terminal reason: ${JSON.stringify(state.terminalReason)}` : "",
		`Reported tools: ${state.stats.toolCalls} calls, ${state.stats.toolResults} results, ${state.stats.toolErrors} errors`,
		`Last activity: ${state.lastActivity || "No activity reported"}`,
		state.reason ? `Reason: ${safeText(state.reason)}` : "",
		state.continuations !== undefined ? `Continuations: ${state.continuations}` : "",
		...(state.taskOutcomes || []).map((task) => `Task ${safeText(task.taskId || task.task_id || task.id || "unknown")}: ${safeText(task.status || "unknown")} · ${safeText(task.summary || task.description || "No details reported")}${task.outputFile || task.output_file ? ` · ${safeText(task.outputFile || task.output_file)}` : ""}`),
		...(state.taskOutcomes || []).flatMap((task) => (task.history?.length > 1 ? task.history : []).map((entry) => `Task history ${safeText(task.taskId || task.task_id || task.id || "unknown")}: ${safeText(entry.status || "unknown")} · ${safeText(entry.summary || "No details reported")}${entry.outputFile ? ` · ${safeText(entry.outputFile)}` : ""}`)),
		state.report ? "Claude Code self-report (not independent Pi certification):" : "",
		...(state.report?.outcomes || []).map((outcome) => `- ${safeText(outcome.requirement)}: ${safeText(outcome.status)} · Evidence: ${(outcome.evidence || []).map(safeText).join("; ") || "none reported"}`),
		...(state.report?.resolved_failures || []).map((resolution) => `Resolved failure ${safeText(resolution.task_id)}: replacement ${safeText(resolution.replacement_task_id)} · Claude Code evidence: ${(resolution.evidence || []).map(safeText).join("; ")}`),
		...(state.omittedOutcomes || []).map((outcome) => `Omitted required outcome: ${safeText(outcome.requirement)} · Last reported: ${safeText(outcome.status)} · Prior evidence: ${(outcome.evidence || []).map(safeText).join("; ") || "none reported"}`),
		state.report?.question ? `Question: ${safeText(state.report.question)}` : "",
		state.report?.outstanding?.length ? `Outstanding: ${state.report.outstanding.map(safeText).join("; ")}` : "",
		state.report?.unverified?.length ? `Unverified: ${state.report.unverified.map(safeText).join("; ")}` : "",
		state.report?.background_task_ids?.length ? `Required background tasks: ${state.report.background_task_ids.map(safeText).join(", ")}` : "",
		state.disposition === "unfinished" ? "Warning: interruption may leave partial changes; inspect existing work before resuming. Nothing is rolled back." : "",
		["needs_input", "unfinished"].includes(state.disposition) ? (state.sessionId
			? `Resume in the same working directory (${safeText(state.cwd)}): /cc-followup <information or recovery instruction>, claude_worker with resume: true, or claude --resume ${safeText(state.sessionId)}.`
			: `No resumable session was recorded. Inspect partial work and the activity log in ${safeText(state.cwd)} before starting /cc <recovery task>.`) : "",
		state.error ? `Error: ${state.error}` : "",
		state.errors?.length ? `Claude errors: ${state.errors.join("; ")}` : "",
		state.permissionDenials?.length ? `Warning: ${state.permissionDenials.length} tool permission(s) were denied; work may be incomplete.` : "",
		state.backgroundTasks?.length ? `Warning: ${state.backgroundTasks.length} task(s) still reported active when the worker ended.` : "",
		state.pendingTools?.length ? `Warning: tool results were not reported for ${state.pendingTools.join(", ")}.` : "",
		state.omittedEvents ? `Activity cap reached: ${state.omittedEvents} event details omitted.` : "",
		`Activity log: ${state.logPath}`,
		output ? `\n${output}` : "",
	].filter(Boolean).join("\n"));
}

export function formatActivityLog(state, retained, { expanded = false } = {}) {
	const records = expanded ? retained.records : retained.records.slice(-12);
	const omitted = retained.omittedRecords + retained.records.length - records.length;
	const lines = [formatRunReport(state, ""), "", "Recorded activity (UTC):"];
	if (omitted) lines.push(`[${omitted} earlier records omitted from this view; the file retains them.]`);
	for (const record of records) {
		lines.push(`${new Date(record.at).toISOString().slice(11, 19)} ${record.kind}: ${safeText(record.summary)}`);
		if (expanded && record.details !== undefined) lines.push(safeText(JSON.stringify(record.details, null, 2)));
	}
	const text = lines.join("\n");
	return text.length <= 64_000 ? text : text.slice(0, 64_000) + `\n[Inspector view truncated; read ${state.logPath} for the complete recorded trace.]`;
}
