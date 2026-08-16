import { isAbsolute, normalize } from "node:path";

import { FactoryWorkerError } from "../worker/errors.mjs";
import { mergeDenies } from "../worker/permissions.mjs";
import { FactoryConfigError } from "./errors.mjs";
import { requireArray, requireNoUnknownKeys, requireNonEmptyString } from "./shape.mjs";

/**
 * §6.8's per-run override channels, as configuration: **declared at run start,
 * recorded in the run manifest as evidence, and un-crossable in one direction.**
 *
 * Three keys, every one optional, and the block itself optional — absence means
 * "no override", which is a different fact from a value nobody chose and is why
 * `load.mjs` reports which keys the file actually wrote.
 *
 * - **`denies`** — extra deny rules. There is no allow channel and no remove
 *   channel here, which is what makes "may add, never subtract" structural
 *   rather than a rule someone follows. The rule *shape* is `permissions.mjs`'s
 *   to judge; this module only translates its refusal into a config refusal, so
 *   the two never drift into two spellings of one predicate.
 * - **`contextFile`** — §6.8's second migration channel for personal rules: a
 *   repo-relative file copied into the worker config environment at run start
 *   and hash-recorded in the manifest. Repo-relative because the run manifest
 *   pins its digest, and a path outside the repository is one nothing in the
 *   pinned revision can account for.
 * - **`piExtensions`** — pi extensions promoted into the otherwise-empty
 *   controller-owned agent directory. This key is not in §11.3's inherited
 *   block inventory and is added deliberately: config isolation removes the
 *   operator's extensions, and on this host that silently removes the `local`
 *   resource class (its models are supplied by an extension, verified live) and
 *   §6.5's transcript pointer with it. §6.8 forbids inheriting *rules*; an
 *   extension supplying a model provider is capability, and the honest answer
 *   is a declared, manifest-recorded promotion rather than either silent
 *   inheritance or a capacity class that quietly ceases to exist.
 *
 * Only shape is judged here. Whether the declared file and extensions **exist**
 * is preflight's `worker-isolation` check, so `factory status` in a checkout
 * missing them still reports rather than refusing to load.
 */

const WORKER_KEYS = Object.freeze(["denies", "contextFile", "piExtensions"]);

/** What an absent block means, so callers never branch on `undefined`. */
const NO_OVERRIDES = Object.freeze({
	denies: Object.freeze([]),
	contextFile: null,
	piExtensions: Object.freeze([]),
});

/**
 * @param {object | undefined} block the `worker` block as written
 * @param {string} configPath
 * @returns {Readonly<{ denies: ReadonlyArray<string>, contextFile: string | null, piExtensions: ReadonlyArray<string> }>}
 * @throws {FactoryConfigError}
 */
export function validateWorker(block, configPath) {
	if (block === undefined) return NO_OVERRIDES;

	requireNoUnknownKeys(block, WORKER_KEYS, "worker", configPath);

	return Object.freeze({
		denies: validateDenies(block.denies, configPath),
		contextFile: block.contextFile === undefined ? null : repoRelativePath(block.contextFile, configPath),
		piExtensions: validateExtensions(block.piExtensions, configPath),
	});
}

function validateDenies(denies, configPath) {
	if (denies === undefined) return NO_OVERRIDES.denies;

	requireArray(denies, "worker.denies", configPath, "worker.denies");
	try {
		// The rule shape and the floor's un-subtractability are one predicate,
		// owned by `permissions.mjs`; a second copy here would be a second answer.
		mergeDenies(denies);
	} catch (error) {
		if (!(error instanceof FactoryWorkerError)) throw error;
		throw new FactoryConfigError("invalid-value", `${configPath}: ${error.message}`, {
			file: configPath,
			at: "worker.denies",
			reason: error.reason,
			...error.details,
		});
	}

	return Object.freeze([...denies]);
}

/**
 * Each declared extension, anchored.
 *
 * Absolute, or `~/`-relative to the operator's home — never plain-relative.
 * These paths live outside the repository by nature, so they cannot be
 * repo-relative like `contextFile`; what they must not be is **cwd-relative**,
 * which would make the same config load a different extension depending on
 * where the binary was invoked from. Config is repo-bound and takes no ambient
 * input (§11.1), and the working directory is ambient input.
 */
function validateExtensions(paths, configPath) {
	if (paths === undefined) return NO_OVERRIDES.piExtensions;

	requireArray(paths, "worker.piExtensions", configPath, "worker.piExtensions");
	return Object.freeze(
		paths.map((value, index) => {
			const at = `worker.piExtensions[${index}]`;
			const path = requireNonEmptyString(value, at, configPath);
			if (isAbsolute(path) || path.startsWith("~/")) return path;

			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: ${at} must be an absolute path or start with "~/"; found "${path}". A cwd-relative path ` +
					`would load a different extension depending on where the binary was invoked from (§11.1).`,
				{ file: configPath, at, found: path, expected: "an absolute or ~/-anchored path" },
			);
		}),
	);
}

/**
 * A path inside the repository, spelled relative to its root. Absolute paths and
 * anything that climbs out are refused here rather than at copy time: the
 * manifest pins this file's digest as evidence of what the workers were told,
 * and evidence that can point anywhere on the machine is not evidence.
 */
function repoRelativePath(value, configPath) {
	const path = requireNonEmptyString(value, "worker.contextFile", configPath);
	const normalized = normalize(path);

	if (isAbsolute(path) || normalized === ".." || normalized.startsWith("../")) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: worker.contextFile must be a path inside the repository, spelled relative to its root; ` +
				`found "${path}". The manifest pins this file's digest as evidence, so it has to be part of the repository ` +
				`the run is about (§6.8).`,
			{ file: configPath, at: "worker.contextFile", found: path, expected: "a repo-relative path" },
		);
	}

	return normalized;
}
