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
	assert.equal(h.messages[0].message.content.includes("Done"), true);
	assert.notEqual(h.messages[0].options?.triggerTurn, true, "direct commands never bill Pi for an automatic follow-up");
	assert.equal(h.entries.at(-1).data.sessionId, SESSION_ID);
	await h.commands.get("cc-followup").handler("Now fix it", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls[1].sessionId, SESSION_ID);
	assert.ok(h.widgets.some(([, lines]) => lines?.join("\n").includes("Working")));
});
