import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";

import { registerClaudeWorker } from "../../extensions/claude-worker/lib/extension.mjs";
import { createActivityLog } from "../../extensions/claude-worker/lib/activity.mjs";
import { createTaskSupervision } from "../../extensions/claude-worker/lib/supervision.mjs";

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

test("both follow-up routes restore the cumulative task ledger and checkpoint it before new results", async () => {
	for (const route of ["command", "tool"]) {
		const required = { requirementId: "saved-integration-identity", requirement: "Required integration verification", status: "unverified", evidence: [] };
		const prior = { sessionId: SESSION_ID, cwd: "/trusted/project", taskId: "approved-task", requiredOutcomes: [required], disposition: "needs_input",
			report: { task_id: "approved-task", disposition: "needs_input", outcomes: [], outstanding: [], unverified: [], question: "Which directory?", background_task_ids: [] }, endedAt: 1 };
		const h = harness(async (options) => {
			assert.equal(options.sessionId, SESSION_ID);
			assert.equal(options.resumeState.taskId, "approved-task");
			assert.deepEqual(options.resumeState.requiredOutcomes, [required]);
			const checkpoint = h.entries.filter((entry) => entry.customType === "cc-worker-run").at(-1).data;
			assert.deepEqual(checkpoint.requiredOutcomes, [required], "an interrupted follow-up cannot lose requirements before its first report");
			assert.equal(checkpoint.taskId, "approved-task");
			return { ...prior, disposition: "unfinished", omittedOutcomes: [required] };
		});
		h.entries.push({ type: "custom", customType: "cc-worker-session", data: { sessionId: SESSION_ID, cwd: h.ctx.cwd } }, { type: "custom", customType: "cc-worker-run", data: prior });
		await h.events.get("session_start")({}, h.ctx);
		if (route === "tool") await h.tools[0].execute("resume", { prompt: "Use artifacts/", resume: true }, undefined, undefined, h.ctx);
		else {
			await h.commands.get("cc-followup").handler("Use artifacts/", h.ctx);
			await new Promise(setImmediate);
			assert.ok(!h.notifications.some(([text]) => /undefined|AssertionError/.test(text)));
		}
		assert.equal(h.entries.at(-1).data.disposition, "unfinished");
		assert.deepEqual(h.entries.at(-1).data.requiredOutcomes, [required]);
	}
});

test("both follow-up routes let an attributed fresh-ID rerun replace work stopped at the pause", async () => {
	for (const route of ["command", "tool"]) {
		const report = (disposition, extra) => ({ task_id: "approved-task", disposition, outcomes: [{ requirement: "Verify", status: "verified", evidence: ["fresh-check passed"] }], outstanding: [], unverified: [], question: "", background_task_ids: [], ...extra });
		const calls = [];
		const h = harness(async (options) => {
			calls.push(options);
			if (calls.length === 1) return { sessionId: SESSION_ID, cwd: options.cwd, taskId: "approved-task", disposition: "needs_input", reason: "Which fixture set?",
				report: report("needs_input", { question: "Which fixture set?", background_task_ids: ["old-check"] }),
				taskOutcomes: [{ taskId: "old-check", status: "stopped", terminalStatus: "stopped", terminalSequence: 1, history: [{ status: "stopped", summary: "Stopped during EOF cleanup" }] }] };
			// The real supervisor consumes the state each route restores from the saved branch.
			const supervisor = createTaskSupervision(options.resumeState.taskId, options.resumeState);
			supervisor.record({ type: "system", subtype: "task_started", task_id: "fresh-check" });
			supervisor.record({ type: "system", subtype: "task_notification", task_id: "fresh-check", status: "completed", uuid: "fresh" });
			const decision = supervisor.assess(report("finished", { resolved_failures: [{ task_id: "old-check", replacement_task_id: "fresh-check", evidence: ["fresh-check passed"] }] }));
			return { sessionId: SESSION_ID, cwd: options.cwd, ...supervisor.snapshot(), disposition: decision.disposition || "unfinished", reason: decision.reason };
		});
		const execute = async (prompt, resume = false) => {
			if (route === "tool") return (await h.tools[0].execute("call", { prompt, resume }, undefined, undefined, h.ctx)).details;
			await h.commands.get(resume ? "cc-followup" : "cc").handler(prompt, h.ctx);
			await new Promise(setImmediate);
			return h.messages.at(-1).message.details;
		};
		assert.equal((await execute("Verify with fixtures")).disposition, "needs_input", route);
		const recovered = await execute("Use fixture set A", true);
		assert.equal(recovered.disposition, "finished", route);
		assert.equal(recovered.taskOutcomes.find((task) => task.taskId === "old-check").status, "stopped", route);
	}
});

