import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runClaude } from "../../extensions/claude-worker/lib/worker.mjs";
import { createTaskSupervision } from "../../extensions/claude-worker/lib/supervision.mjs";
import { createActivityLog, formatRunReport } from "../../extensions/claude-worker/lib/activity.mjs";

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
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", result: "Repair applied; verification passed", structured_output: completion("finished", { outcomes: [...completion().outcomes, { requirement: "Apply repair after verification", status: "verified", evidence: ["Repair applied; verification passed"] }] }) });
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
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("finished", { outcomes: [...completion().outcomes, { requirement: "Repair assertion and rerun after review", status: "verified", evidence: ["Review consumed; repair applied; rerun passed"] }] }) });
 }
});
` });
	const result = await runClaude({ ...fake, prompt: "Review, repair and verify", maxContinuations: 1 });
	assert.equal(result.disposition, "finished");
	assert.equal(result.continuations, 1);
	assert.doesNotMatch(result.stderr, /EOF before/);
	assert.deepEqual(result.taskOutcomes.find((task) => task.taskId === "red-check").history.map((entry) => entry.status), ["failed", "completed"]);
	const handoff = formatRunReport({ ...result, startedAt: Date.now(), status: "Finished", stats: {} });
	assert.match(handoff, /Task history red-check: failed · Pre-repair assertion failed/);
	assert.match(handoff, /Task history red-check: completed · Repair applied; rerun passed/);
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
   outcomes: [...completion().outcomes, { requirement: "Repair and rerun", status: "verified", evidence: ["Repair applied; green rerun passed"] }],
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

test("structured outstanding and unverified declarations require explicit evidence live and after restoration", { timeout: 15_000 }, async (t) => {
	for (const field of ["outstanding", "unverified"]) {
		const required = "Required integration verification";
		const report = { task_id: "approved", disposition: "waiting", outcomes: [{ requirement: "Inspection", status: "verified", evidence: ["inspection.txt"] }], outstanding: [], unverified: [], question: "", background_task_ids: [], [field]: [required] };
		const supervisor = createTaskSupervision("approved");
		supervisor.assess(report);
		for (const current of [supervisor, createTaskSupervision("approved", supervisor.snapshot()), createTaskSupervision("approved", { report, requiredOutcomes: [] })]) {
			const missing = { ...report, disposition: "finished", [field]: [] };
			assert.equal(current.assess(missing).action, "continue", field);
			assert.ok(current.snapshot().omittedOutcomes.some((item) => item.requirement === required));
			assert.equal(current.assess({ ...missing, outcomes: [...missing.outcomes, { requirement: required, status: "unverified", evidence: [] }] }).action, "continue");
			assert.equal(current.assess({ ...missing, outcomes: [...missing.outcomes, { requirement: required, status: "verified", evidence: ["integration.log: passed"] }] }).disposition, "finished");
		}
		const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion(++turns === 1 ? "waiting" : "finished", turns === 1 ? { ${field}: ["${required}"] } : {}) });
});
` });
		const result = await runClaude({ ...fake, prompt: "Inspect and run required integration verification", maxContinuations: 1 });
		assert.equal(result.disposition, "unfinished", field);
		assert.match(result.reason, /Required integration verification/);
		assert.match(formatRunReport({ ...result, startedAt: Date.now(), status: "Unfinished", stats: {} }), /Omitted required outcome: Required integration verification/);
	}
});

test("an early failed legacy resume preserves list-only obligations for later supervision", () => {
	const report = { task_id: "approved", disposition: "needs_input", outcomes: [{ requirement: "Inspection", status: "verified", evidence: ["inspection.txt"] }], outstanding: ["Required repair"], unverified: ["Required integration"], question: "Which directory?", background_task_ids: [] };
	const prior = { cwd: "/project", sessionId: SESSION_ID, report, requiredOutcomes: report.outcomes };
	const failed = createActivityLog({ cwd: "/project", prompt: "Use artifacts/", sessionId: SESSION_ID, resumeState: prior });
	failed.finish({ disposition: "unfinished", status: "Failed", error: "Subscription preflight failed" });
	const restored = createTaskSupervision("approved", failed.snapshot());
	const omitted = { ...report, disposition: "finished", outstanding: [], unverified: [], question: "" };
	assert.equal(restored.assess(omitted).action, "continue");
	assert.deepEqual(restored.snapshot().omittedOutcomes.map((outcome) => outcome.requirement).sort(), ["Required integration", "Required repair"]);
	assert.equal(restored.assess({ ...omitted, outcomes: [...omitted.outcomes, ...["Required repair", "Required integration"].map((requirement) => ({ requirement, status: "verified", evidence: ["repair-and-integration.log: passed"] }))] }).disposition, "finished");
});

