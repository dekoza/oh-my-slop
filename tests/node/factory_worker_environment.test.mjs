import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { prepareWorkerEnvironment, workerConfigRoots } from "../../factory/lib/worker/environment.mjs";
import { DENY_FLOOR } from "../../factory/lib/worker/permissions.mjs";
import { claudeTrustDecision, piTrustDecision, readClaudeConfigState, readPiTrust } from "../../factory/lib/worker/trust.mjs";
import { herdrIntegration } from "./helpers/factory-package.mjs";

/**
 * §6.8's config isolation: a controller-owned environment per runtime, holding
 * the capability artifacts and the declared context file and **nothing the
 * operator wrote** — no skills, no hooks, no settings, no personal memory file.
 */

const NO_OVERRIDES = Object.freeze({ denies: [], contextFile: null, piExtensions: [] });

/** §6.5's integrations at the version the factory is written against. */
const PI_INTEGRATION = herdrIntegration("pi", 8);
const CLAUDE_INTEGRATION = herdrIntegration("claude", 7);

function installIntegrations(home) {
	writeFileSync(join(home, ".pi", "agent", "extensions", "herdr-agent-state.ts"), PI_INTEGRATION);
	writeFileSync(join(home, ".claude", "hooks", "herdr-agent-state.sh"), CLAUDE_INTEGRATION);
}

function lab(t) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-env-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	// An operator's config, as personal as they come, on a host where herdr is
	// installed: the §6.5 agent-state integration sits in both config roots.
	const home = join(root, "home");
	for (const path of [
		join(home, ".pi", "agent", "skills", "secret-skill"),
		join(home, ".pi", "agent", "extensions"),
		join(home, ".claude", "hooks"),
	]) {
		mkdirSync(path, { recursive: true });
	}
	installIntegrations(home);
	writeFileSync(join(home, ".pi", "agent", "auth.json"), '{"anthropic":"operator-token"}');
	writeFileSync(join(home, ".pi", "agent", "models.json"), '{"providers":{"local":{"baseUrl":"http://router/v1"}}}');
	writeFileSync(join(home, ".pi", "agent", "settings.json"), '{"packages":["npm:personal"],"skills":["~/.agents/skills"]}');
	writeFileSync(join(home, ".pi", "agent", "AGENTS.md"), "# the operator's personal rules\n");
	writeFileSync(join(home, ".claude", ".credentials.json"), '{"token":"operator"}');
	writeFileSync(join(home, ".claude", "CLAUDE.md"), "# the operator's personal rules\n");

	const storeDir = join(root, "store");
	const repoRoot = join(root, "repo");
	mkdirSync(storeDir, { recursive: true });
	mkdirSync(repoRoot, { recursive: true });

	return { root, home, storeDir, repoRoot };
}

function prepare(context, worker = NO_OVERRIDES) {
	return prepareWorkerEnvironment({
		storeDir: context.storeDir,
		repoRoot: context.repoRoot,
		worker,
		env: {},
		home: context.home,
	});
}

test("the environment is the controller's own, and the operator's rules are simply not in it", (t) => {
	const context = lab(t);

	const environment = prepare(context);

	assert.deepEqual(environment.roots, workerConfigRoots(context.storeDir));
	// Capability crossed over; behaviour did not.
	assert.equal(readFileSync(join(environment.roots.pi, "auth.json"), "utf8"), '{"anthropic":"operator-token"}');
	assert.deepEqual(environment.promoted.pi, ["auth.json", "models.json"]);
	assert.deepEqual(environment.promoted.claude, [".credentials.json"]);

	for (const absent of [
		join(environment.roots.pi, "AGENTS.md"),
		join(environment.roots.pi, "skills"),
		join(environment.roots.claude, "CLAUDE.md"),
		join(environment.roots.claude, "settings.json"),
	]) {
		assert.equal(existsSync(absent), false, `${absent} leaked out of the operator's config`);
	}
	// pi's settings are the controller's: no packages, no skills roots.
	assert.deepEqual(JSON.parse(readFileSync(join(environment.roots.pi, "settings.json"), "utf8")), {});
});

