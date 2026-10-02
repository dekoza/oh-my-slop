import assert from "node:assert/strict";
import test from "node:test";

import { registerClaudeWorker } from "../../extensions/claude-worker/lib/extension.mjs";

const SESSION_ID = "12345678-1234-1234-1234-123456789abc";

function harness(run) {
	const commands = new Map();
	const events = new Map();
	const tools = [];
	const entries = [];
	const messages = [];
	const notifications = [];
	const confirmations = [];
	const widgets = [];
	const pi = {
		registerCommand: (name, command) => commands.set(name, command),
		registerTool: (tool) => tools.push(tool),
		on: (name, handler) => events.set(name, handler),
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
		sendMessage: (message, options) => messages.push({ message, options }),
	};
	const ctx = {
		cwd: "/trusted/project", hasUI: true, isProjectTrusted: () => true,
		sessionManager: { getBranch: () => entries },
		ui: {
			confirm: async (...args) => { confirmations.push(args); return true; },
			notify: (...args) => notifications.push(args),
			setStatus() {}, setWidget: (...args) => widgets.push(args),
		},
	};
	registerClaudeWorker(pi, { type: "object" }, { run });
	return { commands, events, tools, entries, messages, notifications, confirmations, widgets, ctx };
}

test("slash commands start a worker without a Pi model turn and resume its saved session", async () => {
	const calls = [];
	const h = harness(async (options) => {
		calls.push(options);
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		options.onProgress({ type: "stream_event", event: { delta: { type: "text_delta", text: "Working" } } });
		return { sessionId: SESSION_ID, text: "Done", permissionDenials: [] };
	});
	assert.equal(calls.length, 0, "registration must not spawn a process");
	await h.commands.get("cc").handler("Inspect the project", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls[0].prompt, "Inspect the project");
	assert.equal(calls[0].cwd, h.ctx.cwd);
	assert.ok(h.confirmations[0][1].includes("auto mode"), "first-run consent explains automatic actions");
	assert.equal(h.messages[0].message.content.includes("Done"), true);
	assert.notEqual(h.messages[0].options?.triggerTurn, true, "direct commands never bill Pi for an automatic follow-up");
	assert.equal(h.entries.at(-1).data.sessionId, SESSION_ID);
	await h.commands.get("cc-followup").handler("Now fix it", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls[1].sessionId, SESSION_ID);
	assert.ok(h.widgets.some(([, lines]) => lines?.join("\n").includes("Working")));
});

test("model delegation requires consent and headless or untrusted sessions never launch", async () => {
	let calls = 0;
	const h = harness(async () => { calls++; });
	h.ctx.ui.confirm = async () => false;
	await assert.rejects(h.tools[0].execute("call", { prompt: "Edit files" }, undefined, undefined, h.ctx), /not approved/);
	assert.equal(calls, 0);
	h.ctx.hasUI = false;
	await h.commands.get("cc").handler("Edit files", h.ctx);
	await new Promise(setImmediate);
	assert.match(h.notifications.at(-1)[0], /requires a UI/);
	assert.equal(calls, 0);
	h.ctx.hasUI = true;
	h.ctx.isProjectTrusted = () => false;
	await h.commands.get("cc").handler("Edit files", h.ctx);
	await new Promise(setImmediate);
	assert.match(h.notifications.at(-1)[0], /Trust this project/);
	assert.equal(calls, 0);
});

test("only one worker runs and stop/shutdown preserve the resumable session", async () => {
	let calls = 0;
	const h = harness((options) => {
		calls++;
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }));
	});
	await h.commands.get("cc").handler("First task", h.ctx);
	await new Promise(setImmediate);
	await h.commands.get("cc").handler("Collision", h.ctx);
	await new Promise(setImmediate);
	assert.match(h.notifications.at(-1)[0], /already running/);
	assert.equal(calls, 1);
	await h.commands.get("cc-stop").handler("", h.ctx);
	await h.events.get("session_shutdown")({}, h.ctx);
	assert.equal(h.entries.at(-1).data.sessionId, SESSION_ID);
	await h.commands.get("cc-status").handler("", h.ctx);
	assert.match(h.notifications.at(-1)[0], /Stopped/);
	assert.ok(h.messages.some(({ message }) => message.content.includes("Stopped")), "stopped workers leave a durable terminal report");
	assert.ok(!h.messages.some(({ message }) => message.content.includes("Turn ended; completion unverified")), "cancelled work is not reported as a successful turn");
});

test("restoration follows the active Pi branch and never resumes a session from another directory", async () => {
	const calls = [];
	const h = harness(async (options) => {
		calls.push(options);
		return { sessionId: SESSION_ID, text: "Done", permissionDenials: [] };
	});
	h.entries.push({ type: "custom", customType: "cc-worker-session", data: { sessionId: SESSION_ID, cwd: h.ctx.cwd } });
	await h.events.get("session_start")({}, h.ctx);
	await h.commands.get("cc-followup").handler("Continue", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls[0].sessionId, SESSION_ID);
	h.ctx.cwd = "/other/project";
	await h.commands.get("cc-followup").handler("Continue", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls.length, 1);
	assert.match(h.notifications.at(-1)[0], /No saved/);
	h.entries.length = 0;
	h.ctx.cwd = "/trusted/project";
	await h.events.get("session_tree")({}, h.ctx);
	await h.commands.get("cc-followup").handler("Continue", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls.length, 1);
});

