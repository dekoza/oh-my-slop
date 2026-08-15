import { readFileSync } from "node:fs";

import { remoteUrlToRepoSlug, resolveRemoteUrl } from "../git/repo.mjs";
import { discoverConfigPath } from "./discover.mjs";
import { FactoryConfigError } from "./errors.mjs";

/**
 * The factory's fail-closed configuration load (§11.1, §11.2).
 *
 * One file, read exactly once, at the git repo root. Unknown key, missing
 * required key, unrecognised schemaVersion, parse error, and any residual
 * `TODO` sentinel all refuse the run — the loader never warns and continues,
 * and `extensions/config-loader.ts`'s fallback-on-parse-error semantics are
 * deliberately not reused here.
 */

/** Legacy configs used `version: 1`; starting at 2 keeps one number, one schema. */
export const CONFIG_SCHEMA_VERSION = 2;

/**
 * The §11.3 block inventory. `required` is presence at load time; blocks whose
 * every key has an upstream-fixed default (`budgets`, `retention`) and the
 * optional `package.expect` may be omitted.
 *
 * `interior` names who validates what is inside a block. The blocks marked
 * `deferred` are the repo binding's neighbours, not its parts: their semantics
 * — profile shapes, routing overlap, the five check fields, budget ceilings,
 * concurrency sizes, retention floors — are #89's, and land against this table.
 */
export const CONFIG_BLOCKS = Object.freeze({
	tracker: { required: true, container: "object", interior: "owned" },
	git: { required: true, container: "object", interior: "owned" },
	profiles: { required: true, container: "object", interior: "deferred" },
	routing: { required: true, container: "object", interior: "deferred" },
	checks: { required: true, container: "array", interior: "deferred" },
	budgets: { required: false, container: "object", interior: "deferred" },
	concurrency: { required: true, container: "object", interior: "deferred" },
	retention: { required: false, container: "object", interior: "deferred" },
	package: { required: false, container: "object", interior: "deferred" },
});

const TRACKER_KEYS = Object.freeze(["kind", "repo", "remote", "login", "assignee"]);
const GIT_KEYS = Object.freeze(["baseBranch", "remote"]);
const SUPPORTED_TRACKER_KINDS = Object.freeze(["gitea"]);
const REPO_SLUG_PATTERN = /^[^/\s]+\/[^/\s]+$/;
const TODO_SENTINEL_PATTERN = /^TODO\b/;

/**
 * @returns {{ repoRoot: string, configPath: string, config: object, remote: { name: string, url: string, slug: string } }}
 * @throws {FactoryConfigError}
 */
export function loadFactoryConfig({ cwd }) {
	const { repoRoot, configPath } = discoverConfigPath(cwd);
	const source = readConfigFile(configPath);
	const document = parseConfigFile(source, configPath);

	const config = validateConfig(document, configPath);
	const remote = crossCheckRemote(config, repoRoot, configPath);

	return { repoRoot, configPath, config, remote };
}

/**
 * §11.1's fail-closed cross-check: the repo this binary was invoked in must be
 * the repo the tracker block names. Config is repo-bound, so a policy file that
 * travelled — a copied checkout, a fork, a wrong remote — is caught here rather
 * than by a claim comment landing on somebody else's tracker.
 */
function crossCheckRemote(config, repoRoot, configPath) {
	const name = config.tracker.remote;
	const url = resolveRemoteUrl(repoRoot, name);
	if (url === null) {
		throw new FactoryConfigError(
			"remote-unresolvable",
			`${repoRoot} defines no git remote "${name}", which tracker.remote names.`,
			{ file: configPath, at: "tracker.remote", remote: name, repoRoot },
		);
	}

	const slug = remoteUrlToRepoSlug(url);
	if (slug === null || slug.toLowerCase() !== config.tracker.repo.toLowerCase()) {
		throw new FactoryConfigError(
			"remote-mismatch",
			`Remote "${name}" is ${url}, which is not tracker.repo "${config.tracker.repo}". The factory refuses to start against a repository its config does not describe.`,
			{
				file: configPath,
				at: "tracker.repo",
				remote: name,
				url,
				expected: config.tracker.repo,
				found: slug,
			},
		);
	}

	return { name, url, slug };
}

/**
 * The document checks, in the order that produces the most actionable refusal:
 * a v1 file is a version problem before it is anything else, and a file fresh
 * out of `factory migrate` is a hole-filling problem before it is a shape
 * problem (§11.8).
 */
function validateConfig(document, configPath) {
	requireObject(document, "the configuration", configPath, "");
	requireSchemaVersion(document, configPath);
	requireNoTodoSentinel(document, configPath);
	requireKnownBlocks(document, configPath);
	requireTrackerBlock(document.tracker, configPath);
	requireGitBlock(document.git, configPath);

	return document;
}

function readConfigFile(configPath) {
	try {
		return readFileSync(configPath, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new FactoryConfigError(
				"file-missing",
				`Missing ${configPath}. The factory refuses to start without its policy file.`,
				{ file: configPath },
			);
		}
		throw new FactoryConfigError("unreadable", `Cannot read ${configPath}: ${error.message}`, {
			file: configPath,
		});
	}
}

function parseConfigFile(source, configPath) {
	try {
		return JSON.parse(source);
	} catch (error) {
		throw new FactoryConfigError("parse-error", `Invalid JSON in ${configPath}: ${error.message}`, {
			file: configPath,
		});
	}
}

