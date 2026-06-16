import test from "node:test";
import assert from "node:assert/strict";

import {
	normalizeMessage,
	extractAssistantText,
	detectLoop,
	checkToolErrors,
	buildLoopIntervention,
	buildMistakeIntervention,
	buildRecentContext,
} from "../../extensions/workflow-watchdog/lib/detectors.mjs";

// ── normalizeMessage ─────────────────────────────────────────────────────────

test("normalizeMessage collapses extra whitespace", () => {
	assert.equal(
		normalizeMessage("  hello   world\n\n\t  test  "),
		"hello world test",
	);
});

test("normalizeMessage lowercases input", () => {
	assert.equal(normalizeMessage("Hello WORLD"), "hello world");
});

test("normalizeMessage truncates to maxLen", () => {
	const long = "abcdefghij".repeat(60);
	const result = normalizeMessage(long, 100);
	assert.equal(result.length, 100);
	assert.ok(result.startsWith("abcdefghij"));
});

test("normalizeMessage returns empty string for empty input", () => {
	assert.equal(normalizeMessage(""), "");
	assert.equal(normalizeMessage("   "), "");
});

// ── extractAssistantText ──────────────────────────────────────────────────────

test("extractAssistantText joins text blocks", () => {
	const content = [
		{ type: "text", text: "Hello" },
		{ type: "text", text: "world" },
	];
	assert.equal(extractAssistantText(content), "Hello world");
});

test("extractAssistantText skips non-text blocks", () => {
	const content = [
		{ type: "text", text: "Hello" },
		{ type: "tool_use", name: "bash" },
		{ type: "text", text: "world" },
	];
	assert.equal(extractAssistantText(content), "Hello world");
});

test("extractAssistantText returns empty string for non-array or empty", () => {
	assert.equal(extractAssistantText(null), "");
	assert.equal(extractAssistantText(undefined), "");
	assert.equal(extractAssistantText([]), "");
});

// ── detectLoop — single message repeats ───────────────────────────────────────

const cfg = { windowSize: 12, minRepetitions: 3, sequenceLength: 2 };

test("detectLoop: no messages -> no loop", () => {
	assert.deepEqual(detectLoop(cfg, []), { detected: false, repeatCount: 0 });
});

test("detectLoop: below threshold -> no loop", () => {
	const msgs = ["msg a", "msg b", "msg a", "msg a"];
	assert.deepEqual(detectLoop(cfg, msgs), { detected: false, repeatCount: 0 });
});

test("detectLoop: three same messages at end -> detected", () => {
	const msg = "this is a repeated message"; // >= 10 chars
	const msgs = [msg, msg, msg];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 3);
});

test("detectLoop: four same messages -> detected with count 4", () => {
	const msg = "this is a repeated message";
	const msgs = ["something else", msg, msg, msg, msg];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 4);
});

test("detectLoop: repeats not at end -> not detected", () => {
	// 3 "msg"s in the middle but only 2 "other"s at the end
	const msg = "this is a repeated message";
	const other = "some other message here";
	const msgs = [msg, msg, msg, other, other];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, false);
});

test("detectLoop: too short messages are ignored", () => {
	const msgs = ["ok", "ok", "ok"]; // each < 10 chars
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, false);
});

test("detectLoop: messages scattered among other content -> only trailing repeats count", () => {
	const msg = "this is a repeated message";
	const other = "some unique content here";
	const msgs = [msg, other, msg, other, msg, msg, msg];
	// The 3 repeated messages at the end should be detected
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 3);
});

// ── detectLoop — sequence repeats ────────────────────────────────────────────

test("detectLoop: A-B-A-B-A-B pattern detected (3 cycles)", () => {
	const msgA = "message alpha is the first pattern";
	const msgB = "message beta is the second pattern";
	const msgs = [msgA, msgB, msgA, msgB, msgA, msgB];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 3);
});

test("detectLoop: A-B-A-B pattern (2 cycles) not enough for threshold 3", () => {
	const msgA = "message alpha is the first pattern";
	const msgB = "message beta is the second pattern";
	const msgs = [msgA, msgB, msgA, msgB];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, false);
});

test("detectLoop: sequence broken by different message -> not detected", () => {
	const msgA = "message alpha is the first pattern";
	const msgB = "message beta is the second pattern";
	const diff = "something completely different here";
	const msgs = [msgA, msgB, msgA, msgB, diff, msgA, msgB];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, false);
});