test("the §6.5 agent-state integration is promoted into the run's roots, digested and version-observed", (t) => {
	const context = lab(t);

	const environment = prepare(context);

	// Copied, never inherited: the bytes sit in the controller-owned root the
	// session runs under, and pi auto-discovers its extension from the agent
	// directory's extensions/ — no flag, no operator path.
	const piPath = join(environment.roots.pi, "extensions", "herdr-agent-state.ts");
	const claudePath = join(environment.roots.claude, "hooks", "herdr-agent-state.sh");
	assert.equal(readFileSync(piPath, "utf8"), PI_INTEGRATION);
	assert.equal(readFileSync(claudePath, "utf8"), CLAUDE_INTEGRATION);

	const pi = environment.agentState.pi;
	assert.equal(pi.installed, true);
	assert.equal(pi.source, join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"));
	assert.equal(pi.installed_as, piPath);
	assert.equal(pi.id, "pi");
	assert.equal(pi.version, 8);
	assert.match(pi.digest, /^[0-9a-f]{64}$/);
	assert.equal(createHash("sha256").update(PI_INTEGRATION).digest("hex"), pi.digest);

	const claude = environment.agentState.claude;
	assert.equal(claude.installed, true);
	assert.equal(claude.source, join(context.home, ".claude", "hooks", "herdr-agent-state.sh"));
	assert.equal(claude.installed_as, claudePath);
	assert.equal(claude.id, "claude");
	assert.equal(claude.version, 7);
	assert.equal(createHash("sha256").update(CLAUDE_INTEGRATION).digest("hex"), claude.digest);

	// §6.8: what a run promoted is recorded by declared path and content digest,
	// with the version observed out of the file rather than assumed.
	const facts = environment.manifestFacts();
	assert.deepEqual(facts.agent_state.pi, { source: pi.source, digest: pi.digest, version: 8 });
	assert.deepEqual(facts.agent_state.claude, { source: claude.source, digest: claude.digest, version: 7 });
});

test("an agent-state integration the operator has not installed is recorded absent, and the Claude settings wire no hook", (t) => {
	const context = lab(t);
	for (const path of [
		join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"),
		join(context.home, ".claude", "hooks", "herdr-agent-state.sh"),
	]) {
		rmSync(path, { force: true });
	}

	const environment = prepare(context);

	for (const kind of ["pi", "claude"]) {
		const fact = environment.agentState[kind];
		assert.equal(fact.installed, false, kind);
		assert.equal(fact.digest, null);
		assert.equal(fact.version, null);
		assert.equal(fact.id, null);
	}
	assert.equal(existsSync(join(environment.roots.pi, "extensions", "herdr-agent-state.ts")), false);
	assert.equal(existsSync(join(environment.roots.claude, "hooks", "herdr-agent-state.sh")), false);

	const facts = environment.manifestFacts();
	assert.deepEqual(facts.agent_state, { pi: null, claude: null });

	// Nothing to point a hook at: the session settings carry permissions only.
	for (const posture of ["builder", "reviewer"]) {
		const settings = JSON.parse(
			readFileSync(join(environment.roots.claude, `settings-${posture}.json`), "utf8"),
		);
		assert.equal("hooks" in settings, false);
	}
});

test("an integration herdr left outdated or that lost its header is observed as such, not assumed away", (t) => {
	const context = lab(t);
	// herdr left the pi integration on the version before the one the factory
	// is written against, and the claude one is from before the stamped header
	// existed at all: two different facts, and neither is the other's.
	writeFileSync(join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"), herdrIntegration("pi", 6));
	writeFileSync(join(context.home, ".claude", "hooks", "herdr-agent-state.sh"), herdrIntegration("claude", null));

	const environment = prepare(context);

	// Outdated: the observed version is the older number, and it is the
	// observation rather than a constant that the preflight compares.
	assert.equal(environment.agentState.pi.version, 6);
	assert.equal(environment.agentState.pi.installed, true);
	// No header at all: installed, but unversioned — a different fact than absent.
	assert.equal(environment.agentState.claude.installed, true);
	assert.equal(environment.agentState.claude.version, null);
	assert.equal(environment.agentState.claude.id, null);

	const facts = environment.manifestFacts();
	assert.deepEqual(facts.agent_state.pi, { source: environment.agentState.pi.source, digest: environment.agentState.pi.digest, version: 6 });
	assert.deepEqual(facts.agent_state.claude, { source: environment.agentState.claude.source, digest: environment.agentState.claude.digest, version: null });
});

test("the Claude session settings wire §6.5's hook to the run-owned script, in both postures", (t) => {
	const context = lab(t);

	const environment = prepare(context);

	const expectedCommand = `bash '${join(environment.roots.claude, "hooks", "herdr-agent-state.sh")}' session`;
	for (const posture of ["builder", "reviewer"]) {
		const settings = JSON.parse(
			readFileSync(join(environment.roots.claude, `settings-${posture}.json`), "utf8"),
		);
		assert.deepEqual(Object.keys(settings).sort(), ["hooks", "permissions"]);
		assert.deepEqual(settings.hooks, {
			SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: expectedCommand, timeout: 10 }] }],
		});
	}
});

