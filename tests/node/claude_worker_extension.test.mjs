import assert from "node:assert/strict";
import test from "node:test";

import { registerClaudeWorker } from "../../extensions/claude-worker/lib/extension.mjs";
import { createActivityLog } from "../../extensions/claude-worker/lib/activity.mjs";

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

test("delegation descriptions disclose supervision, attribution, pauses and finite bounds", () => {
	const h = harness(async () => {});
	assert.match(h.commands.get("cc").description, /supervis/i);
	assert.match(h.commands.get("cc-followup").description, /input|paused/i);
	for (const text of ["finished", "needs_input", "unfinished", "self-report", "8", "30", "resume=true"]) assert.ok(h.tools[0].description.includes(text), text);
	assert.ok(!h.tools[0].description.includes("Returns turn output"));
});

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

test("commands and tool resume share needs-input and finished dispositions in the saved scope", async () => {
	for (const route of ["command", "tool"]) {
		const calls = [];
		const h = harness(async (options) => {
			calls.push(options);
			const disposition = calls.length === 1 ? "needs_input" : "finished";
			return { sessionId: SESSION_ID, text: "Worker response", disposition, reason: disposition === "needs_input" ? "Missing target" : "Evidence supplied", continuations: 1,
				report: { task_id: "repair", disposition, outcomes: disposition === "finished" ? [{ requirement: "Repair target", status: "verified", evidence: ["target test: passed"] }] : [], outstanding: disposition === "needs_input" ? ["Repair target"] : [], unverified: [], question: disposition === "needs_input" ? "Which target should I repair?" : "", background_task_ids: [] } };
		});
		const execute = async (prompt, resume = false) => {
			if (route === "tool") return h.tools[0].execute("call", { prompt, resume }, undefined, undefined, h.ctx);
			await h.commands.get(resume ? "cc-followup" : "cc").handler(prompt, h.ctx);
			await new Promise(setImmediate);
			const { message } = h.messages.at(-1);
			return { content: [{ type: "text", text: message.content }], details: message.details };
		};
		const paused = await execute("Repair the target");
		assert.equal(paused.details.disposition, "needs_input", route);
		assert.match(paused.content[0].text, /Needs input/);
		assert.match(paused.content[0].text, /Which target should I repair\?/);
		assert.match(paused.content[0].text, /\/cc-followup/);
		assert.match(paused.content[0].text, /resume: true/);
		const finished = await execute("Repair target A", true);
		assert.equal(calls[1].sessionId, SESSION_ID);
		assert.equal(calls[1].cwd, "/trusted/project");
		assert.equal(finished.details.disposition, "finished", route);
		assert.match(finished.content[0].text, /Finished/);
		assert.match(finished.content[0].text, /Claude Code self-report/);
		assert.match(finished.content[0].text, /target test: passed/);
		assert.equal(finished.details.report.task_id, "repair");
		assert.equal(finished.details.continuations, 1);
		assert.ok(h.messages.every(({ options }) => options?.triggerTurn !== true));
	}
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
	assert.match(h.notifications.at(-1)[0], /Unfinished\/interrupted \(Stopped\)/);
	assert.match(h.notifications.at(-1)[0], /partial changes/);
	assert.equal(h.messages.at(-1).message.details.disposition, "unfinished");
	assert.ok(h.messages.some(({ message }) => message.content.includes("Stopped")), "stopped workers leave a durable terminal report");
	assert.ok(!h.messages.some(({ message }) => message.content.includes("Turn ended; completion unverified")), "cancelled work is not reported as a successful turn");
});

test("shutdown during an approval wait leaves an unfinished handoff and cannot grant late approval", async () => {
	let answer;
	let allowed;
	const h = harness(async (options) => {
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		options.onProgress({ type: "worker_supervision", status: "Waiting", reason: "Awaiting required review", continuations: 2 });
		allowed = await options.onPermission({ tool_name: "Bash", input: { command: "test" } }, options.signal);
		return { sessionId: SESSION_ID, disposition: "finished", text: "Too late" };
	});
	h.ctx.ui.confirm = async (title) => title.includes("allow Bash") ? new Promise((resolve) => { answer = resolve; }) : true;
	await h.commands.get("cc").handler("Repair", h.ctx);
	await new Promise(setImmediate);
	assert.ok(h.widgets.some(([, lines]) => lines?.join("\n").includes("Awaiting required review")));
	assert.ok(h.widgets.some(([, lines]) => lines?.join("\n").includes("continuations: 2")));
	const shutdown = h.events.get("session_shutdown")({}, h.ctx);
	answer(true);
	await shutdown;
	assert.equal(allowed, false);
	const terminal = h.messages.at(-1).message;
	assert.equal(terminal.details.disposition, "unfinished");
	assert.match(terminal.content, /Unfinished\/interrupted \(Stopped\)/);
	assert.match(terminal.content, /partial changes/);
	assert.match(terminal.content, /claude --resume/);
	assert.ok(!terminal.content.includes("Claude Code: Finished"));
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
	assert.equal(result.details.disposition, "unfinished", "a tool fixture without a reported disposition fails closed too");
	const permission = h.confirmations.find(([title]) => title.includes("allow Bash"));
	assert.equal(permission[2].timeout, 60_000);
	assert.ok(!permission[1].includes("\u001b"));
	assert.match(permission[1], /Needs approval/);
});

