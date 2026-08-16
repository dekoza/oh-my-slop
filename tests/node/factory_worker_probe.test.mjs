import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createClaudeAdapter, probeClaudeRuntime, proveClaudeClosure } from "../../factory/lib/worker/claude.mjs";
import { createPiAdapter, probePiRuntime, provePiClosure } from "../../factory/lib/worker/pi.mjs";
import { runCommand } from "../../factory/lib/worker/transports.mjs";
import { makeTree, realGeneratorFiles, skillMarkdown } from "./helpers/factory-package.mjs";
import { piTransport, skillCommandsOf } from "./helpers/factory-worker.mjs";

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
	assert.deepEqual(session.args, ["--mode", "rpc", "--no-session", "--no-skills", "--skill", join(root, "skills")]);
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

/**
 * A Claude transport whose plugin build is the real generator and whose
 * `claude` answers are canned in the live-captured shapes.
 */
function claudeTransport({ skills, validate = { status: 0, stdout: "✔ Validation passed", stderr: "" }, details, commands, models } = {}) {
	const registered = commands ?? skills.map((name) => ({ name: `oh-my-slop:${name}` }));
	const inventoryLine =
		details ?? { status: 0, stdout: `Component inventory\n  Skills (${skills.length})  ${skills.join(", ")}\n`, stderr: "" };
	const calls = { runCommand: [], lineSession: [] };

	return {
		calls,
		transport: {
			runCommand: async (command, args, options) => {
				calls.runCommand.push([command, ...args]);
				if (command !== "claude") return runCommand(command, args, options); // the generator, for real
				if (args[0] === "--version") return { status: 0, stdout: "2.1.233-test", stderr: "" };
				if (args[0] === "plugin" && args[1] === "validate") return validate;
				return inventoryLine;
			},
			lineSession: async (session) => {
				calls.lineSession.push(session);
				const request = JSON.parse(session.input[0]);
				return {
					status: 0,
					timedOut: false,
					stderr: "",
					lines: [
						JSON.stringify({ type: "system", subtype: "hook_started" }),
						JSON.stringify({
							type: "control_response",
							response: {
								subtype: "success",
								request_id: request.request_id,
								response: {
									commands: registered,
									models: models ?? [{ value: "opus", resolvedModel: "claude-opus-5-test" }],
								},
							},
						}),
					],
				};
			},
		},
	};
}

function claudeContext(t, transport) {
	const packageRoot = fixturePackage(t, { withGenerator: true });
	return {
		packageRoot,
		packageRev: "rev-1",
		cacheRoot: makeTree(t, {}),
		expectedSkills: ["implement", "tdd"],
		declaredSize: 2,
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
	assert.equal(fake.calls.lineSession.length, 1, "one revision, one initialize probe");
});
