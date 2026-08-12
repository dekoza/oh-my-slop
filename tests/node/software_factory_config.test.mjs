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
			assignee: "minder",
		},
		git: { ...DEFAULT_FACTORY_CONFIG.git, baseBranch: "main" },
	});
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
