import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runClaude } from "../../extensions/claude-worker/lib/worker.mjs";
import { createTaskSupervision } from "../../extensions/claude-worker/lib/supervision.mjs";
import { formatRunReport } from "../../extensions/claude-worker/lib/activity.mjs";

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
   const notification = { type: "result", uuid: "native-result", subtype: "success", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", result: "Verification notification" };
   send(notification); send(notification);
   send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", summary: "Repeated notification" });
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

test("failed intermediate verification preserves other required work and permits an approved repair", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
let ready = false;
let turns = 0;
input.on("close", () => {
 if (!ready) process.stderr.write("EOF before required review completed\\n");
 process.exit(0);
});
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 if (++turns === 1) {
  send({ type: "system", subtype: "task_notification", task_id: "red-check", status: "failed", summary: "Pre-repair assertion failed" });
  send({ type: "system", subtype: "task_started", task_id: "review", is_backgrounded: true });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { outstanding: ["Repair assertion and rerun after review"], background_task_ids: ["review"] }) });
  setTimeout(() => {
   ready = true;
   send({ type: "system", subtype: "task_notification", task_id: "review", status: "completed" });
   send({ type: "result", subtype: "success", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}" });
  }, 150);
 } else {
  send({ type: "system", subtype: "task_updated", task_id: "red-check", patch: { status: "running" } });
  send({ type: "system", subtype: "task_notification", task_id: "red-check", status: "completed", summary: "Repair applied; rerun passed" });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
 }
});
` });
	const result = await runClaude({ ...fake, prompt: "Review, repair and verify", maxContinuations: 1 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.continuations, 1);
	assert.doesNotMatch(result.stderr, /EOF before/);
	assert.deepEqual(result.taskOutcomes.find((task) => task.taskId === "red-check").history.map((entry) => entry.status), ["failed", "completed"]);
	assert.equal((await fake.frames()).filter((event) => event.type === "user").length, 2);
});

test("explicit fresh-ID replacement evidence resolves a failed check without erasing its history", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "task_notification", task_id: "red-check", status: "failed", summary: "Pre-repair assertion failed" });
 send({ type: "system", subtype: "task_started", task_id: "green-check" });
 send({ type: "system", subtype: "task_notification", task_id: "green-check", status: "completed", summary: "Fresh rerun passed" });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("finished", {
  resolved_failures: [{ task_id: "red-check", replacement_task_id: "green-check", evidence: ["Fixed assertion; fresh rerun passed: green-check.txt"] }]
 }) });
});
` });
	const result = await runClaude({ ...fake, prompt: "Repair and rerun verification" });
	assert.equal(result.disposition, "finished");
	assert.equal(result.continuations, 0);
	const red = result.taskOutcomes.find((task) => task.taskId === "red-check");
	assert.equal(red.status, "failed");
	assert.equal(red.history[0].summary, "Pre-repair assertion failed");
	assert.equal(result.taskOutcomes.find((task) => task.taskId === "green-check").status, "completed");
	const handoff = formatRunReport({ ...result, startedAt: Date.now(), status: "Finished", stats: {} });
	assert.match(handoff, /Task red-check: failed/);
	assert.match(handoff, /Resolved failure red-check: replacement green-check/);
	assert.match(handoff, /Fixed assertion; fresh rerun passed: green-check.txt/);
});

