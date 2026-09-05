import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	CLAUDE_PROJECT_TRUST,
	CLAUDE_STATE_SETTLED,
	claudeTrustDecision,
	claudeTrustKeys,
	claudeUnsettledKeys,
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

/**
 * #178: pi canonicalizes a directory — resolving symlinks — before keying its
 * trust map and before walking to the nearest ancestor entry. A writer that
 * resolved without following them put the two spellings on different keys, the
 * pre-trust silently failed to apply, and the pane met the trust dialog: the
 * exact §6.8 hang the preflight check exists to prove impossible.
 */
test("pi's trust reads back through a symlinked ancestor, because that is the key pi looks under", (t) => {
	const dir = scratch(t);
	const agentDir = join(dir, "agent");
	const real = join(dir, "real-state");
	mkdirSync(join(agentDir), { recursive: true });
	mkdirSync(join(real, "worktrees", "run-t1-a1"), { recursive: true });
	// The store reached through a symlinked ancestor — macOS's `/tmp` and `/var`
	// are exactly this, so it is the ordinary case there rather than a corner.
	symlinkSync(real, join(dir, "state"));
	const linked = join(dir, "state", "worktrees");

	pretrustPi(agentDir, [linked]);

	// Written under the canonical spelling, which is what pi will look up...
	assert.deepEqual(Object.keys(readPiTrust(agentDir)), [join(real, "worktrees")]);
	// ...and read back as trusted through **either** spelling of the path, and
	// through an attempt worktree beneath it, which is the walk pi performs.
	assert.equal(piTrustDecision(readPiTrust(agentDir), linked), true);
	assert.equal(piTrustDecision(readPiTrust(agentDir), join(real, "worktrees")), true);
	assert.equal(piTrustDecision(readPiTrust(agentDir), join(linked, "run-t1-a1")), true);
});

/**
 * #178: the writer settles four things and the `worker-trust` check read back
 * exactly one. Three interstitials were written and never proven, each as
 * capable of hanging an interactive pane as the trust dialog. The predicate is
 * derived from the constants, so a fifth settled key cannot become a fourth
 * unproven one.
 */
test("every key the pre-trust writer writes is part of the readback, derived from the constants", (t) => {
	const configDir = scratch(t);
	const project = "/state/clone.git";
	pretrustClaude(configDir, [project]);

	const settled = readClaudeConfigState(configDir);
	assert.deepEqual(claudeUnsettledKeys(settled, project), []);

	for (const key of Object.keys(CLAUDE_PROJECT_TRUST)) {
		const damaged = {
			...settled,
			projects: { ...settled.projects, [project]: { ...settled.projects[project], [key]: undefined } },
		};
		assert.deepEqual(claudeUnsettledKeys(damaged, project), [key]);
		assert.equal(claudeTrustDecision(damaged, project), false, `${key} did not read back and trust still said yes`);
	}

	for (const key of Object.keys(CLAUDE_STATE_SETTLED)) {
		const damaged = { ...settled, [key]: undefined };
		assert.deepEqual(claudeUnsettledKeys(damaged, project), [key]);
		assert.equal(claudeTrustDecision(damaged, project), false);
	}

	// A project nobody trusted names every key at once rather than the first.
	assert.deepEqual(claudeUnsettledKeys(settled, "/state/somewhere-else"), Object.keys(CLAUDE_PROJECT_TRUST));
});

test("a missing or unparsable store reads as empty rather than throwing at a caller mid-preflight", (t) => {
	const dir = scratch(t);
	mkdirSync(join(dir, "nested"));
	writeFileSync(join(dir, "nested", "trust.json"), "{ not json");

	assert.deepEqual(readPiTrust(dir), {});
	assert.deepEqual(readClaudeConfigState(dir), { projects: {} });
	assert.deepEqual(readPiTrust(join(dir, "nested")), {});
});
