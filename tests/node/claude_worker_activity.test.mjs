import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import { createActivityLog, readActivityLog, formatRunReport, formatActivityLog, activityMessageText } from "../../extensions/claude-worker/lib/activity.mjs";

test("worker activity retains private, timestamped tool calls and results after the turn ends", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Inspect the tests" });
	log.record({ type: "assistant", message: { content: [
		{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "tests/auth.py" } },
	] } });
	log.record({ type: "user", message: { content: [
		{ type: "tool_result", tool_use_id: "read-1", content: "test contents", is_error: false },
	] } });
	log.finish({ status: "Turn ended; completion unverified", sessionId: "session-1", exitCode: 0, resultSubtype: "success", text: "Reviewed tests" });
	const snapshot = log.snapshot();
	assert.equal(snapshot.status, "Turn ended; completion unverified");
	assert.equal(snapshot.exitCode, 0);
	assert.equal(snapshot.resultSubtype, "success");
	assert.equal(snapshot.stats.toolCalls, 1);
	assert.equal(snapshot.stats.toolResults, 1);
	assert.match(snapshot.lastActivity, /Read/);
	const records = readFileSync(snapshot.logPath, "utf8").trim().split("\n").map(JSON.parse);
	assert.ok(records.every((record) => Number.isFinite(record.at)));
	assert.equal(records.find((record) => record.kind === "tool_call").details.input.file_path, "tests/auth.py");
	assert.equal(records.find((record) => record.kind === "tool_result").details.content, "test contents");
	assert.equal(records.at(-1).kind, "finished");
	if (process.platform !== "win32") assert.equal(statSync(snapshot.logPath).mode & 0o777, 0o600);
});

test("activity logs exclude authentication frames, redact common secrets and explicitly bound retained details", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Inspect", maxBytes: 2_000 });
	log.record({ type: "control_response", response: { account: { email: "private@example.com", token: "auth-secret" } } });
	log.record({ type: "assistant", message: { content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: {
		command: "API_KEY=command-secret curl example.invalid", env: { API_KEY: "env-secret", password: "password-secret" },
	} }] } });
	log.record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "Authorization: Bearer bearer-secret\u001b[31m", is_error: true }] } });
	for (let i = 0; i < 10; i++) log.append("note", "Large output", { text: "x".repeat(1_000) });
	log.finish({ status: "Failed", error: "Failed after output", exitCode: 1 });
	const text = readFileSync(log.snapshot().logPath, "utf8");
	for (const secret of ["private@example.com", "auth-secret", "command-secret", "env-secret", "password-secret", "bearer-secret"]) assert.ok(!text.includes(secret), secret);
	assert.ok(!text.includes("\\u001b"));
	assert.match(text, /redacted/);
	assert.match(text, /truncated/);
	assert.ok(log.snapshot().omittedEvents > 0);
	assert.equal(JSON.parse(text.trim().split("\n").at(-1)).kind, "finished", "terminal evidence is retained even after the activity cap");
	assert.ok(text.length < 5_000);
});

test("activity exposes current tools, approval waits and reported subagent activity without logging thinking", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Inspect" });
	log.record({ type: "assistant", message: { content: [
		{ type: "thinking", thinking: "private reasoning" },
		{ type: "tool_use", id: "test-1", name: "Bash", input: { command: "pytest" } },
	] } });
	assert.match(log.snapshot().currentActivity, /Bash/);
	log.record({ type: "worker_permission", status: "waiting", toolName: "Bash" });
	assert.equal(log.snapshot().status, "Awaiting approval");
	log.record({ type: "worker_permission", status: "allowed", toolName: "Bash" });
	assert.equal(log.snapshot().status, "Running");
	log.record({ type: "system", subtype: "task_started", task_id: "agent-1", task_type: "local_agent", description: "Review authentication" });
	log.record({ type: "system", subtype: "task_started", task_id: "ambient-1", ambient: true, description: "Internal watcher" });
	assert.equal(log.snapshot().backgroundTasks.length, 1);
	assert.equal(log.snapshot().backgroundTasks[0].type, "local_agent");
	log.record({ type: "system", subtype: "task_progress", task_id: "agent-1", summary: "Checking validation" });
	assert.match(log.snapshot().lastActivity, /Checking validation/);
	log.record({ type: "system", subtype: "task_notification", task_id: "agent-1", status: "failed", summary: "Review failed" });
	assert.equal(log.snapshot().backgroundTasks.length, 0);
	assert.equal(log.snapshot().taskOutcomes[0].taskType, "local_agent");
	const text = readFileSync(log.snapshot().logPath, "utf8");
	assert.match(text, /Review failed/);
	assert.ok(!text.includes("private reasoning"));
	assert.ok(!text.includes("Internal watcher"));
});