test("failed verification with no other active task continues through a fresh-ID repair", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 if (++turns === 1) {
  send({ type: "system", subtype: "task_notification", task_id: "red", status: "failed" });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { outstanding: ["Repair and rerun"] }) });
 } else {
  send({ type: "system", subtype: "task_notification", task_id: "green", status: "completed" });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("finished", {
   resolved_failures: [{ task_id: "red", replacement_task_id: "green", evidence: ["Repair applied; green rerun passed"] }]
  }) });
 }
});
` });
	const result = await runClaude({ ...fake, prompt: "Repair and verify", maxContinuations: 1 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.continuations, 1);
	assert.equal(result.taskOutcomes.find((task) => task.taskId === "red").status, "failed");
});

test("failure replacement cannot bypass missing attribution, stale evidence or unresolved tasks", { timeout: 15_000 }, async (t) => {
	const failure = { type: "system", subtype: "task_notification", task_id: "red", status: "failed", uuid: "red-1" };
	const green = { type: "system", subtype: "task_notification", task_id: "green", status: "completed", uuid: "green-1" };
	const resolution = { task_id: "red", replacement_task_id: "green", evidence: ["Repair applied; green rerun passed"] };
	const cases = [
		{ name: "no explicit attribution", events: [failure, green], extra: {} },
		{ name: "empty evidence", events: [failure, green], resolution: { ...resolution, evidence: [] } },
		{ name: "blank evidence", events: [failure, green], resolution: { ...resolution, evidence: [" "] } },
		{ name: "malformed entry", events: [failure, green], resolution: ["red", "green"] },
		{ name: "unsupported field", events: [failure, green], resolution: { ...resolution, approved: true } },
		{ name: "missing replacement", events: [failure] },
		{ name: "older passing check", events: [green, failure] },
		{ name: "replacement running again", events: [failure, green, { type: "system", subtype: "task_updated", task_id: "green", patch: { status: "running" } }] },
		{ name: "replacement failed", events: [failure, { ...green, status: "failed" }] },
		{ name: "stopped work", events: [{ ...failure, status: "stopped" }, green] },
		{ name: "unknown work", events: [{ ...failure, status: "unknown" }, green] },
		{ name: "another failure remains", events: [failure, { ...failure, task_id: "other-red", uuid: "red-2" }, green] },
		{ name: "ambient replacement", events: [failure, { ...green, ambient: true }] },
		{ name: "cross-session replacement", events: [failure, { ...green, session_id: "another-session" }] },
		{ name: "new failure after rerun", events: [failure, green, { ...failure, uuid: "red-2" }, green] },
	];
	for (const scenario of cases) {
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 for (const event of ${JSON.stringify(scenario.events)}) send(event);
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("finished", ${JSON.stringify(scenario.extra || { resolved_failures: [scenario.resolution || resolution] })}) });
});
` });
		let result;
		if (scenario.name === "replacement running again") {
			await assert.rejects(runClaude({ ...fake, prompt: "Repair and verify", maxTaskMs: 500 }), (error) => {
				assert.match(error.message, /time safety limit/);
				result = error.outcome;
				return true;
			});
		} else result = await runClaude({ ...fake, prompt: "Repair and verify" });
		assert.equal(result.disposition, "unfinished", scenario.name);
		assert.equal(result.taskOutcomes.find((task) => task.taskId === "red").status, scenario.events.find((event) => event.task_id === "red").status, scenario.name);
	}
});

test("foreground verification survives background-only snapshots and waits after backgrounding", { timeout: 15_000 }, async (t) => {
	for (const transition of ["snapshot", "update", "both"]) {
		const fake = await fixture(t, { body: `
let ready = false;
let turns = 0;
input.on("close", () => {
 if (!ready) process.stderr.write("EOF before required verification completed\\n");
 process.exit(0);
});
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 if (++turns === 1) {
  send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
  send({ type: "system", subtype: "task_started", task_id: "verify", is_backgrounded: false, description: "Required verification" });
  send({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "watcher", ambient: true }] });
  send({ type: "system", subtype: "task_notification", task_id: "watcher", ambient: true, status: "completed" });
  send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  ${transition !== "update" ? 'send({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "verify" }] });' : ""}
  ${transition !== "snapshot" ? 'send({ type: "system", subtype: "task_updated", task_id: "verify", patch: { is_backgrounded: true } });' : ""}
  setTimeout(() => {
   ready = true;
   send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", summary: "Verification passed" });
   send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
   send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", origin: { kind: "task-notification" }, result: "Verification consumed" });
  }, 250);
 }
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: ready
  ? completion()
  : completion("waiting", { outstanding: ["Apply repair after verification"], background_task_ids: ["verify"] }) });
});
` });
		const result = await runClaude({ ...fake, prompt: "Verify then repair", maxContinuations: 2 });
		assert.equal(result.disposition, "finished", transition);
		assert.equal(result.continuations, 1, "waiting must not spend continuation allowance");
		assert.equal(result.taskOutcomes.length, 1, "ambient watcher is not required work");
		assert.equal(result.taskOutcomes[0].status, "completed");
		assert.doesNotMatch(result.stderr, /EOF before/);
		assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 2);
	}
});

