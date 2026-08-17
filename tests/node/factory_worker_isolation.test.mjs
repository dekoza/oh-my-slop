import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { worktreesRoot } from "../../factory/lib/git/isolation.mjs";
import { workerConfigRoots } from "../../factory/lib/worker/environment.mjs";
import { DENY_FLOOR } from "../../factory/lib/worker/permissions.mjs";
import { createWorkerPreflight } from "../../factory/lib/worker/preflight.mjs";
import { herdrIntegration, makeTree, skillMarkdown } from "./helpers/factory-package.mjs";

/**
 * §6.8's three preflight obligations as the checks the controller records:
 * the controller-owned config environment, the permission postures the
 * sessions will actually load, and pre-trust that reads back through each
 * runtime's own resolution rule.
 */

const NO_OVERRIDES = Object.freeze({ denies: [], contextFile: null, piExtensions: [] });

const ROUTING = Object.freeze({
	set: null,
	roles: { implement: "builder", freshRetry: "builder", review: "reviewer" },
	rules: [],
});

function lab(t, { worker = NO_OVERRIDES, profiles, pinned = true } = {}) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-isolation-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const packageRoot = makeTree(t, {
		"package.json": JSON.stringify({ name: "oh-my-slop", version: "9.9.9", description: "f", author: "F" }),
		"skills/workflow/implement/SKILL.md": skillMarkdown("implement"),
		"skills/practice/review-standards/SKILL.md": skillMarkdown("review-standards"),
		"skills/practice/review-spec/SKILL.md": skillMarkdown("review-spec"),
	});

	const storeDir = join(root, "store");
	const repoRoot = join(root, "repo");
	const home = join(root, "home");
	for (const path of [storeDir, repoRoot, join(home, ".pi", "agent", "extensions"), join(home, ".claude", "hooks")]) {
		mkdirSync(path, { recursive: true });
	}
	// The host runs herdr: §6.5's agent-state integration is installed in the
	// operator's config roots at the version the factory is written against.
	writeFileSync(join(home, ".pi", "agent", "extensions", "herdr-agent-state.ts"), herdrIntegration("pi", 8));
	writeFileSync(join(home, ".claude", "hooks", "herdr-agent-state.sh"), herdrIntegration("claude", 7));

	const config = {
		worker,
		profiles: profiles ?? {
			builder: { kind: "pi", model: "local/qwen3" },
			reviewer: { kind: "claude", model: "opus" },
		},
		concurrency: { resources: { local: 1, "claude-code": 1 } },
	};

	return {
		root,
		storeDir,
		repoRoot,
		preflight: createWorkerPreflight({
			// The §11.7 handshake — or, when `pinned: false`, the one that did
			// not resolve, which is what the checks have to name rather than
			// guess around.
			handshake: pinned
				? {
						package: { root: packageRoot, name: "oh-my-slop", version: "9.9.9" },
						tree: { digest: "rev-1" },
						participants: [{ kind: "skills-root", path: join(packageRoot, "skills") }],
					}
				: null,
			config,
			activeRouting: ROUTING,
			cacheRoot: storeDir,
			repoRoot,
			env: { HOME: home },
		}),
		home,
	};
}

/** Delete the operator's copy of one runtime's integration, before the environment is built. */
function uninstall(context, kind) {
	const path =
		kind === "pi"
			? join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts")
			: join(context.home, ".claude", "hooks", "herdr-agent-state.sh");
	rmSync(path, { force: true });
}