test("model delegation returns worker output and permission dialogs are bounded and terminal-safe", async () => {
	const h = harness(async (options) => {
		assert.equal(await options.onPermission({ tool_name: "Bash", decision_reason: "Needs approval", input: { command: "echo \\u001b[31munsafe" } }, options.signal), true);
		return { sessionId: SESSION_ID, text: "Done\u001b[31m\u0007", permissionDenials: [{ tool_name: "Edit" }] };
	});
	const result = await h.tools[0].execute("call", { prompt: "Inspect" }, undefined, undefined, h.ctx);
	assert.match(result.content[0].text, /Done/);
	assert.ok(!result.content[0].text.includes("\u001b"));
	assert.ok(!result.content[0].text.includes("\u0007"));
	assert.match(result.content[0].text, /work may be incomplete/);
	const permission = h.confirmations.find(([title]) => title.includes("allow Bash"));
	assert.equal(permission[2].timeout, 60_000);
	assert.ok(!permission[1].includes("\u001b"));
	assert.match(permission[1], /Needs approval/);
});

test("cc-log retains tool evidence and terminal reports survive restoring the Pi session", async () => {
	const h = harness(async (options) => {
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		options.onProgress({ type: "assistant", message: { content: [{ type: "tool_use", id: "test-1", name: "Bash", input: { command: "pytest tests/auth.py" } }] } });
		options.onProgress({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "test-1", content: "3 failed", is_error: true }] } });
		return { sessionId: SESSION_ID, text: "I stopped after the failing tests", permissionDenials: [], exitCode: 0, resultSubtype: "success", stopReason: "end_turn" };
	});
	await h.commands.get("cc").handler("Fix authentication", h.ctx);
	await new Promise(setImmediate);
	const terminal = h.messages.at(-1).message;
	assert.match(terminal.content, /Turn ended; completion unverified/);
	assert.match(terminal.content, /Last activity: Bash failed/);
	assert.match(terminal.content, /Exit code: 0/);
	assert.match(terminal.content, /Result subtype: success/);
	await h.commands.get("cc-log").handler("", h.ctx);
	const view = h.messages.at(-1);
	assert.equal(view.message.customType, "cc-worker-log");
	assert.match(view.message.details.expandedText, /pytest tests\/auth.py/);
	assert.match(view.message.details.expandedText, /3 failed/);
	assert.notEqual(view.options?.triggerTurn, true);
	const restored = harness(async () => { throw new Error("must not launch"); });
	restored.ctx.sessionManager.getBranch = () => h.entries;
	await restored.events.get("session_start")({}, restored.ctx);
	await restored.commands.get("cc-status").handler("", restored.ctx);
	assert.match(restored.notifications.at(-1)[0], /completion unverified/);
	assert.match(restored.notifications.at(-1)[0], /Exit code: 0/);
	await restored.commands.get("cc-log").handler("", restored.ctx);
	assert.match(restored.messages.at(-1).message.details.expandedText, /3 failed/);
});

test("cc failures keep diagnostic reports rather than only disappearing into notifications", async () => {
	const h = harness(async (options) => {
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		const error = new Error("Claude stopped after a tool failure");
		error.outcome = { exitCode: 13, resultSubtype: "error_during_execution", stopReason: "error", errors: ["Tool failure"], permissionDenials: [] };
		throw error;
	});
	await h.commands.get("cc").handler("Fix authentication", h.ctx);
	await new Promise(setImmediate);
	assert.match(h.messages.at(-1).message.content, /Failed/);
	assert.match(h.messages.at(-1).message.content, /Exit code: 13/);
	assert.match(h.messages.at(-1).message.content, /Claude stopped after a tool failure/);
	await h.commands.get("cc-log").handler("", h.ctx);
	assert.match(h.messages.at(-1).message.details.expandedText, /error_during_execution/);
});

test("failure metadata retained in Pi does not reintroduce redacted credentials", async () => {
	const h = harness(async () => {
		const error = new Error("Authorization: Bearer panic-secret");
		error.outcome = { exitCode: 1, stderr: "Authorization: Bearer panic-secret", errors: ["API_KEY=another-secret"], permissionDenials: [] };
		throw error;
	});
	await h.commands.get("cc").handler("Inspect", h.ctx);
	await new Promise(setImmediate);
	const retained = JSON.stringify(h.entries) + JSON.stringify(h.messages) + JSON.stringify(h.notifications);
	assert.ok(!retained.includes("panic-secret"));
	assert.ok(!retained.includes("another-secret"));
	assert.match(retained, /redacted/);
	await assert.rejects(h.tools[0].execute("call", { prompt: "Inspect" }, undefined, undefined, h.ctx), (error) => {
		assert.ok(!error.message.includes("panic-secret"));
		return true;
	});
});

