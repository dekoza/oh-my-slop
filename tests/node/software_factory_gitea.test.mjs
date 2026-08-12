import test from "node:test";
import assert from "node:assert/strict";

import { createGiteaTracker } from "../../extensions/software-factory/lib/gitea.mjs";

function result(stdout = "") {
	return { code: 0, stdout, stderr: "" };
}

function trackerWithFixtures({ issues, dependencies = {} }) {
	const calls = [];
	const exec = async (command, args) => {
		calls.push([command, args]);
		if (command === "tea" && args[0] === "issues" && args[1] === "list") {
			return result(JSON.stringify(issues));
		}
		if (command === "tea" && args[0] === "api") {
			const match = args.at(-1).match(/issues\/(\d+)\/dependencies$/);
			return result(JSON.stringify(dependencies[match[1]] ?? []));
		}
		throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
	};
	return {
		calls,
		tracker: createGiteaTracker({
			exec,
			cwd: "/repo",
			config: {
				repo: "minder/example",
				remote: "gitea",
				assignee: "minder",
			},
		}),
	};
}

test("listFrontier returns only unassigned children whose blockers are closed", async () => {
	const { tracker } = trackerWithFixtures({
		issues: [
			{ index: 14, title: "Later slice", body: "## Parent\n\n#9", assignees: [] },
			{ index: 12, title: "Claimed slice", body: "## Parent\n\n#9", assignees: [{ login: "other" }] },
			{ index: 11, title: "Wrong parent", body: "## Parent\n\n#8", assignees: [] },
			{ index: 10, title: "First slice", body: "Part of #9\n\n## What to build", assignees: [] },
		],
		dependencies: {
			10: [],
			14: [{ index: 13, state: "open" }],
		},
	});

	assert.deepEqual(await tracker.listFrontier(9), [
		{ index: 10, title: "First slice" },
	]);
});

test("listFrontier keeps dependency-free tickets in ascending creation order", async () => {
	const { tracker } = trackerWithFixtures({
		issues: [
			{ index: 22, title: "Second", body: "## Parent\n#7", assignees: [] },
			{ index: 21, title: "First", body: "## Parent\n#7", assignees: [] },
		],
	});

	assert.deepEqual(await tracker.listFrontier(7), [
		{ index: 21, title: "First" },
		{ index: 22, title: "Second" },
	]);
});

test("claim uses argument arrays and the configured assignee", async () => {
	const calls = [];
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (command, args) => {
			calls.push([command, args]);
			return result();
		},
	});

	await tracker.claim(42);

	assert.deepEqual(calls, [["tea", [
		"issues", "edit", "42", "--repo", "minder/example", "--add-assignees", "minder",
	]]]);
});