test("the isolation check builds the environment it reports, and names what it promoted", (t) => {
	const context = lab(t);

	const checked = context.preflight.isolationCheck();

	assert.equal(checked.result, "passed");
	assert.equal(checked.detail.config_environment.pi, workerConfigRoots(context.storeDir).pi);
	assert.match(checked.message, /inheriting none of the operator's config, skills, or hooks/);
	// The facts ride the check, because the run manifest records them — the
	// declarations under `overrides`, and where they landed beside it.
	assert.deepEqual(checked.facts.overrides.extra_denies, { declared: [] });
	assert.equal(checked.facts.environment.pi, workerConfigRoots(context.storeDir).pi);
});

test("the permissions check reads the floor back out of the settings a session will load", (t) => {
	const context = lab(t, { worker: { ...NO_OVERRIDES, denies: ["WebFetch"] } });
	context.preflight.isolationCheck();

	const checked = context.preflight.permissionsCheck();

	assert.equal(checked.result, "passed");
	assert.match(checked.message, /plan and acceptEdits are never used/);
	// A pi profile is in play, so §6.8's concession is recorded loudly rather
	// than left in a specification nobody reads during an incident.
	assert.match(checked.message, /no command-level permission system/);
	assert.deepEqual(checked.detail.extra_denies, ["WebFetch"]);

	const settings = JSON.parse(
		readFileSync(join(workerConfigRoots(context.storeDir).claude, "settings-builder.json"), "utf8"),
	);
	for (const rule of DENY_FLOOR) assert.ok(settings.permissions.deny.includes(rule));
});

test("with no pi profile in play the caveat is absent — it is a fact about this run, not a slogan", (t) => {
	const context = lab(t, { profiles: { builder: { kind: "claude", model: "opus" }, reviewer: { kind: "claude", model: "opus" } } });
	context.preflight.isolationCheck();

	const checked = context.preflight.permissionsCheck();

	assert.equal(checked.detail.pi_caveat, null);
});

test("a settings file that lost the floor is a red check, not a session nobody inspected", (t) => {
	const context = lab(t);
	context.preflight.isolationCheck();
	writeFileSync(
		join(workerConfigRoots(context.storeDir).claude, "settings-builder.json"),
		JSON.stringify({ permissions: { defaultMode: "acceptEdits", allow: ["Bash"], deny: [] } }),
	);

	const checked = context.preflight.permissionsCheck();

	assert.equal(checked.result, "failed");
	assert.match(checked.message, /deny floor/);
	assert.ok(checked.detail.missing.some((entry) => entry.rule === "defaultMode acceptEdits"));
});

test("the trust check proves both runtimes' own resolution rules for the paths panes will use", (t) => {
	const context = lab(t);
	context.preflight.isolationCheck();

	const checked = context.preflight.trustCheck();

	assert.equal(checked.result, "passed");
	assert.deepEqual(checked.detail.decisions, { pi: true, claude: true });
	assert.equal(checked.detail.worktrees, worktreesRoot(context.storeDir));
	assert.match(checked.message, /No trust dialog can reach a worker pane/);
});

test("a trust store that cannot be written is this check's red, never a crash mid-preflight", (t) => {
	const context = lab(t);
	context.preflight.isolationCheck();
	const roots = workerConfigRoots(context.storeDir);
	chmodSync(roots.pi, 0o500);

	const checked = context.preflight.trustCheck();

	// Restored here rather than in an after-hook: the fixture's own cleanup is
	// registered first and would meet the read-only directory before the hook ran.
	chmodSync(roots.pi, 0o700);
	assert.equal(checked.result, "failed");
	assert.match(checked.message, /would meet the trust dialog and hang there/);
});

test("every later check names the isolation check rather than repeating its diagnosis", (t) => {
	const context = lab(t, { worker: { ...NO_OVERRIDES, contextFile: "docs/absent.md" } });

	assert.equal(context.preflight.isolationCheck().result, "failed");
	for (const checked of [
		context.preflight.permissionsCheck(),
		context.preflight.trustCheck(),
		context.preflight.agentStateCheck(),
	]) {
		assert.equal(checked.result, "failed");
		assert.equal(checked.detail.cause, "worker-isolation");
	}
});

/**
 * §6.5's agent-state integration, observed out of the environment the workers
 * get: the capability that pushes the transcript pointer, promoted rather
 * than inherited, version-observed rather than assumed. A run that could not
 * carry the pointer is a named red here, not a silent `null` on every
 * `attempt.correlated`.
 */

test("the agent-state check observes the integration installed and current for every runtime in play", (t) => {
	const context = lab(t);
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "passed");
	assert.match(checked.message, /pi/);
	assert.match(checked.message, /claude/);
	assert.deepEqual(checked.detail.runtimes.pi, {
		installed: true,
		source: join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"),
		observed_version: 8,
		expected_version: 8,
	});
	assert.equal(checked.detail.runtimes.claude.observed_version, 7);
	assert.equal(checked.detail.runtimes.claude.expected_version, 7);
});

