import test from "node:test";
import assert from "node:assert/strict";

import { runFactory } from "../../extensions/software-factory/lib/factory.mjs";

function testConfig() {
	return {
		tracker: { repo: "minder/example" },
		git: { baseBranch: "main" },
		retry: { repairAttempts: 1, freshAgentRetries: 1 },
		completion: { createPullRequest: true },
	};
}

test("runFactory claims, implements, verifies, and integrates one frontier ticket before creating a PR", async () => {
	const events = [];
	let frontierCalls = 0;
	const tracker = {
		async listFrontier() {
			events.push("frontier");
			return frontierCalls++ === 0 ? [{ index: 42, title: "Deliver checkout" }] : [];
		},
		async countOpenChildren() { events.push("count-open"); return 0; },
		async claim(index) { events.push(`claim:${index}`); },
		async complete(index, result) { events.push(`complete:${index}:${result.summary}`); },
		async block(index) { events.push(`block:${index}`); },
		async createPullRequest(run) { events.push(`pr:${run.integrationBranch}`); return "https://gitea/pr/7"; },
		async reportRun(_parent, state) { events.push(`report:${state.status}`); },
	};
	const git = {
		async preflight() { events.push("preflight"); },
		async createRun(id) {
			events.push(`create-run:${id}`);
			return { id, integrationBranch: `factory/${id}/integration`, integrationPath: `/repo/.worktrees/${id}-integration` };
		},
		async createTicket(_run, index) { events.push(`create-ticket:${index}`); return { branch: `ticket-${index}`, path: `/worktree/${index}` }; },
		async verifyTicket() { events.push("verify"); },
		async integrate(_run, _ticket, index) { events.push(`integrate:${index}`); },
		async publish() { events.push("publish"); },
	};
	const herdr = {
		async createWorkspace() { events.push("workspace"); return "w4"; },
		async createWorker({ name }) { events.push(`worker:${name}`); return { name, tabId: "w4:t2", paneId: "w4:p2" }; },
		async promptWorker() {
			events.push("prompt");
			return { status: "success", summary: "checkout works", tests: ["test: pass"], review: "passed" };
		},
	};
	const snapshots = [];

	const result = await runFactory({
		cwd: "/repo",
		parentIndex: 9,
		runId: "factory-a1",
		config: testConfig(),
		tracker,
		git,
		herdr,
		store: { async save(state) { snapshots.push(structuredClone(state)); } },
	});

	assert.equal(result.status, "awaiting-merge");
	assert.equal(result.pullRequest, "https://gitea/pr/7");
	assert.deepEqual(result.completed, [42]);
	assert.ok(events.indexOf("claim:42") < events.indexOf("create-ticket:42"));
	assert.ok(events.indexOf("verify") < events.indexOf("integrate:42"));
	assert.ok(events.indexOf("integrate:42") < events.indexOf("complete:42:checkout works"));
	assert.deepEqual(events.slice(-3), ["publish", "pr:factory/factory-a1/integration", "report:awaiting-merge"]);
	assert.equal(snapshots.at(-1).status, "awaiting-merge");
});

test("runFactory gives the same worker one repair attempt before integration", async () => {
	let frontierCalls = 0;
	let promptCalls = 0;
	let completed = false;
	const tracker = {
		async listFrontier() { return frontierCalls++ === 0 ? [{ index: 5, title: "Repairable" }] : []; },
		async countOpenChildren() { return 0; },
		async claim() {},
		async complete() { completed = true; },
		async block() {},
		async createPullRequest() { return "pr"; },
		async reportRun() {},
	};
	const git = {
		async preflight() {},
		async createRun(id) { return { id, integrationBranch: "integration", integrationPath: "/integration" }; },
		async createTicket() { return { branch: "ticket", path: "/ticket" }; },
		async verifyTicket() {},
		async integrate() {},
		async publish() {},
	};
	const herdr = {
		async createWorkspace() { return "w1"; },
		async createWorker({ name }) { return { name, tabId: "w1:t2", paneId: "w1:p2" }; },
		async promptWorker() {
			promptCalls++;
			if (promptCalls === 1) throw new Error("missing result protocol");
			return { status: "success", summary: "repaired", tests: ["test: pass"], review: "passed" };
		},
	};

	await runFactory({
		cwd: "/repo", parentIndex: 9, runId: "factory-repair", config: testConfig(),
		tracker, git, herdr, store: { async save() {} },
	});

	assert.equal(promptCalls, 2);
	assert.equal(completed, true);
});

