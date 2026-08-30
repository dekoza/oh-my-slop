import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	CLAUDE_PROBE_ONLY_FLAGS,
	claudeProfileArguments,
	claudeSpellingArguments,
	claudeWorkerArguments,
	proveClaudeProfileFlags,
} from "../../factory/lib/worker/claude.mjs";
import {
	PI_PROBE_ONLY_FLAGS,
	piProfileArguments,
	piSpellingArguments,
	piWorkerArguments,
	provePiProfileFlags,
} from "../../factory/lib/worker/pi.mjs";
import { createWorkerPreflight } from "../../factory/lib/worker/preflight.mjs";
import { runCommand } from "../../factory/lib/worker/transports.mjs";
import { makeTree, realGeneratorFiles, skillMarkdown } from "./helpers/factory-package.mjs";
import { claudeProjectSkills, skillCommandsOf } from "./helpers/factory-worker.mjs";

/**
 * #164: the profile's own flags — `--model`, and Claude's `--effort` / pi's
 * `--thinking` — are appended at launch, and before this slice nothing handed
 * them to the installed binary. #160's defect one argument set down: something
 * the worker runs under that no probe exercises, surfacing as a pane that will
 * not come up **after** a branch, a worktree and the tracker claim exist.
 *
 * These tests hold the composition: the argv the spelling proof hands the binary
 * is the argv a pane receives, plus the probe-only IO flags and nothing else.
 */

// ── The composed binding, one argument set down (§6.2, #164) ──────────────────

test("a pi profile contributes its model, and its thinking level only when declared", () => {
	assert.deepEqual(piProfileArguments({ name: "builder", model: "local/qwen3" }), ["--model", "local/qwen3"]);
	assert.deepEqual(piProfileArguments({ name: "builder", model: "local/qwen3", thinking: "high" }), [
		"--model",
		"local/qwen3",
		"--thinking",
		"high",
	]);
});

test("a Claude profile contributes its model, and its effort only when declared", () => {
	assert.deepEqual(claudeProfileArguments({ name: "reader", model: "opus" }), ["--model", "opus"]);
	assert.deepEqual(claudeProfileArguments({ name: "big", model: "opus", effort: "high" }), [
		"--model",
		"opus",
		"--effort",
		"high",
	]);
});

test("the pi spelling proof runs the launch argv plus the probe-only flags, and nothing else", () => {
	const profile = { name: "builder", model: "local/qwen3", thinking: "high" };
	const sessionArgs = ["--exclude-tools", "edit,write"];
	const launched = [...piWorkerArguments(["/pin/skills"], sessionArgs), ...piProfileArguments(profile)];

	const spelling = piSpellingArguments(["/pin/skills"], sessionArgs, profile);

	assert.deepEqual(spelling.slice(0, PI_PROBE_ONLY_FLAGS.length), [...PI_PROBE_ONLY_FLAGS]);
	assert.deepEqual(spelling.slice(PI_PROBE_ONLY_FLAGS.length), launched);
});

test("the Claude spelling proof runs the launch argv plus the probe-only flags, and nothing else", () => {
	const profile = { name: "big", model: "opus", effort: "high" };
	const sessionArgs = ["--settings", "/cfg/settings-builder.json"];
	const launched = [...claudeWorkerArguments("/store/plugins/rev-1", sessionArgs), ...claudeProfileArguments(profile)];

	const spelling = claudeSpellingArguments("/store/plugins/rev-1", sessionArgs, profile);

	assert.deepEqual(spelling.slice(-CLAUDE_PROBE_ONLY_FLAGS.length), [...CLAUDE_PROBE_ONLY_FLAGS]);
	assert.deepEqual(spelling.slice(0, -CLAUDE_PROBE_ONLY_FLAGS.length), launched);
});

// ── The proof: a session that answers, or a refusal that names the flag ───────

