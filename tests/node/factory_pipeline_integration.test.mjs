import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { evidenceRef, integrationWorktreePath } from "../../factory/lib/git/isolation.mjs";
import { integratePublish, integrationVerify } from "../../factory/lib/pipeline/integration.mjs";
import { parsePullBody } from "../../factory/lib/tracker/pulls.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { LEASE_NAMES, openLeases } from "../../factory/lib/state/leases.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { commitInto, moveRemoteBase, workedAttempt } from "./helpers/factory-git.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";
import { FIXED_NOW, manualTimers } from "./helpers/factory-store.mjs";

/**
 * §9.5's twice-acquired integration lease, composed over §7.5's steps: the
 * rebase and the required set under the first, the base-commit precondition and
 * the publication under the second, and the loop between them that costs no
 * budget.
 */

const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

/** A check that is green in any worktree, and one that is red in any worktree. */
const GREEN = [{ name: "unit", command: "git rev-parse HEAD", timeout: 60, severity: "required", expectedFailureExitCodes: [1] }];
const RED = [{ name: "unit", command: "exit 1", timeout: 60, severity: "required", expectedFailureExitCodes: [1] }];

async function integrating(t, options = {}) {
	const fixture = await workedAttempt(t, options);
	const { store } = fixture;
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: manualTimers().api });
	hold.recordStartupReconcile();
	hold.adopt(fixture.run);

	const gitea = fakeGitea({ issues: [giteaIssue({ number: fixture.ticket, title: "feat: the work" })], pulls: [] });

	const context = {
		hold,
		leases,
		run: fixture.run,
		ticket: fixture.ticket,
		attempt: fixture.attempt,
		branch: fixture.branch,
		baseCommit: fixture.base.commit,
		baseBranch: "main",
		checks: GREEN,
		reader: createGiteaReader({ repo: "acme/widgets", login: "gitea", request: gitea.request }),
		writer: createGiteaWriter({ repo: "acme/widgets", login: "gitea", request: gitea.write }),
		ticketTitle: "feat: the work",
		packageRevision: "d".repeat(64),
		actor: "controller",
		now: () => FIXED_NOW,
	};

	return { ...fixture, hold, leases, gitea, context };
}

/** Record a verify result the way `walkStages` would, so integrate can read it. */
function recordVerify(context, verified) {
	resolveStage(context.store, {
		hold: context.hold,
		run: context.run,
		ticket: context.ticket,
		phase: "verify",
		attempt: context.attempt,
		outcome: verified.outcome,
		detail: verified.detail,
		actor: "controller",
		at: FIXED_NOW,
	});
}

/** Both reviews approved, so §8.7 has verdicts to attest (§14.15). */
function recordReview(context) {
	for (const [ordinal, axis] of [
		[2, "review-standards"],
		[3, "review-spec"],
	]) {
		context.store.append({
			kind: "attempt.launched",
			source: "controller",
			run: context.run,
			ticket: context.ticket,
			phase: "review",
			attempt: `${context.run}-t${context.ticket}-a${ordinal}`,
			occurredAt: FIXED_NOW,
			observedAt: FIXED_NOW,
			payload: { role: axis, profile: "builder" },
		});
		resolveStage(context.store, {
			hold: context.hold,
			run: context.run,
			ticket: context.ticket,
			phase: "review",
			attempt: `${context.run}-t${context.ticket}-a${ordinal}`,
			outcome: "completed",
			detail: {
				axis,
				verdict: "approved",
				findings: axis === "review-standards" ? [{ severity: "advisory", statement: "inline this", citation: "§8.4" }] : [],
				attestation: { mutated: false, reasons: [], before_head: null, after_head: null, leftovers: [] },
			},
			actor: "controller",
			at: FIXED_NOW,
		});
	}
}

test("verify rebases onto the fresh base and runs the set at the result, under the lease (§9.5)", async (t) => {
	const fixture = await integrating(t);
	moveRemoteBase(t, fixture.remote);

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);

	assert.equal(verified.outcome, "passed");
	assert.equal(verified.detail.rebased, true);
	assert.notEqual(verified.detail.head, fixture.head);
	// §14.13: the commit the checks ran at is the one the branch now is.
	assert.equal(git(fixture.clone.dir, ["rev-parse", `refs/heads/${fixture.branch}`]), verified.detail.head);
	assert.deepEqual([...verified.detail.commits], [verified.detail.head]);

	// §7.5: the pre-rebase head survives by contract.
	assert.equal(verified.detail.evidence_ref, evidenceRef(fixture.attempt));
	assert.equal(git(fixture.clone.dir, ["rev-parse", verified.detail.evidence_ref]), fixture.head);

	// §9.5: the lease is given up at the end of the span, so review runs without it.
	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
});