function requireSchemaVersion(document, configPath) {
	const found = document.schemaVersion;
	if (found === CONFIG_SCHEMA_VERSION) return;

	const legacy = found === undefined && document.version !== undefined;
	const message = legacy
		? `${configPath} is a legacy v${document.version} config. Run \`factory migrate\` — there is no silent in-place upgrade.`
		: `${configPath} declares schemaVersion ${JSON.stringify(found ?? null)}; this factory reads ${CONFIG_SCHEMA_VERSION}. Run \`factory migrate\` for a v1 file.`;

	throw new FactoryConfigError("schema-version", message, {
		file: configPath,
		at: legacy ? "version" : "schemaVersion",
		found: legacy ? document.version : (found ?? null),
		expected: CONFIG_SCHEMA_VERSION,
	});
}

/**
 * `factory migrate` leaves holes rather than guessing (§11.8), and the loader
 * is what keeps a hole from reaching a run. The scan is whole-document because
 * the holes live in blocks whose interiors this slice does not otherwise read.
 */
function requireNoTodoSentinel(document, configPath) {
	for (const [path, value] of walkDocument(document)) {
		const sentinelKey = pathSegments(path).find((segment) => TODO_SENTINEL_PATTERN.test(segment));
		const offending =
			sentinelKey ?? (typeof value === "string" && TODO_SENTINEL_PATTERN.test(value) ? value : null);
		if (offending === null || offending === undefined) continue;

		throw new FactoryConfigError(
			"todo-sentinel",
			`${configPath} still carries a TODO sentinel at ${path}; a human has to resolve it before a run can start.`,
			{ file: configPath, at: path, found: offending },
		);
	}
}

function requireKnownBlocks(document, configPath) {
	for (const key of Object.keys(document)) {
		if (key === "schemaVersion") continue;
		if (!Object.hasOwn(CONFIG_BLOCKS, key)) {
			throw new FactoryConfigError(
				"unknown-key",
				`${configPath} declares unknown key "${key}". The factory never ignores config it does not understand.`,
				{ file: configPath, at: key },
			);
		}
	}

	for (const [name, block] of Object.entries(CONFIG_BLOCKS)) {
		const value = document[name];
		if (value === undefined) {
			if (!block.required) continue;
			throw new FactoryConfigError(
				"missing-key",
				`${configPath} is missing the required "${name}" block; it has no default.`,
				{ file: configPath, at: name },
			);
		}

		const container = Array.isArray(value) ? "array" : typeof value === "object" && value !== null ? "object" : typeof value;
		if (container !== block.container) {
			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: "${name}" must be ${block.container === "array" ? "an array" : "an object"}, found ${container}.`,
				{ file: configPath, at: name, expected: block.container, found: container },
			);
		}
	}
}

function requireTrackerBlock(tracker, configPath) {
	requireExactKeys(tracker, TRACKER_KEYS, "tracker", configPath);

	for (const key of TRACKER_KEYS) {
		requireNonEmptyString(tracker[key], `tracker.${key}`, configPath);
	}

	if (!SUPPORTED_TRACKER_KINDS.includes(tracker.kind)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: tracker.kind must be one of ${SUPPORTED_TRACKER_KINDS.join(", ")}; found "${tracker.kind}".`,
			{ file: configPath, at: "tracker.kind", found: tracker.kind, expected: SUPPORTED_TRACKER_KINDS.join("|") },
		);
	}

	if (!REPO_SLUG_PATTERN.test(tracker.repo)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: tracker.repo must have the form "owner/repository"; found "${tracker.repo}".`,
			{ file: configPath, at: "tracker.repo", found: tracker.repo, expected: "owner/repository" },
		);
	}
}

function requireGitBlock(git, configPath) {
	requireExactKeys(git, GIT_KEYS, "git", configPath);

	for (const key of GIT_KEYS) {
		requireNonEmptyString(git[key], `git.${key}`, configPath);
	}
}

function requireExactKeys(block, allowed, blockName, configPath) {
	for (const key of Object.keys(block)) {
		if (allowed.includes(key)) continue;
		throw new FactoryConfigError(
			"unknown-key",
			`${configPath} declares unknown key "${blockName}.${key}". The factory never ignores config it does not understand.`,
			{ file: configPath, at: `${blockName}.${key}` },
		);
	}

	for (const key of allowed) {
		if (block[key] !== undefined) continue;
		throw new FactoryConfigError(
			"missing-key",
			`${configPath} is missing required key "${blockName}.${key}"; it has no default.`,
			{ file: configPath, at: `${blockName}.${key}` },
		);
	}
}

function requireNonEmptyString(value, path, configPath) {
	if (typeof value === "string" && value.trim() !== "") return;
	throw new FactoryConfigError(
		"invalid-value",
		`${configPath}: ${path} must be a non-empty string.`,
		{ file: configPath, at: path, found: value === undefined ? null : typeof value, expected: "non-empty string" },
	);
}

function requireObject(value, description, configPath, at) {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) return;
	throw new FactoryConfigError(
		"invalid-value",
		`${configPath}: ${description} must be a JSON object.`,
		{ file: configPath, at, expected: "object", found: Array.isArray(value) ? "array" : value === null ? "null" : typeof value },
	);
}

/** Every scalar in the document, paired with its `a.b[0].c` path. */
function* walkDocument(value, path = "") {
	if (Array.isArray(value)) {
		for (const [index, element] of value.entries()) {
			yield* walkDocument(element, `${path}[${index}]`);
		}
		return;
	}

	if (value !== null && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			yield* walkDocument(child, path === "" ? key : `${path}.${key}`);
		}
		return;
	}

	yield [path, value];
}

function pathSegments(path) {
	return path.split(".").map((segment) => segment.replace(/\[\d+\]$/, ""));
}