test("large retained requirements reach a resumed session through stdin, not process arguments", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t);
	const requiredOutcomes = Array.from({ length: 12 }, (_, index) => ({ requirement: `Inspect private project file ${index}: ${"x".repeat(15_900)}`, status: "unverified", evidence: [] }));
	const result = await runClaude({ ...fake, prompt: "Continue", sessionId: SESSION_ID, resumeState: { cwd: fake.cwd, sessionId: SESSION_ID, taskId: "large-task", requiredOutcomes } });
	assert.equal(result.disposition, "unfinished");
	const [, transport] = await fake.calls();
	for (const outcome of requiredOutcomes) assert.ok(!transport.args.some((arg) => arg.includes(outcome.requirement)));
	const prompt = (await fake.frames()).find((frame) => frame.type === "user").message.content;
	assert.match(prompt, /^Continue/);
	for (const outcome of requiredOutcomes) assert.ok(prompt.includes(JSON.stringify(outcome.requirement)));
});

test("an early failed resume preserves consumed result deliveries for later supervision", () => {
	const consumed = { type: "result", uuid: "old-native-delivery", subtype: "success", origin: { kind: "task-notification" } };
	const original = createTaskSupervision("approved");
	assert.equal(original.acceptResult(consumed, true), true);
	const prior = { cwd: "/project", sessionId: SESSION_ID, taskId: "approved", ...original.snapshot() };
	const failed = createActivityLog({ cwd: "/project", prompt: "Use artifacts/", sessionId: SESSION_ID, resumeState: prior });
	failed.finish({ disposition: "unfinished", status: "Failed", error: "Subscription preflight failed" });
	const restored = createTaskSupervision("approved", failed.snapshot());
	assert.equal(restored.acceptResult(consumed, true), false);
	assert.equal(restored.acceptResult({ ...consumed, uuid: "fresh-native-delivery" }, true), true);
	// result_index restarts with every CLI process and therefore never crosses a resume.
	assert.equal(restored.acceptResult({ type: "result", result_index: 0 }, false), true);
	assert.equal(restored.acceptResult({ type: "result", result_index: 0 }, false), false);
	assert.equal(createTaskSupervision("approved", restored.snapshot()).acceptResult({ type: "result", result_index: 0 }, false), true);
});

test("sanitized requirement wording cannot collapse distinct persistent outcome identities", () => {
	for (const requirements of [["x".repeat(16_100) + "A", "x".repeat(16_100) + "B"], ["Check API_TOKEN=alpha", "Check API_TOKEN=beta"]]) {
		const report = { task_id: "approved", disposition: "needs_input", outcomes: requirements.map((requirement) => ({ requirement, status: "unverified", evidence: [] })), outstanding: [], unverified: [], question: "Which directory?", background_task_ids: [] };
		const current = createTaskSupervision("approved");
		current.assess(report);
		const log = createActivityLog({ cwd: "/project", prompt: "Verify", sessionId: SESSION_ID });
		log.observe(current.snapshot());
		const saved = log.snapshot();
		assert.equal(saved.requiredOutcomes[0].requirement, saved.requiredOutcomes[1].requirement, "display sanitization is intentionally lossy");
		const restored = createTaskSupervision("approved", saved);
		assert.equal(restored.snapshot().requiredOutcomes.length, 2, "distinct obligations survive identical displayed wording");
		const finished = { ...report, disposition: "finished", question: "", outcomes: [{ requirement: requirements[0], status: "verified", evidence: ["first.log: passed"] }] };
		assert.equal(restored.assess(finished).action, "continue", "verifying one raw identity cannot discharge the other");
		assert.equal(restored.snapshot().omittedOutcomes.length, 1);
		assert.equal(restored.assess({ ...finished, outcomes: requirements.map((requirement) => ({ requirement, status: "verified", evidence: ["both.log: passed"] })) }).disposition, "finished");
		assert.ok(saved.requiredOutcomes.every((item) => /^[a-f0-9]{64}$/.test(item.requirementId)));
		assert.doesNotMatch(JSON.stringify(saved), /API_TOKEN=(alpha|beta)/);
	}
});

