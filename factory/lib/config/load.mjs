import { readFileSync } from "node:fs";

import { remoteUrlToRepoSlug, resolveRemoteUrl } from "../git/repo.mjs";
import { FACTORY_LABELS } from "../tracker/labels.mjs";
import { validateChecks } from "./checks.mjs";
import { validateConcurrency } from "./concurrency.mjs";
import { validateBudgets, validateRetention } from "./defaults.mjs";
import { discoverConfigPath } from "./discover.mjs";
import { FactoryConfigError } from "./errors.mjs";
import { validateProfiles } from "./profiles.mjs";
import { validateRouting } from "./routing.mjs";
import { requireExactKeys, requireNoUnknownKeys, requireNonEmptyString, requireObject } from "./shape.mjs";

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
 * This table answers presence and container shape only. Every block's interior is
 * validated too — profile shapes, routing overlap, the five check fields, budget
 * ceilings, concurrency sizes, retention floors — by the sibling module named
 * after it, so no surviving key becomes an inferred runtime policy at execution
 * time.
 */
export const CONFIG_BLOCKS = Object.freeze({
	tracker: { required: true, container: "object" },
	git: { required: true, container: "object" },
	profiles: { required: true, container: "object" },
	routing: { required: true, container: "object" },
	checks: { required: true, container: "array" },
	budgets: { required: false, container: "object" },
	concurrency: { required: true, container: "object" },
	retention: { required: false, container: "object" },
	package: { required: false, container: "object" },
});

const TRACKER_KEYS = Object.freeze(["kind", "repo", "remote", "login", "assignee"]);
const GIT_KEYS = Object.freeze(["baseBranch", "remote"]);
const SUPPORTED_TRACKER_KINDS = Object.freeze(["gitea"]);
const REPO_SLUG_PATTERN = /^[^/\s]+\/[^/\s]+$/;
const TODO_SENTINEL_PATTERN = /^TODO\b/;
const PACKAGE_EXPECT_KEYS = Object.freeze(["name", "version"]);

/**
 * @param {{ cwd: string, routingSet?: string | null }} invocation `routingSet` is
 *   the run's §11.5 selection: a name from `routing.sets`, or null for the
 *   declared default. It is a per-run input rather than config, so an unknown
 *   name refuses instead of quietly leaving the default active.
 * @returns {{ repoRoot: string, configPath: string, config: object, activeRouting: { set: string | null, roles: object, rules: ReadonlyArray<object> }, remote: { name: string, url: string, slug: string } }}
 *   `config.routing` is what the file declares, sets and all; `activeRouting` is
 *   the one this run routes by.
 * @throws {FactoryConfigError}
 */
export function loadFactoryConfig({ cwd, routingSet = null }) {
	const { repoRoot, configPath } = discoverConfigPath(cwd);
	const source = readConfigFile(configPath);
	const document = parseConfigFile(source, configPath);

	const { config, activeRouting } = validateConfig(document, configPath, routingSet);
	const remote = crossCheckRemote(config, repoRoot, configPath);

	return { repoRoot, configPath, config, activeRouting, remote };
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
function validateConfig(document, configPath, routingSet) {
	requireObject(document, "the configuration", configPath, "");
	requireSchemaVersion(document, configPath);
	requireNoTodoSentinel(document, configPath);
	requireKnownBlocks(document, configPath);
	requireTrackerBlock(document.tracker, configPath);
	requireGitBlock(document.git, configPath);

	const profiles = validateProfiles(document.profiles, configPath);
	const routings = validateRouting(document.routing, profiles, routingSet, configPath);

	const config = Object.freeze({
		...document,
		profiles,
		routing: routings.block,
		checks: validateChecks(document.checks, configPath),
		budgets: validateBudgets(document.budgets, configPath),
		concurrency: validateConcurrency(document.concurrency, profiles, routings, configPath),
		retention: validateRetention(document.retention, configPath),
		...(document.package === undefined ? {} : { package: validatePackage(document.package, configPath) }),
	});

	return {
		config,
		activeRouting: Object.freeze({
			set: routings.active.name,
			roles: routings.active.roles,
			rules: routings.active.rules,
		}),
	};
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
	refuseConfiguredLabels(tracker, configPath);
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

/**
 * §3.2's vocabulary lives in `lib/tracker/labels.mjs`. A config still carrying
 * `tracker.labels` is answered by name, because the author is renaming an
 * eligibility predicate and needs to be told the names are no longer theirs.
 */
function refuseConfiguredLabels(tracker, configPath) {
	if (tracker.labels === undefined) return;
	throw new FactoryConfigError(
		"unknown-key",
		`${configPath} declares "tracker.labels". The factory's label vocabulary is fixed constants in code (§3.2): ${Object.values(FACTORY_LABELS).join(", ")}. Per-install names make the tracker graph un-auditable across repos.`,
		{ file: configPath, at: "tracker.labels" },
	);
}

/**
 * §11.7's declared half. `expect` is the operator's expectation of the package
 * they installed; the tree digest stays purely observational — recorded per run
 * and compared across attempts, never hand-declared, because a digest in config
 * would be unmaintainable in development.
 */
function validatePackage(block, configPath) {
	requireExactKeys(block, ["expect"], "package", configPath);
	requireObject(block.expect, "package.expect", configPath, "package.expect");

	if (block.expect.digest !== undefined) {
		throw new FactoryConfigError(
			"unknown-key",
			`${configPath} declares "package.expect.digest". The tree digest is observational: the run records it and compares it across attempts, and a hand-declared one would be unmaintainable in development (§11.7).`,
			{ file: configPath, at: "package.expect.digest" },
		);
	}
	requireNoUnknownKeys(block.expect, PACKAGE_EXPECT_KEYS, "package.expect", configPath);

	return Object.freeze({
		expect: Object.freeze(
			Object.fromEntries(
				PACKAGE_EXPECT_KEYS.map((key) => [
					key,
					requireNonEmptyString(block.expect[key], `package.expect.${key}`, configPath),
				]),
			),
		),
	});
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