test("an unmoved base writes no evidence ref, because nothing destructive happened (§7.5)", async (t) => {
	const fixture = await integrating(t);

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);

	assert.equal(verified.outcome, "passed");
	assert.equal(verified.detail.rebased, false);
	assert.equal(verified.detail.evidence_ref, null);
	assert.equal(verified.detail.head, fixture.head);
});

test("a rebase conflict ends verify as a typed outcome and keeps the worktree (§8.10, §12.7)", async (t) => {
	const fixture = await integrating(t, { files: { "contested.txt": "the attempt's line\n" } });
	moveRemoteBase(t, fixture.remote, { "contested.txt": "a human's line\n" });

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);

	assert.equal(verified.outcome, "rebase-conflict");
	assert.deepEqual([...verified.detail.conflicts], ["contested.txt"]);
	assert.equal(existsSync(integrationWorktreePath(fixture.store.storeDir, fixture.attempt)), true);
	// The branch is untouched: nothing was adopted, so §8.5's fresh-retry starts
	// from a branch that still holds exactly what the worker wrote.
	assert.equal(git(fixture.clone.dir, ["rev-parse", `refs/heads/${fixture.branch}`]), fixture.head);
	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
});

test("a red required set is verify's own failure, and nothing is published (§14.15)", async (t) => {
	const fixture = await integrating(t);

	const verified = await integrationVerify(fixture.store, fixture.clone, { ...fixture.context, checks: RED });

	assert.equal(verified.outcome, "failed");
	assert.deepEqual([...verified.detail.red], ["unit"]);
	assert.throws(() => git(fixture.remote, ["rev-parse", "--verify", `refs/heads/${fixture.branch}`]));
});

test("integrate publishes: predicates, plain push, one PR, and §8.7's attestation (§7.5)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	assert.equal(git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]), integrated.detail.head);

	// §7.5's PR: one, against the default branch, with the parseable block.
	assert.equal(fixture.gitea.pulls.length, 1);
	assert.equal(fixture.gitea.pulls[0].base.ref, "main");
	assert.equal(fixture.gitea.pulls[0].title, "feat: the work (#42)");
	const block = parsePullBody(fixture.gitea.pulls[0].body);
	assert.equal(block.identity.attempt, fixture.attempt);
	assert.equal(block.head, integrated.detail.head);
	assert.equal(block.package_revision, "d".repeat(64));
	assert.equal(block.attestation.digest, integrated.detail.attestation.digest);
	assert.deepEqual(block.advisory.map((f) => f.statement), ["inline this"]);
	assert.match(fixture.gitea.pulls[0].body, /\nCloses #42$/);

	// §12.7: both worktrees go eagerly, and the lease is given back.
	assert.equal(existsSync(fixture.worktreePath), false);
	assert.equal(existsSync(integrationWorktreePath(fixture.store.storeDir, fixture.attempt)), false);
	assert.equal(integrated.detail.branch_cleanup_eligible, true);
	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
});

test("the base moving during review re-rebases and re-verifies, consuming no budget (§9.5, §15 case 10)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	// The one way a base ever moves: a human merged something while the two
	// review axes were talking to a model.
	moveRemoteBase(t, fixture.remote);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	// The published commit sits on the new tip, and it is the one the remote has.
	const fresh = git(fixture.clone.dir, ["rev-parse", "refs/factory/base/main"]);
	assert.equal(git(fixture.clone.dir, ["merge-base", "--is-ancestor", fresh, integrated.detail.head]) || "ancestor", "ancestor");
	assert.equal(git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]), integrated.detail.head);

	// Nothing about the loop is a failure, so no stage of it was resolved: the
	// walk sees one `integrate` result and no retry was ever asked for.
	assert.deepEqual(
		fixture.store
			.readEvents({ kind: "stage.resolved" })
			.map((event) => event.phase)
			.filter((phase) => phase === "integrate"),
		[],
	);
});

