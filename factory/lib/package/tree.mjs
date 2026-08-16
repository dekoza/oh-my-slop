import { createHash } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * §11.7's deterministic tree digest: **sorted relative paths plus content
 * hashes over the package's own files**, and the only thing the handshake
 * treats as authoritative about what a package *is*.
 *
 * It is authoritative **uniformly for every install shape**. A checkout is not
 * special-cased — git commit and a dirty flag ride along as metadata (§11.7) —
 * because special-casing them would make dev runs incomparable to installed
 * runs, and dirty checkouts are the common case. The digest is likewise never
 * declared in config: it is recorded and compared across attempts within a run,
 * and a hand-maintained one would be unmaintainable in development.
 */

/**
 * The same algorithm the journal chains with (§4.3) and the artifact store
 * addresses by (§12.1). One spelling of "hashed" across the factory means an
 * operator comparing two digests never has to ask which kind they are.
 */
export const TREE_DIGEST_ALGORITHM = "sha256";

/**
 * The exclusions §11.7 names, and nothing else. `node_modules` is the
 * installer's tree rather than the package's own, and it is exactly what
 * differs between a global install and a checkout; a VCS directory rewrites
 * itself on every command; `__pycache__` is the interpreter's tree — proven
 * live when preflight's own plugin build reran python in the package root,
 * the rewritten .pyc header (it carries the source mtime) changed the digest,
 * and the attempt recheck refused a package nothing changed as
 * handshake-drift. Anything wider would be this module deciding what counts
 * as the package, which is the digest's whole job to observe.
 */
const EXCLUDED_DIRECTORIES = Object.freeze(["node_modules", "__pycache__", ".git", ".hg", ".svn"]);

/**
 * One entry's contribution: `<relative path> NUL <kind> NUL <content hash> LF`.
 *
 * The path is inside the hash, so moving a file changes the digest even when
 * every byte survives. The kind keeps a symlink from colliding with a file
 * whose content happens to be the link's target text.
 */
const KINDS = Object.freeze({ file: "file", link: "link" });

/**
 * The digest of the tree rooted at `root`.
 *
 * **Symlinks are hashed as their target string and never followed.** Following
 * one would double-count an in-tree target, and a link pointing outside the
 * package — the very shape §14.35's guard exists to catch — would either drag a
 * foreign tree into the digest or walk a loop forever.
 *
 * @param {string} root an absolute directory
 * @returns {Readonly<{ algorithm: string, digest: string, files: number }>}
 */
export function treeDigest(root) {
	const lines = [];
	for (const entry of walk(root, root)) {
		lines.push(`${entry.path}\0${entry.kind}\0${hash(entry.payload)}\n`);
	}
	lines.sort();

	return Object.freeze({
		algorithm: TREE_DIGEST_ALGORITHM,
		digest: hash(lines.join("")),
		files: lines.length,
	});
}

/**
 * Every file and symlink under `directory`, depth-first. Order is not part of
 * the result — the caller sorts — because directory order is the filesystem's
 * business and never a fact about the package.
 */
function* walk(root, directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			if (EXCLUDED_DIRECTORIES.includes(entry.name)) continue;
			yield* walk(root, path);
			continue;
		}

		if (entry.isSymbolicLink()) {
			yield { path: relativePosix(root, path), kind: KINDS.link, payload: readlinkSync(path) };
			continue;
		}

		if (entry.isFile()) {
			yield { path: relativePosix(root, path), kind: KINDS.file, payload: readFileSync(path) };
		}
	}
}

/** `/`-separated, so the same tree digests the same wherever it is read. */
function relativePosix(root, path) {
	return relative(root, path).split(sep).join("/");
}

function hash(payload) {
	return createHash(TREE_DIGEST_ALGORITHM).update(payload).digest("hex");
}