test("a session binds to the controller-owned root through each runtime's own variable", (t) => {
	const context = lab(t);
	const environment = prepare(context);

	const pi = environment.binding({ kind: "pi", posture: "builder" });
	const claude = environment.binding({ kind: "claude", posture: "reviewer" });

	assert.equal(pi.env.PI_CODING_AGENT_DIR, environment.roots.pi);
	assert.equal(claude.env.CLAUDE_CONFIG_DIR, environment.roots.claude);
	// Both variables in both bindings: a worker that shells out to the other
	// harness must not land in the operator's config.
	assert.equal(pi.env.CLAUDE_CONFIG_DIR, environment.roots.claude);
	assert.equal(claude.env.PI_CODING_AGENT_DIR, environment.roots.pi);
	assert.deepEqual([...pi.args], []);
	assert.equal(claude.args[0], "--settings");
	assert.equal(claude.args[1], join(environment.roots.claude, "settings-reviewer.json"));
});

test("the deny floor and the run's declared additions are written into both posture settings files", (t) => {
	const context = lab(t);

	const environment = prepare(context, { ...NO_OVERRIDES, denies: ["Bash(curl:*)"] });

	for (const posture of ["builder", "reviewer"]) {
		const settings = JSON.parse(
			readFileSync(join(environment.roots.claude, `settings-${posture}.json`), "utf8"),
		);
		for (const rule of DENY_FLOOR) assert.ok(settings.permissions.deny.includes(rule));
		assert.ok(settings.permissions.deny.includes("Bash(curl:*)"));
	}
});

test("the declared worker-context file lands as each runtime's user memory, hashed for the manifest", (t) => {
	const context = lab(t);
	mkdirSync(join(context.repoRoot, "docs"), { recursive: true });
	writeFileSync(join(context.repoRoot, "docs", "worker-context.md"), "capture whole output with tee\n");

	const environment = prepare(context, { ...NO_OVERRIDES, contextFile: "docs/worker-context.md" });

	assert.equal(readFileSync(join(environment.roots.pi, "AGENTS.md"), "utf8"), "capture whole output with tee\n");
	assert.equal(readFileSync(join(environment.roots.claude, "CLAUDE.md"), "utf8"), "capture whole output with tee\n");

	const facts = environment.manifestFacts();
	assert.equal(facts.worker_context_file.declared, "docs/worker-context.md");
	assert.match(facts.worker_context_file.digest, /^[0-9a-f]{64}$/);
	assert.deepEqual(facts.worker_context_file.installed_as, ["AGENTS.md", "CLAUDE.md"]);
});

test("a context file the config stopped declaring stops reaching workers", (t) => {
	const context = lab(t);
	writeFileSync(join(context.repoRoot, "rules.md"), "old rules\n");

	const first = prepare(context, { ...NO_OVERRIDES, contextFile: "rules.md" });
	assert.ok(existsSync(join(first.roots.claude, "CLAUDE.md")));

	const second = prepare(context);
	assert.equal(existsSync(join(second.roots.claude, "CLAUDE.md")), false);
	assert.equal(existsSync(join(second.roots.pi, "AGENTS.md")), false);
	assert.equal(second.manifestFacts().worker_context_file.digest, null);
});