test("queued correlated results drain before finished and repeated results cannot dispatch twice", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
let sends = 0;
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 sends++;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 const first = { type: "result", uuid: "queued-first", subtype: "success", session_id: "${SESSION_ID}", queued_turn_count: 1, structured_output: completion() };
 send(first); send(first);
 setTimeout(() => send({ type: "result", uuid: "drained", subtype: "success", session_id: "${SESSION_ID}", queued_turn_count: 0, result: "Queue drained", structured_output: completion() }), 30);
});
` });
	const events = [];
	const result = await runClaude({ ...fake, prompt: "Inspect", onProgress: (event) => events.push(event), maxContinuations: 1 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.text, "Queue drained");
	assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 1);
});

test("resumed task lifecycles invalidate earlier completion and retain terminal history", () => {
	const report = { task_id: "approved", disposition: "finished", outcomes: [{ requirement: "Verify", status: "verified", evidence: ["verification passed"] }], outstanding: [], unverified: [], question: "", background_task_ids: [] };
	for (const resume of [
		{ subtype: "task_started", task_id: "verify" },
		{ subtype: "task_updated", task_id: "verify", patch: { status: "running" } },
		{ subtype: "background_tasks_changed", tasks: [{ task_id: "verify" }] },
	]) for (const withUuid of [true, false]) {
		const supervisor = createTaskSupervision("approved");
		const completed = { type: "system", subtype: "task_notification", task_id: "verify", status: "completed", ...(withUuid ? { uuid: "completion-1" } : {}), summary: "First verification passed" };
		supervisor.record(completed);
		assert.equal(supervisor.assess(report).disposition, "finished");
		supervisor.record({ type: "system", ...resume });
		supervisor.record(completed); // A redelivered earlier completion cannot finish a resumed task.
		assert.equal(supervisor.waiting, true);
		assert.equal(supervisor.assess(report).action, "continue");
		supervisor.record({ type: "system", subtype: "task_notification", task_id: "verify", status: "failed", uuid: "completion-2", summary: "Resumed verification failed" });
		assert.equal(supervisor.assess(report).action, "continue", "failed verification blocks finished but permits repair");
		const task = supervisor.snapshot().taskOutcomes[0];
		assert.equal(task.status, "failed");
		assert.deepEqual(task.history.map((outcome) => outcome.status), ["completed", "failed"]);
	}
});

test("a fresh resumed completion resolves snapshot uncertainty but not a terminal unknown notification", () => {
	const report = { task_id: "approved", disposition: "finished", outcomes: [{ requirement: "Verify", status: "verified", evidence: ["fresh verification passed"] }], outstanding: [], unverified: [], question: "", background_task_ids: [] };
	for (const explicitUnknown of [false, true]) {
		const supervisor = createTaskSupervision("approved");
		supervisor.record({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", uuid: "first" });
		supervisor.record({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: "running" } });
		if (explicitUnknown) supervisor.record({ type: "system", subtype: "task_notification", task_id: "verify", status: "unknown", uuid: "unknown" });
		supervisor.record({ type: "system", subtype: "background_tasks_changed", tasks: [] });
		assert.equal(supervisor.snapshot().taskOutcomes[0].status, "unknown");
		supervisor.record({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", uuid: "second" });
		const decision = supervisor.assess(report);
		assert.equal(decision.action, explicitUnknown ? "continue" : "end");
		assert.equal(decision.disposition, explicitUnknown ? undefined : "finished");
	}
});

test("live background evidence resolves snapshot uncertainty without erasing terminal evidence", () => {
	for (const live of [
		{ subtype: "background_tasks_changed", tasks: [{ task_id: "verify" }] },
		{ subtype: "task_updated", task_id: "verify", patch: { is_backgrounded: true } },
	]) for (const terminal of [undefined, "stopped", "failed", "unknown"]) {
		const supervisor = createTaskSupervision("approved");
		supervisor.record({ type: "system", subtype: "task_started", task_id: "verify", is_backgrounded: true });
		if (terminal) supervisor.record({ type: "system", subtype: "task_notification", task_id: "verify", status: terminal, uuid: "terminal", summary: "Retained terminal evidence" });
		supervisor.record({ type: "system", subtype: "background_tasks_changed", tasks: [] });
		assert.equal(supervisor.snapshot().taskOutcomes[0].status, terminal || "unknown");
		supervisor.record({ type: "system", ...live });
		assert.equal(supervisor.waiting, !terminal);
		const task = supervisor.snapshot().taskOutcomes[0];
		assert.equal(task.status, terminal || "running");
		assert.deepEqual(task.history.map((outcome) => outcome.status), terminal ? [terminal] : []);
		if (!terminal) {
			// A patch-only transition must establish background membership for later omissions.
			supervisor.record({ type: "system", subtype: "background_tasks_changed", tasks: [] });
			assert.equal(supervisor.snapshot().taskOutcomes[0].status, "unknown");
		}
	}
});

test("contradictory completion cannot erase stopped or failed work without an explicit resume", { timeout: 15_000 }, async (t) => {
	for (const status of ["stopped", "failed"]) {
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "${status}", uuid: "first", summary: "Verification did not finish" });
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", uuid: "contradictory", summary: "Completion without resume" });
 send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
` });
		const result = await runClaude({ ...fake, prompt: "Verify" });
		assert.equal(result.disposition, "unfinished");
		assert.equal(result.taskOutcomes[0].status, status);
		assert.match(result.reason, new RegExp('verify \\(' + status + '\\)'));
		assert.deepEqual(result.taskOutcomes[0].history.map((outcome) => outcome.status), [status, "completed"]);
	}
});