/**
 * A harness that parses its argv the way both installed binaries were measured
 * to: an option it does not know is refused **before** the session starts, with
 * a non-zero exit and two stderr lines — the diagnosis naming the spelling, then
 * a hint that names no flag at all. That order is Claude 2.1.233's, measured:
 * `error: unknown option '--efffort'` followed by `(Did you mean --effort?)`, so
 * a refusal that quoted the *last* line would drop the useful half.
 */
function refusedSpelling(args, known) {
	const unknown = args.filter((word) => word.startsWith("--") && !known.includes(word));
	if (unknown.length === 0) return null;
	return {
		status: 1,
		timedOut: false,
		// The diagnosis first and a hint after it, as measured — a refusal quoting
		// the last line would keep the half naming no flag.
		stderr: `error: unknown option '${unknown[0]}'\n(Did you mean something else?)\n`,
		lines: [],
	};
}

function parsingHarness({ known, answer }) {
	const sessions = [];
	return {
		sessions,
		transport: {
			lineSession: async (session) => {
				sessions.push(session);
				return (
					refusedSpelling(session.args, known) ?? { status: 0, timedOut: false, stderr: "", lines: [answer(session)] }
				);
			},
		},
	};
}

const PI_KNOWN = [
	"--mode",
	"--no-session",
	"--no-skills",
	// §6.8's trust approval rides the worker binding, so the spelling proof hands
	// it to the binary too (#178).
	"--approve",
	"--skill",
	"--exclude-tools",
	"--model",
	"--thinking",
];
const CLAUDE_KNOWN = [
	"--plugin-dir",
	// §6.8's discovery fence rides the worker binding, so the spelling proof
	// hands it to the binary too (#163) — and #178's browser fence beside it.
	"--no-chrome",
	"--setting-sources",
	"--settings",
	"--permission-mode",
	"--input-format",
	"--output-format",
	"--print",
	"--verbose",
	"--model",
	"--effort",
];

const piAnswer = () =>
	JSON.stringify({ type: "response", command: "get_commands", success: true, data: { commands: [] } });

const claudeAnswer = (session) =>
	JSON.stringify({
		type: "control_response",
		response: { subtype: "success", request_id: JSON.parse(session.input[0]).request_id, response: {} },
	});

test("a pi profile whose flags the binary accepts is proven by one session over the launch argv", async () => {
	const profiles = [{ name: "builder", model: "local/qwen3", thinking: "high" }];
	const harness = parsingHarness({ known: PI_KNOWN, answer: piAnswer });

	const proven = await provePiProfileFlags({
		profiles,
		skillsRoots: ["/pin/skills"],
		session: { sessionArgs: ["--exclude-tools", "edit,write"] },
		transport: harness.transport,
	});

	assert.deepEqual(proven.findings, []);
	assert.deepEqual(proven.checked, [{ profile: "builder", flags: ["--model", "--thinking"] }]);
	assert.equal(harness.sessions.length, 1, "the spelling proof cost more than one session per profile");
	// Spelled out rather than recomputed from the builder the prover itself calls:
	// this is the argv a pane receives, and the expectation has to come from
	// somewhere other than the code under test.
	assert.deepEqual(harness.sessions[0].args, [
		"--mode",
		"rpc",
		"--no-session",
		"--no-skills",
		"--approve",
		"--skill",
		"/pin/skills",
		"--exclude-tools",
		"edit,write",
		"--model",
		"local/qwen3",
		"--thinking",
		"high",
	]);
});

