import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_FACTORY_CONFIG,
	FactoryConfigError,
	loadFactoryConfig,
} from "../../extensions/software-factory/lib/config.mjs";

async function projectWithConfig(config) {
	const cwd = await mkdtemp(join(tmpdir(), "software-factory-config-"));
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(join(cwd, ".pi", "factory.json"), JSON.stringify(config));
	return cwd;
}

test("loadFactoryConfig returns a validated Gitea factory configuration", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: {
			kind: "gitea",
			repo: "minder/example",
			remote: "gitea",
			assignee: "minder",
		},
		git: { baseBranch: "main" },
	});

	assert.deepEqual(await loadFactoryConfig(cwd), {
		...DEFAULT_FACTORY_CONFIG,
		tracker: {
			kind: "gitea",
			repo: "minder/example",
			remote: "gitea",
			login: "gitea",
			assignee: "minder",
		},
		git: { ...DEFAULT_FACTORY_CONFIG.git, baseBranch: "main" },
	});
});

test("loadFactoryConfig validates pi and Claude worker profiles with deterministic routing", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		workers: {
			profiles: {
				local: {
					kind: "pi",
					model: "local/thinkingcap-qwen3.6-27b",
					thinking: "high",
					startupTimeoutMs: 180000,
				},
				claude: {
					kind: "claude",
					model: "sonnet",
					effort: "high",
					permissionMode: "dontAsk",
				},
			},
			routing: {
				defaults: {
					implement: "local",
					freshRetry: "claude",
					review: "local",
					finalReview: "claude",
				},
				rules: [{ labelsAny: ["factory:claude"], phases: ["implement", "review"], profile: "claude" }],
			},
		},
	});

	const config = await loadFactoryConfig(cwd);
	assert.equal(config.workers.profiles.local.model, "local/thinkingcap-qwen3.6-27b");
	assert.equal(config.workers.profiles.claude.permissionMode, "dontAsk");
	assert.equal(config.workers.routing.defaults.finalReview, "claude");
	assert.deepEqual(config.workers.routing.rules[0].phases, ["implement", "review"]);
});

test("loadFactoryConfig requires exact provider/model selectors for pi profiles", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		workers: {
			profiles: { ambiguous: { kind: "pi", model: "thinkingcap-qwen3.6-27b", thinking: "high" } },
			routing: {
				defaults: { implement: "ambiguous", freshRetry: "ambiguous", review: "ambiguous", finalReview: "ambiguous" },
			},
		},
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError && error.message.includes("exact provider/model selector"),
	);
});

test("loadFactoryConfig rejects unknown profile fields instead of inheriting defaults", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		workers: {
			profiles: { typo: { kind: "pi", modle: "local/thinkingcap-qwen3.6-27b" } },
			routing: {
				defaults: { implement: "typo", freshRetry: "typo", review: "typo", finalReview: "typo" },
			},
		},
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError && error.message.includes('unknown field "modle"'),
	);
});

test("loadFactoryConfig rejects Claude permission bypass profiles", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		workers: {
			profiles: { unsafe: { kind: "claude", model: "sonnet", permissionMode: "bypassPermissions" } },
			routing: {
				defaults: { implement: "unsafe", freshRetry: "unsafe", review: "unsafe", finalReview: "unsafe" },
			},
		},
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError
			&& error.message.includes("permissionMode is not an allowed Claude permission mode"),
	);
});

test("loadFactoryConfig rejects label rules for run-level final review", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		workers: {
			profiles: { reviewer: { kind: "claude", model: "sonnet", permissionMode: "dontAsk" } },
			routing: {
				defaults: { implement: "reviewer", freshRetry: "reviewer", review: "reviewer", finalReview: "reviewer" },
				rules: [{ labelsAny: ["risk:high"], phases: ["finalReview"], profile: "reviewer" }],
			},
		},
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError
			&& error.message.includes("finalReview is run-level and cannot use ticket-label rules"),
	);
});

test("loadFactoryConfig preserves setup-project-skills label overrides", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: {
			kind: "gitea",
			repo: "minder/example",
			assignee: "minder",
			labels: {
				implementation: "agent-build",
				readyForAgent: "bot-ready",
				readyForHuman: "human-needed",
			},
		},
	});

	const config = await loadFactoryConfig(cwd);
	assert.deepEqual(config.tracker.labels, {
		implementation: "agent-build",
		readyForAgent: "bot-ready",
		readyForHuman: "human-needed",
	});
});

test("loadFactoryConfig rejects attempts to loosen fixed MVP gates", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		retry: { repairAttempts: 0, freshAgentRetries: 1 },
		completion: { createPullRequest: false },
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError
			&& error.message.includes("retry.repairAttempts must be 1"),
	);
});

test("loadFactoryConfig keeps pull request creation and integration closure mandatory", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "gitea", repo: "minder/example", assignee: "minder" },
		completion: { closeAfterIntegration: false, createPullRequest: false },
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError
			&& error.message.includes("completion.closeAfterIntegration must be true"),
	);
});

test("loadFactoryConfig rejects unsupported trackers explicitly", async () => {
	const cwd = await projectWithConfig({
		version: 1,
		tracker: { kind: "github", repo: "owner/repo", assignee: "octocat" },
	});

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError
			&& error.message.includes("tracker.kind must be \"gitea\""),
	);
});

test("loadFactoryConfig explains how to create missing project configuration", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "software-factory-config-missing-"));

	await assert.rejects(
		loadFactoryConfig(cwd),
		(error) => error instanceof FactoryConfigError
			&& error.message.includes("Run setup-project-skills"),
	);
});