test("a report-declared background task is supervised even without a task-start notification", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 turns++;
 if (turns === 1) {
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { background_task_ids: ["declared"] }) });
  setTimeout(() => {
   send({ type: "system", subtype: "task_notification", task_id: "declared", status: "completed" });
   send({ type: "result", subtype: "success", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}" });
  }, 20);
 } else send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
` });
	const result = await runClaude({ ...fake, prompt: "Inspect", maxContinuations: 1 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.taskOutcomes[0].status, "completed");
});

test("native notification execution failures terminate unfinished without another model turn", { timeout: 15_000 }, async (t) => {
	for (const failure of [{ subtype: "error_during_execution", is_error: true }, { subtype: "error_max_turns", is_error: false }, { subtype: "success", is_error: true }]) {
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "system", subtype: "task_started", task_id: "verify" });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", permission_denials: [{ tool_name: "Read" }], structured_output: completion("waiting", { background_task_ids: ["verify"] }) });
 setTimeout(() => {
  send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed" });
  send({ type: "result", uuid: "native-error", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", ...${JSON.stringify(failure)}, errors: ["Subscription allowance exhausted"], permission_denials: [{ tool_name: "Bash" }], stop_reason: "error" });
 }, 20);
});
` });
		const events = [];
		await assert.rejects(runClaude({ ...fake, prompt: "Verify then repair", maxContinuations: 1, onProgress: (event) => events.push(event) }), (error) => {
			assert.equal(error.outcome.disposition, "unfinished");
			assert.equal(error.outcome.continuations, 0);
			assert.deepEqual(error.outcome.errors, ["Subscription allowance exhausted"]);
			assert.deepEqual(error.outcome.permissionDenials, [{ tool_name: "Read" }, { tool_name: "Bash" }]);
			assert.equal(error.outcome.resultSubtype, failure.subtype);
			assert.equal(error.outcome.stopReason, "error");
			return true;
		});
		assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 1);
		assert.equal(events.at(-1).disposition, "unfinished");
	}
});