test("a missing agent-state integration is a named red that says which runtime loses its pointer", (t) => {
	const context = lab(t);
	uninstall(context, "pi");
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "failed");
	assert.match(checked.message, /pi/);
	assert.match(checked.message, /herdr-agent-state\.ts/);
	assert.match(checked.message, /no other channel/);
	assert.deepEqual(checked.detail.findings.map((entry) => entry.reason), ["agent-state-missing"]);
	assert.equal(checked.detail.findings[0].runtime, "pi");
	assert.equal(checked.detail.findings[0].source, join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"));
	// The runtime that is still fine is reported as observed, not hidden.
	assert.equal(checked.detail.runtimes.claude.installed, true);
	assert.equal(checked.detail.runtimes.claude.observed_version, 7);
});

test("an integration herdr left outdated is a version mismatch naming the numbers observed and expected", (t) => {
	const context = lab(t);
	writeFileSync(join(context.home, ".claude", "hooks", "herdr-agent-state.sh"), herdrIntegration("claude", 5));
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "failed");
	assert.deepEqual(checked.detail.findings.map((entry) => entry.reason), ["agent-state-version-mismatch"]);
	const finding = checked.detail.findings[0];
	assert.equal(finding.runtime, "claude");
	assert.equal(finding.observed_version, 5);
	assert.equal(finding.expected_version, 7);
	assert.match(checked.message, /5/);
	assert.match(checked.message, /7/);
});

test("an integration that identifies as another runtime is a mismatch, not a version story", (t) => {
	const context = lab(t);
	// claude's integration, in pi's slot, stamped with the version pi expects:
	// a version-only check would read this as current, and it is not.
	writeFileSync(join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"), herdrIntegration("claude", 8));
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "failed");
	assert.deepEqual(checked.detail.findings.map((entry) => entry.reason), ["agent-state-mismatch"]);
	const finding = checked.detail.findings[0];
	assert.equal(finding.runtime, "pi");
	assert.match(checked.message, /"claude"/);
});

test("an integration that lost its header is unversioned — observed, not assumed away", (t) => {
	const context = lab(t);
	writeFileSync(join(context.home, ".pi", "agent", "extensions", "herdr-agent-state.ts"), herdrIntegration("pi", null));
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "failed");
	assert.deepEqual(checked.detail.findings.map((entry) => entry.reason), ["agent-state-unversioned"]);
	assert.equal(checked.detail.findings[0].runtime, "pi");
	assert.equal(checked.detail.runtimes.pi.installed, true);
	assert.equal(checked.detail.runtimes.pi.observed_version, null);
	assert.match(checked.message, /HERDR_INTEGRATION_VERSION/);
});

test("a runtime the active routing cannot dispatch to is not gated — the check answers for this run, not the host", (t) => {
	const context = lab(t, { profiles: { builder: { kind: "claude", model: "opus" }, reviewer: { kind: "claude", model: "opus" } } });
	uninstall(context, "pi");
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "passed");
	assert.deepEqual(Object.keys(checked.detail.runtimes), ["claude"]);
	assert.equal(checked.detail.runtimes.claude.observed_version, 7);
});

test("with no pinned revision the agent-state check names the handshake rather than guessing", (t) => {
	const context = lab(t, { pinned: false });
	context.preflight.isolationCheck();

	const checked = context.preflight.agentStateCheck();

	assert.equal(checked.result, "failed");
	assert.equal(checked.detail.cause, "package-handshake");
});