test("a base that moved and now breaks the branch is integration-red, never an automation fault (§8.6)", async (t) => {
	const fixture = await integrating(t);
	// Green while the branch stands alone; the check reads a file the human's
	// merge is about to change.
	const checks = [
		{
			name: "unit",
			command: "test ! -f human.txt",
			timeout: 60,
			severity: "required",
			expectedFailureExitCodes: [1],
		},
	];
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, { ...fixture.context, checks }));
	recordReview(fixture);

	moveRemoteBase(t, fixture.remote);

	const integrated = await integratePublish(fixture.store, fixture.clone, { ...fixture.context, checks });

	assert.equal(integrated.outcome, "integration-red");
	assert.match(integrated.detail.problem, /do not compose/);
	assert.deepEqual([...integrated.detail.red], ["unit"]);
	// Nothing was published, and the worktree is kept for the human §14.18 sends.
	assert.throws(() => git(fixture.remote, ["rev-parse", "--verify", `refs/heads/${fixture.branch}`]));
	assert.equal(existsSync(integrationWorktreePath(fixture.store.storeDir, fixture.attempt)), true);
});

test("a base that moved and now conflicts is a rebase-conflict, from the integrate phase (§8.10)", async (t) => {
	const fixture = await integrating(t, { files: { "contested.txt": "the attempt's line\n" } });
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	moveRemoteBase(t, fixture.remote, { "contested.txt": "a human's line\n" });

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "rebase-conflict");
	assert.deepEqual([...integrated.detail.conflicts], ["contested.txt"]);
});

test("a branch that grew a commit after verification is never published (§7.4, §14.13)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	// A commit nothing verified, appearing on the branch between the verify and
	// the publish. §7.4's identity check is what catches it, and the outcome is a
	// predicate failure rather than a push failure: retrying would push the same
	// unattested branch.
	const path = integrationWorktreePath(fixture.store.storeDir, fixture.attempt);
	const smuggled = commitInto(path, { "smuggled.txt": "from nowhere\n" }, { message: "chore: smuggled", trailer: null });
	execFileSync("git", ["-C", fixture.clone.dir, "update-ref", `refs/heads/${fixture.branch}`, smuggled]);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "predicate-failed");
	assert.equal(integrated.detail.at, "head");
	assert.throws(() => git(fixture.remote, ["rev-parse", "--verify", `refs/heads/${fixture.branch}`]));
	assert.equal(existsSync(path), true, "the only copy of the work was reclaimed on a failure");
});

test("a commit with no §7.3 correlation trailer stops the publication (§7.3, §7.4)", async (t) => {
	// The worker ignored the prompt obligation. §7.3 says it is verified at
	// integration, and this is where.
	const fixture = await integrating(t, { trailer: false });
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "predicate-failed");
	assert.equal(integrated.detail.reason, "trailer-missing");
	assert.deepEqual([...integrated.detail.untrailed], [fixture.head]);
	assert.throws(() => git(fixture.remote, ["rev-parse", "--verify", `refs/heads/${fixture.branch}`]));
	assert.equal(fixture.gitea.pulls.length, 0);
});

test("publishing twice is the committed publication, not a second PR or a second push (§7.7)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	const first = await integratePublish(fixture.store, fixture.clone, fixture.context);
	const again = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(again.outcome, "integrated");
	assert.equal(again.detail.pr.number, first.detail.pr.number);
	assert.equal(again.detail.attestation.digest, first.detail.attestation.digest);
	assert.equal(fixture.gitea.pulls.length, 1);
	assert.equal(
		fixture.store.read((db) => db.prepare("SELECT count(*) AS n FROM effect WHERE operation = 'push'").get()).n,
		1,
	);
});

test("integrate refuses to publish from an attempt no verify attested (§14.15, §14.16)", async (t) => {
	const fixture = await integrating(t);
	recordReview(fixture);

	await assert.rejects(
		integratePublish(fixture.store, fixture.clone, fixture.context),
		(error) => error.name === "FactoryPipelineError" && error.reason === "phase-unwired",
	);
	assert.equal(fixture.gitea.pulls.length, 0);
});

test("the lease is given back however the span ends, so a refusal does not wedge the next lane (§4.6)", async (t) => {
	const fixture = await integrating(t);
	recordReview(fixture);

	await assert.rejects(integratePublish(fixture.store, fixture.clone, fixture.context));

	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
	// And the next span can take it.
	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);
	assert.equal(verified.outcome, "passed");
});