test("a pi flag the installed binary does not accept is a finding naming profile, flag and binary", async () => {
	const harness = parsingHarness({ known: PI_KNOWN.filter((flag) => flag !== "--thinking"), answer: piAnswer });

	const proven = await provePiProfileFlags({
		profiles: [{ name: "builder", model: "local/qwen3", thinking: "high" }],
		skillsRoots: ["/pin/skills"],
		transport: harness.transport,
	});

	assert.equal(proven.findings.length, 1);
	const [finding] = proven.findings;
	assert.equal(finding.reason, "profile-flags-unaccepted");
	assert.equal(finding.profile, "builder");
	assert.deepEqual(finding.flags, ["--model", "--thinking"]);
	assert.equal(finding.binary, "pi");
	// The binary's own diagnostic, not a guess of ours about which flag moved —
	// and the line that names the flag, not the hint that trails it.
	assert.match(finding.message, /unknown option '--thinking'/);
	assert.doesNotMatch(finding.message, /Did you mean/);
	assert.match(finding.message, /"builder"/);
});

test("a Claude profile whose flags the binary accepts is proven by one session over the launch argv", async () => {
	const profiles = [{ name: "big", model: "opus", effort: "high" }];
	const harness = parsingHarness({ known: CLAUDE_KNOWN, answer: claudeAnswer });

	const proven = await proveClaudeProfileFlags({
		profiles,
		pluginDir: "/store/plugins/rev-1",
		session: { sessionArgs: ["--settings", "/cfg/settings-builder.json"] },
		transport: harness.transport,
	});

	assert.deepEqual(proven.findings, []);
	assert.deepEqual(proven.checked, [{ profile: "big", flags: ["--model", "--effort"] }]);
	assert.equal(harness.sessions.length, 1);
	assert.deepEqual(harness.sessions[0].args, [
		"--plugin-dir",
		"/store/plugins/rev-1",
		"--no-chrome",
		"--setting-sources",
		"user",
		"--settings",
		"/cfg/settings-builder.json",
		"--model",
		"opus",
		"--effort",
		"high",
		...CLAUDE_PROBE_ONLY_FLAGS,
	]);
});

test("a Claude flag the installed binary does not accept is a finding naming profile, flag and binary", async () => {
	const harness = parsingHarness({ known: CLAUDE_KNOWN.filter((flag) => flag !== "--effort"), answer: claudeAnswer });

	const proven = await proveClaudeProfileFlags({
		profiles: [{ name: "big", model: "opus", effort: "high" }],
		pluginDir: "/store/plugins/rev-1",
		transport: harness.transport,
	});

	assert.equal(proven.findings.length, 1);
	const [finding] = proven.findings;
	assert.equal(finding.reason, "profile-flags-unaccepted");
	assert.equal(finding.profile, "big");
	assert.deepEqual(finding.flags, ["--model", "--effort"]);
	assert.equal(finding.binary, "claude");
	assert.match(finding.message, /unknown option '--effort'/);
});

test("a harness that takes the argv and never answers is a refusal, not a pass", async () => {
	const proven = await provePiProfileFlags({
		profiles: [{ name: "builder", model: "local/qwen3" }],
		skillsRoots: ["/pin/skills"],
		timeoutMs: 250,
		transport: { lineSession: async () => ({ status: null, timedOut: true, stderr: "", lines: [] }) },
	});

	assert.equal(proven.findings.length, 1);
	assert.equal(proven.findings[0].reason, "profile-flags-unaccepted");
	assert.match(proven.findings[0].message, /250ms/);
});

test("a binary that cannot be spawned was never asked about a spelling, and is not blamed for one", async () => {
	const proven = await proveClaudeProfileFlags({
		profiles: [{ name: "big", model: "opus" }],
		pluginDir: "/store/plugins/rev-1",
		transport: {
			lineSession: async () => {
				throw new Error("spawn claude ENOENT");
			},
		},
	});

	// A refusal, never an exception out of preflight — but §11.7's word for a
	// binary that is not there, not "your profile's flags are wrong".
	assert.equal(proven.findings.length, 1);
	assert.equal(proven.findings[0].reason, "runtime-unreachable");
	assert.match(proven.findings[0].message, /ENOENT/);
	assert.doesNotMatch(proven.findings[0].message, /spelling/);
});