test("later reports must explicitly verify every previously declared required outcome", { timeout: 15_000 }, async (t) => {
	for (const includeRequired of [false, true]) {
		const fake = await fixture(t, { body: `
let turns = 0;
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 const base = completion().outcomes;
 if (++turns === 1) send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", {
  outcomes: [...base, { requirement: "Required integration", status: "unverified", evidence: [] }],
  outstanding: ["Required integration"], unverified: ["Required integration"]
 }) });
 else send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("finished", {
  outcomes: ${includeRequired ? '[...base, { requirement: "Required integration", status: "verified", evidence: ["Integration passed: integration.log"] }]' : "base"}
 }) });
});
` });
		const result = await runClaude({ ...fake, prompt: "Inspect and run required integration", maxContinuations: 1 });
		assert.equal(result.disposition, includeRequired ? "finished" : "unfinished");
		if (!includeRequired) {
			assert.match(result.reason, /Required integration/);
			const handoff = formatRunReport({ ...result, startedAt: Date.now(), status: "Unfinished", stats: {} });
			assert.match(handoff, /Omitted required outcome: Required integration/);
			assert.equal(result.omittedOutcomes[0].status, "unverified");
		}
	}
});

test("a stopped required task stays unfinished despite native resume and fresh completion", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "stopped", uuid: "stopped", summary: "Required verification stopped" });
 send({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: "running" } });
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", uuid: "completed", summary: "Native resumed completion" });
 send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
` });
	const result = await runClaude({ ...fake, prompt: "Verify required work", maxContinuations: 1 });
	assert.equal(result.disposition, "unfinished");
	assert.equal(result.continuations, 0);
	assert.equal(result.taskOutcomes[0].status, "stopped");
	assert.deepEqual(result.taskOutcomes[0].history.map((entry) => entry.status), ["stopped", "completed"]);
	const handoff = formatRunReport({ ...result, startedAt: Date.now(), status: "Unfinished", stats: {} });
	assert.match(handoff, /Task verify: stopped/);
	assert.match(handoff, /Resume in the same working directory/);
});

test("later failure or unknown notifications cannot erase a stopped-task barrier", { timeout: 15_000 }, async (t) => {
	for (const mode of ["failed-resume", "unknown-resume", "failed-replacement"]) {
		const status = mode.startsWith("failed") ? "failed" : "unknown";
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "stopped", uuid: "stopped", summary: "Required task stopped" });
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "${status}", uuid: "later", summary: "Later terminal evidence" });
 ${mode === "failed-replacement" ? 'send({ type: "system", subtype: "task_notification", task_id: "replacement", status: "completed", uuid: "replacement" });' : `
 send({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: "running" } });
 send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", uuid: "completed" });`}
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("finished", ${mode === "failed-replacement" ? '{ resolved_failures: [{ task_id: "verify", replacement_task_id: "replacement", evidence: ["Rerun passed"] }] }' : "{}"}) });
});
` });
		const result = await runClaude({ ...fake, prompt: "Verify required work", maxContinuations: 1 });
		assert.equal(result.disposition, "unfinished", mode);
		assert.equal(result.continuations, 0, mode);
		assert.equal(result.taskOutcomes[0].status, "stopped", mode);
		assert.match(result.reason, /verify \(stopped\)/);
		assert.deepEqual(result.taskOutcomes[0].history.map((entry) => entry.status), mode === "failed-replacement" ? ["stopped", status] : ["stopped", status, "completed"]);
	}
});

test("replayed UUID-less native results cannot drain a later queue or close input", { timeout: 15_000 }, async (t) => {
	for (const freshDrain of [false, true]) {
		const fake = await fixture(t, { body: `
