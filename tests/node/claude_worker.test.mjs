import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runClaude } from "../../extensions/claude-worker/lib/worker.mjs";

const SESSION_ID = "12345678-1234-1234-1234-123456789abc";

async function fixture(t, { auth = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }, initialAccount = { apiProvider: "firstParty", subscriptionType: "Claude Max" }, body = "" } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "pi-claude-worker-"));
	const script = join(cwd, "claude.mjs");
	const capture = join(cwd, "calls.jsonl");
	await writeFile(script, `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, env: process.env, cwd: process.cwd() }) + "\\n");
let userId;
const taskId = JSON.parse(args.includes("--json-schema") ? args[args.indexOf("--json-schema") + 1] : "{}").properties?.task_id?.const;
const completion = (disposition = "finished", extra = {}) => ({ task_id: taskId, disposition,
 outcomes: [{ requirement: "Requested inspection", status: "verified", evidence: ["artifact: inspection.txt"] }],
 outstanding: [], unverified: [], question: "", background_task_ids: [], ...extra });
const send = (event) => {
 if (event.type === "result" && !event.origin && !("user_message_uuid" in event) && !("user_message_uuids" in event)) event.user_message_uuid = userId;
 process.stdout.write(JSON.stringify(event) + "\\n");
};
if (args[0] === "auth") {
 console.log(${JSON.stringify(JSON.stringify(auth))});
 process.exit(0);
}
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type === "user") userId = event.uuid;
 appendFileSync(${JSON.stringify(join(cwd, "frames.jsonl"))}, line + "\\n");
 if (event.type === "control_request" && event.request.subtype === "initialize") {
  send({ type: "control_response", response: { subtype: "success", request_id: event.request_id, response: { account: ${JSON.stringify(initialAccount)} } } });
 }
});
${body || `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type === "user") {
  send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
  send({ type: "assistant", message: { content: [{ type: "text", text: "Worker answer" }] } });
  send({ type: "result", subtype: "success", is_error: false, session_id: "${SESSION_ID}", result: "Worker answer" });
 }
});
`}
`);
	// The fixture directory is owned by this test and retained for failure inspection.
	return { cwd, maxContinuations: 0, signal: AbortSignal.timeout(3_000), executable: process.execPath, prefixArgs: [script], frames: async () => (await readFile(join(cwd, "frames.jsonl"), "utf8")).trim().split("\n").map(JSON.parse), calls: async () => (await readFile(capture, "utf8")).trim().split("\n").map(JSON.parse) };
}

test("delegation runs the real CLI interface with subscription auth and no inherited API credentials", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t);
	const progress = [];
	const result = await runClaude({ ...fake, prompt: "Inspect only; $(do not execute this)", env: {
		...process.env, ANTHROPIC_API_KEY: "api-secret", ANTHROPIC_AUTH_TOKEN: "bearer-secret",
		ANTHROPIC_BASE_URL: "https://proxy.invalid", ANTHROPIC_PROFILE: "console",
		CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_OAUTH_TOKEN: "owned-by-claude",
	}, onProgress: (event) => progress.push(event) });
	assert.equal(result.sessionId, SESSION_ID);
	assert.equal(result.text, "Worker answer");
	const calls = await fake.calls();
	assert.deepEqual(calls[0].args.slice(0, 3), ["auth", "status", "--json"]);
	assert.equal(calls.length, 2);
	for (const call of calls) {
		assert.equal(call.cwd, fake.cwd);
		assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
		assert.equal(call.env.ANTHROPIC_AUTH_TOKEN, undefined);
		assert.equal(call.env.ANTHROPIC_BASE_URL, undefined);
		assert.equal(call.env.ANTHROPIC_PROFILE, undefined);
		assert.equal(call.env.CLAUDE_CODE_USE_BEDROCK, undefined);
		assert.equal(call.env.CLAUDE_CODE_OAUTH_TOKEN, "owned-by-claude");
	}
	assert.ok(!calls[1].args.includes("--bare"));
	assert.ok(!calls[1].args.includes("--dangerously-skip-permissions"));
	assert.equal(calls[1].args[calls[1].args.indexOf("--permission-mode") + 1], "auto");
	assert.ok(!calls[1].args.includes("bypassPermissions"));
	assert.ok(!calls[1].args.includes("Inspect only; $(do not execute this)"), "prompt travels through stdin, not shell or process arguments");
	assert.ok(progress.length > 0);
});

