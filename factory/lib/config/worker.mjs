import { isAbsolute, normalize } from "node:path";

import { FactoryWorkerError } from "../worker/errors.mjs";
import { mergeDenies } from "../worker/permissions.mjs";
import { FactoryConfigError } from "./errors.mjs";
import { requireArray, requireNoUnknownKeys, requireNonEmptyString, requireObject } from "./shape.mjs";

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
 * @returns {Readonly<{ denies: ReadonlyArray<string>, contextFile: string | null,
 *   piExtensions: ReadonlyArray<{ path: string, env: Readonly<Record<string, string>> }> }>}
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
 * Each declared extension, anchored and normalized to `{ path, env }`.
 *
 * A bare string is shorthand for an extension with no declared environment;
 * one validated shape leaves consumers nothing to branch on.
 *
 * Paths: absolute, or `~/`-relative to the operator's home — never
 * plain-relative. These paths live outside the repository by nature, so they
 * cannot be repo-relative like `contextFile`; what they must not be is
 * **cwd-relative**, which would make the same config load a different extension
 * depending on where the binary was invoked from. Config is repo-bound and
 * takes no ambient input (§11.1), and the working directory is ambient input.
 *
 * Environment: the values a promoted capability needs — a provider's endpoint,
 * typically — declared here rather than inherited from whatever the operator's
 * shell happens to export, so the run manifest can account for them (§6.8).
 */
function validateExtensions(entries, configPath) {
	if (entries === undefined) return NO_OVERRIDES.piExtensions;

	requireArray(entries, "worker.piExtensions", configPath, "worker.piExtensions");
	return Object.freeze(
		entries.map((value, index) => {
			const at = `worker.piExtensions[${index}]`;
			if (typeof value === "string") {
				return Object.freeze({ path: anchoredPath(value, at, configPath), env: Object.freeze({}) });
			}

			requireObject(value, at, configPath, at);
			requireNoUnknownKeys(value, ["path", "env"], at, configPath);
			return Object.freeze({
				path: anchoredPath(requireNonEmptyString(value.path, `${at}.path`, configPath), `${at}.path`, configPath),
				env: validateExtensionEnv(value.env, at, configPath),
			});
		}),
	);
}

function anchoredPath(path, at, configPath) {
	requireNonEmptyString(path, at, configPath);
	if (isAbsolute(path) || path.startsWith("~/")) return path;

	throw new FactoryConfigError(
		"invalid-value",
		`${configPath}: ${at} must be an absolute path or start with "~/"; found "${path}". A cwd-relative path ` +
			`would load a different extension depending on where the binary was invoked from (§11.1).`,
		{ file: configPath, at, found: path, expected: "an absolute or ~/-anchored path" },
	);
}

/** The variables the launch types into a worker pane's shell (§6.5's channel). */
const RESERVED_ENV_NAMES = Object.freeze(["PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR", "HOME", "PATH"]);
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SECRET_SHAPED = /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY/;

/**
 * A declared environment a shell export can carry faithfully and a pane can
 * show without leaking: the values land in the worker pane's scrollback, so a
 * name that announces a secret is refused here rather than displayed there.
 * The isolation and identity variables are refused too — the binding would win
 * anyway (it spreads them last), but a declaration that silently loses is
 * worse than one that is refused with the reason.
 */
function validateExtensionEnv(env, at, configPath) {
	if (env === undefined) return Object.freeze({});

	requireObject(env, `${at}.env`, configPath, `${at}.env`);
	for (const [name, value] of Object.entries(env)) {
		const envAt = `${at}.env.${name}`;
		const refuse = (sentence, expected) => {
			throw new FactoryConfigError("invalid-value", `${configPath}: ${envAt} ${sentence}`, {
				file: configPath,
				at: envAt,
				found: name,
				expected,
			});
		};

		if (!ENV_NAME_PATTERN.test(name)) {
			refuse(`is not a portable environment variable name (${ENV_NAME_PATTERN}).`, "an UPPER_SNAKE_CASE name");
		}
		if (RESERVED_ENV_NAMES.includes(name) || name.startsWith("FACTORY_")) {
			refuse(
				`names a variable the controller owns: the isolation and identity channels are not declarable (§6.5, §6.8).`,
				"a name outside the controller-owned set",
			);
		}
		if (SECRET_SHAPED.test(name)) {
			refuse(
				`looks like a credential, and declared values are typed into the worker pane's shell, so they land in ` +
					`scrollback anyone attached can read. Credentials cross only as §6.8's promoted capability artifacts.`,
				"a non-secret capability value, such as an endpoint URL",
			);
		}
		if (typeof value !== "string" || value === "" || /[\p{Cc}]/u.test(value)) {
			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: ${envAt} must be a non-empty single-line string; a shell export cannot carry anything else ` +
					`faithfully.`,
				{ file: configPath, at: envAt, found: typeof value, expected: "a non-empty string without control characters" },
			);
		}
	}

	return Object.freeze({ ...env });
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
