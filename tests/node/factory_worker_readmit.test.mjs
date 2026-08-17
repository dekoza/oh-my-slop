import test from "node:test";
import assert from "node:assert/strict";

import { createReadmissionProbe, DEFAULT_READMIT_PROBE_TIMEOUT_MS } from "../../factory/lib/worker/readmit.mjs";

/**
 * #154: **an expiry that has passed re-admits the class by probe, never by
 * assumption (§5.2).** The probe is one cheap completion on the class — the
 * worker binding's environment and flags, a one-line prompt, no pane — and it
 * answers `admitted`, `refused`, or `inconclusive`. Only the first two move
 * the memo; the third holds the class rather than opening it on a read that
 * answered nothing.
 */

const PLAN = Object.freeze({
	classes: Object.freeze([
		Object.freeze({ class: "local", size: 1, profiles: Object.freeze(["builder"]) }),
		Object.freeze({ class: "claude-code", size: 1, profiles: Object.freeze(["reviewer"]) }),
	]),
});

const PROFILES = Object.freeze({
	builder: Object.freeze({ kind: "pi", model: "local/qwen3" }),
	reviewer: Object.freeze({ kind: "claude", model: "opus" }),
});

const BINDINGS = Object.freeze({
	pi: Object.freeze({ env: Object.freeze({ PI_CODING_AGENT_DIR: "/state/worker/pi" }), args: Object.freeze([]) }),
	claude: Object.freeze({
		env: Object.freeze({ CLAUDE_CONFIG_DIR: "/state/worker/claude" }),
		args: Object.freeze(["--settings", "/state/worker/claude/settings.json"]),
	}),
});

function probe({ answer, reject = null, calls = [] } = {}) {
	const environment = {
		binding({ kind }) {
			return BINDINGS[kind];
		},
	};
	const transport = {
		runCommand: async (command, args, options) => {
			calls.push({ command, args, options });
			if (reject !== null) throw reject;
			return answer;
		},
	};
	return createReadmissionProbe({
		plan: PLAN,
		profiles: PROFILES,
		environment,
		repoRoot: "/repo",
		env: {},
		transport,
	});
}

test("a completion the provider answers is an admission", async () => {
	const calls = [];
	const probeClass = probe({ answer: { status: 0, stdout: "ok\n", stderr: "" }, calls });

	const result = await probeClass("local", { at: 1 });

	assert.equal(result.verdict, "admitted");
	assert.equal(result.evidence.model, "local/qwen3");
});

test("a completion the provider refuses for quota is a refusal carrying the signature", async () => {
	const probeClass = probe({
		answer: { status: 1, stdout: "", stderr: "Error: insufficient_quota: you exceeded your current quota\n" },
	});

	const result = await probeClass("local", { at: 1 });

	assert.equal(result.verdict, "refused");
	assert.ok(result.evidence.signatures.includes("quota"));
	assert.match(result.evidence.excerpt, /insufficient_quota/);
});

test("a failure with no refusal wording is inconclusive — the class stays locked on it", async () => {
	const probeClass = probe({ answer: { status: 1, stdout: "", stderr: "segfault in libssl\n" } });

	const result = await probeClass("local", { at: 1 });

	assert.equal(result.verdict, "inconclusive");
});

test("a probe that cannot run at all is inconclusive, never an admission", async () => {
	const probeClass = probe({ reject: new Error("spawn pi ENOENT") });

	const result = await probeClass("local", { at: 1 });

	assert.equal(result.verdict, "inconclusive");
	assert.match(result.evidence.reason, /probe-failed|ENOENT/i);
});

test("a class the plan does not carry refuses to answer", async () => {
	const probeClass = probe({ answer: { status: 0, stdout: "ok", stderr: "" } });

	const result = await probeClass("no-such-class", { at: 1 });

	assert.equal(result.verdict, "inconclusive");
	assert.equal(result.evidence.reason, "class-unknown");
});

test("the pi probe runs the worker binding plus the probe-only flags, and nothing else (#160's rule)", async () => {
	const calls = [];
	const probeClass = probe({ answer: { status: 0, stdout: "ok", stderr: "" }, calls });

	await probeClass("local", { at: 1 });

	assert.equal(calls.length, 1);
	const { command, args, options } = calls[0];
	assert.equal(command, "pi");
	assert.deepEqual(args, ["--print", "--no-session", "--no-tools", "--model", "local/qwen3", args.at(-1)]);
	assert.match(args.at(-1), /ok/, "the prompt is the cheap one-liner, not a ticket");
	assert.equal(options.env.PI_CODING_AGENT_DIR, "/state/worker/pi", "the probe runs the worker's isolated config");
	assert.equal(options.timeout, DEFAULT_READMIT_PROBE_TIMEOUT_MS);
});

test("the claude probe carries the worker binding's settings and the model flag", async () => {
	const calls = [];
	const probeClass = probe({ answer: { status: 0, stdout: "ok", stderr: "" }, calls });

	await probeClass("claude-code", { at: 1 });

	const { command, args, options } = calls[0];
	assert.equal(command, "claude");
	assert.deepEqual(args.slice(0, 2), ["--settings", "/state/worker/claude/settings.json"]);
	assert.ok(args.includes("--model"), "the profile's model reaches the probe");
	assert.ok(args.includes("opus"));
	assert.equal(options.env.CLAUDE_CONFIG_DIR, "/state/worker/claude");
});