test("early failed follow-ups retain prior handoffs through restoration and later recovery on both routes", async () => {
	for (const route of ["command", "tool"]) {
		const priorLog = createActivityLog({ cwd: "/trusted/project", prompt: "Repair" });
		const required = { requirementId: "saved-raw-requirement-identity", requirement: "Repair authentication", status: "verified", evidence: ["unit tests: passed", "API_KEY=evidence-secret"] };
		const report = { task_id: "repair", disposition: "needs_input", outcomes: [{ requirement: "Repair authentication", status: "verified", evidence: ["unit tests: passed", "API_KEY=evidence-secret"] }], outstanding: ["Finish review"], unverified: ["Integration coverage"], question: "Which target?", background_task_ids: ["review-1"], resolved_failures: [{ task_id: "old-review", replacement_task_id: "review-1", evidence: ["replacement started"] }] };
		priorLog.finish({ sessionId: SESSION_ID, taskId: "repair", status: "Needs input", disposition: "needs_input", report, requiredOutcomes: [required], omittedOutcomes: [{ requirement: "Deploy", status: "unverified", evidence: ["deployment not attempted"] }], taskOutcomes: [{ taskId: "review-1", status: "failed", summary: "review evidence", outputFile: "/tmp/review.txt" }], text: "Prior artifact: /tmp/repair.txt", errors: ["obsolete error"] });
		let entries = [{ type: "custom", customType: "cc-worker-session", data: { sessionId: SESSION_ID, cwd: "/trusted/project" } }, { type: "custom", customType: "cc-worker-run", data: priorLog.snapshot() }];
		const logPaths = [priorLog.snapshot().logPath];
		for (let attempt = 0; attempt < 3; attempt++) {
			const h = harness(async (options) => {
				if (!options.sessionId) throw new Error("fresh authentication failed");
				const startup = h.entries.filter((entry) => entry.customType === "cc-worker-run").at(-1).data;
				assert.equal(startup.priorHandoffs[0].report.question, "Which target?");
				assert.equal(startup.report, undefined, "a prior self-report is not a current report");
				assert.equal(startup.requiredOutcomes[0].requirementId, "saved-raw-requirement-identity");
				if (attempt === 2) options.onState({ taskId: "repair", report: undefined });
				if (attempt < 2) throw new Error(`subscription authentication failed ${attempt}`);
				return { sessionId: SESSION_ID, taskId: "repair", disposition: "finished", report: { task_id: "repair", disposition: "finished", outcomes: [{ requirement: "Repair authentication", status: "verified", evidence: ["current integration tests: passed"] }], outstanding: [], unverified: [], question: "", background_task_ids: [] } };
			});
			h.entries.push(...structuredClone(entries));
			await h.events.get("session_start")({}, h.ctx);
			if (route === "tool") {
				const run = h.tools[0].execute("resume", { prompt: "Continue", resume: true }, undefined, undefined, h.ctx);
				if (attempt < 2) await assert.rejects(run, (error) => {
					assert.match(error.message, /subscription authentication failed/);
					assert.equal(error.outcome.priorHandoffs[0].report.question, "Which target?");
					return true;
				});
				else await run;
			} else {
				await h.commands.get("cc-followup").handler("Continue", h.ctx);
				await new Promise(setImmediate);
			}
			const state = h.entries.filter((entry) => entry.customType === "cc-worker-run").at(-1).data;
			assert.equal(state.disposition, attempt < 2 ? "unfinished" : "finished", route);
			assert.deepEqual(state.priorHandoffs.map((handoff) => handoff.logPath), logPaths);
			assert.equal(state.requiredOutcomes[0].requirementId, "saved-raw-requirement-identity");
			assert.equal(state.priorHandoffs[0].requiredOutcomes[0].requirementId, "saved-raw-requirement-identity");
			assert.equal(state.priorHandoffs[0].report.outcomes[0].evidence[1], "API_KEY=[redacted]");
			const retained = JSON.stringify(state);
			for (const evidence of ["Finish review", "Integration coverage", "Which target?", "replacement started", "deployment not attempted", "/tmp/review.txt", "/tmp/repair.txt"]) assert.ok(retained.includes(evidence), evidence);
			assert.ok(!retained.includes("evidence-secret"));
			assert.ok(!retained.includes("obsolete error"));
			if (attempt === 2) {
				assert.equal(state.error, undefined);
				assert.equal(state.errors, undefined);
				assert.equal(state.report.outcomes[0].evidence[0], "current integration tests: passed");
			}
			await h.commands.get("cc-status").handler("", h.ctx);
			const text = h.notifications.at(-1)[0];
			assert.match(text, /Prior handoff \(not current completion evidence\)/);
			for (const evidence of ["Finish review", "Integration coverage", "Which target?", "unit tests: passed", ...logPaths]) assert.ok(text.includes(evidence), evidence);
			await h.commands.get("cc-log").handler("", h.ctx);
			assert.match(h.messages.at(-1).message.details.expandedText, /Finish review/);
			logPaths.push(state.logPath);
			entries = h.entries;
			if (attempt === 2) {
				if (route === "tool") await assert.rejects(h.tools[0].execute("fresh", { prompt: "New task" }, undefined, undefined, h.ctx), /fresh authentication failed/);
				else {
					await h.commands.get("cc").handler("New task", h.ctx);
					await new Promise(setImmediate);
				}
				const fresh = h.entries.filter((entry) => entry.customType === "cc-worker-run").at(-1).data;
				assert.equal(fresh.priorHandoffs, undefined);
				assert.equal(fresh.taskId, undefined);
				assert.equal(fresh.report, undefined);
				assert.deepEqual(fresh.taskOutcomes, []);
				assert.ok(!h.messages.at(-1).message.content.includes("Finish review"));
			}
		}
	}
});

