import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	assertFactoryRef,
	attemptBranch,
	attemptWorktreePath,
	privateClonePath,
	worktreesRoot,
} from "../../factory/lib/git/isolation.mjs";

/**
 * §7.3, §2.1: the branch and worktree a factory attempt lives in are **derived
 * deterministically from the minted identity tuple**, and every identity-derived
 * path is contained by charset validation **plus** canonicalize-and-assert-prefix
 * — both, not either.
 */

const RUN = "01JRUN0000000000000000000A";
const ATTEMPT = `${RUN}-t42-a1`;

test("the attempt branch is derived from the tuple, inside the factory/ namespace", () => {
	assert.equal(attemptBranch({ ticket: 42, attempt: ATTEMPT }), `factory/t42/a${ATTEMPT}`);
});

test("a branch is never minted from a tuple whose attempt names a different ticket", () => {
	assert.throws(
		() => attemptBranch({ ticket: 7, attempt: ATTEMPT }),
		(error) => error.name === "FactoryGitError" && error.reason === "identity-mismatch",
	);
});

test("the clone and the worktrees are peers of state.db in the controller-owned state area", () => {
	assert.equal(privateClonePath("/agent/repos/slug"), "/agent/repos/slug/clone.git");
	assert.equal(worktreesRoot("/agent/repos/slug"), "/agent/repos/slug/worktrees");
	assert.equal(attemptWorktreePath("/agent/repos/slug", ATTEMPT), `/agent/repos/slug/worktrees/${ATTEMPT}`);
});

test("an identity segment outside §2.1's charset never becomes a path or a branch", () => {
	for (const hostile of ["../escape", "a/b", "a b", ".", "", null]) {
		assert.throws(
			() => attemptWorktreePath("/agent/repos/slug", hostile),
			(error) => error.name === "FactoryGitError" && error.reason === "identity-charset",
			JSON.stringify(hostile),
		);
		assert.throws(
			() => attemptBranch({ ticket: 42, attempt: hostile }),
			(error) => error.name === "FactoryGitError" && error.reason === "identity-charset",
			JSON.stringify(hostile),
		);
	}
});

test("a symlink planted as the attempt's entry cannot launder the worktree out of its root", (t) => {
	// Charset validation alone would pass this attempt id; only the
	// canonicalize-and-assert-prefix half (§2.1: both, not either) catches a
	// pre-planted symlink pointing outside the state area.
	const storeDir = mkdtempSync(join(tmpdir(), "factory-isolation-"));
	const outside = mkdtempSync(join(tmpdir(), "factory-outside-"));
	t.after(() => rmSync(storeDir, { recursive: true, force: true }));
	t.after(() => rmSync(outside, { recursive: true, force: true }));

	mkdirSync(worktreesRoot(storeDir), { recursive: true });
	symlinkSync(outside, join(worktreesRoot(storeDir), ATTEMPT));

	assert.throws(
		() => attemptWorktreePath(storeDir, ATTEMPT),
		(error) => error.name === "FactoryGitError" && error.reason === "identity-path-escape",
	);
});

test("§14.11's gate: only factory/ branches and refs/factory/* refs are writable", () => {
	assert.equal(assertFactoryRef("factory/t42/a" + ATTEMPT), "factory/t42/a" + ATTEMPT);
	assert.equal(assertFactoryRef("refs/factory/base/main"), "refs/factory/base/main");
	assert.equal(assertFactoryRef("refs/heads/factory/t42/a1"), "refs/heads/factory/t42/a1");

	for (const outside of ["main", "refs/heads/main", "refs/tags/v1", "refs/remotes/origin/main", "factoryish/x"]) {
		assert.throws(
			() => assertFactoryRef(outside),
			(error) => error.name === "FactoryGitError" && error.reason === "ref-outside-namespace",
			outside,
		);
	}
});
