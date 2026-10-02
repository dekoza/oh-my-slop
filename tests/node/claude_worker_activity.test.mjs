import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import { createActivityLog } from "../../extensions/claude-worker/lib/activity.mjs";

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