test("a stderr line about a longer flag is not quoted as the diagnosis for a shorter one", async () => {
	const proven = await provePiProfileFlags({
		profiles: [{ name: "builder", model: "local/qwen3" }],
		skillsRoots: ["/pin/skills"],
		transport: {
			// `--models` contains `--model`, so a substring match would read this
			// unrelated line as the verdict on the flag the profile declares.
			lineSession: async () => ({
				status: 1,
				timedOut: false,
				stderr: "warning: --models is deprecated\nError: catalog unreadable\n",
				lines: [],
			}),
		},
	});

	assert.equal(proven.findings.length, 1);
	assert.match(proven.findings[0].message, /Error: catalog unreadable/);
	assert.doesNotMatch(proven.findings[0].message, /--models/);
});

// ── The preflight check: once per distinct profile, and only that (§6.2) ──────

/**
 * A whole pi harness that also parses its argv: `--version`, the probe's two RPC
 * answers, the router's `/props`, and a refusal for any option `known` omits.
 * The runtime probe and the spelling proof both run through it, so the sessions
 * this records are every session a preflight spends.
 */
function piPreflightHarness(packageRoot, { known = PI_KNOWN } = {}) {
	const sessions = [];
	const commands = skillCommandsOf(packageRoot);

	return {
		sessions,
		transport: {
			runCommand: async () => ({ status: 0, stdout: "0.52.0-test", stderr: "" }),
			lineSession: async (session) => {
				sessions.push(session);
				const refused = refusedSpelling(session.args, known);
				if (refused !== null) return refused;
				return {
					status: 0,
					timedOut: false,
					stderr: "",
					lines: [
						JSON.stringify({ type: "response", command: "get_commands", success: true, data: { commands } }),
						JSON.stringify({
							type: "response",
							command: "get_available_models",
							success: true,
							data: { models: [{ id: "qwen3", provider: "local", baseUrl: "http://127.0.0.1:9/v1" }] },
						}),
					],
				};
			},
			httpGet: async () => ({ status: 200, body: JSON.stringify({ role: "router", max_instances: 1 }) }),
		},
	};
}

/**
 * A pi-only run, so the whole preflight is drivable from one fake harness. The
 * routing names `builder` for every role **and** in a rule — five namings of one
 * profile, which §6.2's "one request" says must cost one check.
 */
function piLab(t, { profiles, routing, known } = {}) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-profile-flags-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const packageRoot = makeTree(t, {
		"package.json": JSON.stringify({ name: "oh-my-slop", version: "9.9.9", description: "f", author: "F" }),
		"skills/workflow/implement/SKILL.md": skillMarkdown("implement"),
		"skills/practice/review-standards/SKILL.md": skillMarkdown("review-standards"),
		"skills/practice/review-spec/SKILL.md": skillMarkdown("review-spec"),
	});

	const storeDir = join(root, "store");
	mkdirSync(storeDir, { recursive: true });
	mkdirSync(join(root, "repo"), { recursive: true });

	const harness = piPreflightHarness(packageRoot, { known });
	const preflight = createWorkerPreflight({
		handshake: {
			package: { root: packageRoot, name: "oh-my-slop", version: "9.9.9" },
			tree: { digest: "rev-1" },
			participants: [{ kind: "skills-root", path: join(packageRoot, "skills") }],
		},
		config: {
			worker: { denies: [], contextFile: null, piExtensions: [] },
			profiles: profiles ?? { builder: { kind: "pi", model: "local/qwen3", thinking: "high" } },
			concurrency: { resources: { local: 1 } },
		},
		activeRouting:
			routing ?? {
				set: null,
				roles: { implement: "builder", freshRetry: "builder", review: ["builder", "builder"] },
				rules: [{ role: "implement", labelsAny: ["fast"], profile: "builder" }],
			},
		cacheRoot: storeDir,
		repoRoot: join(root, "repo"),
		env: { HOME: join(root, "home") },
		transports: { pi: harness.transport },
	});

	preflight.isolationCheck();
	return { harness, preflight };
}

