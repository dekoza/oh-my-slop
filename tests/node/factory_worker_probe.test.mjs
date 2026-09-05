import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createClaudeAdapter, probeClaudeRuntime, proveClaudeClosure } from "../../factory/lib/worker/claude.mjs";
import { createPiAdapter, probePiRuntime, provePiClosure } from "../../factory/lib/worker/pi.mjs";
import { makeTree, realGeneratorFiles, skillMarkdown } from "./helpers/factory-package.mjs";
import { claudeTransport, piTransport, skillCommandsOf } from "./helpers/factory-worker.mjs";

/**
 * §6.2's layer 2: the live per-runtime probe over the production path, with
 * §9.7's capacity observation folded into the same probe pass. The transports
 * are fakes answering with the live-captured shapes; everything above them —
 * parsing, closure proof, capacity verdicts — is the real code.
 */

function fixturePackage(t, { withGenerator = false } = {}) {
	return makeTree(t, {
		"package.json": JSON.stringify({
			name: "oh-my-slop",
			version: "9.9.9",
			description: "fixture",
			author: "Fixture",
		}),
		"skills/workflow/implement/SKILL.md": skillMarkdown("implement", { requires: ["tdd"] }),
		"skills/practice/tdd/SKILL.md": skillMarkdown("tdd"),
		...(withGenerator ? realGeneratorFiles() : {}),
	});
}

function piContext(root, transport, overrides = {}) {
	return {
		skillsRoots: [join(root, "skills")],
		profiles: [{ name: "builder", model: "local/qwen3" }],
		declaredResources: { local: 1 },
		requiredClasses: ["local"],
		transport,
		...overrides,
	};
}

// ── pi: the disposable RPC session (§6.2) ────────────────────────────────────

test("a green pi probe proves the closure, the models, and the observed capacity", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: skillCommandsOf(root) });

	const probed = await probePiRuntime(piContext(root, fake.transport));

	assert.equal(probed.ok, true);
	assert.equal(probed.version, "0.52.0-test");
	assert.deepEqual(provePiClosure(probed, ["implement", "tdd"], { skillsRoots: [join(root, "skills")] }), []);
	assert.deepEqual(probed.classes.local, {
		class: "local",
		declared: 1,
		models: ["qwen3"],
		endpoint: "http://127.0.0.1:9/v1",
		reachable: true,
		max_instances: 1,
	});

	// The production flag set, verbatim (§6.2).
	const [session] = fake.calls.lineSession;
	assert.deepEqual(session.args, [
		"--mode",
		"rpc",
		"--no-session",
		"--no-skills",
		"--approve",
		"--skill",
		join(root, "skills"),
	]);
	// The capacity fold: the same probe pass asked the endpoint, not a second subsystem.
	assert.deepEqual(fake.calls.httpGet, ["http://127.0.0.1:9/props"]);
});

test("a closure member with no skill: command record is unprovable — no degraded mode", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({
		commands: skillCommandsOf(root).filter((command) => command.name !== "skill:tdd"),
	});

	const probed = await probePiRuntime(piContext(root, fake.transport));
	const findings = provePiClosure(probed, ["implement", "tdd"], { skillsRoots: [join(root, "skills")] });

	assert.equal(findings.length, 1);
	assert.equal(findings[0].reason, "skill-not-invocable");
	assert.equal(findings[0].skill, "tdd");
	assert.match(findings[0].message, /no degraded prose-loading mode/);
});

test("a command record resolving outside the pinned root is shadowing, naming the source", async (t) => {
	const root = fixturePackage(t);
	const elsewhere = makeTree(t, { "tdd/SKILL.md": skillMarkdown("tdd") });
	const commands = skillCommandsOf(root).map((command) =>
		command.name === "skill:tdd"
			? { ...command, sourceInfo: { path: join(elsewhere, "tdd", "SKILL.md") } }
			: command,
	);
	const fake = piTransport({ commands });

	const probed = await probePiRuntime(piContext(root, fake.transport));
	const findings = provePiClosure(probed, ["tdd"], { skillsRoots: [join(root, "skills")] });

	assert.equal(findings.length, 1);
	assert.equal(findings[0].reason, "skill-shadowed");
	assert.match(findings[0].message, new RegExp(elsewhere.replaceAll("/", "\\/")));
});