test("queued results cannot override a needs-input pause or an unfinished decision", { timeout: 15_000 }, async (t) => {
	for (const disposition of ["needs_input", "unfinished"]) for (const correlatedDrain of [false, true]) {
		const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 if (++turns > 1) return send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
 send({ type: "result", uuid: "pause", subtype: "success", session_id: "${SESSION_ID}", queued_turn_count: 2, result: "Awaiting human decision", structured_output: completion("${disposition}", { question: "Which target?", outstanding: ["Write after human decision"] }) });
 setTimeout(() => {
  send({ type: "result", uuid: "unrelated", subtype: "success", session_id: "${SESSION_ID}", user_message_uuid: "other-turn", queued_turn_count: 0, structured_output: completion() });
  send({ type: "result", uuid: "still-queued", subtype: "success", origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", queued_turn_count: 1 });
  const drained = { type: "result", uuid: "drained", subtype: "success", ${correlatedDrain ? "" : 'origin: { kind: "task-notification" },'} session_id: "${SESSION_ID}", queued_turn_count: 0, structured_output: completion() };
  setTimeout(() => { send(drained); send(drained); }, 20);
 }, 20);
});
` });
		const result = await runClaude({ ...fake, prompt: "Inspect and ask before writing", maxContinuations: 1 });
		assert.equal(result.disposition, disposition);
		assert.equal(result.report.question, "Which target?");
		assert.deepEqual(result.report.outstanding, ["Write after human decision"]);
		assert.equal(result.text, "Awaiting human decision");
		assert.equal(result.continuations, 0);
		assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 1);
	}
});

test("explicit needs-input preserves its question and a same-session answer can finish", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 const resumed = args.includes("--resume");
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: resumed ? completion() : completion("needs_input", { question: "Which output directory?", outstanding: ["Write artifact after answer"] }) });
});
` });
	const paused = await runClaude({ ...fake, prompt: "Inspect and save" });
	assert.equal(paused.disposition, "needs_input");
	assert.equal(paused.report.question, "Which output directory?");
	const resumed = await runClaude({ ...fake, prompt: "Use artifacts/", sessionId: paused.sessionId });
	assert.equal(resumed.disposition, "finished");
	assert.equal(resumed.sessionId, paused.sessionId);
});

test("unsupported, ambiguous, missing evidence and pending work reports never finish", { timeout: 15_000 }, async (t) => {
	for (const expression of [
		"undefined", "null", "{ disposition: 'finished' }", "completion('done')", "completion('finished', { task_id: 'other-task' })",
		"completion('finished', { outcomes: [] })", "completion('finished', { outcomes: [{ requirement: 'Inspect', status: 'verified', evidence: [] }] })",
		"completion('finished', { outcomes: [{ requirement: 'Inspect', status: 'unverified', evidence: ['Pending'] }] })",
		"completion('finished', { outstanding: ['Repair still required'] })", "completion('finished', { unverified: ['Tests not run'] })",
		"completion('finished', { question: 'Unanswered' })", "completion('needs_input', { question: '' })",
		"completion('finished', { extra: 'unsupported' })",
	]) {
		const fake = await fixture(t, { body: `input.on("line", (line) => { if (JSON.parse(line).type === "user") send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", result: "Done", structured_output: ${expression} }); });` });
		const result = await runClaude({ ...fake, prompt: "Inspect" });
		assert.equal(result.disposition, "unfinished", expression);
	}
});