test("a routing table naming one profile five times costs one spelling check", async (t) => {
	const lab = piLab(t);

	assert.equal((await lab.preflight.runtimeCheck()).result, "passed");
	const probeSessions = lab.harness.sessions.length;
	const checked = await lab.preflight.profileFlagsCheck();

	assert.equal(checked.result, "passed");
	assert.equal(checked.class, "probe");
	assert.deepEqual(checked.detail.profiles, [
		{ profile: "builder", kind: "pi", flags: ["--model", "--thinking"], binary: "pi" },
	]);
	assert.equal(
		lab.harness.sessions.length - probeSessions,
		1,
		"the spelling check is per distinct profile, not per role or per attempt",
	);
	// §6.2's own cardinality is untouched: the runtime probe stayed one session
	// for the whole revision, whatever the routing names.
	assert.equal(probeSessions, 1);
});

test("each distinct profile is checked, and the argv is the one its pane would receive", async (t) => {
	const lab = piLab(t, {
		profiles: {
			builder: { kind: "pi", model: "local/qwen3", thinking: "high" },
			reader: { kind: "pi", model: "local/qwen3" },
		},
		routing: {
			set: null,
			roles: { implement: "builder", freshRetry: "builder", review: ["reader", "reader"] },
			rules: [],
		},
	});

	await lab.preflight.runtimeCheck();
	const checked = await lab.preflight.profileFlagsCheck();

	assert.equal(checked.result, "passed");
	assert.deepEqual(
		checked.detail.profiles.map((entry) => entry.profile),
		["builder", "reader"],
	);
	const spelling = lab.harness.sessions.slice(1).map((session) => session.args);
	assert.ok(
		spelling.every((args) => args.includes("--no-skills") && args.includes("--model")),
		"a spelling session ran an argv no pane receives",
	);
	assert.deepEqual(
		spelling.map((args) => args.filter((word) => word === "--thinking").length),
		[1, 0],
	);
});

test("a flag the installed binary refuses is a red preflight check, not a launch failure", async (t) => {
	const lab = piLab(t, { known: PI_KNOWN.filter((flag) => flag !== "--thinking") });

	// The runtime probe is green: it never passes the profile's flags, which is
	// exactly the gap #164 closes — and what makes this verdict a spelling one.
	assert.equal((await lab.preflight.runtimeCheck()).result, "passed");
	const checked = await lab.preflight.profileFlagsCheck();

	assert.equal(checked.result, "failed");
	assert.match(checked.message, /"builder"/);
	assert.match(checked.message, /--thinking/);
	assert.match(checked.message, /`pi`/);
	assert.deepEqual(
		checked.detail.findings.map((finding) => finding.reason),
		["profile-flags-unaccepted"],
	);
	assert.equal(lab.preflight.productionContext(), null, "a run whose profile flags are unproven still composed");
});

test("the spelling check refuses rather than answers when the runtime probe has not gone green", async (t) => {
	const lab = piLab(t);

	// Never calling runtimeCheck() is the same state as its failing: there is no
	// proven runtime to attribute a spelling verdict against.
	const checked = await lab.preflight.profileFlagsCheck();

	assert.equal(checked.result, "failed");
	assert.equal(checked.detail.cause, "runtime-probe");
	assert.equal(lab.harness.sessions.length, 0, "a check that cannot answer spent a session anyway");
});

/**
 * A Claude harness for the whole preflight: `--version`, strict validation, the
 * component inventory, and the `initialize` control-response — refusing any
 * option `known` omits, exactly as the pi one does.
 */
