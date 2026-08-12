import test from "node:test";
import assert from "node:assert/strict";

import {
	FactoryWorkerError,
	buildWorkerPrompt,
	createHerdrRuntime,
	parseFactoryResult,
} from "../../extensions/software-factory/lib/herdr.mjs";

function response(payload) {
	return { code: 0, stdout: JSON.stringify(payload), stderr: "" };
}

test("buildWorkerPrompt invokes implement and keeps integration authority outside the worker", () => {
	const prompt = buildWorkerPrompt({
		repo: "minder/example",
		ticket: { index: 42, title: "Deliver checkout" },
		profile: { kind: "pi" },
	});

	assert.match(prompt, /^\/skill:implement /);
	assert.match(prompt, /ticket #42/);
	assert.match(prompt, /Do not merge, push, close, or relabel/);
	assert.match(prompt, /FACTORY_RESULT/);
});

test("parseFactoryResult reads the last machine-readable worker result", () => {
	const transcript = [
		'FACTORY_RESULT {"status":"blocked","reason":"old"}',
		"more work",
		'FACTORY_RESULT {"status":"success","summary":"done","tests":["node --test"],"review":"passed"}',
	].join("\n");

	assert.deepEqual(parseFactoryResult(transcript), {
		status: "success",
		summary: "done",
		tests: ["node --test"],
		review: "passed",
	});
});

test("parseFactoryResult rejects success without test and review evidence", () => {
	assert.throws(
		() => parseFactoryResult('FACTORY_RESULT {"status":"success","summary":"done"}'),
		FactoryWorkerError,
	);
});

test("Herdr runtime creates one background workspace and a named pi worker tab", async () => {
	const calls = [];
	const exec = async (command, args) => {
		calls.push([command, args]);
		if (args[0] === "workspace" && args[1] === "create") {
			return response({ result: { workspace: { workspace_id: "w4" } } });
		}
		if (args[0] === "tab" && args[1] === "create") {
			return response({ result: {
				tab: { tab_id: "w4:t2" },
				root_pane: { pane_id: "w4:p2" },
			} });
		}
		if (args[0] === "agent" && args[1] === "start") {
			return response({ result: { agent: { name: "factory-a1-t42" } } });
		}
		throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
	};
	const runtime = createHerdrRuntime({ exec, env: { HERDR_ENV: "1" } });

	const workspaceId = await runtime.createWorkspace("/repo/.worktrees/factory-a1-integration", "factory-a1");
	const worker = await runtime.createWorker({
		workspaceId,
		cwd: "/repo/.worktrees/factory-a1-t42",
		name: "factory-a1-t42",
		label: "#42 Deliver checkout",
		profile: { kind: "pi", model: "openai-codex/gpt-5.6-sol", thinking: "high" },
	});

	assert.equal(workspaceId, "w4");
	assert.deepEqual(worker, { name: "factory-a1-t42", tabId: "w4:t2", paneId: "w4:p2" });
	assert.deepEqual(calls, [
		["herdr", ["workspace", "create", "--cwd", "/repo/.worktrees/factory-a1-integration", "--label", "factory-a1", "--no-focus"]],
		["herdr", ["tab", "create", "--workspace", "w4", "--cwd", "/repo/.worktrees/factory-a1-t42", "--label", "#42 Deliver checkout", "--no-focus"]],
		["herdr", [
			"agent", "start", "factory-a1-t42", "--kind", "pi", "--pane", "w4:p2", "--timeout", "30000", "--",
			"--model", "openai-codex/gpt-5.6-sol", "--thinking", "high",
		]],
	]);
});

test("Herdr runtime starts Claude Code with profile-specific safe native arguments", async () => {
	const calls = [];
	const runtime = createHerdrRuntime({
		env: { HERDR_ENV: "1" },
		exec: async (_command, args) => {
			calls.push(args);
			if (args[0] === "tab") return response({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
			return response({ result: { agent: { name: "claude-worker" } } });
		},
	});

	await runtime.createWorker({
		workspaceId: "w1",
		cwd: "/worktree",
		name: "claude-worker",
		label: "#42 review",
		profile: { kind: "claude", model: "sonnet", effort: "high", permissionMode: "dontAsk", startupTimeoutMs: 90000 },
	});

	assert.deepEqual(calls[1], [
		"agent", "start", "claude-worker", "--kind", "claude", "--pane", "w1:p2", "--timeout", "90000", "--",
		"--model", "sonnet", "--effort", "high", "--permission-mode", "dontAsk",
	]);
});

test("buildWorkerPrompt uses a portable skill instruction for Claude Code", () => {
	const prompt = buildWorkerPrompt({
		repo: "minder/example",
		ticket: { index: 42, title: "Deliver checkout" },
		profile: { kind: "claude" },
	});
	assert.match(prompt, /^Use the `implement` skill/);
	assert.doesNotMatch(prompt, /^\/skill:implement/);
});

test("Herdr runtime surfaces a blocked agent without sending a repair prompt", async () => {
	const calls = [];
	const runtime = createHerdrRuntime({
		env: { HERDR_ENV: "1" },
		exec: async (command, args) => {
			calls.push([command, args]);
			return response({ result: { agent: { agent_status: "blocked" } } });
		},
	});

	const result = await runtime.promptWorker("sf-a1-t42", "work");

	assert.equal(result.status, "blocked");
	assert.match(result.reason, /requires human input/);
	assert.equal(calls.length, 1);
});

test("Herdr runtime retires only the worker tab it was given", async () => {
	const calls = [];
	const runtime = createHerdrRuntime({
		env: { HERDR_ENV: "1" },
		exec: async (command, args) => {
			calls.push([command, args]);
			return response({ result: { type: "ok" } });
		},
	});

	await runtime.retireWorker("w4:t2");

	assert.deepEqual(calls, [["herdr", ["tab", "close", "w4:t2"]]]);
});

test("Herdr runtime refuses to control a session from outside Herdr", () => {
	assert.throws(
		() => createHerdrRuntime({ exec: async () => response({}), env: {} }),
		/error must run inside a Herdr-managed pane/,
	);
});
