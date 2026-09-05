import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fixtures shared by the factory's node tests. They build a real git repository
 * rather than a mock, because discovery and the remote cross-check are both
 * statements about git.
 *
 * This file lives one level down so `node --test tests/node/*.mjs` does not pick
 * it up as a test file of its own.
 */

/** A config that loads: every required §11.3 block, and a remote that matches. */
export const VALID_CONFIG = Object.freeze({
	schemaVersion: 2,
	tracker: {
		kind: "gitea",
		repo: "acme/widgets",
		remote: "gitea",
		login: "gitea",
		assignee: "factory-bot",
	},
	git: { baseBranch: "main", remote: "gitea" },
	profiles: { builder: { kind: "pi", model: "local/qwen3" } },
	routing: {
		roles: { implement: "builder", freshRetry: "builder", review: ["builder", "builder"] },
		rules: [],
	},
	// A **real** command: #104's runner executes the declared checks for real, in
	// a throwaway worktree at the pinned base, so a fixture check has to be cheap,
	// deterministic, and green against `makeRemote`'s seed commit. It prints the
	// commit it ran at, which is what makes "the baseline ran at the pinned base"
	// observable from a suite rather than asserted.
	checks: [
		{
			name: "unit",
			command: "git rev-parse HEAD",
			timeout: 60,
			severity: "required",
			expectedFailureExitCodes: [1],
		},
	],
	budgets: { repair: 1, freshRetry: 1, automation: 1 },
	concurrency: { maxTicketExecutions: 1, resources: { local: 1 } },
	retention: { fullDetailRuns: 20, fullDetailDays: 30 },
});

export function cloneValidConfig() {
	return structuredClone(VALID_CONFIG);
}

/**
 * `VALID_CONFIG` plus one alternative §11.5 routing set, and a profile only that
 * set reaches — so a selection is visible in the capacity plan as a different
 * resource class rather than only as a different profile name.
 *
 * One fixture rather than one per suite: the loader's semantics, the CLI's flag,
 * and the detached launcher's argv all need a config with a set to select, and
 * three copies of it are three things to keep in step.
 *
 * @param {{ activeSet?: string }} [options] `activeSet` declares the set as the
 *   file's own default; omitted, the file-level routing stays the default
 */
export function cloneConfigWithRoutingSet({ activeSet } = {}) {
	const config = cloneValidConfig();
	config.profiles.remote = { kind: "pi", model: "openrouter/glm-5.2" };
	config.routing.sets = {
		"post-subscription": {
			roles: { implement: "remote", freshRetry: "remote", review: ["remote", "remote"] },
			rules: [],
		},
	};
	config.concurrency.resources.openrouter = 2;
	if (activeSet !== undefined) config.routing.activeSet = activeSet;

	return config;
}

/**
 * A legacy `version: 1` file, modelled on the one this repository shipped: every
 * key §11.8 tabulates is present exactly once, so a migration test can assert
 * the whole disposition list rather than the rows a fixture happened to carry.
 */
export const LEGACY_CONFIG = Object.freeze({
	version: 1,
	tracker: {
		kind: "gitea",
		repo: "acme/widgets",
		remote: "gitea",
		login: "gitea",
		assignee: "factory-bot",
		labels: { implementation: "workflow:implement", readyForAgent: "ready-for-agent" },
	},
	git: { baseBranch: "main", remote: "gitea" },
	herdr: { maxWorkers: 1 },
	workers: {
		profiles: {
			builder: { kind: "pi", model: "local/qwen3", thinking: "high", permissionMode: "auto" },
			reviewer: { kind: "claude", model: "opus", effort: "high", permissionMode: "dontAsk" },
		},
		routing: {
			defaults: { implement: "builder", freshRetry: "builder", review: "reviewer", finalReview: "reviewer" },
			rules: [{ labelsAny: ["factory:claude"], phases: ["implement", "freshRetry"], profile: "reviewer" }],
		},
	},
	_postSubscription: {
		comment: "Migration metadata only; the factory loader ignores this top-level key.",
		workers: {
			routing: {
				defaults: { implement: "builder", freshRetry: "builder", review: "builder", finalReview: "builder" },
				rules: [],
			},
		},
	},
	retry: { repairAttempts: 2, freshAgentRetries: 1 },
	completion: { closeAfterIntegration: true, finalMerge: "manual", createPullRequest: true, deploy: false },
});

export function cloneLegacyConfig() {
	return structuredClone(LEGACY_CONFIG);
}

/**
 * A real bare repository standing in for the Gitea remote, reachable as a local
 * path. The path ends in `acme/widgets.git` so `VALID_CONFIG`'s remote
 * cross-check still holds, and the seed commit is what §7.2's fetch pins.
 *
 * @param {import("node:test").TestContext} t owner of the temp directory's lifetime
 * @param {{ files?: Record<string, string>, branch?: string }} [options] tree of the
 *   seed commit — a test hands over `.gitmodules` or LFS attributes to make the
 *   remote §7.8-refusable
 * @returns {string} the bare repository's path
 */
export function makeRemote(t, { files = { "README.md": "seed\n" }, branch = "main" } = {}) {
	const root = mkdtempSync(join(tmpdir(), "factory-remote-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const seed = join(root, "seed");
	execFileSync("git", ["init", "--quiet", "-b", branch, seed]);
	for (const [path, body] of Object.entries(files)) {
		mkdirSync(dirname(join(seed, path)), { recursive: true });
		writeFileSync(join(seed, path), body, "utf8");
	}
	execFileSync("git", ["-C", seed, "add", "--all"]);
	execFileSync(
		"git",
		["-C", seed, "-c", "user.name=Seed", "-c", "user.email=seed@example.invalid", "commit", "--quiet", "-m", "seed"],
	);

	const bare = join(root, "acme", "widgets.git");
	mkdirSync(dirname(bare), { recursive: true });
	execFileSync("git", ["clone", "--bare", "--quiet", seed, bare]);
	return bare;
}

/**
 * @param {import("node:test").TestContext} t owner of the temp directory's lifetime
 * @param {{ config?: object | string | null, remotes?: Record<string, string> }} [options]
 *   `config: null` writes no policy file; a string is written verbatim, so a test
 *   can hand over unparseable JSON. The default remote is a **real** local bare
 *   repository (`makeRemote`), so a fixture that reaches §7.2's fetch fetches.
 * @returns {string} the repository root
 */
export function makeRepo(t, { config = VALID_CONFIG, remotes } = {}) {
	const root = mkdtempSync(join(tmpdir(), "factory-repo-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	execFileSync("git", ["init", "--quiet", root]);
	for (const [name, url] of Object.entries(remotes ?? { gitea: makeRemote(t) })) {
		execFileSync("git", ["-C", root, "remote", "add", name, url]);
	}

	if (config !== null) {
		mkdirSync(join(root, ".pi"), { recursive: true });
		const body = typeof config === "string" ? config : JSON.stringify(config, null, 2);
		writeFileSync(join(root, ".pi", "factory.json"), body, "utf8");
	}

	return root;
}

/**
 * Every `.mjs` the binary ships, as `[path relative to factory/, source]`.
 *
 * Several invariants are statements about the code rather than about one call —
 * "`node:sqlite` is imported once", "`PI_AGENT_DIR` is never read", "nothing
 * reaches for the extension loader's fallback" — and each test that checks one
 * was growing its own copy of this walk.
 */
export function factorySources() {
	const factoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "factory");

	return readdirSync(factoryRoot, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
		.map((entry) => {
			const path = join(entry.parentPath, entry.name);
			return [relative(factoryRoot, path), readFileSync(path, "utf8")];
		});
}
