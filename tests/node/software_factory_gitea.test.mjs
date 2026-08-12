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
		if (command === "tea" && args[0] === "api") {
			const endpoint = args.at(-1);
			if (endpoint.includes("?state=open")) {
				return result(JSON.stringify(issues.map((issue) => ({
					...issue,
					number: issue.index,
					labels: ["workflow:implement", "ready-for-agent"].map((name) => ({ name })),
				}))));
			}
			const match = endpoint.match(/issues\/(\d+)\/dependencies$/);
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
			{ index: 12, title: "Claimed slice", body: "## Parent\n\n#9", assignees: "other" },
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

test("listFrontier rejects Gitea API error envelopes even when tea exits zero", async () => {
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (_command, args) => {
			if (args.at(-1).includes("?state=open")) {
				return result(JSON.stringify([{
					number: 10,
					title: "Slice",
					body: "Part of #9",
					assignees: [],
					labels: [{ name: "workflow:implement" }, { name: "ready-for-agent" }],
				}]));
			}
			return result('{"message":"permission denied"}');
		},
	});

	await assert.rejects(
		tracker.listFrontier(9),
		(error) => error.name === "GiteaTrackerError" && error.message.includes("permission denied"),
	);
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

test("complete records idempotent evidence before closing the ticket", async () => {
	const calls = [];
	const exec = async (command, args) => {
		calls.push([command, args]);
		if (args[0] === "comments" && args[1] === "list") {
			return result(JSON.stringify([{ id: 700, body: "🤖 `software-factory` — ticket integration\nold" }]));
		}
		return result();
	};
	const tracker = createGiteaTracker({
		exec,
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
	});

	await tracker.complete(
		42,
		{ summary: "Checkout works", tests: ["uv run pytest: passed"], review: "passed" },
		{ integrationBranch: "factory/run/integration" },
	);

	assert.equal(calls[1][1][0], "comments");
	assert.equal(calls[1][1][1], "edit");
	assert.equal(calls[1][1][2], "700");
	assert.match(calls[1][1][3], /Checkout works/);
	assert.match(calls[1][1][3], /uv run pytest: passed/);
	assert.deepEqual(calls.at(-1), ["tea", ["issues", "close", "42", "--repo", "minder/example"]]);
});

test("block moves a ticket to ready-for-human with the reason", async () => {
	const calls = [];
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (command, args) => {
			calls.push([command, args]);
			if (args[0] === "comments" && args[1] === "list") return result("[]");
			return result();
		},
	});

	await tracker.block(42, "Production credentials are required.");

	assert.ok(calls.some(([, args]) => args[0] === "comments" && args[1] === "add" && args[3].includes("Production credentials")));
	assert.ok(calls.some(([, args]) => args.includes("--remove-labels") && args.includes("ready-for-agent") && args.includes("ready-for-human")));
});
