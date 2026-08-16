import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openPrivateClone } from "../../factory/lib/git/clone.mjs";
import { privateClonePath } from "../../factory/lib/git/isolation.mjs";
import { makeRemote } from "./helpers/factory-repo.mjs";

/**
 * §7.1, §7.2, §7.7: the factory-private bare clone. These run real git against
 * a real bare remote on disk, because "derived, disposable state" and "the
 * fetched tip is the pin" are statements about a repository, not about a mock.
 */

function makeStoreDir(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-clone-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function refsOf(cloneDir) {
	const out = execFileSync("git", ["-C", cloneDir, "for-each-ref", "--format=%(refname)"], { encoding: "utf8" });
	return out.split("\n").filter((line) => line !== "");
}

test("opening the private clone creates a bare repository pointed at the remote", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);

	const clone = await openPrivateClone({ storeDir, remoteUrl: remote });

	assert.equal(clone.dir, privateClonePath(storeDir));
	assert.equal(
		execFileSync("git", ["-C", clone.dir, "rev-parse", "--is-bare-repository"], { encoding: "utf8" }).trim(),
		"true",
	);
	assert.equal(
		execFileSync("git", ["-C", clone.dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim(),
		remote,
	);
});

test("fetchBase pins the remote's tip under refs/factory/, and writes no other ref", async (t) => {
	const remote = makeRemote(t);
	execFileSync("git", ["-C", remote, "tag", "v1", "main"]);
	const storeDir = makeStoreDir(t);
	const clone = await openPrivateClone({ storeDir, remoteUrl: remote });

	const base = await clone.fetchBase({ baseBranch: "main" });

	const tip = execFileSync("git", ["-C", remote, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
	assert.equal(base.commit, tip);
	assert.equal(base.ref, "refs/factory/base/main");
	// §14.11 observed rather than promised: after a fetch, every ref in the
	// private clone is factory-owned. No refs/heads/main, no remote-tracking
	// refs, no tags followed in.
	assert.deepEqual(refsOf(clone.dir), ["refs/factory/base/main"]);
});
