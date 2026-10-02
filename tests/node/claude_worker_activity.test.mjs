import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import { createActivityLog, readActivityLog, formatRunReport, formatActivityLog } from "../../extensions/claude-worker/lib/activity.mjs";

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
	log.record({ type: "system", subtype: "task_progress", task_id: "agent-1", summary: "Checking validation" });
	assert.match(log.snapshot().lastActivity, /Checking validation/);
	log.record({ type: "system", subtype: "task_notification", task_id: "agent-1", status: "failed", summary: "Review failed" });
	assert.equal(log.snapshot().backgroundTasks.length, 0);
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
