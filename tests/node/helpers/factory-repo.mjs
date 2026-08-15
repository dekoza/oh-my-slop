import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
	checks: [
		{
			name: "unit",
			command: "uv run pytest",
			timeout: 600,
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
 * @param {import("node:test").TestContext} t owner of the temp directory's lifetime
 * @param {{ config?: object | string | null, remotes?: Record<string, string> }} [options]
 *   `config: null` writes no policy file; a string is written verbatim, so a test
 *   can hand over unparseable JSON.
 * @returns {string} the repository root
 */
export function makeRepo(
	t,
	{ config = VALID_CONFIG, remotes = { gitea: "git@gitea.example:acme/widgets.git" } } = {},
) {
	const root = mkdtempSync(join(tmpdir(), "factory-repo-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	execFileSync("git", ["init", "--quiet", root]);
	for (const [name, url] of Object.entries(remotes)) {
		execFileSync("git", ["-C", root, "remote", "add", name, url]);
	}

	if (config !== null) {
		mkdirSync(join(root, ".pi"), { recursive: true });
		const body = typeof config === "string" ? config : JSON.stringify(config, null, 2);
		writeFileSync(join(root, ".pi", "factory.json"), body, "utf8");
	}

	return root;
}