test("a declared model the live inventory does not carry is a named failure", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: skillCommandsOf(root) });

	const probed = await probePiRuntime(
		piContext(root, fake.transport, { profiles: [{ name: "builder", model: "local/ghost-model" }] }),
	);

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "model-unavailable");
	assert.match(finding.message, /local\/ghost-model/);
	assert.equal(finding.profile, "builder");
});

// ── §9.7: capacity observation, folded in ────────────────────────────────────

test("a declared size exceeding observed max_instances names both values, never a clamp", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: skillCommandsOf(root) });

	const probed = await probePiRuntime(piContext(root, fake.transport, { declaredResources: { local: 3 } }));

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "capacity-exceeded");
	assert.equal(finding.declared, 3);
	assert.equal(finding.observed, 1);
	assert.match(finding.message, /declares 3 slots/);
	assert.match(finding.message, /max_instances 1/);
});

test("an unreachable required class names the class, the endpoint, and the fix — never capacity 0", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({
		commands: skillCommandsOf(root),
		props: new Error("connect ECONNREFUSED 127.0.0.1:9"),
	});

	const probed = await probePiRuntime(piContext(root, fake.transport));

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "class-unreachable");
	assert.equal(finding.class, "local");
	assert.equal(finding.endpoint, "http://127.0.0.1:9/v1");
	assert.match(finding.message, /Start the model endpoint/);
	assert.equal(probed.classes.local.reachable, false);
	assert.equal(probed.classes.local.max_instances, null);
});

test("a class with no model in the live inventory is unreachable, not silently sized", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: skillCommandsOf(root), models: [] });

	const probed = await probePiRuntime(piContext(root, fake.transport));

	const findings = probed.failures.filter((entry) => entry.reason === "class-unreachable");
	assert.equal(findings.length, 1);
	assert.equal(findings[0].class, "local");
});

test("a cloud-shaped endpoint with no router fact stays declared-only, and is not a failure", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({
		commands: skillCommandsOf(root),
		models: [{ id: "glm", provider: "openrouter", baseUrl: "https://openrouter.example/api/v1" }],
		props: { status: 404, body: "not found" },
	});

	const probed = await probePiRuntime(
		piContext(root, fake.transport, {
			profiles: [{ name: "cloudy", model: "openrouter/glm" }],
			declaredResources: { openrouter: 4 },
			requiredClasses: ["openrouter"],
		}),
	);

	assert.equal(probed.ok, true);
	assert.deepEqual(probed.classes.openrouter, {
		class: "openrouter",
		declared: 4,
		models: ["glm"],
		endpoint: "https://openrouter.example/api/v1",
		reachable: true,
		max_instances: null,
	});
});

test("an unprobeable pi runtime is a named automation failure, not an inference", async (t) => {
	const root = fixturePackage(t);

	const probed = await probePiRuntime(
		piContext(root, {
			runCommand: async () => {
				throw new Error("spawn pi ENOENT");
			},
		}),
	);

	assert.equal(probed.ok, false);
	assert.equal(probed.failures[0].reason, "runtime-unreachable");
	assert.match(probed.failures[0].message, /ENOENT/);
});

test("an RPC session that never answers names the missing request", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: [] });
	fake.transport.lineSession = async () => ({ status: 1, timedOut: false, stderr: "boom", lines: [] });

	const probed = await probePiRuntime(piContext(root, fake.transport));

	assert.equal(probed.ok, false);
	assert.match(probed.failures[0].message, /get_commands/);
});

// ── The pi adapter: one probe per pinned revision (§6.2's "one request") ─────

test("the pi adapter memoizes the probe per revision and proves each role against it", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: skillCommandsOf(root) });
	const adapter = createPiAdapter(piContext(root, fake.transport));

	const role = (name, closure) => ({
		name,
		entrySkill: closure[0],
		closure,
		promptTemplate: null,
		resultExpectations: { statuses: ["completed"] },
	});

	const first = await adapter.preflight(role("implement", ["implement", "tdd"]), "rev-1");
	const second = await adapter.preflight(role("review-standards", ["review-standards"]), "rev-1");

	assert.equal(first.ok, true);
	assert.equal(second.ok, false, "a closure member the session never registered passed");
	assert.equal(second.findings[0].reason, "skill-not-invocable");
	assert.equal(fake.calls.lineSession.length, 1, "one revision, one disposable session");

	await adapter.preflight(role("implement", ["implement", "tdd"]), "rev-2");
	assert.equal(fake.calls.lineSession.length, 2, "a new revision is a fresh probe, never a stale pin");
});

