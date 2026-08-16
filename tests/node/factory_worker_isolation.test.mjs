import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { worktreesRoot } from "../../factory/lib/git/isolation.mjs";
import { workerConfigRoots } from "../../factory/lib/worker/environment.mjs";
import { DENY_FLOOR } from "../../factory/lib/worker/permissions.mjs";
import { createWorkerPreflight } from "../../factory/lib/worker/preflight.mjs";
import { makeTree, skillMarkdown } from "./helpers/factory-package.mjs";

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

function lab(t, { worker = NO_OVERRIDES, profiles } = {}) {
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
	mkdirSync(storeDir, { recursive: true });
	mkdirSync(repoRoot, { recursive: true });

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
			handshake: {
				package: { root: packageRoot, name: "oh-my-slop", version: "9.9.9" },
				tree: { digest: "rev-1" },
				participants: [{ kind: "skills-root", path: join(packageRoot, "skills") }],
			},
			config,
			activeRouting: ROUTING,
			cacheRoot: storeDir,
			repoRoot,
			env: { HOME: join(root, "home") },
		}),
	};
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
	assert.match(checked.message, /acceptEdits is never used/);
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
	for (const checked of [context.preflight.permissionsCheck(), context.preflight.trustCheck()]) {
		assert.equal(checked.result, "failed");
		assert.equal(checked.detail.cause, "worker-isolation");
	}
});