test("a successful turn without an explicit completion report stays unfinished", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t);
	const result = await runClaude({ ...fake, prompt: "Inspect", maxContinuations: 0 });
	assert.equal(result.disposition, "unfinished");
	assert.match(result.reason, /completion report/i);
	assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 1);
});

test("waiting preserves stdin and native background work until an attributable completion report", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 turns++;
 if (turns === 1) {
  send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
  send({ type: "system", subtype: "task_started", task_id: "verify", description: "Required verification" });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", result: "Waiting", structured_output: completion("waiting", { outstanding: ["Apply repair after verification"], background_task_ids: ["verify"] }) });
  setTimeout(() => {
   send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", summary: "Verification passed" });
   send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
   send({ type: "result", subtype: "success", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", result: "Verification notification" });
  }, 40);
 } else {
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", result: "Repair applied; verification passed", structured_output: completion() });
 }
});
` });
	const result = await runClaude({ ...fake, prompt: "Repair after verifying", maxContinuations: 2 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.continuations, 1);
	assert.equal(result.taskOutcomes[0].taskId, "verify");
	assert.equal(result.taskOutcomes[0].status, "completed");
	const users = (await fake.frames()).filter((event) => event.type === "user");
	assert.equal(users.length, 2);
	assert.notEqual(users[0].uuid, users[1].uuid);
});

test("API, logged-out, unknown-plan and mixed credentials fail before any model request", { timeout: 15_000 }, async (t) => {
	for (const auth of [
		{ loggedIn: true, authMethod: "api_key", apiKeySource: "apiKeyHelper" },
		{ loggedIn: false },
		{ loggedIn: true, authMethod: "claude.ai" },
		{ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max", apiKeySource: "apiKeyHelper" },
	]) {
		const fake = await fixture(t, { auth });
		await assert.rejects(runClaude({ ...fake, prompt: "Inspect" }), /subscription/i);
		assert.equal((await fake.calls()).length, 1, "never start a model request with ambiguous billing");
	}
});

test("Claude permission requests are forwarded to a person, not silently approved", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type === "user") send({ type: "control_request", request_id: "permission-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "git status" } } });
 if (event.type === "control_response") {
  send({ type: "result", subtype: "success", is_error: false, session_id: "${SESSION_ID}", result: JSON.stringify(event.response) });
 }
});
` });
	const permissions = [];
	const result = await runClaude({ ...fake, prompt: "Check status", onPermission: async (request) => {
		permissions.push(request);
		return false;
	} });
	assert.equal(permissions.length, 1);
	assert.equal(permissions[0].tool_name, "Bash");
	const response = JSON.parse(result.text);
	assert.equal(response.subtype, "success");
	assert.equal(response.request_id, "permission-1");
	assert.equal(response.response.behavior, "deny");
	assert.match(response.response.message, /denied/i);
});

test("stop terminates an uncooperative worker within a bounded grace period", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
process.on("SIGTERM", () => {});
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "assistant", message: { content: [{ type: "text", text: "Ready" }] } });
 setTimeout(() => process.exit(0), 4000);
});
` });
	const controller = new AbortController();
	const start = performance.now();
	await assert.rejects(runClaude({ ...fake, signal: controller.signal, prompt: "Wait", onProgress: () => controller.abort() }), /stopped/i);
	assert.ok(performance.now() - start < 2500, "SIGTERM must escalate instead of waiting forever");
});

test("follow-up resumes a saved session and streams partial text while preserving permission denials", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello 世界" } } });
 send({ type: "result", subtype: "success", is_error: false, session_id: "${SESSION_ID}", result: "Hello 世界", permission_denials: [{ tool_name: "Bash" }] });
});
` });
	const updates = [];
	const result = await runClaude({ ...fake, prompt: "Continue", sessionId: SESSION_ID, onProgress: (event) => updates.push(event) });
	assert.equal(result.text, "Hello 世界");
	assert.equal(result.permissionDenials.length, 1);
	assert.ok(updates.some((event) => event.type === "stream_event"));
	const args = (await fake.calls())[1].args;
	assert.equal(args[args.indexOf("--resume") + 1], SESSION_ID);
	assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
	assert.ok(args.includes("--include-partial-messages"));
});

