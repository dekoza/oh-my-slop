import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	claudeTrustDecision,
	claudeTrustKeys,
	pretrustClaude,
	pretrustPi,
	piTrustDecision,
	readClaudeConfigState,
	readPiTrust,
	untrustedProjects,
} from "../../factory/lib/worker/trust.mjs";

/**
 * §6.8's trust half: the controller pre-trusts its own worktrees mechanically,
 * in controller-owned config scope, for both runtimes — and reads the decision
 * back through each runtime's *own* resolution rule rather than assuming the
 * write was enough.
 */

function scratch(t) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "factory-trust-")));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("pi resolves trust by nearest ancestor, so one entry covers every attempt worktree", () => {
	const map = { "/state/worktrees": true };

	assert.equal(piTrustDecision(map, "/state/worktrees/run-t1-a1"), true);
	assert.equal(piTrustDecision(map, "/state/worktrees/run-t1-a1/deep/inside"), true);
	assert.equal(piTrustDecision(map, "/state/baselines/b1"), null);
	// The nearest entry wins, not the most permissive one.
	assert.equal(piTrustDecision({ ...map, "/state/worktrees/run-t1-a1": false }, "/state/worktrees/run-t1-a1"), false);
});

test("pre-trusting pi writes the controller's own trust store and leaves the operator's alone", (t) => {
	const agentDir = scratch(t);

	pretrustPi(agentDir, ["/state/worktrees", "/state/worktrees/run-t1-a1"]);
	pretrustPi(agentDir, ["/state/worktrees/run-t1-a2"]);

	const map = readPiTrust(agentDir);
	assert.deepEqual(Object.keys(map).sort(), [
		"/state/worktrees",
		"/state/worktrees/run-t1-a1",
		"/state/worktrees/run-t1-a2",
	]);
	assert.ok(Object.values(map).every((decision) => decision === true));
	// The file pi itself would write: sorted keys, plain booleans, newline-ended.
	assert.equal(readFileSync(join(agentDir, "trust.json"), "utf8").at(-1), "\n");
});

test("a trust store the operator left a refusal in is corrected, never merged around", (t) => {
	const agentDir = scratch(t);
	writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ "/state/worktrees": false }));

	pretrustPi(agentDir, ["/state/worktrees"]);

	assert.equal(piTrustDecision(readPiTrust(agentDir), "/state/worktrees/run-t1-a1"), true);
});

test("Claude keys a worktree's project by the repository it belongs to, so both spellings are trusted", () => {
	assert.deepEqual(claudeTrustKeys({ worktreePath: "/state/worktrees/a1", gitCommonDir: "/state/clone.git" }), [
		"/state/clone.git",
		"/state/worktrees/a1",
	]);
	// A non-bare repository's common dir is `<root>/.git`, and Claude names the root.
	assert.deepEqual(claudeTrustKeys({ worktreePath: "/repo/wt", gitCommonDir: "/repo/.git" }), [
		"/repo",
		"/repo/.git",
		"/repo/wt",
	]);
});

test("pre-trusting Claude accepts the trust dialog and the onboarding that would also block a pane", (t) => {
	const configDir = scratch(t);

	pretrustClaude(configDir, ["/state/clone.git"]);
	const state = readClaudeConfigState(configDir);

	assert.equal(state.hasCompletedOnboarding, true);
	assert.equal(claudeTrustDecision(state, "/state/clone.git"), true);
	assert.equal(claudeTrustDecision(state, "/state/somewhere-else"), false);
	// The external-includes prompt is a dialog too, and it is answered up front.
	assert.equal(state.projects["/state/clone.git"].hasClaudeMdExternalIncludesApproved, true);
});

test("pre-trusting preserves whatever else the runtime already recorded for the project", (t) => {
	const configDir = scratch(t);
	writeFileSync(
		join(configDir, ".claude.json"),
		JSON.stringify({ numStartups: 3, projects: { "/state/clone.git": { lastSessionId: "abc" } } }),
	);

	pretrustClaude(configDir, ["/state/clone.git"]);
	const state = readClaudeConfigState(configDir);

	assert.equal(state.numStartups, 3);
	assert.equal(state.projects["/state/clone.git"].lastSessionId, "abc");
	assert.equal(state.projects["/state/clone.git"].hasTrustDialogAccepted, true);
});

test("a project the runtime recorded that nobody pre-trusted is named, because that pane would have hung", (t) => {
	const configDir = scratch(t);
	pretrustClaude(configDir, ["/state/clone.git"]);
	writeFileSync(
		join(configDir, ".claude.json"),
		JSON.stringify({
			...readClaudeConfigState(configDir),
			projects: {
				...readClaudeConfigState(configDir).projects,
				"/home/operator/somewhere": { hasTrustDialogAccepted: false },
			},
		}),
	);

	assert.deepEqual(untrustedProjects(readClaudeConfigState(configDir)), ["/home/operator/somewhere"]);
});

test("a missing or unparsable store reads as empty rather than throwing at a caller mid-preflight", (t) => {
	const dir = scratch(t);
	mkdirSync(join(dir, "nested"));
	writeFileSync(join(dir, "nested", "trust.json"), "{ not json");

	assert.deepEqual(readPiTrust(dir), {});
	assert.deepEqual(readClaudeConfigState(dir), { projects: {} });
	assert.deepEqual(readPiTrust(join(dir, "nested")), {});
});