test("detectLoop: sequence with larger window works", () => {
	const msgA = "message alpha is the first pattern";
	const msgB = "message beta is the second pattern";
	const filler = "some prefix messages that fill the buffer space";
	const msgs = [
		filler, filler, filler, filler, filler,
		msgA, msgB, msgA, msgB, msgA, msgB,
	];
	const bigCfg = { windowSize: 12, minRepetitions: 3, sequenceLength: 2 };
	const result = detectLoop(bigCfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 3);
});

// ── detectLoop — real-world pattern simulation ───────────────────────────────

test("detectLoop: simulates 'I'll fix X' → error → repeat loop", () => {
	// Model keeps trying to fix something, making the same edit, getting the same error
	const msgs = [
		"i'll fix the import path",
		"i'll fix the import path", // error turn (message after error report)
		"i'll fix the import path", // error turn
		"i'll fix the import path", // error turn
	];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 4);
});

test("detectLoop: simulates alternating 'fix' then 'test' then 'fix' loop", () => {
	const msgs = [
		"i'll fix the failing test",
		"running the test suite again",
		"i'll fix the failing test",
		"running the test suite again",
		"i'll fix the failing test",
		"running the test suite again",
	];
	const result = detectLoop(cfg, msgs);
	assert.equal(result.detected, true);
	assert.equal(result.repeatCount, 3);
});

// ── checkToolErrors ──────────────────────────────────────────────────────────

test("checkToolErrors: returns true when any tool has isError", () => {
	const results = [
		{ toolName: "bash", isError: false },
		{ toolName: "read", isError: true },
	];
	assert.equal(checkToolErrors(results), true);
});

test("checkToolErrors: returns false when no errors", () => {
	const results = [
		{ toolName: "bash", isError: false },
		{ toolName: "read", isError: false },
	];
	assert.equal(checkToolErrors(results), false);
});

test("checkToolErrors: returns false for empty or missing", () => {
	assert.equal(checkToolErrors([]), false);
	assert.equal(checkToolErrors(null), false);
	assert.equal(checkToolErrors(undefined), false);
});

// ── buildLoopIntervention ─────────────────────────────────────────────────────

test("buildLoopIntervention contains repeat count", () => {
	const msg = buildLoopIntervention(5);
	assert.ok(msg.includes("5 times"));
	assert.ok(msg.includes("WORKFLOW WATCHDOG"));
	assert.ok(msg.includes("DIFFERENT strategy"));
});

// ── buildMistakeIntervention ──────────────────────────────────────────────────

test("buildMistakeIntervention contains error count", () => {
	const msg = buildMistakeIntervention(3);
	assert.ok(msg.includes("3 consecutive turns"));
	assert.ok(msg.includes("WORKFLOW WATCHDOG"));
	assert.ok(msg.includes("Re-read the error messages"));
});

// ── buildRecentContext ────────────────────────────────────────────────────────

test("buildRecentContext includes stats and messages", () => {
	const messages = ["first msg", "second msg", "third msg", "fourth msg"];
	const ctx = buildRecentContext(messages, 2, 10);

	assert.ok(ctx.includes("Total turns in session: 10"));
	assert.ok(ctx.includes("Consecutive error turns: 2"));
	assert.ok(ctx.includes("Recent assistant messages:"));
	assert.ok(ctx.includes("LATEST"));
	assert.ok(ctx.includes("fourth msg"));
});

test("buildRecentContext truncates long messages", () => {
	const long = "x".repeat(500);
	const messages = ["short", long, "another"];
	const ctx = buildRecentContext(messages, 1, 5);

	assert.ok(ctx.includes("another"));
	assert.ok(ctx.includes("xxx")); // first part of the long message
	// Should be truncated to 300 chars as used in slice(0, 300)
	assert.ok(!ctx.includes("x".repeat(400)));
});

test("buildRecentContext handles many messages by showing last 8", () => {
	const messages = Array.from({ length: 20 }, (_, i) => `msg ${i}`);
	const ctx = buildRecentContext(messages, 0, 20);

	// Should only show last 8 messages (indices 12-19)
	assert.ok(ctx.includes("msg 19"));
	assert.ok(ctx.includes("msg 12"));
	assert.ok(!ctx.includes("msg 10"));
	assert.ok(!ctx.includes("msg 0"));
});