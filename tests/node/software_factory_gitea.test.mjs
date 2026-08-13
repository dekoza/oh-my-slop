import test from "node:test";
import assert from "node:assert/strict";

import { createGiteaTracker } from "../../extensions/software-factory/lib/gitea.mjs";

function result(stdout = "") {
	return { code: 0, stdout, stderr: "" };
}

function trackerWithFixtures({ issues, dependencies = {}, extraLabels = [], targetIssue }) {
	const calls = [];
	const exec = async (command, args) => {
		calls.push([command, args]);
		if (command === "tea" && args[0] === "api") {
			const endpoint = args.at(-1);
			if (/\/issues\/\d+$/.test(endpoint)) {
				return result(JSON.stringify(targetIssue ?? {
					number: 9,
					title: "Parent",
					body: "",
					state: "open",
					assignees: [],
					labels: [],
				}));
			}
			if (endpoint.includes("?state=open")) {
				return result(JSON.stringify(issues.map((issue) => ({
					...issue,
					number: issue.index,
					labels: ["workflow:implement", "ready-for-agent", ...extraLabels].map((name) => ({ name })),
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

test("listFrontier runs an eligible implementation ticket passed directly to the factory", async () => {
	const { calls, tracker } = trackerWithFixtures({
		issues: [],
		targetIssue: {
			number: 64,
			title: "Shareable HTML demo",
			body: "Part of #46",
			state: "open",
			assignees: [],
			labels: [{ name: "workflow:implement" }, { name: "ready-for-agent" }],
		},
	});

	assert.deepEqual(await tracker.listFrontier(64), [{
		index: 64,
		title: "Shareable HTML demo",
		labels: ["workflow:implement", "ready-for-agent"],
	}]);
	assert.equal(await tracker.countOpenTargets(64), 1);
	assert.equal(calls.some(([, args]) => args.at(-1).includes("?state=open")), false);
});

test("listFrontier returns routing labels for unassigned children whose blockers are closed", async () => {
	const { tracker } = trackerWithFixtures({
		extraLabels: ["risk:high"],
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
		{
			index: 10,
			title: "First slice",
			labels: ["workflow:implement", "ready-for-agent", "risk:high"],
		},
	]);
});

test("listFrontier rejects Gitea API error envelopes even when tea exits zero", async () => {
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (_command, args) => {
			if (/\/issues\/\d+$/.test(args.at(-1))) {
				return result(JSON.stringify({
					number: 9,
					title: "Parent",
					body: "",
					state: "open",
					assignees: [],
					labels: [],
				}));
			}
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
		{ index: 21, title: "First", labels: ["workflow:implement", "ready-for-agent"] },
		{ index: 22, title: "Second", labels: ["workflow:implement", "ready-for-agent"] },
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
		"--login", "gitea",
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
		{
			summary: "Checkout works",
			tests: ["uv run pytest: passed"],
			workerProfile: "gpt",
			review: { status: "passed", summary: "No actionable findings", findings: [], profile: "claude-review" },
		},
		{ integrationBranch: "factory/run/integration" },
	);

	assert.equal(calls[1][1][0], "comments");
	assert.equal(calls[1][1][1], "edit");
	assert.equal(calls[1][1][2], "700");
	assert.match(calls[1][1][3], /Checkout works/);
	assert.match(calls[1][1][3], /uv run pytest: passed/);
	assert.match(calls[1][1][3], /Implementation profile: `gpt`/);
	assert.match(calls[1][1][3], /Independent review \(`claude-review`\): No actionable findings/);
	assert.deepEqual(calls.at(-1), ["tea", [
		"issues", "close", "42", "--repo", "minder/example", "--login", "gitea",
	]]);
});

test("reportRun preserves final-review findings and blocker reasons", async () => {
	const calls = [];
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (command, args) => {
			calls.push([command, args]);
			if (args[0] === "comments" && args[1] === "list") return result("No comments found\n");
			return result();
		},
	});

	await tracker.reportRun(9, {
		id: "factory-a1",
		status: "waiting-for-human",
		completed: [42],
		blocked: [],
		finalReview: {
			status: "failed",
			profile: "claude-review",
			summary: "Integration needs repair",
			findings: ["Cross-ticket invariant is untested"],
			reason: "Reviewer needs architecture input",
		},
	});

	const comment = calls.find(([, args]) => args[0] === "comments" && args[1] === "add")[1][3];
	assert.match(comment, /Cross-ticket invariant is untested/);
	assert.match(comment, /Reviewer needs architecture input/);
});

test("failAutomation releases a ticket back to ready-for-agent with infrastructure evidence", async () => {
	const calls = [];
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (command, args) => {
			calls.push([command, args]);
			if (args[0] === "comments" && args[1] === "list") return result("No comments found\n");
			return result();
		},
	});

	await tracker.failAutomation(42, "Herdr returned malformed output.");

	assert.ok(calls.some(([, args]) =>
		args[0] === "comments"
		&& args[1] === "add"
		&& args[3].startsWith("🤖 `software-factory` — automation failure")
		&& args[3].includes("Herdr returned malformed output"),
	));
	assert.ok(calls.some(([, args]) =>
		args.includes("--add-labels")
		&& args.includes("ready-for-agent")
		&& args.includes("--remove-labels")
		&& args.includes("ready-for-human")
		&& args.includes("--remove-assignees")
		&& args.includes("minder"),
	));
});

test("block moves a ticket to ready-for-human with the reason", async () => {
	const calls = [];
	const tracker = createGiteaTracker({
		cwd: "/repo",
		config: { repo: "minder/example", remote: "gitea", assignee: "minder" },
		exec: async (command, args) => {
			calls.push([command, args]);
			if (args[0] === "comments" && args[1] === "list") return result("No comments found\n");
			return result();
		},
	});

	await tracker.block(42, "Production credentials are required.");

	assert.ok(calls.some(([, args]) => args[0] === "comments" && args[1] === "add" && args[3].includes("Production credentials")));
	assert.ok(calls.some(([, args]) => args.includes("--remove-labels") && args.includes("ready-for-agent") && args.includes("ready-for-human")));
});
