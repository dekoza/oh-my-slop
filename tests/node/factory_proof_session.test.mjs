import assert from "node:assert/strict";
import test from "node:test";

import {
	claudeCellArguments,
	claudeCellInput,
	readClaudeTranscript,
	runClaudeCell,
} from "../../factory/lib/proof/claude-session.mjs";
import {
	CLAUDE_PROBE_ONLY_FLAGS,
	claudeProfileArguments,
	claudeWorkerArguments,
} from "../../factory/lib/worker/claude.mjs";

/**
 * #160's rule, applied to §6.7's matrix: **a cell must be produced in a session
 * launched with the worker binding.**
 *
 * A matrix cell proven under any other flag set proves a session no worker runs
 * in, which is the exact defect class #160 closed — a probe green about an
 * environment its workers never got. The identity is asserted here rather than
 * kept by care, and the composition is the one the launch and §6.2's spelling
 * proof already share.
 */

const PROFILE = Object.freeze({ name: "opus-builder", kind: "claude", model: "opus", effort: "high" });
const SESSION_ARGS = Object.freeze(["--settings", "/cfg/settings-builder.json", "--permission-mode", "dontAsk"]);

test("a cell's argv is the worker binding, plus the profile's flags, plus the probe-only IO flags", () => {
	assert.deepEqual(claudeCellArguments({ pluginDir: "/store/plugins/rev-1", sessionArgs: SESSION_ARGS, profile: PROFILE }), [
		...claudeWorkerArguments("/store/plugins/rev-1", SESSION_ARGS),
		...claudeProfileArguments(PROFILE),
		...CLAUDE_PROBE_ONLY_FLAGS,
	]);
});

test("a cell keeps the discovery fence every worker session carries", () => {
	// §6.8's fence is worker-session isolation, not a probe flag (#163). A cell
	// that dropped it would prove loading in a session that also loads whatever
	// its working directory ships.
	const argv = claudeCellArguments({ pluginDir: "/store/plugins/rev-1", sessionArgs: [], profile: PROFILE });

	assert.ok(argv.includes("--setting-sources"));
	assert.equal(argv[argv.indexOf("--setting-sources") + 1], "user");
});

test("the prompt crosses as one stream-json user message", () => {
	assert.deepEqual(JSON.parse(claudeCellInput("hello\nthere")), {
		type: "user",
		message: { role: "user", content: [{ type: "text", text: "hello\nthere" }] },
	});
});

// ── Reading what the session said ───────────────────────────────────────────

function lines(...frames) {
	return { status: 0, lines: frames.map((frame) => JSON.stringify(frame)), stderr: "", timedOut: false };
}

const ASSISTANT = Object.freeze({
	type: "assistant",
	message: {
		model: "claude-opus-5",
		content: [
			{ type: "tool_use", name: "Skill", input: { command: "oh-my-slop:skill-loading-proof" } },
			{ type: "text", text: "SKILL-LOADING-PROOF tok 321CBA" },
		],
	},
});

const RESULT = Object.freeze({
	type: "result",
	subtype: "success",
	result: "SKILL-LOADING-PROOF tok 321CBA",
	session_id: "abc-123",
	modelUsage: { "claude-opus-5": { inputTokens: 10 } },
});

test("a completed session yields its text, its tool uses, its session id and its resolved model", () => {
	const transcript = readClaudeTranscript(lines({ type: "system", subtype: "init" }, ASSISTANT, RESULT));

	assert.equal(transcript.answered, true);
	assert.ok(transcript.text.includes("SKILL-LOADING-PROOF tok 321CBA"));
	assert.deepEqual(transcript.toolUses.map((use) => use.name), ["Skill"]);
	assert.equal(transcript.sessionId, "abc-123");
	assert.equal(transcript.resolvedModel, "claude-opus-5");
});

test("the resolved id is the one the session billed, not the alias the profile declared", () => {
	// §11.7 pins the model twice and persists the **observed** id. `modelUsage`
	// is keyed by it, which is why it is read before the assistant frame's own
	// field rather than after.
	const transcript = readClaudeTranscript(
		lines({ ...ASSISTANT, message: { ...ASSISTANT.message, model: "opus" } }, RESULT),
	);

	assert.equal(transcript.resolvedModel, "claude-opus-5");
});

test("an assistant frame answers even when no result frame arrives", () => {
	const transcript = readClaudeTranscript(lines(ASSISTANT));

	assert.equal(transcript.answered, true);
	assert.equal(transcript.resolvedModel, "claude-opus-5");
	assert.equal(transcript.sessionId, null);
});

test("a session that produced no assistant text has not answered, and says why", () => {
	const transcript = readClaudeTranscript({
		status: 1,
		lines: [],
		stderr: "error: unknown option '--efffort'\n(Did you mean --effort?)",
		timedOut: false,
	});

	assert.equal(transcript.answered, false);
	assert.match(transcript.said, /exit 1/);
	assert.match(transcript.said, /--efffort/);
});

test("a session that wedged says so rather than reporting an exit it never reached", () => {
	const transcript = readClaudeTranscript({ status: null, lines: [], stderr: "", timedOut: true });

	assert.equal(transcript.answered, false);
	assert.match(transcript.said, /answered nothing/);
});

test("an execution error is a fact about the cell, never an exception out of the matrix", async () => {
	// One unspawnable binary must not lose the cells that would have run after
	// it: the matrix records the whole point on its three axes or it records a
	// hole, and a throw here would produce neither.
	const transcript = await runClaudeCell(
		{
			lineSession() {
				throw new Error("spawn claude ENOENT");
			},
		},
		{ binary: "claude", pluginDir: "/p", sessionArgs: [], profile: PROFILE, prompt: "hi", timeoutMs: 10 },
	);

	assert.equal(transcript.answered, false);
	assert.match(transcript.said, /ENOENT/);
});

test("a cell runs the argv it says it runs", async () => {
	let seen = null;
	const transcript = await runClaudeCell(
		{
			lineSession(session) {
				seen = session;
				return lines(ASSISTANT, RESULT);
			},
		},
		{
			binary: "/usr/bin/claude",
			pluginDir: "/store/plugins/rev-1",
			sessionArgs: SESSION_ARGS,
			profile: PROFILE,
			prompt: "hi",
			timeoutMs: 90_000,
			where: { env: { CLAUDE_CONFIG_DIR: "/cfg" }, cwd: "/work" },
		},
	);

	assert.deepEqual(seen.args, claudeCellArguments({ pluginDir: "/store/plugins/rev-1", sessionArgs: SESSION_ARGS, profile: PROFILE }));
	assert.deepEqual(seen.input, [claudeCellInput("hi")]);
	assert.equal(seen.cwd, "/work");
	assert.equal(seen.env.CLAUDE_CONFIG_DIR, "/cfg");
	assert.equal(transcript.answered, true);
});