let turns = 0;
let drained = false;
const oldDrain = { type: "result", subtype: "success", session_id: "${SESSION_ID}", origin: { kind: "task-notification" }, queued_turn_count: 0, result: "Old consumed native notification" };
input.on("close", () => {
 if (!drained) process.stderr.write("EOF before fresh queue drain\\n");
 process.exit(0);
});
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 if (++turns === 1) {
  send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
  send({ type: "result", uuid: "first", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { outstanding: ["Finish approved work"] }) });
  setTimeout(() => send(oldDrain), 20);
 } else {
  setTimeout(() => {
   send({ type: "result", uuid: "second", subtype: "success", session_id: "${SESSION_ID}", queued_turn_count: 1, structured_output: completion("finished", { outcomes: [...completion().outcomes, { requirement: "Finish approved work", status: "verified", evidence: ["approved-work.txt"] }] }) });
   setTimeout(() => send(oldDrain), 20);
   ${freshDrain ? 'setTimeout(() => { drained = true; send({ ...oldDrain, result: "Fresh consumed queue drain" }); }, 100);' : ""}
  }, 60);
 }
});
` });
		if (freshDrain) {
			const result = await runClaude({ ...fake, prompt: "Finish approved work", maxContinuations: 1 });
			assert.equal(result.disposition, "finished");
			assert.doesNotMatch(result.stderr, /EOF before fresh/);
		} else await assert.rejects(runClaude({ ...fake, prompt: "Finish approved work", maxContinuations: 1, maxTaskMs: 500 }), (error) => {
			assert.equal(error.outcome.disposition, "unfinished");
			assert.match(error.message, /time safety limit/);
			return true;
		});
		assert.equal((await fake.frames()).filter((event) => event.type === "user").length, 2);
	}
});

test("a native result consumed before a pause cannot drain the resumed task's queue", { timeout: 15_000 }, async (t) => {
	for (const tagged of [true, false]) {
		const fake = await fixture(t, { body: `
const oldDrain = { type: "result", ${tagged ? 'uuid: "old-native-delivery", ' : ""}subtype: "success", session_id: "${SESSION_ID}", origin: { kind: "task-notification" }, queued_turn_count: 0, result: "Old consumed native notification" };
input.on("close", () => process.exit(0));
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 if (!args.includes("--resume")) {
  send({ type: "result", uuid: "paused", subtype: "success", session_id: "${SESSION_ID}", queued_turn_count: 1, structured_output: completion("needs_input", { question: "Which target?" }) });
  setTimeout(() => send(oldDrain), 20);
 } else {
  send({ type: "result", uuid: "resumed-finish", subtype: "success", session_id: "${SESSION_ID}", queued_turn_count: 1, structured_output: completion() });
  setTimeout(() => send(oldDrain), 20);
  setTimeout(() => send({ type: "system", subtype: "task_notification", session_id: "${SESSION_ID}", uuid: "fresh-stopped", task_id: "queued-check", status: "stopped", summary: "Queued required verification stopped" }), 120);
  setTimeout(() => send({ ...oldDrain, uuid: "fresh-drain", result: "Fresh queue drain" }), 160);
 }
});
` });
		const paused = await runClaude({ ...fake, prompt: "Verify" });
		assert.equal(paused.disposition, "needs_input");
		const resumed = await runClaude({ ...fake, prompt: "Target A", sessionId: SESSION_ID, resumeState: { ...paused, cwd: fake.cwd } });
		assert.equal(resumed.disposition, "unfinished", tagged ? "tagged replay" : "untagged replay");
		assert.equal(resumed.taskOutcomes.find((task) => task.taskId === "queued-check")?.status, "stopped");
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
  ? completion("finished", { outcomes: [...completion().outcomes, { requirement: "Apply repair after verification", status: "verified", evidence: ["repair.txt; verification passed"] }] })
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
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: resumed ? completion("finished", { outcomes: [...completion().outcomes, { requirement: "Write artifact after answer", status: "verified", evidence: ["artifacts/inspection.txt"] }] }) : completion("needs_input", { question: "Which output directory?", outstanding: ["Write artifact after answer"] }) });
});
` });
	const paused = await runClaude({ ...fake, prompt: "Inspect and save" });
	assert.equal(paused.disposition, "needs_input");
	assert.equal(paused.report.question, "Which output directory?");
	const resumed = await runClaude({ ...fake, prompt: "Use artifacts/", sessionId: paused.sessionId, resumeState: { ...paused, cwd: fake.cwd } });
	assert.equal(resumed.disposition, "finished");
	assert.equal(resumed.sessionId, paused.sessionId);
});