test("interrupted restoration retains newly assessed requirements before terminal settlement", async () => {
	let options;
	let settle;
	const h = harness((request) => {
		options = request;
		request.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		return new Promise((resolve) => { settle = resolve; });
	});
	await h.commands.get("cc").handler("Verify integration", h.ctx);
	await new Promise(setImmediate);
	const required = { requirement: "Required integration verification", status: "unverified", evidence: [] };
	try {
		options.onState?.({ sessionId: SESSION_ID, taskId: "approved-task", requiredOutcomes: [required], notificationDeliveries: ["uuid:prior-check"], resultDeliveries: ["prior-result-fingerprint"], taskOutcomes: [{ taskId: "verify", status: "running", history: [] }],
			report: { task_id: "approved-task", disposition: "waiting", outcomes: [required], outstanding: [required.requirement], unverified: [required.requirement], question: "", background_task_ids: ["verify"] } });
		const checkpoint = h.entries.filter((entry) => entry.customType === "cc-worker-run").at(-1).data;
		assert.equal(checkpoint.taskId, "approved-task");
		assert.deepEqual(checkpoint.requiredOutcomes, [required]);
		assert.deepEqual(checkpoint.notificationDeliveries, ["uuid:prior-check"]);
		assert.deepEqual(checkpoint.resultDeliveries, ["prior-result-fingerprint"]);
		assert.equal(checkpoint.endedAt, undefined, "this is an observation checkpoint, not completion");
		const restored = harness(async (request) => {
			assert.equal(request.resumeState.taskId, "approved-task");
			assert.deepEqual(request.resumeState.requiredOutcomes, [required]);
			assert.deepEqual(request.resumeState.resultDeliveries, ["prior-result-fingerprint"]);
			return { sessionId: SESSION_ID, disposition: "unfinished" };
		});
		restored.entries.push(...structuredClone(h.entries));
		await restored.events.get("session_start")({}, restored.ctx);
		await restored.tools[0].execute("recovery", { prompt: "Continue", resume: true }, undefined, undefined, restored.ctx);
	} finally {
		settle({ sessionId: SESSION_ID, disposition: "unfinished" });
		await new Promise(setImmediate);
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

test("pre-navigation cancellation retains the interrupted handoff only on the launching branch", async () => {
	const calls = [];
	const h = harness((options) => {
		calls.push(options);
		if (calls.length > 1) return { sessionId: SESSION_ID, disposition: "needs_input", report: { question: "Which target?" } };
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }));
	});
	await h.commands.get("cc").handler("Repair", h.ctx);
	await new Promise(setImmediate);
	assert.equal(typeof h.events.get("session_before_tree"), "function", "cleanup must run before Pi changes branches");
	await h.events.get("session_before_tree")({}, h.ctx);
	assert.equal(h.entries.at(-1).data.disposition, "unfinished");
	assert.ok(h.entries.at(-1).data.endedAt);
	assert.match(h.messages.at(-1).message.content, /Unfinished\/interrupted/);
	const launchingBranch = [...h.entries];
	h.entries.length = 0;
	await h.events.get("session_tree")({}, h.ctx);
	await h.commands.get("cc-followup").handler("No old task here", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls.length, 1);
	h.entries.push(...launchingBranch);
	await h.events.get("session_tree")({}, h.ctx);
	await h.commands.get("cc-followup").handler("Recover original task", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls[1].sessionId, SESSION_ID);
});