test("stopped, failed and unknown required tasks survive an empty active snapshot and block finished", { timeout: 15_000 }, async (t) => {
	for (const status of ["stopped", "failed", "unknown"]) {
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "task_started", task_id: "verify", description: "Integration check" });
 ${status === "unknown" ? "" : `send({ type: "system", subtype: "task_notification", task_id: "verify", status: "${status}", summary: "Check did not finish" });`}
 send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
` });
		const result = await runClaude({ ...fake, prompt: "Verify" });
		assert.equal(result.disposition, "unfinished");
		assert.equal(result.taskOutcomes[0].taskId, "verify");
		assert.equal(result.taskOutcomes[0].status, status);
	}
});

test("continuation and elapsed-time limits end unfinished with retained context", { timeout: 15_000 }, async (t) => {
	const looping = await fixture(t);
	const result = await runClaude({ ...looping, prompt: "Inspect", maxContinuations: 2 });
	assert.equal(result.disposition, "unfinished");
	assert.equal(result.continuations, 2);
	assert.match(result.reason, /safety limit/);
	assert.equal((await looping.frames()).filter((frame) => frame.type === "user").length, 3);
	const waiting = await fixture(t, { body: `input.on("line", (line) => { if (JSON.parse(line).type === "user") {
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "system", subtype: "task_started", task_id: "never-finishes" });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { background_task_ids: ["never-finishes"] }) });
} });` });
	await assert.rejects(runClaude({ ...waiting, prompt: "Wait", maxTaskMs: 100 }), (error) => {
		assert.equal(error.outcome.disposition, "unfinished");
		assert.equal(error.outcome.sessionId, SESSION_ID);
		assert.equal(error.outcome.taskOutcomes[0].taskId, "never-finishes");
		assert.match(error.outcome.reason, /time safety limit/);
		return true;
	});
});

test("unrelated sessions, UUIDs and notification reports cannot certify the approved task", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "result", subtype: "success", session_id: "other-session", structured_output: completion() });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", user_message_uuid: "unrelated", structured_output: completion() });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", origin: { kind: "task-notification" }, structured_output: completion() });
 setTimeout(() => send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", result: "Approved task paused", structured_output: completion("needs_input", { question: "Which scope?" }) }), 20);
});
` });
	const result = await runClaude({ ...fake, prompt: "Inspect" });
	assert.equal(result.disposition, "needs_input");
	assert.equal(result.text, "Approved task paused");
	assert.equal(result.continuations, 0);
});

test("a native notification turn can consume an explicitly correlated host continuation", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 turns++;
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", user_message_uuids: [event.uuid], ...(turns > 1 ? { origin: { kind: "task-notification" }, structured_output: completion() } : {}) });
});
` });
	const result = await runClaude({ ...fake, prompt: "Inspect", maxContinuations: 1 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.continuations, 1);
});

test("an execution failure after a completion report cannot emit a finished terminal event", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("close", () => process.exit(7));
input.on("line", (line) => { if (JSON.parse(line).type === "user") send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() }); });
` });
	const events = [];
	await assert.rejects(runClaude({ ...fake, prompt: "Inspect", onProgress: (event) => events.push(event) }), (error) => {
		assert.equal(error.outcome.disposition, "unfinished");
		return true;
	});
	assert.equal(events.at(-1).type, "worker_exit");
	assert.equal(events.at(-1).disposition, "unfinished");
});

test("a required task stopped before its first report retains the stopped outcome", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "system", subtype: "task_notification", task_id: "early-stop", status: "stopped", summary: "Required verification was stopped" });
 send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { background_task_ids: ["early-stop"], outstanding: ["Verification and repair"] }) });
});
` });
	const result = await runClaude({ ...fake, prompt: "Verify then repair" });
	assert.equal(result.disposition, "unfinished");
	assert.equal(result.taskOutcomes[0].status, "stopped");
	assert.match(result.reason, /early-stop \(stopped\)/);
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

test("normal terminal completion exits without waiting for cancellation escalation", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("close", () => process.exit(0));
input.on("line", (line) => {
 if (JSON.parse(line).type === "user") send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
` });
	let terminalAt;
	const events = [];
	const result = await runClaude({ ...fake, prompt: "Inspect", onProgress: (event) => {
		events.push(event);
		if (event.type === "result") terminalAt = performance.now();
	} });
	assert.equal(result.disposition, "finished");
	assert.equal(events.at(-1).type, "worker_exit");
	assert.equal(events.at(-1).disposition, "finished");
	assert.ok(performance.now() - terminalAt < 900, "normal close must not incur the one-second cancellation grace period");
});