// ── Claude: validate, diff, initialize (§6.2, §6.3) ──────────────────────────


function claudeContext(t, transport) {
	const packageRoot = fixturePackage(t, { withGenerator: true });
	const cacheRoot = makeTree(t, {});
	return {
		packageRoot,
		packageRev: "rev-1",
		cacheRoot,
		expectedSkills: ["implement", "tdd"],
		declaredSize: 2,
		// Every Claude probe runs in a working directory, because every Claude
		// probe in production does — and #163's fence proof is planted in it.
		session: { cwd: cacheRoot },
		transport,
	};
}

test("a green Claude probe validates strictly, diffs components, and proves the closure at zero model cost", async (t) => {
	const fake = claudeTransport({ skills: ["implement", "tdd"] });
	const context = claudeContext(t, fake.transport);

	const probed = await probeClaudeRuntime(context);

	assert.equal(probed.ok, true);
	assert.deepEqual(proveClaudeClosure(probed, ["implement", "tdd"]), []);
	assert.equal(probed.plugin.manifest.name, "oh-my-slop");
	assert.deepEqual(probed.models, [{ value: "opus", resolved: "claude-opus-5-test" }]);

	// §9.7: a cloud class has nothing to observe and stays declared-only.
	assert.deepEqual(probed.classes["claude-code"], {
		class: "claude-code",
		endpoint: "claude",
		reachable: true,
		max_instances: null,
		declared: 2,
		models: ["opus"],
	});

	// The three steps, in §6.2's order, against the built plugin.
	const claudeCalls = fake.calls.runCommand.filter(([command]) => command === "claude");
	assert.deepEqual(claudeCalls[1].slice(1, 4), ["plugin", "validate", "--strict"]);
	assert.equal(claudeCalls[2][1], "--plugin-dir");
	assert.deepEqual(claudeCalls[2].slice(3), ["plugin", "details", "oh-my-slop"]);
	const [session] = fake.calls.lineSession;
	assert.deepEqual(session.args.slice(2), [
		"--no-chrome",
		"--setting-sources",
		"user",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--print",
		"--verbose",
	]);
});

test("strict validation refusing the built plugin is a typed finding", async (t) => {
	const fake = claudeTransport({
		skills: ["implement", "tdd"],
		validate: { status: 1, stdout: "", stderr: "author: Invalid input: expected object, received string" },
	});

	const probed = await probeClaudeRuntime(claudeContext(t, fake.transport));

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "plugin-invalid");
	assert.match(finding.message, /expected object/);
});

test("a smaller registered inventory is the component diff naming what the loader dropped", async (t) => {
	// §6.3's silent failure: the loader registers depth-1 skills only, so the
	// only symptom is a smaller Skills (N) count.
	const fake = claudeTransport({ skills: ["implement"] });

	const probed = await probeClaudeRuntime(claudeContext(t, fake.transport));

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "plugin-component-diff");
	assert.deepEqual(finding.missing, ["tdd"]);
	assert.match(finding.message, /registers 1 skills while the pinned revision ships 2/);
});

test("a closure member missing from the initialize commands array is unprovable", async (t) => {
	const fake = claudeTransport({
		skills: ["implement", "tdd"],
		commands: [{ name: "oh-my-slop:implement" }],
	});

	const probed = await probeClaudeRuntime(claudeContext(t, fake.transport));
	const findings = proveClaudeClosure(probed, ["implement", "tdd"]);

	assert.equal(findings.length, 1);
	assert.equal(findings[0].reason, "skill-not-invocable");
	assert.equal(findings[0].command, "oh-my-slop:tdd");
});

test("an initialize session with no control_response is an unprobeable runtime", async (t) => {
	const fake = claudeTransport({ skills: ["implement", "tdd"] });
	fake.transport.lineSession = async () => ({ status: 1, timedOut: false, stderr: "exploded", lines: [] });

	const probed = await probeClaudeRuntime(claudeContext(t, fake.transport));

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "runtime-unreachable");
	assert.match(finding.message, /control_response/);
});

