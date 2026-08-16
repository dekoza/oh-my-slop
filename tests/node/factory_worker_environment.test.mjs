import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { prepareWorkerEnvironment, workerConfigRoots } from "../../factory/lib/worker/environment.mjs";
import { DENY_FLOOR } from "../../factory/lib/worker/permissions.mjs";
import { claudeTrustDecision, piTrustDecision, readClaudeConfigState, readPiTrust } from "../../factory/lib/worker/trust.mjs";

/**
 * §6.8's config isolation: a controller-owned environment per runtime, holding
 * the capability artifacts and the declared context file and **nothing the
 * operator wrote** — no skills, no hooks, no settings, no personal memory file.
 */

const NO_OVERRIDES = Object.freeze({ denies: [], contextFile: null, piExtensions: [] });

function lab(t) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-env-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	// An operator's config, as personal as they come.
	const home = join(root, "home");
	for (const path of [join(home, ".pi", "agent", "skills", "secret-skill"), join(home, ".claude", "hooks")]) {
		mkdirSync(path, { recursive: true });
	}
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
		join(environment.roots.claude, "hooks"),
	]) {
		assert.equal(existsSync(absent), false, `${absent} leaked out of the operator's config`);
	}
	// pi's settings are the controller's: no packages, no skills roots.
	assert.deepEqual(JSON.parse(readFileSync(join(environment.roots.pi, "settings.json"), "utf8")), {});
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

	const environment = prepare(context, { ...NO_OVERRIDES, piExtensions: ["~/.pi/agent/extensions/local-router/index.ts"] });
	assert.deepEqual([...environment.binding({ kind: "pi", posture: "builder" }).args], ["--extension", extension]);

	// The digest, not just the path: a path is a claim about intent, and an
	// extension edited between runs has to be visible rather than inferred.
	const [recorded] = environment.manifestFacts().pi_extensions.declared;
	assert.equal(recorded.declared, "~/.pi/agent/extensions/local-router/index.ts");
	assert.match(recorded.digest, /^[0-9a-f]{64}$/);

	assert.throws(
		() => prepare(context, { ...NO_OVERRIDES, piExtensions: ["/nowhere/at/all.ts"] }),
		(error) => {
			assert.equal(error.reason, "config-environment-invalid");
			assert.match(error.message, /capability the run believes it has and does not/);
			return true;
		},
	);
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
	assert.deepEqual(Object.keys(facts).sort(), ["extra_denies", "pi_extensions", "worker_context_file"]);
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