test("post-navigation cancellation cannot import the abandoned worker into the selected branch", async () => {
	const calls = [];
	let lateProgress;
	const h = harness((options) => {
		calls.push(options);
		lateProgress = options.onProgress;
		options.onProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
		return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
			// Exercise a late frame while cancellation settles after Pi has moved its leaf.
			lateProgress({ type: "system", subtype: "init", session_id: SESSION_ID });
			reject(new Error("Stopped"));
		}, { once: true }));
	});
	await h.commands.get("cc").handler("Repair on the old branch", h.ctx);
	await new Promise(setImmediate);
	const abandoned = [...h.entries];
	const messagesBefore = h.messages.length;
	// Pi emits session_tree AFTER selecting the new leaf; this ancestor has no worker state.
	h.entries.length = 0;
	await h.events.get("session_tree")({}, h.ctx);
	assert.deepEqual(h.entries, [], "old cancellation state must not be appended to the selected branch");
	assert.equal(h.messages.length, messagesBefore, "old terminal messages must not enter the new branch");
	assert.ok(abandoned.some((entry) => entry.data.sessionId === SESSION_ID), "old session evidence remains on its own branch");
	await h.commands.get("cc-followup").handler("Continue", h.ctx);
	await new Promise(setImmediate);
	assert.equal(calls.length, 1, "the newly selected branch cannot resume the abandoned session");
	assert.match(h.notifications.at(-1)[0], /No saved/);
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

test("assembled tool reports are byte and line bounded with a private complete evidence artifact", async () => {
	for (const evidence of ["😀".repeat(3_750), "evidence line\n".repeat(350)]) {
		const h = harness(async () => ({ sessionId: SESSION_ID, disposition: "finished", text: "Final reply", report: {
			task_id: "repair", disposition: "finished", outcomes: Array.from({ length: 8 }, (_, i) => ({ requirement: `Outcome ${i}`, status: "verified", evidence: [evidence + `LAST-EVIDENCE-${i}`, "API_KEY=artifact-secret"] })), outstanding: [], unverified: [], question: "", background_task_ids: [],
		} }));
		const result = await h.tools[0].execute("call", { prompt: "Repair" }, undefined, undefined, h.ctx);
		const text = result.content[0].text;
		assert.ok(Buffer.byteLength(text) <= 50 * 1024, `model-facing bytes: ${Buffer.byteLength(text)}`);
		assert.ok(text.split("\n").length <= 2_000, "the assembled report must respect Pi's line budget too");
		assert.match(text, /Output truncated/);
		assert.ok(!text.includes("\ufffd"), "UTF-8 truncation must not split a code point");
		const path = text.match(/Full report: ([^\n]+)\]/)?.[1];
		assert.ok(path, "the model needs a concrete complete-output pointer");
		const retained = readFileSync(path, "utf8");
		for (const expected of ["Outcome 0", "Outcome 7", "LAST-EVIDENCE-7", "Final reply"]) assert.ok(retained.includes(expected), expected);
		assert.ok(!retained.includes("artifact-secret"));
		assert.match(retained, /redacted/);
		if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
	}
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

