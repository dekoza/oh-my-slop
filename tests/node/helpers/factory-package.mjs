import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Fixtures for the §11.7 handshake tests: real package trees on disk, because
 * every statement the handshake makes — what is on `PATH`, what a realpath is,
 * what the tree digest covers — is a statement about a filesystem.
 *
 * This file lives one level down so `node --test tests/node/*.mjs` does not pick
 * it up as a test file of its own.
 */

/** The root manifest an installed `oh-my-slop` carries (§11.7's "one package"). */
export const PACKAGE_MANIFEST = Object.freeze({
	name: "oh-my-slop",
	version: "0.1.0",
	bin: { factory: "./factory/bin/factory.mjs" },
	pi: {
		skills: ["./skills"],
		extensions: ["./extensions/factory", "./extensions/factory-monitor"],
	},
});

/**
 * A package tree, written file by file.
 *
 * @param {import("node:test").TestContext} t owner of the temp directory's lifetime
 * @param {Record<string, string | { symlink: string } | null>} files paths relative
 *   to the root, in any order. A `{ symlink }` value writes a link instead of a
 *   file, and `null` writes nothing — which is how a test drops one of
 *   `makePackage`'s defaults before putting something else in its place.
 * @returns {string} the package root
 */
export function makeTree(t, files) {
	// Realpathed here, because everything the handshake records is a realpath and
	// a temp root under a symlinked `/tmp` would make every comparison a mystery.
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-package-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeTree(root, files);
	return root;
}

/** The same, into a directory that already exists. */
export function writeTree(root, files) {
	for (const [path, content] of Object.entries(files)) {
		if (content === null) continue;

		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		if (typeof content === "string") writeFileSync(target, content, "utf8");
		else symlinkSync(content.symlink, target);
	}
	return root;
}

/**
 * A whole package: the four participants §11.7 names, plus whatever the test
 * adds or overrides. `manifest` merges into `PACKAGE_MANIFEST`, so a test that
 * cares about one declaration writes only that one.
 */
export function makePackage(t, { manifest = {}, files = {} } = {}) {
	return makeTree(t, {
		"package.json": JSON.stringify({ ...PACKAGE_MANIFEST, ...manifest }, null, 2),
		"factory/bin/factory.mjs": "#!/usr/bin/env node\n",
		"extensions/factory/index.ts": "export const factory = true;\n",
		"extensions/factory-monitor/index.ts": "export const monitor = true;\n",
		"skills/practice/tdd/SKILL.md": "# tdd\n",
		...files,
	});
}

/**
 * Make the tree a checkout with everything in it committed, and hand back the
 * commit. Identity is passed with `-c` so the fixture never depends on whatever
 * the machine's git config happens to say.
 *
 * @param {string} root
 * @returns {string} the commit sha
 */
export function commitAll(root) {
	const git = (...args) =>
		execFileSync("git", ["-C", root, "-c", "user.name=Factory", "-c", "user.email=factory@example", ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();

	git("init", "--quiet", "--initial-branch=main");
	git("add", "--all");
	git("commit", "--quiet", "--message", "the package as installed");
	return git("rev-parse", "HEAD");
}

/**
 * Put a name on `PATH`, the way an install does: a symlink in a bin directory
 * pointing at the real executable. Returns that directory, for `env.PATH`.
 *
 * @param {import("node:test").TestContext} t
 * @param {string} target what typing the name runs
 * @param {string} [name]
 */
export function onPath(t, target, name = "factory") {
	const bin = mkdtempSync(join(tmpdir(), "factory-bin-"));
	t.after(() => rmSync(bin, { recursive: true, force: true }));

	symlinkSync(target, join(bin, name));
	chmodSync(target, 0o755);
	return bin;
}
