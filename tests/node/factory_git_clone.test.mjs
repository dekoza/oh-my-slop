import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openPrivateClone, runGit } from "../../factory/lib/git/clone.mjs";
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

test("a corrupt clone is replaced wholesale, never repaired in place", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);
	await openPrivateClone({ storeDir, remoteUrl: remote });

	// Damage the repository structurally and leave a marker: §7.1's "re-clone,
	// never in-place repair" means the marker must not survive the reopening.
	writeFileSync(join(privateClonePath(storeDir), "HEAD"), "this is not a ref\n");
	writeFileSync(join(privateClonePath(storeDir), "marker"), "left by the damaged clone\n");

	const clone = await openPrivateClone({ storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });

	assert.ok(!existsSync(join(clone.dir, "marker")), "the damaged clone was repaired in place");
	assert.match(base.commit, /^[0-9a-f]{40}$/);
});

test("a healthy clone whose remote URL drifted converges by set-url, keeping its branches", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);
	const first = await openPrivateClone({ storeDir, remoteUrl: remote });
	const base = await first.fetchBase({ baseBranch: "main" });
	await first.createBranch({ branch: "factory/t42/aRUN-t42-a1", at: base.commit });

	// The remote moved hosts. A rebuild here would discard the attempt branch —
	// the only copy of unpushed work (§7.7) — so drift converges in place.
	const moved = makeRemote(t);
	const clone = await openPrivateClone({ storeDir, remoteUrl: moved });

	assert.equal(
		execFileSync("git", ["-C", clone.dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim(),
		moved,
	);
	assert.ok(refsOf(clone.dir).includes("refs/heads/factory/t42/aRUN-t42-a1"), "the attempt branch was lost");
});

test("fetches into the private clone are serialized, however many callers ask (§7.7)", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);

	let inFlight = 0;
	let peak = 0;
	const watching = async (args, options) => {
		if (args[0] === "fetch") {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		try {
			return await runGit(args, options);
		} finally {
			if (args[0] === "fetch") inFlight -= 1;
		}
	};

	const clone = await openPrivateClone({ storeDir, remoteUrl: remote, git: watching });
	const results = await Promise.all([
		clone.fetchBase({ baseBranch: "main" }),
		clone.fetchBase({ baseBranch: "main" }),
		clone.fetchBase({ baseBranch: "main" }),
	]);

	assert.equal(peak, 1, "two fetches ran into the clone at once");
	assert.equal(new Set(results.map((result) => result.commit)).size, 1);
});

test("every opener of one clone shares one handle, so serialization is the repo's, not the caller's", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);

	const first = await openPrivateClone({ storeDir, remoteUrl: remote });
	const second = await openPrivateClone({ storeDir, remoteUrl: remote });

	// §7.7 serializes fetches into the *clone*; two handles with two private
	// fetch chains would serialize nothing against each other.
	assert.equal(first, second);
});

test("a branch collision is a typed refusal, never a force", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);
	const clone = await openPrivateClone({ storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });

	const first = await clone.createBranch({ branch: "factory/t42/aRUN-t42-a1", at: base.commit });
	assert.deepEqual(first, { sha: base.commit, created: true });

	// The same request again is the same branch, not an error (§7.7's re-runnable
	// integration needs exactly this).
	const again = await clone.createBranch({ branch: "factory/t42/aRUN-t42-a1", at: base.commit });
	assert.deepEqual(again, { sha: base.commit, created: false });

	// A different commit under the deterministic name is a mutation.
	const other = execFileSync("git", ["-C", clone.dir, "commit-tree", `${base.commit}^{tree}`, "-m", "impostor"], {
		encoding: "utf8",
	}).trim();
	await assert.rejects(
		clone.createBranch({ branch: "factory/t42/aRUN-t42-a1", at: other }),
		(error) => error.name === "FactoryGitError" && error.reason === "branch-collision",
	);
});

test("no handle operation can write a ref outside the factory namespaces", async (t) => {
	const remote = makeRemote(t);
	const storeDir = makeStoreDir(t);
	const clone = await openPrivateClone({ storeDir, remoteUrl: remote });
	const base = await clone.fetchBase({ baseBranch: "main" });

	await assert.rejects(
		clone.createBranch({ branch: "main", at: base.commit }),
		(error) => error.name === "FactoryGitError" && error.reason === "ref-outside-namespace",
	);
	await assert.rejects(
		clone.addWorktree({ path: join(storeDir, "worktrees", "x"), branch: "refs/heads/main" }),
		(error) => error.name === "FactoryGitError" && error.reason === "ref-outside-namespace",
	);
});