test("same-task resume retains required outcomes across repeated pauses until explicit evidence", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 // The host appends retained requirement data after the task text.
 const prompt = event.message.content.split("\\n\\n")[0];
 const required = { requirement: "Required integration verification", status: "unverified", evidence: [] };
 const report = prompt === "Initial task"
  ? completion("needs_input", { outcomes: [required], outstanding: [required.requirement], unverified: [required.requirement], question: "Which output directory?" })
  : prompt === "Ask another question"
   ? completion("needs_input", { question: "Which format?" })
   : prompt === "Provide verification evidence"
    ? completion("finished", { outcomes: [completion().outcomes[0], { ...required, status: "verified", evidence: ["integration: passed"] }] })
    : completion();
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: report });
});
` });
	const paused = await runClaude({ ...fake, prompt: "Initial task" });
	assert.equal(paused.disposition, "needs_input");
	const omitted = await runClaude({ ...fake, sessionId: paused.sessionId, resumeState: { ...paused, cwd: fake.cwd }, prompt: "Use artifacts/" });
	assert.equal(omitted.disposition, "unfinished", "an answer cannot silently waive required verification");
	assert.equal(omitted.report.task_id, paused.report.task_id, "follow-up keeps the approved task identity");
	assert.deepEqual(omitted.omittedOutcomes.map((item) => item.requirement), ["Required integration verification"]);
	const pausedAgain = await runClaude({ ...fake, sessionId: omitted.sessionId, resumeState: { ...omitted, cwd: fake.cwd }, prompt: "Ask another question" });
	assert.equal(pausedAgain.disposition, "needs_input");
	const stillOmitted = await runClaude({ ...fake, sessionId: pausedAgain.sessionId, resumeState: { ...pausedAgain, cwd: fake.cwd }, prompt: "Use JSON" });
	assert.equal(stillOmitted.disposition, "unfinished", "a second pause must not replace the cumulative ledger");
	const verified = await runClaude({ ...fake, sessionId: stillOmitted.sessionId, resumeState: { ...stillOmitted, cwd: fake.cwd }, prompt: "Provide verification evidence" });
	assert.equal(verified.disposition, "finished");
	assert.deepEqual(verified.omittedOutcomes, []);
	const fresh = await runClaude({ ...fake, prompt: "A new task" });
	assert.equal(fresh.disposition, "finished", "a new task does not inherit old obligations");
	assert.notEqual(fresh.report.task_id, paused.report.task_id);
});

test("supervision checkpoints authoritative requirements while waiting before terminal settlement", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "system", subtype: "task_started", task_id: "verify", is_backgrounded: true });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", {
  outcomes: [{ requirement: "Required integration verification", status: "unverified", evidence: [] }], background_task_ids: ["verify"]
 }) });
});
` });
	const controller = new AbortController();
	const checkpoints = [];
	await assert.rejects(runClaude({ ...fake, signal: controller.signal, prompt: "Verify", onState: (state) => checkpoints.push(structuredClone(state)),
		onProgress: (event) => {
			if (event.type !== "worker_supervision" || !event.status.startsWith("Waiting")) return;
			controller.abort();
		},
	}));
	assert.ok(checkpoints[0].taskId, "task identity is checkpointed before the first model frame");
	const learned = checkpoints.find((state) => state.requiredOutcomes.some((outcome) => outcome.requirement === "Required integration verification"));
	assert.ok(learned, "raw reports must be assessed before checkpointing the cumulative ledger");
	assert.equal(learned.sessionId, SESSION_ID);
	assert.equal(learned.report.task_id, learned.taskId);
	assert.equal(learned.taskOutcomes[0].status, "running");
});

