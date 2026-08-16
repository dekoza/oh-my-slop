import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.3's Claude plugin artifact: **the package's own tested generator**
 * (`scripts/build_claude_plugin.py`) invoked against the pinned revision, into
 * an immutable directory **cached per revision** and referenced by the run.
 *
 * The cache key is §11.7's tree digest, so "run-scoped" and "cached per
 * revision" are one thing: two runs pinning the same revision share the same
 * immutable tree, and a revision change is a different directory rather than a
 * rewrite. Nothing here ever modifies an existing cache entry — the build lands
 * in a scratch directory and is renamed into place, so a half-built plugin is
 * never at the cached path and a concurrent builder losing the rename race
 * simply finds the winner's identical tree.
 *
 * Like the factory-private bare clone, the cache is factory-owned
 * infrastructure beside `state.db`, not a §4.5 effect: the mutation inventory
 * is the spec's, and what the run cites is the *validation* of this tree —
 * `claude plugin validate --strict` in the layer-2 probe — not the bytes'
 * arrival.
 */

/** Where one revision's plugin lives under the store directory. */
export function pluginCachePath({ cacheRoot, treeDigest }) {
	return join(cacheRoot, "plugins", treeDigest);
}

/**
 * The generator invocation, verbatim from §6.3's contract: the *pinned
 * package's* script, run from the pinned package root, so the tree it flattens
 * is the tree the digest pinned.
 */
const GENERATOR = Object.freeze(["-m", "scripts.build_claude_plugin"]);
const MANIFEST_LEAF = join(".claude-plugin", "plugin.json");

/**
 * @param {object} input
 * @param {string} input.packageRoot the §11.7 handshake's canonical root
 * @param {string} input.treeDigest the pinned revision — the cache key
 * @param {string} input.cacheRoot the factory's store directory for this repo
 * @param {(command: string, args: string[], options: object) => Promise<{ status: number, stdout: string, stderr: string }>}
 *   [input.runCommand] injectable, so a test drives the refusal paths without a
 *   broken interpreter on the machine
 * @param {string} [input.python]
 * @returns {Promise<Readonly<{ dir: string, manifest: object, outcome: "built" | "cached" }>>}
 * @throws {FactoryWorkerError} `plugin-build-failed`
 */
export async function ensureClaudePlugin({
	packageRoot,
	treeDigest,
	cacheRoot,
	runCommand = execute,
	python = "python3",
}) {
	const dir = pluginCachePath({ cacheRoot, treeDigest });
	if (existsSync(join(dir, MANIFEST_LEAF))) {
		return Object.freeze({ dir, manifest: readPluginManifest(dir), outcome: "cached" });
	}

	const scratch = `${dir}.building-${process.pid}`;
	mkdirSync(dirname(dir), { recursive: true });
	rmSync(scratch, { recursive: true, force: true });

	let built;
	try {
		built = await runCommand(python, [...GENERATOR, "--out", scratch], { cwd: packageRoot });
	} catch (error) {
		rmSync(scratch, { recursive: true, force: true });
		throw new FactoryWorkerError(
			"plugin-build-failed",
			`The plugin generator could not run from ${packageRoot}: ${error.message} (§6.3).`,
			{ packageRoot, treeDigest, command: python },
		);
	}

	if (built.status !== 0) {
		rmSync(scratch, { recursive: true, force: true });
		throw new FactoryWorkerError(
			"plugin-build-failed",
			`scripts.build_claude_plugin refused for revision ${treeDigest} (exit ${built.status}): ${
				(built.stderr || built.stdout).trim() || "(no output)"
			} (§6.3).`,
			{ packageRoot, treeDigest, status: built.status, stderr: built.stderr },
		);
	}

	if (!existsSync(join(scratch, MANIFEST_LEAF))) {
		rmSync(scratch, { recursive: true, force: true });
		throw new FactoryWorkerError(
			"plugin-build-failed",
			`The generator exited 0 but produced no ${MANIFEST_LEAF} under ${scratch} — a plugin with no manifest is not a plugin (§6.3).`,
			{ packageRoot, treeDigest },
		);
	}

	try {
		renameSync(scratch, dir);
	} catch (error) {
		// The rename lost a race with another builder of the same revision. Their
		// tree is the generator's output for the same digest — identical by
		// construction — so theirs is the cache and this scratch is surplus.
		rmSync(scratch, { recursive: true, force: true });
		if (!existsSync(join(dir, MANIFEST_LEAF))) {
			throw new FactoryWorkerError(
				"plugin-build-failed",
				`Could not place the built plugin at ${dir}: ${error.message} (§6.3).`,
				{ packageRoot, treeDigest },
			);
		}
		return Object.freeze({ dir, manifest: readPluginManifest(dir), outcome: "cached" });
	}

	return Object.freeze({ dir, manifest: readPluginManifest(dir), outcome: "built" });
}

/**
 * The manifest of a cached plugin — where the probe learns the plugin *name* it
 * must find components under, rather than hardcoding what the generator owns.
 *
 * @throws {FactoryWorkerError} `plugin-build-failed`
 */
export function readPluginManifest(dir) {
	const path = join(dir, MANIFEST_LEAF);
	try {
		const manifest = JSON.parse(readFileSync(path, "utf8"));
		if (manifest === null || typeof manifest !== "object" || typeof manifest.name !== "string") {
			throw new Error("the manifest names no plugin");
		}
		return Object.freeze(manifest);
	} catch (error) {
		throw new FactoryWorkerError("plugin-build-failed", `Cannot read ${path}: ${error.message} (§6.3).`, {
			at: path,
		});
	}
}

/** The real interpreter call. Exit codes are answers here, not exceptions. */
function execute(command, args, options) {
	return new Promise((resolvePromise, rejectPromise) => {
		execFile(command, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
			if (error !== null && typeof error.code !== "number") {
				rejectPromise(error); // ENOENT and friends: the command could not run at all.
				return;
			}
			resolvePromise({ status: error === null ? 0 : error.code, stdout, stderr });
		});
	});
}