test("stop cleans a TERM-ignoring descendant after its parent closes without late permission approval", { timeout: 15_000, skip: process.platform !== "linux" }, async (t) => {
	const fake = await fixture(t, { body: `
const { spawn } = await import("node:child_process");
process.on("SIGTERM", () => process.exit(0));
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 const descendant = spawn(process.execPath, ["-e", \`
  const { writeFileSync } = require("node:fs");
  process.on("SIGTERM", () => {});
  writeFileSync("descendant.pid", String(process.pid));
  setInterval(() => {}, 100);
  process.stdout.write("ready");
 \`], { stdio: ["ignore", "pipe", "ignore"] });
 descendant.stdout.once("data", () => {
  send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
  process.stderr.write("Descendant ready\\n");
  send({ type: "control_request", request_id: "late-approval", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "touch forbidden" } } });
 });
});
` });
	const controller = new AbortController();
	let permissionSignal;
	let approval;
	let stoppedAt;
	let descendantPid;
	const running = async (pid) => {
		try {
			const stat = await readFile(`/proc/${pid}/stat`, "utf8");
			// An orphan may remain a zombie until the host reaps it; it cannot run.
			return !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
		} catch (error) {
			if (error.code === "ENOENT") return false;
			throw error;
		}
	};
	try {
		await assert.rejects(runClaude({ ...fake, signal: controller.signal, prompt: "Wait for permission", onPermission: (_request, signal) => {
			permissionSignal = signal;
			stoppedAt = performance.now();
			controller.abort();
			approval = delay(50).then(() => true);
			return approval;
		} }), (error) => {
			assert.match(error.message, /stopped/i);
			assert.equal(error.outcome.exitCode, 0, "the immediate parent exits on TERM");
			assert.equal(error.outcome.exitSignal, null);
			assert.equal(error.outcome.sessionId, SESSION_ID);
			assert.equal(error.outcome.disposition, "unfinished");
			assert.match(error.outcome.stderr, /Descendant ready/);
			return true;
		});
		const settledAfter = performance.now() - stoppedAt;
		await approval;
		assert.equal(permissionSignal.aborted, true);
		assert.ok(!(await fake.frames()).some((event) => event.type === "control_response"));
		descendantPid = Number(await readFile(join(fake.cwd, "descendant.pid"), "utf8"));
		await delay(Math.max(0, 1_250 - (performance.now() - stoppedAt)));
		assert.equal(await running(descendantPid), false, "owned descendant must be killed beyond the escalation deadline even when parent stdio closes first");
		assert.ok(settledAfter >= 950, "invocation must await owned escalation before settling");
		assert.ok(settledAfter < 2_500, "cleanup remains bounded");
	} finally {
		controller.abort();
		if (!descendantPid) {
			try { descendantPid = Number(await readFile(join(fake.cwd, "descendant.pid"), "utf8")); }
			catch (error) { if (error.code !== "ENOENT") throw error; }
		}
		if (descendantPid && await running(descendantPid)) {
			try { process.kill(descendantPid, "SIGKILL"); }
			catch (error) { if (error.code !== "ESRCH") throw error; }
			const deadline = performance.now() + 1_000;
			while (await running(descendantPid) && performance.now() < deadline) await delay(10);
			assert.equal(await running(descendantPid), false, "fixture cleanup must not leave its own descendant running on red");
		}
	}
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