test("saved-session replay cannot turn restored unfinished verification into fresh completion", { timeout: 15_000 }, async (t) => {
	for (const tagged of [true, false, "long-untagged"]) {
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 send({ type: "system", subtype: "task_notification", task_id: "verify", ${tagged === true ? 'uuid: "old-pass",' : ''} status: "completed", summary: ${tagged === "long-untagged" ? '"API_KEY=replayed-secret " + "x".repeat(20_000)' : '"Old verification passed"'} });
 if (!args.includes("--resume")) {
  send({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: "running", is_backgrounded: true } });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("needs_input", { question: "Which target?", background_task_ids: ["verify"] }) });
 } else {
  if (event.message.content.startsWith("Fresh verification")) send({ type: "system", subtype: "task_notification", task_id: "verify", uuid: "new-pass", status: "completed", summary: "Fresh verification passed" });
  send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
 }
});
` });
		const paused = await runClaude({ ...fake, prompt: "Verify then ask" });
		assert.equal(paused.taskOutcomes[0].status, "running");
		const retained = createActivityLog({ cwd: fake.cwd, prompt: "Verify then ask", sessionId: SESSION_ID });
		retained.finish(paused);
		const replayed = await runClaude({ ...fake, prompt: "Target A", sessionId: SESSION_ID, resumeState: retained.snapshot() });
		assert.equal(replayed.disposition, "unfinished");
		assert.equal(replayed.taskOutcomes[0].status, "unknown");
		assert.equal(replayed.taskOutcomes[0].history.length, 1, "deduplication survives deliberate follow-up");
		const fresh = await runClaude({ ...fake, prompt: "Fresh verification", sessionId: SESSION_ID, resumeState: { ...replayed, cwd: fake.cwd } });
		assert.equal(fresh.disposition, "finished");
		assert.equal(fresh.taskOutcomes[0].history.length, 2);
	}
});

test("resume preserves native obligations and history without assuming old running work is live", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 const event = JSON.parse(line);
 if (event.type !== "user") return;
 if (event.message.content.startsWith("Recover stopped verification")) {
  send({ type: "system", subtype: "task_started", task_id: "verify", is_backgrounded: true });
  send({ type: "system", subtype: "task_notification", task_id: "verify", status: "completed", summary: "Recovery verification passed" });
 }
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
` });
	for (const status of ["running", "stopped", "failed", "unknown"]) {
		const previous = { cwd: fake.cwd, sessionId: SESSION_ID, taskId: "approved-task", taskOutcomes: [{ taskId: "verify", status, terminalStatus: status === "running" ? undefined : status, history: status === "running" ? [] : [{ status, summary: "Prior verification" }] }] };
		const result = await runClaude({ ...fake, sessionId: SESSION_ID, resumeState: previous, prompt: "Use artifacts/" });
		assert.equal(result.disposition, "unfinished", status);
		assert.equal(result.taskOutcomes[0].status, status === "running" ? "unknown" : status);
		assert.equal(result.continuations, 0, "stale running state must not hang instead of asking for evidence");
		if (status === "stopped") {
			const recovered = await runClaude({ ...fake, sessionId: SESSION_ID, resumeState: previous, prompt: "Recover stopped verification" });
			assert.equal(recovered.disposition, "finished");
			assert.deepEqual(recovered.taskOutcomes[0].history.map((entry) => entry.status), ["stopped", "completed"]);
		}
	}
	for (const changed of [{ sessionId: "another-session" }, { cwd: "/other/directory" }]) {
		await assert.rejects(runClaude({ ...fake, sessionId: SESSION_ID, resumeState: { cwd: fake.cwd, sessionId: SESSION_ID, ...changed }, prompt: "Follow up" }), /do not belong/);
	}
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