test("a declared context file that is not there refuses, rather than silently reaching nobody", (t) => {
	const context = lab(t);

	assert.throws(
		() => prepare(context, { ...NO_OVERRIDES, contextFile: "docs/absent.md" }),
		(error) => {
			assert.ok(error instanceof FactoryWorkerError);
			assert.equal(error.reason, "config-environment-invalid");
			assert.match(error.message, /silently not reach any worker/);
			return true;
		},
	);
});

test("declared pi extensions are promoted onto the session, and a missing one refuses", (t) => {
	const context = lab(t);
	const extension = join(context.home, ".pi", "agent", "extensions", "local-router", "index.ts");
	mkdirSync(join(context.home, ".pi", "agent", "extensions", "local-router"), { recursive: true });
	writeFileSync(extension, "export default {};\n");

	const environment = prepare(context, {
		...NO_OVERRIDES,
		piExtensions: [{ path: "~/.pi/agent/extensions/local-router/index.ts", env: {} }],
	});
	assert.deepEqual([...environment.binding({ kind: "pi", posture: "builder" }).args], ["--extension", extension]);

	// The digest, not just the path: a path is a claim about intent, and an
	// extension edited between runs has to be visible rather than inferred.
	const [recorded] = environment.manifestFacts().pi_extensions.declared;
	assert.equal(recorded.declared, "~/.pi/agent/extensions/local-router/index.ts");
	assert.match(recorded.digest, /^[0-9a-f]{64}$/);

	assert.throws(
		() => prepare(context, { ...NO_OVERRIDES, piExtensions: [{ path: "/nowhere/at/all.ts", env: {} }] }),
		(error) => {
			assert.equal(error.reason, "config-environment-invalid");
			assert.match(error.message, /capability the run believes it has and does not/);
			return true;
		},
	);
});

test("a declared extension's environment reaches the pi session, its pane exports, and the manifest — deliberately, never ambiently (§6.8)", (t) => {
	const context = lab(t);
	mkdirSync(join(context.home, ".pi", "agent", "extensions", "local-router"), { recursive: true });
	writeFileSync(join(context.home, ".pi", "agent", "extensions", "local-router", "index.ts"), "export default {};\n");

	const environment = prepare(context, {
		...NO_OVERRIDES,
		piExtensions: [
			{
				path: "~/.pi/agent/extensions/local-router/index.ts",
				env: { PI_LOCAL_ROUTER_BASE_URL: "http://router.lab:11545" },
			},
		],
	});

	// The probe's spawn environment and the pane's export set carry the same
	// declared value, so the session the probe proves is the session a worker gets.
	const pi = environment.binding({ kind: "pi", posture: "builder" });
	assert.equal(pi.env.PI_LOCAL_ROUTER_BASE_URL, "http://router.lab:11545");
	assert.equal(pi.paneEnv.PI_LOCAL_ROUTER_BASE_URL, "http://router.lab:11545");

	// Claude sessions never load the extension, so its variable does not ride them.
	const claude = environment.binding({ kind: "claude", posture: "builder" });
	assert.equal("PI_LOCAL_ROUTER_BASE_URL" in claude.paneEnv, false);
	assert.equal("PI_LOCAL_ROUTER_BASE_URL" in claude.env, false);

	// Recorded as evidence beside the digest: which values a run handed its workers.
	const [recorded] = environment.manifestFacts().pi_extensions.declared;
	assert.deepEqual(recorded.env, { PI_LOCAL_ROUTER_BASE_URL: "http://router.lab:11545" });
});

test("a profile's own endpoint overrides the run-wide extension declaration on that pane (#209)", (t) => {
	const context = lab(t);
	mkdirSync(join(context.home, ".pi", "agent", "extensions", "local-router"), { recursive: true });
	writeFileSync(join(context.home, ".pi", "agent", "extensions", "local-router", "index.ts"), "export default {};\n");

	const environment = prepare(context, {
		...NO_OVERRIDES,
		piExtensions: [
			{
				path: "~/.pi/agent/extensions/local-router/index.ts",
				env: { PI_LOCAL_ROUTER_BASE_URL: "http://router.lab:11545" },
			},
		],
	});

	// §9.1's pool identity is the machine, so the profile's binding is what the
	// pane must talk to — the run-wide declaration is the address for profiles
	// that bind none.
	const endpoint = { env: "PI_LOCAL_ROUTER_BASE_URL", url: "http://gerda:11545" };
	const bound = environment.binding({ kind: "pi", posture: "builder", endpoint });
	assert.equal(bound.env.PI_LOCAL_ROUTER_BASE_URL, "http://gerda:11545");
	assert.equal(bound.paneEnv.PI_LOCAL_ROUTER_BASE_URL, "http://gerda:11545");

	const unbound = environment.binding({ kind: "pi", posture: "builder" });
	assert.equal(unbound.env.PI_LOCAL_ROUTER_BASE_URL, "http://router.lab:11545");
	assert.equal(unbound.paneEnv.PI_LOCAL_ROUTER_BASE_URL, "http://router.lab:11545");
});

