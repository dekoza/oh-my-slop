import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { treeDigest } from "../../factory/lib/package/tree.mjs";
import { makeTree, writeTree } from "./helpers/factory-package.mjs";

/**
 * §11.7's deterministic tree digest: sorted relative paths plus content hashes
 * over the package's own files, **authoritative uniformly for every install
 * shape**. It is what makes the split-brain visible without anyone maintaining
 * a hash by hand.
 */

/** The documented wire format, spelled out here so a silent change fails. */
function expectedDigest(entries) {
	const lines = entries
		.map(([path, kind, payload]) => `${path}\0${kind}\0${createHash("sha256").update(payload).digest("hex")}\n`)
		.sort();
	return createHash("sha256").update(lines.join("")).digest("hex");
}

test("the digest is sha256 over sorted `path NUL kind NUL content-hash` lines", (t) => {
	const root = makeTree(t, { "b.txt": "second", "a/deep.txt": "first" });

	const tree = treeDigest(root);

	assert.equal(tree.algorithm, "sha256");
	assert.equal(tree.files, 2);
	assert.equal(
		tree.digest,
		expectedDigest([
			["a/deep.txt", "file", "first"],
			["b.txt", "file", "second"],
		]),
	);
	assert.ok(Object.isFrozen(tree));
});

test("the same files hash the same however they were laid down", (t) => {
	// Directory order is filesystem business — creation order, inode order, the
	// reader's `readdir` — and none of it is a fact about the package. A digest
	// that moved with it could not be compared across attempts, let alone across
	// installs.
	const forwards = makeTree(t, { "a.txt": "one", "z/b.txt": "two", "m.txt": "three" });
	const backwards = makeTree(t, { "m.txt": "three", "z/b.txt": "two", "a.txt": "one" });

	assert.equal(treeDigest(forwards).digest, treeDigest(backwards).digest);
});

test("a byte of content, or a path, moves the digest", (t) => {
	const base = makeTree(t, { "a.txt": "one" });
	const edited = makeTree(t, { "a.txt": "onE" });
	const renamed = makeTree(t, { "b.txt": "one" });

	assert.notEqual(treeDigest(base).digest, treeDigest(edited).digest);
	assert.notEqual(treeDigest(base).digest, treeDigest(renamed).digest, "the path is part of the digest, not just the bytes");
});

test("node_modules and VCS directories are excluded, wherever they sit", (t) => {
	const clean = makeTree(t, { "index.mjs": "export default 1;\n" });
	const noisy = makeTree(t, { "index.mjs": "export default 1;\n" });

	// §11.7 excludes exactly these: dependencies are the installer's business and
	// differ between a global install and a checkout, and `.git` churns on every
	// command — either one inside the digest would make it a random number.
	writeTree(noisy, {
		"node_modules/dep/index.js": "module.exports = 1;\n",
		".git/HEAD": "ref: refs/heads/main\n",
		".hg/store": "x",
		".svn/entries": "x",
		"extensions/factory/node_modules/nested/index.js": "nested",
	});

	assert.equal(treeDigest(noisy).digest, treeDigest(clean).digest);
	assert.equal(treeDigest(noisy).files, 1);
});

test("a symlink is hashed as its target string, and never followed", (t) => {
	const root = makeTree(t, { "real.txt": "content", "alias.txt": { symlink: "real.txt" } });

	// Following would double-count the target, and a link pointing outside the
	// package — the shape the anti-shadowing guard exists to catch — would drag a
	// foreign tree into the digest or loop forever.
	assert.equal(treeDigest(root).files, 2);
	assert.equal(
		treeDigest(root).digest,
		expectedDigest([
			["alias.txt", "link", "real.txt"],
			["real.txt", "file", "content"],
		]),
	);
});

test("an empty directory is not a file, and a package with no files still digests", (t) => {
	const root = makeTree(t, { "a.txt": "one" });
	mkdirSync(join(root, "empty", "deeper"), { recursive: true });

	assert.equal(treeDigest(root).files, 1);
	assert.equal(treeDigest(makeTree(t, {})).files, 0);
});