test("terminal native task updates retain their outcome and diagnostics without a notification", { timeout: 15_000 }, async (t) => {
	for (const [nativeStatus, status] of [["killed", "stopped"], ["failed", "failed"]]) {
		const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "system", subtype: "task_started", task_id: "verify", is_backgrounded: true, description: "Required integration verification" });
 send({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: "${nativeStatus}", error: "NATIVE-PATCH-REASON" } });
 send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { background_task_ids: ["verify"] }) });
});
` });
		const log = createActivityLog({ cwd: fake.cwd, prompt: "Verify integration" });
		const result = await runClaude({ ...fake, prompt: "Verify integration", onProgress: (event) => log.record(event), onState: (state) => log.observe(state) });
		log.finish({ ...result, status: "Unfinished/interrupted" });
		assert.equal(result.disposition, "unfinished", nativeStatus);
		assert.equal(result.taskOutcomes[0].status, status, nativeStatus);
		assert.equal(result.taskOutcomes[0].summary, "NATIVE-PATCH-REASON");
		assert.match(formatRunReport(log.snapshot()), new RegExp(`Task verify: ${status} · NATIVE-PATCH-REASON`));
		const records = (await readFile(log.snapshot().logPath, "utf8")).trim().split("\n").map(JSON.parse);
		assert.equal(records.find((record) => record.kind === "task_updated").details.patch.error, "NATIVE-PATCH-REASON");
	}
	const supervision = createTaskSupervision("approved");
	supervision.record({ type: "system", subtype: "task_started", task_id: "verify" });
	supervision.record({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: "completed" } });
	assert.equal(supervision.snapshot().taskOutcomes[0].status, "completed");
	assert.equal(supervision.waiting, false);
});

test("a native terminal update followed by its notification is one transition with the notification details", () => {
	for (const [nativeStatus, status] of [["killed", "stopped"], ["completed", "completed"], ["failed", "failed"]]) {
		const supervision = createTaskSupervision("approved");
		supervision.record({ type: "system", subtype: "task_started", task_id: "verify", description: "Integration run" });
		supervision.record({ type: "system", subtype: "task_updated", task_id: "verify", patch: { status: nativeStatus, error: "Native patch reason" } });
		supervision.record({ type: "system", subtype: "task_notification", task_id: "verify", status, summary: "Integration ended at 75%", output_file: "/tmp/int.out" });
		const [task] = supervision.snapshot().taskOutcomes;
		assert.equal(task.status, status, nativeStatus);
		assert.equal(task.summary, "Integration ended at 75%");
		assert.equal(task.outputFile, "/tmp/int.out");
		assert.equal(task.history.length, 1, `${nativeStatus} is one terminal transition`);
		assert.equal(task.history[0].error, "Native patch reason");
		assert.match(formatRunReport({ startedAt: 0, stats: { toolCalls: 0, toolResults: 0, toolErrors: 0 }, taskOutcomes: [task] }), new RegExp(`Task verify: ${status} · Integration ended at 75% · /tmp/int.out`));
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
	// The budget must outlast fixture process startup so the init frame can arrive first.
	await assert.rejects(runClaude({ ...waiting, prompt: "Wait", maxTaskMs: 1_000 }), (error) => {
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

test("cancellation retains same-session cleanup evidence without dispatch or permission approval", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
process.on("SIGTERM", () => {
 send({ type: "system", subtype: "task_notification", session_id: "other-session", task_id: "verify", status: "failed", summary: "Unrelated failure" });
 send({ type: "system", subtype: "task_notification", session_id: "${SESSION_ID}", task_id: "verify", status: "stopped", summary: "Stopped during cleanup", output_file: "cleanup-output.txt" });
 send({ type: "control_request", request_id: "late-permission", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "must not run" } } });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
 setTimeout(() => process.exit(0), 30);
});
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "system", subtype: "task_started", task_id: "verify", is_backgrounded: true });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("waiting", { background_task_ids: ["verify"] }) });
});
` });
	const controller = new AbortController();
	const progress = [];
	let permissions = 0;
	await assert.rejects(runClaude({ ...fake, signal: controller.signal, prompt: "Verify", maxContinuations: 2,
		onPermission: async () => { permissions++; return true; },
		onProgress: (event) => {
			progress.push(event);
			if (event.type === "worker_supervision" && event.status.startsWith("Waiting")) controller.abort();
		},
	}), (error) => {
		assert.equal(error.outcome.disposition, "unfinished");
		const task = error.outcome.taskOutcomes.find((item) => item.taskId === "verify");
		assert.equal(task.status, "stopped");
		assert.equal(task.summary, "Stopped during cleanup");
		assert.equal(task.outputFile, "cleanup-output.txt");
		assert.deepEqual(task.history.map((item) => item.status), ["stopped"]);
		const handoff = formatRunReport({ ...error.outcome, startedAt: Date.now(), status: "Unfinished", stats: {} });
		assert.match(handoff, /Stopped during cleanup/);
		assert.match(handoff, /cleanup-output.txt/);
		return true;
	});
	assert.ok(progress.some((event) => event.subtype === "task_notification" && event.status === "stopped"));
	assert.ok(!progress.some((event) => event.summary === "Unrelated failure"));
	assert.equal(permissions, 0);
	assert.equal((await fake.frames()).filter((event) => event.type === "user").length, 1);
	assert.ok(!(await fake.frames()).some((event) => event.response?.request_id === "late-permission"));
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