test("a bound endpoint cannot displace the isolation variables either (#209)", (t) => {
	const context = lab(t);

	const pi = prepare(context).binding({
		kind: "pi",
		posture: "builder",
		endpoint: { env: "PI_CODING_AGENT_DIR", url: "http://gerda:11545" },
	});

	assert.equal(pi.env.PI_CODING_AGENT_DIR, workerConfigRoots(context.storeDir).pi);
	assert.equal(pi.paneEnv.PI_CODING_AGENT_DIR, workerConfigRoots(context.storeDir).pi);
});

test("a declared extension environment cannot displace the isolation variables (§6.8)", (t) => {
	const context = lab(t);
	mkdirSync(join(context.home, ".pi", "agent", "extensions", "rogue"), { recursive: true });
	writeFileSync(join(context.home, ".pi", "agent", "extensions", "rogue", "index.ts"), "export default {};\n");

	// Config validation refuses these names; the binding still wins structurally
	// when handed an unvalidated block, because the isolation variables are
	// spread last.
	const environment = prepare(context, {
		...NO_OVERRIDES,
		piExtensions: [
			{ path: "~/.pi/agent/extensions/rogue/index.ts", env: { PI_CODING_AGENT_DIR: "/tmp/operator-config" } },
		],
	});

	const pi = environment.binding({ kind: "pi", posture: "builder" });
	assert.equal(pi.env.PI_CODING_AGENT_DIR, environment.roots.pi);
	assert.equal(pi.paneEnv.PI_CODING_AGENT_DIR, environment.roots.pi);
});

test("pre-trusting a worktree writes both stores, keyed the way each runtime resolves them", (t) => {
	const context = lab(t);
	const environment = prepare(context);
	const worktreePath = join(context.storeDir, "worktrees", "run-t1-a1");
	const gitCommonDir = join(context.storeDir, "clone.git");

	const trusted = environment.pretrust({ worktreePath, gitCommonDir });

	assert.equal(piTrustDecision(readPiTrust(environment.roots.pi), worktreePath), true);
	// Claude keys a linked worktree's project by the repository, so that is what
	// has to be trusted — trusting only the worktree path would leave the dialog.
	assert.ok(trusted.claude.includes(gitCommonDir));
	assert.equal(claudeTrustDecision(readClaudeConfigState(environment.roots.claude), gitCommonDir), true);
	assert.equal(readClaudeConfigState(environment.roots.claude).hasCompletedOnboarding, true);
});

test("the manifest facts are declarations only — the promoted capability list is code policy, not evidence", (t) => {
	const context = lab(t);

	const facts = prepare(context, { ...NO_OVERRIDES, denies: ["WebFetch"] }).manifestFacts();

	assert.deepEqual(facts.extra_denies, { declared: ["WebFetch"] });
	assert.deepEqual(Object.keys(facts).sort(), ["agent_state", "extra_denies", "pi_extensions", "worker_context_file"]);
	assert.equal(JSON.stringify(facts).includes("credentials"), false);
});

test("a promoted capability artifact whose source is gone stops existing here too", (t) => {
	const context = lab(t);
	const first = prepare(context);
	assert.ok(existsSync(join(first.roots.claude, ".credentials.json")));

	rmSync(join(context.home, ".claude", ".credentials.json"));
	const second = prepare(context);

	// The environment is rebuilt every run; a credential outliving its source
	// would be capability nobody granted this run.
	assert.equal(existsSync(join(second.roots.claude, ".credentials.json")), false);
	assert.deepEqual(second.promoted.claude, []);
});