function claudePreflightHarness(skills, { known = CLAUDE_KNOWN } = {}) {
	const sessions = [];
	return {
		sessions,
		transport: {
			// Only `claude` is faked: the §6.3 plugin is built by the **real**
			// generator, so the directory the spelling session is handed is a
			// directory that exists.
			runCommand: async (command, args, options) => {
				if (command !== "claude") return runCommand(command, args, options);
				if (args[0] === "--version") return { status: 0, stdout: "2.1.233-test", stderr: "" };
				if (args.includes("validate")) return { status: 0, stdout: "✔", stderr: "" };
				return { status: 0, stdout: `  Skills (${skills.length})  ${skills.join(", ")}\n`, stderr: "" };
			},
			lineSession: async (session) => {
				sessions.push(session);
				const refused = refusedSpelling(session.args, known);
				if (refused !== null) return refused;
				return {
					status: 0,
					timedOut: false,
					stderr: "",
					lines: [
						JSON.stringify({
							type: "control_response",
							response: {
								subtype: "success",
								request_id: JSON.parse(session.input[0]).request_id,
								response: {
									// The plugin's skills, plus whatever project skills this
									// session's cwd ships and the fence let in (#163) — without
									// which the fence proof's control session sees nothing.
									commands: [
										...skills.map((name) => ({ name: `oh-my-slop:${name}` })),
										...claudeProjectSkills(session),
									],
									models: [{ value: "opus", resolvedModel: "claude-opus-5-test" }],
								},
							},
						}),
					],
				};
			},
		},
	};
}

test("a Claude profile is checked over the plugin directory the runtime probe proved", async (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-profile-flags-claude-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const packageRoot = makeTree(t, {
		"package.json": JSON.stringify({ name: "oh-my-slop", version: "9.9.9", description: "f", author: "F" }),
		"skills/workflow/implement/SKILL.md": skillMarkdown("implement"),
		"skills/practice/review-standards/SKILL.md": skillMarkdown("review-standards"),
		"skills/practice/review-spec/SKILL.md": skillMarkdown("review-spec"),
		...realGeneratorFiles(),
	});
	const storeDir = join(root, "store");
	mkdirSync(storeDir, { recursive: true });
	mkdirSync(join(root, "repo"), { recursive: true });

	const harness = claudePreflightHarness(["implement", "review-standards", "review-spec"]);
	const preflight = createWorkerPreflight({
		handshake: {
			package: { root: packageRoot, name: "oh-my-slop", version: "9.9.9" },
			tree: { digest: "rev-1" },
			participants: [{ kind: "skills-root", path: join(packageRoot, "skills") }],
		},
		config: {
			worker: { denies: [], contextFile: null, piExtensions: [] },
			profiles: { big: { kind: "claude", model: "opus", effort: "high" } },
			concurrency: { resources: { "claude-code": 2 } },
		},
		activeRouting: { set: null, roles: { implement: "big", freshRetry: "big", review: ["big", "big"] }, rules: [] },
		cacheRoot: storeDir,
		repoRoot: join(root, "repo"),
		env: { HOME: join(root, "home") },
		transports: { claude: harness.transport },
	});

	preflight.isolationCheck();
	assert.equal((await preflight.runtimeCheck()).result, "passed");
	const checked = await preflight.profileFlagsCheck();

	assert.equal(checked.result, "passed");
	assert.deepEqual(checked.detail.profiles, [
		{ profile: "big", kind: "claude", flags: ["--model", "--effort"], binary: "claude" },
	]);

	// The proven §6.3 plugin, not a second computation of it: the spelling session
	// carries the same `--plugin-dir` the probe's own session did (#160).
	// Between them sits the fence proof's unfenced control session (#163), so the
	// spelling one is named by its position at the end rather than by an index.
	const [probed] = harness.sessions;
	const spelling = harness.sessions.at(-1);
	assert.deepEqual(spelling.args.slice(0, 2), probed.args.slice(0, 2));
	assert.equal(probed.args[0], "--plugin-dir");
	assert.deepEqual(
		spelling.args.slice(0, -CLAUDE_PROBE_ONLY_FLAGS.length).slice(-4),
		["--model", "opus", "--effort", "high"],
	);
});