test("tool output keeps its display budget while retained task metadata stays sanitized", async () => {
	const h = harness(async () => ({ sessionId: SESSION_ID, disposition: "unfinished", reason: "API_KEY=reason-secret", text: "x".repeat(20_000) + "Final artifact reference", permissionDenials: [{ tool_name: "Edit", reason: "API_KEY=permission-secret" }], taskOutcomes: [{ taskId: "task-1", status: "unknown", summary: "API_KEY=task-secret" }], report: { task_id: "repair", disposition: "unfinished", outcomes: [], outstanding: ["API_KEY=outstanding-secret"], unverified: [], question: "", background_task_ids: [] } }));
	const result = await h.tools[0].execute("call", { prompt: "Inspect" }, undefined, undefined, h.ctx);
	assert.match(result.content[0].text, /Final artifact reference/);
	assert.equal(result.details.disposition, "unfinished");
	assert.match(result.content[0].text, /task-1: unknown/);
	for (const secret of ["reason-secret", "permission-secret", "task-secret", "outstanding-secret"]) assert.ok(!JSON.stringify(result).includes(secret));
	assert.match(result.details.activity.text, /\[truncated\]/);
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
	assert.match(terminal.content, /Unfinished\/interrupted/);
	assert.equal(terminal.details.disposition, "unfinished");
	assert.match(terminal.content, /No terminal task disposition reported/);
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
	assert.match(restored.notifications.at(-1)[0], /Unfinished\/interrupted/);
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

test("execution errors retain sanitized task context and resume an outcome-only session", async () => {
	for (const route of ["command", "tool"]) {
		let calls = 0;
		const h = harness(async (options) => {
			if (++calls > 1) {
				assert.equal(options.sessionId, SESSION_ID);
				assert.equal(options.cwd, "/trusted/project");
				return { sessionId: SESSION_ID, disposition: "needs_input", report: { question: "Which verification?", outcomes: [], outstanding: [], unverified: [], background_task_ids: [] } };
			}
			const error = new Error("API_KEY=error-secret");
			error.outcome = { sessionId: SESSION_ID, disposition: "unfinished", reason: "Execution failed", continuations: 3, exitCode: 1, taskOutcomes: [{ taskId: "tests-1", status: "failed", summary: "API_KEY=task-secret" }], report: { task_id: "repair", disposition: "unfinished", outcomes: [{ requirement: "Fix", status: "unverified", evidence: ["API_KEY=evidence-secret"] }], outstanding: ["Finish tests"], unverified: ["Verification"], question: "", background_task_ids: [] } };
			throw error;
		});
		if (route === "tool") await assert.rejects(h.tools[0].execute("call", { prompt: "Fix" }, undefined, undefined, h.ctx), (error) => {
			assert.equal(error.outcome.disposition, "unfinished");
			assert.equal(error.outcome.sessionId, SESSION_ID);
			assert.equal(error.outcome.report.task_id, "repair");
			assert.ok(!JSON.stringify(error.outcome).includes("evidence-secret"));
			return true;
		});
		else {
			await h.commands.get("cc").handler("Fix", h.ctx);
			await new Promise(setImmediate);
		}
		const terminal = h.messages.at(-1).message;
		assert.match(terminal.content, /Unfinished\/interrupted \(Failed\)/);
		assert.equal(terminal.details.disposition, "unfinished");
		assert.match(terminal.content, /Finish tests/);
		assert.match(terminal.content, /tests-1: failed/);
		assert.match(terminal.content, /partial changes/);
		assert.match(terminal.content, /\/cc-followup/);
		const retained = JSON.stringify(h.entries) + JSON.stringify(h.messages) + JSON.stringify(h.notifications);
		for (const secret of ["error-secret", "task-secret", "evidence-secret"]) assert.ok(!retained.includes(secret));
		const restored = harness(async (options) => {
			assert.equal(options.sessionId, SESSION_ID);
			assert.equal(options.cwd, "/trusted/project");
			return { sessionId: SESSION_ID, disposition: "unfinished", reason: "No verification yet" };
		});
		restored.ctx.sessionManager.getBranch = () => h.entries;
		await restored.events.get("session_start")({}, restored.ctx);
		await restored.commands.get("cc-followup").handler("Continue verification", restored.ctx);
		await new Promise(setImmediate);
		assert.equal(restored.messages.at(-1).message.details.sessionId, SESSION_ID);
	}
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

test("restoring an unfinished observation never invents a terminal timestamp or successful completion", async () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Inspect" });
	log.setStatus("Running");
	const h = harness(async () => { throw new Error("must not launch"); });
	h.entries.push({ type: "custom", customType: "cc-worker-run", data: log.snapshot() });
	await h.events.get("session_start")({}, h.ctx);
	await h.commands.get("cc-status").handler("", h.ctx);
	assert.match(h.notifications.at(-1)[0], /terminal outcome unknown/);
	assert.match(h.notifications.at(-1)[0], /Ended: not recorded/);
	await h.commands.get("cc-log").handler("", h.ctx);
	assert.match(h.messages.at(-1).message.content, /terminal outcome unknown/);
});

