import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runClaude } from "../../extensions/claude-worker/lib/worker.mjs";

const SESSION_ID = "12345678-1234-1234-1234-123456789abc";

async function fixture(t, { auth = { loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }, body = "" } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "pi-claude-worker-"));
	const script = join(cwd, "claude.mjs");
	const capture = join(cwd, "calls.jsonl");
	await writeFile(script, `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, env: process.env, cwd: process.cwd() }) + "\\n");
const send = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
if (args[0] === "auth") {
 console.log(${JSON.stringify(JSON.stringify(auth))});
 process.exit(0);
}
${body || `
const input = createInterface({ input: process.stdin });
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
	return { cwd, signal: AbortSignal.timeout(3_000), executable: process.execPath, prefixArgs: [script], calls: async () => (await readFile(capture, "utf8")).trim().split("\n").map(JSON.parse) };
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
	assert.ok(!calls[1].args.includes("Inspect only; $(do not execute this)"), "prompt travels through stdin, not shell or process arguments");
	assert.ok(progress.length > 0);
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
const input = createInterface({ input: process.stdin });
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