test("the Claude adapter memoizes per revision, and a fresh revision rebuilds nothing it cached", async (t) => {
	const fake = claudeTransport({ skills: ["implement", "tdd"] });
	const context = claudeContext(t, fake.transport);
	const adapter = createClaudeAdapter(context);

	const role = {
		name: "implement",
		entrySkill: "implement",
		closure: ["implement", "tdd"],
		promptTemplate: null,
		resultExpectations: { statuses: ["completed"] },
	};

	const first = await adapter.preflight(role, "rev-1");
	await adapter.preflight({ ...role, name: "fresh-retry" }, "rev-1");

	assert.equal(first.ok, true);
	// One revision, one probe pass: the production session and the fence proof's
	// control session, and no second pass for the second role.
	assert.equal(fake.calls.lineSession.length, 2, "a second role re-probed the same revision");
});

// ── §6.8's binding rides the probe (§6.2's production path) ──────────────────

test("the pi probe runs under the controller-owned binding, flags and all", async (t) => {
	const root = fixturePackage(t);
	const fake = piTransport({ commands: skillCommandsOf(root) });

	await probePiRuntime(
		piContext(root, fake.transport, {
			session: {
				env: { PI_CODING_AGENT_DIR: "/state/worker-config/pi" },
				sessionArgs: ["--extension", "/ext/index.ts"],
				cwd: "/state/worktrees",
			},
		}),
	);

	const [session] = fake.calls.lineSession;
	assert.equal(session.env.PI_CODING_AGENT_DIR, "/state/worker-config/pi");
	assert.equal(session.cwd, "/state/worktrees");
	assert.deepEqual(session.args.slice(-2), ["--extension", "/ext/index.ts"]);
	// The production flags stay first: the binding adds, it does not replace.
	assert.deepEqual(session.args.slice(0, 4), ["--mode", "rpc", "--no-session", "--no-skills"]);
});

test("the Claude probe runs the posture's own flags, so the installed binary is what accepts them", async (t) => {
	const fake = claudeTransport({ skills: ["implement", "tdd"] });
	const context = claudeContext(t, fake.transport);

	await probeClaudeRuntime({
		...context,
		session: {
			env: { CLAUDE_CONFIG_DIR: context.cacheRoot },
			sessionArgs: ["--settings", "/state/settings-builder.json", "--permission-mode", "dontAsk"],
			cwd: context.cacheRoot,
			configDir: context.cacheRoot,
		},
	});

	const [session] = fake.calls.lineSession;
	// The worker binding first — plugin dir, the browser fence, the discovery
	// fence, then the posture's flags — with the probe-only IO flags after it
	// (#160's restored invariant, #163's fence inside it, #178's beside it).
	assert.deepEqual(session.args.slice(2, 9), [
		"--no-chrome",
		"--setting-sources",
		"user",
		"--settings",
		"/state/settings-builder.json",
		"--permission-mode",
		"dontAsk",
	]);
	assert.equal(session.env.CLAUDE_CONFIG_DIR, context.cacheRoot);
});

// ── §6.8's discovery fence, proven live in the probe's own cwd (#163) ────────

/**
 * #163: a Claude session registers the project skills its cwd ships, and an
 * isolated `CLAUDE_CONFIG_DIR` does not fence them — the same leak class #160
 * closed for pi. The worker binding fences them; the probe proves the fence
 * held **and** that it would have noticed a leak, by planting a canary project
 * skill in its own cwd and running one deliberately unfenced control session.
 */
function canaryPath(cwd) {
	return join(cwd, ".claude", "skills", "factory-discovery-canary", "SKILL.md");
}