test("retained run reports and expandable log snapshots explain outcomes without declaring the work complete", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Inspect" });
	log.record({ type: "assistant", message: { content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "pytest tests/auth.py" } }] } });
	log.record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "3 failed", is_error: true }] } });
	log.finish({ status: "Turn ended; completion unverified", exitCode: 0, resultSubtype: "success", stopReason: "end_turn", text: "Needs further work" });
	const snapshot = log.snapshot();
	const report = formatRunReport(snapshot);
	assert.match(report, /completion unverified/);
	assert.match(report, /Exit code: 0/);
	assert.match(report, /Result subtype: success/);
	assert.match(report, /Stop reason: end_turn/);
	assert.match(report, /Last activity: Bash failed/);
	assert.ok(report.includes(snapshot.logPath));
	const retained = readActivityLog(snapshot.logPath);
	const compact = formatActivityLog(snapshot, retained, { expanded: false });
	const expanded = formatActivityLog(snapshot, retained, { expanded: true });
	assert.match(compact, /Bash requested/);
	assert.match(expanded, /pytest tests\/auth.py/);
	assert.match(expanded, /3 failed/);
	const limited = readActivityLog(snapshot.logPath, 1);
	assert.equal(limited.records.length, 1);
	assert.ok(limited.omittedRecords > 0);
	assert.match(formatActivityLog(snapshot, limited, { expanded: true }), /earlier records omitted/);
});

test("supervision waiting is visible with reason and continuation count, but cannot revive a finished log", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Repair" });
	log.record({ type: "worker_supervision", status: "Waiting for required background work", reason: "Awaiting review-1", continuations: 2 });
	assert.equal(log.snapshot().status, "Waiting for required background work");
	assert.equal(log.snapshot().reason, "Awaiting review-1");
	assert.equal(log.snapshot().continuations, 2);
	assert.match(formatRunReport(log.snapshot()), /Continuations: 2/);
	assert.match(readFileSync(log.snapshot().logPath, "utf8"), /worker_supervision/);
	log.finish({ status: "Needs input", disposition: "needs_input", report: { question: "Which target?" } });
	log.record({ type: "worker_supervision", status: "Running", continuations: 3 });
	assert.equal(log.snapshot().status, "Needs input");
	assert.match(formatRunReport(log.snapshot()), /Question: Which target\?/);
});

test("terminal task identities and evidence survive an empty active list and render recovery", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Repair authentication" });
	log.record({ type: "system", subtype: "task_started", task_id: "review-1", task_type: "local_agent", description: "Review repair" });
	log.record({ type: "system", subtype: "task_notification", task_id: "review-1", status: "stopped", summary: "Review stopped", output_file: "/tmp/review.txt" });
	log.record({ type: "system", subtype: "task_notification", task_id: "tests-1", status: "failed", summary: "Verification failed" });
	log.record({ type: "system", subtype: "task_notification", task_id: "read-1", status: "completed", summary: "Read complete" });
	log.record({ type: "system", subtype: "background_tasks_changed", tasks: [] });
	assert.equal(log.snapshot().backgroundTasks.length, 0);
	assert.deepEqual(log.snapshot().taskOutcomes.map(({ taskId, status }) => [taskId, status]), [["review-1", "stopped"], ["tests-1", "failed"], ["read-1", "completed"]]);
	const report = { task_id: "repair", disposition: "unfinished", outcomes: [{ requirement: "Fix authentication", status: "verified", evidence: ["tests/auth.py: 3 passed"] }], outstanding: ["Finish review"], unverified: ["Integration coverage"], question: "", background_task_ids: [] };
	log.finish({ status: "Unfinished/interrupted", disposition: "unfinished", sessionId: "session-1", reason: "Required task stopped", continuations: 2, report });
	const state = log.snapshot();
	assert.deepEqual(state.report, report);
	assert.equal(state.taskOutcomes.length, 3);
	const text = formatRunReport(state);
	for (const expected of ["Claude Code self-report", "tests/auth.py: 3 passed", "Finish review", "Integration coverage", "review-1", "stopped", "tests-1", "failed", "read-1", "completed", "Required task stopped", "Continuations: 2", "/cc-followup", "resume: true", "claude --resume session-1", "/trusted/project", "partial changes"]) assert.ok(text.includes(expected), expected);
});

test("activity uses canonical terminal state without requiring a later notification or snapshot", () => {
	for (const status of ["completed", "failed", "killed"]) {
		const log = createActivityLog({ cwd: "/trusted/project", prompt: "Verify" });
		log.record({ type: "system", subtype: "task_started", task_id: "check", is_backgrounded: true });
		log.record({ type: "system", subtype: "task_updated", task_id: "check", patch: { status, is_backgrounded: false } });
		log.finish({ status: "Unfinished/interrupted" });
		assert.equal(log.snapshot().backgroundTasks.length, 0, status);
		assert.equal(log.snapshot().taskOutcomes[0].status, status === "killed" ? "stopped" : status);
		assert.doesNotMatch(formatRunReport(log.snapshot()), /still reported active/);
	}
});

