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