test("late stopped cleanup evidence invalidates finished without restarting dispatch", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "task_notification", task_id: "verify", uuid: "pass", status: "completed" });
 send({ type: "result", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion() });
});
input.on("close", () => {
 send({ type: "system", subtype: "task_notification", session_id: "${SESSION_ID}", task_id: "verify", uuid: "stop", status: "stopped", summary: "Stopped during EOF cleanup" });
 setTimeout(() => process.exit(0), 25);
});
` });
	const result = await runClaude({ ...fake, prompt: "Verify", maxContinuations: 2 });
	assert.equal(result.taskOutcomes[0].status, "stopped");
	assert.equal(result.disposition, "unfinished");
	assert.match(result.reason, /stopped/i);
	assert.equal(result.continuations, 0);
	assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 1);
});

test("a same-session execution failure during EOF cleanup invalidates finished without restarting dispatch", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "result", uuid: "first", subtype: "success", session_id: "${SESSION_ID}", result: "Initial completion", structured_output: completion() });
});
input.on("close", () => {
 send({ type: "result", uuid: "late-error", subtype: "error_during_execution", is_error: true, origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", errors: ["EOF cleanup execution failed"], permission_denials: [{ tool_name: "Bash" }], stop_reason: "error" });
 setTimeout(() => process.exit(0), 25);
});
` });
	const events = [];
	await assert.rejects(runClaude({ ...fake, prompt: "Inspect", maxContinuations: 2, onProgress: (event) => events.push(event) }), (error) => {
		assert.equal(error.outcome.disposition, "unfinished");
		assert.match(error.outcome.reason, /cleanup/i);
		assert.deepEqual(error.outcome.errors, ["EOF cleanup execution failed"]);
		assert.deepEqual(error.outcome.permissionDenials, [{ tool_name: "Bash" }]);
		assert.equal(error.outcome.text, "Initial completion");
		assert.equal(error.outcome.continuations, 0);
		return true;
	});
	assert.equal(events.at(-1).type, "worker_exit");
	assert.equal(events.at(-1).disposition, "unfinished");
	assert.equal((await fake.frames()).filter((frame) => frame.type === "user").length, 1);
});

test("a cleanup execution failure after a needs-input pause leads the unfinished reason and keeps the question", { timeout: 15_000 }, async (t) => {
	const fake = await fixture(t, { body: `
input.on("line", (line) => {
 if (JSON.parse(line).type !== "user") return;
 send({ type: "system", subtype: "init", session_id: "${SESSION_ID}" });
 send({ type: "result", uuid: "paused", subtype: "success", session_id: "${SESSION_ID}", structured_output: completion("needs_input", { question: "Which target?" }) });
});
input.on("close", () => {
 send({ type: "result", uuid: "late-error", subtype: "error_during_execution", is_error: true, origin: { kind: "task-notification" }, session_id: "${SESSION_ID}", errors: ["EOF cleanup execution failed"] });
 setTimeout(() => process.exit(0), 25);
});
` });
	await assert.rejects(runClaude({ ...fake, prompt: "Inspect" }), (error) => {
		assert.equal(error.outcome.disposition, "unfinished");
		assert.match(error.outcome.reason, /^Claude Code execution failed during cleanup/);
		assert.match(error.outcome.reason, /Which target\?/);
		assert.equal(error.outcome.report.question, "Which target?");
		return true;
	});
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