test("activity preserves the supervisor's stop barrier and authoritative active projection", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Verify" });
	log.record({ type: "system", subtype: "task_started", task_id: "check", is_backgrounded: true });
	log.record({ type: "system", subtype: "task_notification", task_id: "check", status: "stopped" });
	log.record({ type: "system", subtype: "task_notification", task_id: "check", status: "completed" });
	assert.equal(log.snapshot().taskOutcomes[0].status, "stopped");
	assert.deepEqual(log.snapshot().taskOutcomes[0].history.map((entry) => entry.status), ["stopped", "completed"]);
	log.observe({ taskOutcomes: [{ taskId: "reported-check", status: "running", isBackgrounded: true, description: "Required by task report" }] });
	assert.deepEqual(log.snapshot().backgroundTasks.map((task) => task.id), ["reported-check"]);
	log.record({ type: "system", subtype: "task_notification", task_id: "reported-check", status: "completed" });
	assert.equal(log.snapshot().taskOutcomes[0].status, "running", "raw events only log activity once authoritative checkpoints are available");
	log.observe({ taskOutcomes: [{ taskId: "reported-check", status: "completed" }] });
	assert.equal(log.snapshot().backgroundTasks.length, 0);
	assert.equal(log.snapshot().taskOutcomes.length, 1);
});

test("raw background snapshot logging does not mistake the previous checkpoint for the event", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Verify" });
	log.observe({ taskOutcomes: [] });
	log.record({ type: "system", subtype: "background_tasks_changed", tasks: [
		{ task_id: "check", task_type: "local_agent", description: "New check" },
		{ task_id: "watcher", ambient: true },
	] });
	const record = readActivityLog(log.snapshot().logPath).records.at(-1);
	assert.equal(record.summary, "1 reported active task(s)");
	assert.deepEqual(record.details, [{ id: "check", type: "local_agent", description: "New check" }]);
	assert.equal(log.snapshot().backgroundTasks.length, 0, "display projection awaits the authoritative checkpoint");
});

test("a prior finished report stays historical through an undefined startup report and a later success", () => {
	const prior = createActivityLog({ cwd: "/trusted/project", prompt: "Repair" });
	prior.finish({ sessionId: "session-1", taskId: "repair", status: "Finished", disposition: "finished", error: "obsolete error", errors: ["obsolete diagnostics"], report: { task_id: "repair", disposition: "finished", outcomes: [{ requirement: "Repair", status: "verified", evidence: ["prior tests: passed"] }], outstanding: [], unverified: ["prior integration gap"], question: "", background_task_ids: [] } });
	const resume = createActivityLog({ cwd: "/trusted/project", prompt: "Verify more", sessionId: "session-1", resumeState: prior.snapshot() });
	assert.equal(resume.snapshot().status, "Starting");
	assert.equal(resume.snapshot().disposition, undefined);
	assert.equal(resume.snapshot().report, undefined);
	resume.observe({ taskId: "repair", report: undefined });
	resume.finish({ status: "Finished", disposition: "finished", report: { task_id: "repair", disposition: "finished", outcomes: [{ requirement: "Repair", status: "verified", evidence: ["current tests: passed"] }], outstanding: [], unverified: [], question: "", background_task_ids: [] } });
	const state = resume.snapshot();
	assert.equal(state.report.outcomes[0].evidence[0], "current tests: passed");
	assert.equal(state.priorHandoffs[0].report.outcomes[0].evidence[0], "prior tests: passed");
	assert.equal(state.error, undefined);
	assert.equal(state.errors, undefined);
	const text = formatRunReport(state);
	assert.ok(!text.includes("obsolete"));
	assert.ok(text.indexOf("Prior handoff (not current completion evidence)") < text.indexOf("prior tests: passed"));
	const fresh = createActivityLog({ cwd: "/trusted/project", prompt: "New task" });
	fresh.finish({ status: "Failed", disposition: "unfinished" });
	assert.equal(fresh.snapshot().priorHandoffs, undefined);
	assert.equal(fresh.snapshot().report, undefined);
	assert.ok(!formatRunReport(fresh.snapshot()).includes(prior.snapshot().logPath));
});

test("the lightweight inspector expands a retained snapshot without filesystem access during rendering", () => {
	const message = { content: "Compact timeline", details: { expandedText: "Full input and result: 世界", logPath: "/not/read/during/render" } };
	assert.match(activityMessageText(message, { expanded: false }), /Compact timeline/);
	assert.equal(activityMessageText(message, { expanded: true }), "Full input and result: 世界");
	assert.match(activityMessageText({ content: "Legacy log" }, { expanded: true }), /Legacy log/);
});

test("a late cancelled approval cannot change a retained terminal outcome back to running", () => {
	const log = createActivityLog({ cwd: "/trusted/project", prompt: "Inspect" });
	log.finish({ status: "Stopped", exitCode: null, exitSignal: "SIGTERM" });
	const before = readFileSync(log.snapshot().logPath, "utf8");
	log.record({ type: "worker_permission", status: "cancelled", toolName: "Bash" });
	assert.equal(log.snapshot().status, "Stopped");
	assert.equal(readFileSync(log.snapshot().logPath, "utf8"), before);
});
