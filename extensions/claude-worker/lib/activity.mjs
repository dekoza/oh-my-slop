import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const MAX_TEXT = 16_000;

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

export function createActivityLog({ cwd, prompt, sessionId, maxBytes = 8 * 1024 * 1024 }) {
	const directory = mkdtempSync(join(tmpdir(), "pi-cc-worker-"));
	const logPath = join(directory, "activity.jsonl");
	writeFileSync(logPath, "", { flag: "wx", mode: 0o600 });
	const startedAt = Date.now();
	let state = { cwd, prompt: scrub(prompt), sessionId, logPath, startedAt, status: "Starting", omittedEvents: 0, stats: { toolCalls: 0, toolResults: 0, toolErrors: 0 } };
	const tools = new Map();
	let bytes = 0;
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
		record(event) {
			if (event.type === "system" && event.subtype === "init") state.sessionId = event.session_id;
			for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
				if (block.type === "tool_use") {
					tools.set(block.id, block.name);
					state.stats.toolCalls++;
					state.lastActivity = `${block.name} requested`;
					append("tool_call", state.lastActivity, { id: block.id, name: block.name, input: block.input });
				}
				if (block.type === "tool_result") {
					const name = tools.get(block.tool_use_id) || block.tool_use_id;
					state.stats.toolResults++;
					if (block.is_error) state.stats.toolErrors++;
					state.lastActivity = `${name} ${block.is_error ? "failed" : "returned"}`;
					append("tool_result", state.lastActivity, { id: block.tool_use_id, name, content: block.content, isError: block.is_error === true });
				}
			}
		},
		finish(outcome) {
			state = { ...state, ...scrub(outcome), endedAt: Date.now() };
			append("finished", state.status, state);
		},
		snapshot() { return structuredClone(state); },
	};
}
