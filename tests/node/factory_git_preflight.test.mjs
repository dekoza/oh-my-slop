import test from "node:test";
import assert from "node:assert/strict";

import { gitIsolationCheck } from "../../factory/lib/git/preflight.mjs";
import { cloneValidConfig, makeRemote, makeRepo } from "./helpers/factory-repo.mjs";
import { openTestStore } from "./helpers/factory-store.mjs";

/**
 * §7.8: v1 supports plain repos only. Preflight detects `.gitmodules` or LFS
 * attributes on the fetched base and fails closed with a clear diagnostic — no
 * silent degradation. The same check proves §7.1's clone and §7.2's fetch: a
 * base nobody can fetch is equally a run that must not start.
 */

async function checkAgainst(t, { files, remotes } = {}) {
	const remote = remotes === undefined ? makeRemote(t, files === undefined ? {} : { files }) : null;
	const store = await openTestStore(t, {
		repoRoot: makeRepo(t, { remotes: remotes ?? { gitea: remote } }),
	});
	return gitIsolationCheck(store, cloneValidConfig());
}

test("a plain, fetchable repo passes, pinning the base tip it observed", async (t) => {
	const check = await checkAgainst(t);

	assert.equal(check.check, "git-isolation");
	assert.equal(check.class, "probe");
	assert.equal(check.result, "passed");
	assert.match(check.detail.base_commit, /^[0-9a-f]{40}$/);
	assert.equal(check.detail.base_branch, "main");
});

test("a repo with submodules fails closed, naming .gitmodules (§7.8)", async (t) => {
	const check = await checkAgainst(t, {
		files: { ".gitmodules": '[submodule "lib"]\n\tpath = lib\n\turl = ../lib.git\n' },
	});

	assert.equal(check.result, "failed");
	assert.match(check.message, /\.gitmodules/);
	assert.match(check.message, /§7\.8/);
});

test("LFS attributes anywhere in the tree fail closed, naming the file", async (t) => {
	const check = await checkAgainst(t, {
		files: { "assets/.gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n" },
	});

	assert.equal(check.result, "failed");
	assert.match(check.message, /assets\/\.gitattributes/);
});

test("plain .gitattributes without LFS is no refusal", async (t) => {
	const check = await checkAgainst(t, { files: { ".gitattributes": "*.md text eol=lf\n" } });

	assert.equal(check.result, "passed");
});

test("an unreachable remote is a red check naming the fetch, not a crash", async (t) => {
	const check = await checkAgainst(t, { remotes: { gitea: "/nonexistent/acme/widgets.git" } });

	assert.equal(check.result, "failed");
	assert.match(check.message, /fetch|remote/i);
});

test("a checkout without the configured remote is a red check naming it", async (t) => {
	const check = await checkAgainst(t, { remotes: {} });

	assert.equal(check.result, "failed");
	assert.match(check.message, /gitea/);
});