test("runFactory uses one fresh pi worker after the repair attempt fails", async () => {
	let frontierCalls = 0;
	let promptCalls = 0;
	let workerCalls = 0;
	const retired = [];
	const blocked = [];
	let completed = false;
	const tracker = {
		async listFrontier() { return frontierCalls++ === 0 ? [{ index: 6, title: "Fresh retry" }] : []; },
		async countOpenChildren() { return 0; },
		async claim() {},
		async complete() { completed = true; },
		async block(index, reason) { blocked.push([index, reason]); },
		async createPullRequest() { return "pr"; },
		async reportRun() {},
	};
	const git = {
		async preflight() {},
		async createRun(id) { return { id, integrationBranch: "integration", integrationPath: "/integration" }; },
		async createTicket() { return { branch: "ticket", path: "/ticket" }; },
		async verifyTicket() {},
		async integrate() {},
		async publish() {},
	};
	const herdr = {
		async createWorkspace() { return "w1"; },
		async createWorker({ name }) {
			workerCalls++;
			return { name, tabId: `w1:t${workerCalls + 1}`, paneId: `w1:p${workerCalls + 1}` };
		},
		async retireWorker(tabId) { retired.push(tabId); },
		async promptWorker() {
			promptCalls++;
			if (promptCalls < 3) throw new Error(`attempt ${promptCalls} failed`);
			return { status: "success", summary: "fresh worker recovered", tests: ["test: pass"], review: "passed" };
		},
	};

	await runFactory({
		cwd: "/repo", parentIndex: 9, runId: "factory-fresh", config: testConfig(),
		tracker, git, herdr, store: { async save() {} },
	});

	assert.equal(workerCalls, 2);
	assert.equal(promptCalls, 3);
	assert.deepEqual(retired, ["w1:t2"]);
	assert.deepEqual(blocked, []);
	assert.equal(completed, true);
});

test("runFactory routes a human blocker and continues unrelated frontier work", async () => {
	const blocked = [];
	let call = 0;
	const tracker = {
		async listFrontier() {
			call++;
			if (call === 1) return [{ index: 10, title: "Needs credentials" }];
			return [];
		},
		async countOpenChildren() { return 1; },
		async claim() {},
		async block(index, reason) { blocked.push([index, reason]); },
		async complete() { throw new Error("must not complete"); },
		async reportRun() {},
	};
	const git = {
		async preflight() {},
		async createRun(id) { return { id, integrationBranch: "integration", integrationPath: "/integration" }; },
		async createTicket() { return { branch: "ticket", path: "/ticket" }; },
	};
	const herdr = {
		async createWorkspace() { return "w1"; },
		async createWorker({ name }) { return { name, tabId: "w1:t2", paneId: "w1:p2" }; },
		async promptWorker() { return { status: "blocked", reason: "A production API credential is required." }; },
	};

	const result = await runFactory({
		cwd: "/repo",
		parentIndex: 9,
		runId: "factory-a2",
		config: testConfig(),
		tracker,
		git,
		herdr,
		store: { async save() {} },
	});

	assert.equal(result.status, "waiting-for-human");
	assert.deepEqual(result.blocked, [10]);
	assert.deepEqual(blocked, [[10, "A production API credential is required."]]);
});
