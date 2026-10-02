import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createActivityLog({ cwd, prompt, sessionId }) {
	const directory = mkdtempSync(join(tmpdir(), "pi-cc-worker-"));
	const logPath = join(directory, "activity.jsonl");
	writeFileSync(logPath, "", { flag: "wx", mode: 0o600 });
	const startedAt = Date.now();
	let state = { cwd, prompt, sessionId, logPath, startedAt, status: "Starting", stats: { toolCalls: 0, toolResults: 0, toolErrors: 0 } };
	const tools = new Map();
	const append = (kind, summary, details) => {
		appendFileSync(logPath, JSON.stringify({ at: Date.now(), kind, summary, details }) + "\n");
	};
	append("started", "Worker requested", { cwd, prompt, sessionId });
	return {
		append,
		record(event) {
			if (event.type === "system" && event.subtype === "init") state.sessionId = event.session_id;
			for (const block of event.message?.content || []) {
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
			state = { ...state, ...outcome, endedAt: Date.now() };
			append("finished", state.status, state);
		},
		snapshot() { return structuredClone(state); },
	};
}
