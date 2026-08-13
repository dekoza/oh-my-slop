import test from "node:test";
import assert from "node:assert/strict";

import {
	FactoryWorkerError,
	buildReviewPrompt,
	buildWorkerPrompt,
	createHerdrRuntime,
	parseFactoryResult,
	parseReviewResult,
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
		'FACTORY_RESULT {"status":"success","summary":"done","tests":["node --test"]}',
	].join("\n");

	assert.deepEqual(parseFactoryResult(transcript), {
		status: "success",
		summary: "done",
		tests: ["node --test"],
	});
});

test("parseFactoryResult requires implementation test evidence but not self-review", () => {
	assert.deepEqual(
		parseFactoryResult('FACTORY_RESULT {"status":"success","summary":"done","tests":["node --test: passed"]}'),
		{ status: "success", summary: "done", tests: ["node --test: passed"] },
	);
	assert.throws(
		() => parseFactoryResult('FACTORY_RESULT {"status":"success","summary":"done"}'),
		FactoryWorkerError,
	);
});

test("review protocol carries actionable findings independently from implementation", () => {
	assert.deepEqual(
		parseReviewResult('FACTORY_REVIEW {"status":"failed","summary":"Needs repair","findings":["Missing rollback test"]}'),
		{ status: "failed", summary: "Needs repair", findings: ["Missing rollback test"] },
	);
	assert.deepEqual(
		parseReviewResult('FACTORY_REVIEW {"status":"passed","summary":"No actionable findings"}'),
		{ status: "passed", summary: "No actionable findings", findings: [] },
	);
	assert.throws(
		() => parseReviewResult('FACTORY_REVIEW {"status":"passed","summary":"Contradictory","findings":["Critical defect"]}'),
		/pass.*cannot include findings/i,
	);
});

test("buildReviewPrompt gives pi and Claude a read-only two-axis-review contract", () => {
	const prompt = buildReviewPrompt({
		repo: "minder/example",
		ticket: { index: 42, title: "Deliver checkout" },
		baseBranch: "factory/run/integration",
		profile: { kind: "claude" },
	});
	assert.match(prompt, /^Use the `two-axis-review` skill/);
	assert.match(prompt, /Do not edit/);
	assert.match(prompt, /FACTORY_REVIEW/);
});

test("Herdr runtime preflights selected pi models and the Claude binary without starting agents", async () => {
	const calls = [];
	const runtime = createHerdrRuntime({
		env: { HERDR_ENV: "1" },
		exec: async (command, args) => {
			calls.push([command, args]);
			if (command === "pi") {
				return { code: 0, stderr: "", stdout: [
					"provider  model                    context  max-out  thinking  images",
					"local     thinkingcap-qwen3.6-27b  231.4K   32.8K    yes       no",
				].join("\n") };
			}
			return { code: 0, stderr: "", stdout: "2.1.80\n" };
		},
	});

	const profiles = [
		{ kind: "pi", model: "local/thinkingcap-qwen3.6-27b" },
		{ kind: "claude", model: "sonnet" },
	];
	await runtime.preflightProfiles(profiles);
	await runtime.preflightProfiles(profiles);

	assert.deepEqual(calls, [
		["pi", ["--list-models", "local/thinkingcap-qwen3.6-27b"]],
		["claude", ["--version"]],
	]);
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

test("Herdr runtime constrains reviewer editing tools regardless of profile defaults", async () => {
	const starts = [];
	const runtime = createHerdrRuntime({
		env: { HERDR_ENV: "1" },
		exec: async (_command, args) => {
			if (args[0] === "tab") return response({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
			starts.push(args);
			return response({ result: { agent: { name: "reviewer" } } });
		},
	});

	await runtime.createWorker({
		workspaceId: "w1", cwd: "/worktree", name: "reviewer", label: "review",
		profile: { kind: "claude", model: "sonnet", permissionMode: "acceptEdits" },
		role: "review",
	});

	assert.deepEqual(starts[0].slice(-6), [
		"--model", "sonnet", "--permission-mode", "plan", "--disallowedTools", "Edit,Write,NotebookEdit",
	]);
});

test("buildWorkerPrompt gives Claude Code the manual-only skill fallback", () => {
	const prompt = buildWorkerPrompt({
		repo: "minder/example",
		ticket: { index: 42, title: "Deliver checkout" },
		profile: { kind: "claude" },
	});
	assert.match(prompt, /^Use the `implement` skill/);
	assert.match(prompt, /If it isn't among your available skills, locate its `SKILL\.md` in the installed `oh-my-slop` package and follow that\./);
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

test("Herdr runtime parses raw-text agent read output from the installed CLI", async () => {
	const runtime = createHerdrRuntime({
		env: { HERDR_ENV: "1" },
		exec: async (_command, args) => {
			if (args[1] === "prompt") return response({ result: { agent: { status: "done" } } });
			if (args[1] === "read") {
				return {
					code: 0,
					stdout: 'review transcript\nFACTORY_REVIEW {"status":"passed","summary":"clean"}\n',
					stderr: "",
				};
			}
			throw new Error(`Unexpected Herdr command: ${args.join(" ")}`);
		},
	});

	assert.deepEqual(await runtime.promptReviewer("reviewer", "review"), {
		status: "passed",
		summary: "clean",
		findings: [],
	});
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