test("initialization verifies effective subscription authentication before sending the task prompt", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t);
	await runClaude({ ...fake, prompt: "Inspect" });
	const frames = await fake.frames();
	assert.equal(frames[0].type, "control_request");
	assert.equal(frames[0].request.subtype, "initialize");
	assert.equal(frames[1].type, "user");
	const args = (await fake.calls())[1].args;
	assert.equal(args[args.indexOf("--permission-prompt-tool") + 1], "stdio");
	assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
	for (const initialAccount of [
		{ apiProvider: "bedrock" },
		{ apiProvider: "firstParty", apiKeySource: "apiKeyHelper", subscriptionType: "Claude Max" },
		{ apiProvider: "firstParty", tokenSource: "ANTHROPIC_AUTH_TOKEN" },
		{},
	]) {
		const rejected = await fixture(t, { initialAccount });
		await assert.rejects(runClaude({ ...rejected, prompt: "Do not send" }), /subscription/i);
		assert.ok(!(await rejected.frames()).some((event) => event.type === "user"));
	}
});

test("cancelled and duplicate permission requests never receive a late approval", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 const request = { type: "control_request", request_id: "cancel-me", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "touch forbidden" } } };
 send(request); send(request);
 setTimeout(() => send({ type: "control_cancel_request", request_id: "cancel-me" }), 10);
 setTimeout(() => send({ type: "result", subtype: "success", is_error: false, session_id: "${SESSION_ID}", result: "Done" }), 100);
});
` });
	let prompts = 0;
	let dismissed = false;
	await runClaude({ ...fake, prompt: "Inspect", onPermission: async (_request, signal) => {
		prompts++;
		signal.addEventListener("abort", () => { dismissed = true; }, { once: true });
		await new Promise((resolve) => setTimeout(resolve, 50));
		return true;
	} });
	assert.equal(prompts, 1);
	assert.equal(dismissed, true);
	assert.ok(!(await fake.frames()).some((event) => event.type === "control_response"));
});

test("terminal errors retain Claude's explanation and invalid results are not treated as success", { timeout: 15_000 }, async (t) => {
	for (const [result, message] of [
		[{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Subscription allowance exhausted"] }, /allowance exhausted/],
		[{ type: "result", subtype: "error_max_turns", is_error: false, errors: ["Turn limit reached"] }, /Turn limit/],
		[{ type: "result", subtype: "success", is_error: false, result: "Done" }, /session/i],
	]) {
		const fake = await fixture(t, { body: `input.on("line", (line) => { if (JSON.parse(line).type === "user") send(${JSON.stringify(result)}); });` });
		await assert.rejects(runClaude({ ...fake, prompt: "Inspect" }), message);
	}
	const malformed = await fixture(t, { body: `input.on("line", (line) => { if (JSON.parse(line).type === "user") process.stdout.write("not JSON\\n"); });` });
	await assert.rejects(runClaude({ ...malformed, prompt: "Inspect" }), /JSON/);
});

test("worker reports terminal diagnostics and does not finish on an unrelated background result", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("close", () => process.exit(0));
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 process.stderr.write("Worker warning\\n");
 send({ type: "result", subtype: "success", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", result: "Background notification only" });
 setTimeout(() => send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", user_message_uuid: event.uuid, result: "Requested turn ended", stop_reason: "end_turn", num_turns: 2 }), 30);
});
` });
	const events = [];
	const result = await runClaude({ ...fake, prompt: "Inspect", onProgress: (event) => events.push(event) });
	assert.equal(result.text, "Requested turn ended");
	assert.equal(result.exitCode, 0);
	assert.equal(result.resultSubtype, "success");
	assert.equal(result.stopReason, "end_turn");
	assert.equal(result.numTurns, 2);
	assert.match(events.find((event) => event.type === "worker_stderr").text, /Worker warning/);
	assert.equal(events.at(-1).type, "worker_exit");
	assert.ok((await fake.frames()).find((frame) => frame.type === "user").uuid);

	const failed = await fixture(t, { body: `input.on("line", (line) => { if (JSON.parse(line).type === "user") { send({ type: "result", subtype: "error_during_execution", errors: ["Task failed"], session_id: "${SESSION_ID}", stop_reason: "error" }); } });` });
	await assert.rejects(runClaude({ ...failed, prompt: "Inspect" }), (error) => {
		assert.equal(error.outcome.resultSubtype, "error_during_execution");
		assert.equal(error.outcome.exitCode, 0);
		assert.equal(error.outcome.stopReason, "error");
		assert.deepEqual(error.outcome.errors, ["Task failed"]);
		return true;
	});
});