test("the fence proof plants a canary in the probe's cwd, proves both sides, and takes it away again", async (t) => {
	const fake = claudeTransport({ skills: ["implement", "tdd"] });
	const context = claudeContext(t, fake.transport);
	const cwd = context.cacheRoot;

	const probed = await probeClaudeRuntime({ ...context, session: { cwd } });

	assert.equal(probed.ok, true, JSON.stringify(probed.failures));
	assert.equal(fake.calls.lineSession.length, 2, "the fence proof needs its control session");

	// The production session carries the fence; the control is that same binding
	// with the fence taken out, and it is the only unfenced session the factory
	// ever runs.
	const [production, control] = fake.calls.lineSession;
	assert.ok(production.args.includes("--setting-sources"));
	assert.ok(!control.args.includes("--setting-sources"));
	assert.deepEqual(production.args.slice(3, 5), ["--setting-sources", "user"]);
	assert.deepEqual(control.args, [...production.args.slice(0, 3), ...production.args.slice(5)]);
	// #178: the control drops the discovery fence and nothing else — a control
	// session that warmed the Chrome cache would hang a later worker pane.
	assert.ok(control.args.includes("--no-chrome"));
	assert.equal(control.cwd, cwd);

	// The canary is the controller's, not the repository's: it does not outlive
	// the probe that planted it.
	assert.equal(existsSync(canaryPath(cwd)), false, "the probe left its canary behind");

	// And the proof is recorded, not merely performed: a green probe that says
	// nothing about the fence cannot be told from one that never proved it.
	assert.deepEqual(probed.discovery, {
		fence: ["--setting-sources", "user"],
		canary: "factory-discovery-canary",
		proven: true,
	});
});

test("a project skill that survives the fence is a typed shadowed-skill finding naming its source", async (t) => {
	// The harness's fence stopped working — the flag is accepted and ignored.
	const fake = claudeTransport({ skills: ["implement", "tdd"], discovery: "leaking" });
	const context = claudeContext(t, fake.transport);

	const probed = await probeClaudeRuntime({ ...context, session: { cwd: context.cacheRoot } });

	assert.equal(probed.ok, false, "a project skill reached the probed session and the probe passed");
	const finding = probed.failures.find((entry) => entry.reason === "skill-shadowed");
	assert.equal(finding.skill, "factory-discovery-canary");
	assert.equal(finding.source, join(context.cacheRoot, ".claude", "skills", "factory-discovery-canary"));
	assert.match(finding.message, /only from the pinned package/);
	assert.equal(probed.discovery.proven, false);
});

test("a control session blind to the canary leaves the fence unproven rather than proven", async (t) => {
	// Nothing registers project skills here, so the absence of the canary from
	// the production session is no evidence at all (§6.2's probe that proves
	// nothing).
	const fake = claudeTransport({ skills: ["implement", "tdd"], discovery: "blind" });
	const context = claudeContext(t, fake.transport);

	const probed = await probeClaudeRuntime({ ...context, session: { cwd: context.cacheRoot } });

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "discovery-fence-unproven");
	assert.match(finding.message, /control session/);
	assert.equal(finding.canary, "factory-discovery-canary");
	// The recorded fact and the verdict agree: an unproven fence never reads as
	// a proven one, and never as a missing field either.
	assert.equal(probed.discovery.proven, false);
});

test("a binding with no cwd has nowhere safe to plant, so the fence is unproven rather than assumed", async (t) => {
	// The session would inherit the controller's own directory — the operator's
	// repository — and the factory plants nothing there.
	const fake = claudeTransport({ skills: ["implement", "tdd"] });

	const probed = await probeClaudeRuntime({ ...claudeContext(t, fake.transport), session: {} });

	assert.equal(probed.ok, false);
	const finding = probed.failures.find((entry) => entry.reason === "discovery-fence-unproven");
	assert.equal(finding.at, null);
	assert.equal(probed.discovery.proven, false);
	assert.equal(fake.calls.lineSession.length, 1, "nothing was planted, so there is no control session to run");
});

test("a project the probed session recorded but nobody pre-trusted is a typed finding, not a later hang", async (t) => {
	const fake = claudeTransport({ skills: ["implement", "tdd"] });
	const context = claudeContext(t, fake.transport);
	writeFileSync(
		join(context.cacheRoot, ".claude.json"),
		JSON.stringify({ projects: { "/home/operator/elsewhere": { hasTrustDialogAccepted: false } } }),
	);

	const probed = await probeClaudeRuntime({ ...context, session: { configDir: context.cacheRoot } });

	assert.equal(probed.ok, false);
	const [finding] = probed.failures.filter((entry) => entry.reason === "trust-not-established");
	assert.deepEqual(finding.untrusted, ["/home/operator/elsewhere"]);
	assert.match(finding.message, /would sit on the trust dialog/);
});
