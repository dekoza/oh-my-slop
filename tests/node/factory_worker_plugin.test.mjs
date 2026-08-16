import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureClaudePlugin, pluginCachePath, readPluginManifest } from "../../factory/lib/worker/plugin.mjs";
import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import { makeTree } from "./helpers/factory-package.mjs";

/**
 * §6.3: the plugin is built from the pinned revision **by the package's own
 * generator**, into an immutable per-revision cache, strictly validated
 * downstream. These tests run the real generator against real fixture
 * packages, because the flattening it performs is load-bearing — the Claude
 * loader registers skills at depth 1 only, silently.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The real generator, carried into the fixture the way an install carries it. */
function generatorFiles() {
	return {
		"scripts/__init__.py": "",
		"scripts/validate_refs.py": readFileSync(join(REPO_ROOT, "scripts", "validate_refs.py"), "utf8"),
		"scripts/build_claude_plugin.py": readFileSync(join(REPO_ROOT, "scripts", "build_claude_plugin.py"), "utf8"),
	};
}

function fixturePackage(t, { manifest = {} } = {}) {
	return makeTree(t, {
		"package.json": JSON.stringify({
			name: "oh-my-slop",
			version: "9.9.9",
			description: "fixture package",
			author: "Fixture",
			...manifest,
		}),
		"skills/practice/tdd/SKILL.md": "---\nname: tdd\ndescription: d\n---\n",
		"skills/workflow/implement/SKILL.md": "---\nname: implement\ndescription: d\n---\n",
		"skills/workflow/implement/references/notes.md": "kept beside its skill\n",
		...generatorFiles(),
	});
}

test("the generator builds a flattened plugin into the per-revision cache", async (t) => {
	const packageRoot = fixturePackage(t);
	const cacheRoot = makeTree(t, {});

	const built = await ensureClaudePlugin({ packageRoot, treeDigest: "sha256:rev1", cacheRoot });

	assert.equal(built.outcome, "built");
	assert.equal(built.dir, pluginCachePath({ cacheRoot, treeDigest: "sha256:rev1" }));
	assert.equal(built.manifest.name, "oh-my-slop");

	// §6.3's loader fact: depth 1 only, references kept beside their skill.
	assert.ok(existsSync(join(built.dir, "skills", "tdd", "SKILL.md")));
	assert.ok(existsSync(join(built.dir, "skills", "implement", "references", "notes.md")));
	assert.ok(!existsSync(join(built.dir, "skills", "practice")), "a bucket survived the flattening");

	// No scratch directory left behind.
	assert.deepEqual(
		readdirSync(join(cacheRoot, "plugins")).filter((entry) => entry.includes("building")),
		[],
	);
});

test("a second run over the same revision reuses the cache without rebuilding", async (t) => {
	const packageRoot = fixturePackage(t);
	const cacheRoot = makeTree(t, {});

	const first = await ensureClaudePlugin({ packageRoot, treeDigest: "sha256:rev1", cacheRoot });
	const marker = join(first.dir, ".claude-plugin", "plugin.json");
	utimesSync(marker, new Date(0), new Date(0));

	const second = await ensureClaudePlugin({
		packageRoot,
		treeDigest: "sha256:rev1",
		cacheRoot,
		// A rebuild would have to run something; a cache hit runs nothing.
		runCommand: () => {
			throw new Error("the cache was ignored");
		},
	});

	assert.equal(second.outcome, "cached");
	assert.equal(second.dir, first.dir);

	// Immutable: the cached tree was not touched.
	const stat = readFileSync(marker, "utf8");
	assert.equal(JSON.parse(stat).name, "oh-my-slop");
});

test("a different revision is a different directory, never a rewrite", async (t) => {
	const packageRoot = fixturePackage(t);
	const cacheRoot = makeTree(t, {});

	const one = await ensureClaudePlugin({ packageRoot, treeDigest: "sha256:rev1", cacheRoot });
	const two = await ensureClaudePlugin({ packageRoot, treeDigest: "sha256:rev2", cacheRoot });

	assert.notEqual(one.dir, two.dir);
	assert.ok(existsSync(join(one.dir, ".claude-plugin", "plugin.json")));
	assert.ok(existsSync(join(two.dir, ".claude-plugin", "plugin.json")));
});

test("a generator refusal is a typed failure carrying its own words, and no cache entry", async (t) => {
	// The real generator refuses a package.json without a description — the
	// fail-closed path §6.3 promises, driven through the real interpreter.
	const packageRoot = fixturePackage(t, { manifest: { description: undefined } });
	const cacheRoot = makeTree(t, {});

	await assert.rejects(
		ensureClaudePlugin({ packageRoot, treeDigest: "sha256:bad", cacheRoot }),
		(error) => {
			assert.ok(error instanceof FactoryWorkerError);
			assert.equal(error.reason, "plugin-build-failed");
			assert.match(error.message, /description/);
			return true;
		},
	);

	assert.ok(!existsSync(pluginCachePath({ cacheRoot, treeDigest: "sha256:bad" })));
	assert.deepEqual(
		existsSync(join(cacheRoot, "plugins")) ? readdirSync(join(cacheRoot, "plugins")) : [],
		[],
		"a refused build left something in the cache",
	);
});

test("an interpreter that cannot run at all is the same typed failure", async (t) => {
	const packageRoot = fixturePackage(t);
	const cacheRoot = makeTree(t, {});

	await assert.rejects(
		ensureClaudePlugin({
			packageRoot,
			treeDigest: "sha256:rev1",
			cacheRoot,
			python: "no-such-interpreter-anywhere",
		}),
		(error) => error instanceof FactoryWorkerError && error.reason === "plugin-build-failed",
	);
});

test("a manifest that names no plugin is refused when read back", (t) => {
	const dir = makeTree(t, { ".claude-plugin/plugin.json": JSON.stringify({ version: "1.0.0" }) });

	assert.throws(
		() => readPluginManifest(dir),
		(error) => error instanceof FactoryWorkerError && error.reason === "plugin-build-failed",
	);
});
