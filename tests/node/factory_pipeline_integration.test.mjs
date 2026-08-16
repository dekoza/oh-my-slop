import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { unresolvedEffects } from "../../factory/lib/effects/records.mjs";
import { registerGitProbes } from "../../factory/lib/git/probes.mjs";
import { reconcile } from "../../factory/lib/reconcile/engine.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { withTrackerProbes } from "../../factory/lib/reconcile/tracker-probes.mjs";
import { evidenceRef, integrationWorktreePath } from "../../factory/lib/git/isolation.mjs";
import { integratePublish, integrationVerify, MAX_BASE_MOVES } from "../../factory/lib/pipeline/integration.mjs";
import { parsePullBody, renderPullBody } from "../../factory/lib/tracker/pulls.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { LEASE_NAMES, openLeases } from "../../factory/lib/state/leases.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { commitInto, moveRemoteBase, workedAttempt } from "./helpers/factory-git.mjs";
import { fakeGitea, giteaIssue, giteaPull } from "./helpers/factory-tracker.mjs";
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

async function integrating(t, { status = {}, ...options } = {}) {
	const fixture = await workedAttempt(t, options);
	const { store } = fixture;
	const leases = openLeases(store, { now: () => FIXED_NOW });
	const hold = holdControllerLease({ store, leases, timers: manualTimers().api });
	hold.recordStartupReconcile();
	hold.adopt(fixture.run);

	// `status` is kept by reference, so a test can refuse one write, let the phase
	// die on it, and then lift the refusal for the re-entry.
	const gitea = fakeGitea({ issues: [giteaIssue({ number: fixture.ticket, title: "feat: the work" })], pulls: [], status });

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
	assert.doesNotThrow(
		() => git(fixture.clone.dir, ["merge-base", "--is-ancestor", fresh, integrated.detail.head]),
		"the published commit does not sit on the tip the human merged onto",
	);
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

test("a base that moves on every pass stops the loop rather than holding the lease forever (§9.5)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	// A repository under continuous merge: every fetch answers a tip nobody has
	// verified against. Unbounded, the loop would hold the integration lease
	// indefinitely and report nothing.
	let moves = 0;
	const churning = {
		...fixture.clone,
		fetchBase: async (what) => {
			moves += 1;
			moveRemoteBase(t, fixture.remote, { [`human-${moves}.txt`]: `merge ${moves}\n` });
			return fixture.clone.fetchBase(what);
		},
	};

	const integrated = await integratePublish(fixture.store, churning, fixture.context);

	assert.equal(integrated.outcome, "push-failed");
	assert.equal(integrated.detail.passes, MAX_BASE_MOVES);
	assert.match(integrated.detail.problem, /base moved on \d+ consecutive passes/);
	// Nothing was published, and the lease is back for the next lane.
	assert.throws(() => git(fixture.remote, ["rev-parse", "--verify", `refs/heads/${fixture.branch}`]));
	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
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
	// §12.7: on a failure both worktrees stay — the attempt's because it is the
	// only copy of the work, the integration one because that is where an
	// operator goes to see what the predicate refused.
	assert.equal(existsSync(fixture.worktreePath), true, "the only copy of the work was reclaimed on a failure");
	assert.equal(existsSync(path), true, "the integration worktree was reclaimed on a failure");
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

test("a published branch is never touched again: a second head under the same key refuses (§14.12)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);
	const published = await integratePublish(fixture.store, fixture.clone, fixture.context);
	const remoteHead = git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]);

	// A human merges something, and a second pass comes back to a branch that is
	// already out there. §14.12 has nothing refresh it — the compare-and-publish
	// loop is between verify and publish, and this one is published.
	moveRemoteBase(t, fixture.remote);
	const again = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(again.detail.pr.number, published.detail.pr.number);
	assert.equal(git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]), remoteHead);
	assert.equal(fixture.gitea.pulls.length, 1);
	assert.equal(fixture.gitea.pulls[0].state, "open", "a drifted PR was auto-closed");
	// One push effect, and it is the one that landed: a second head offered under
	// the same key would be §4.5's typed payload conflict rather than a force.
	assert.equal(
		fixture.store.read((db) => db.prepare("SELECT count(*) AS n FROM effect WHERE operation = 'push'").get()).n,
		1,
	);
});

test("a crash between the PR and the sweep leaves one live PR once the re-entry finishes (§7.5)", async (t) => {
	const refusing = {};
	const fixture = await integrating(t, { status: refusing });
	const staleNumber = 7050;
	// A pull request a previous run opened from a previous attempt's branch, with
	// a body that parses as ours — which is what makes it the sweep's to close.
	const staleAttempt = `${fixture.run}-t${fixture.ticket}-a9`;
	fixture.gitea.pulls.push(
		giteaPull({
			number: staleNumber,
			headBranch: `factory/t${fixture.ticket}/a${staleAttempt}`,
			body: renderPullBody({
				identity: { run: fixture.run, ticket: fixture.ticket, attempt: staleAttempt },
				base_commit: fixture.base.commit,
				package_revision: null,
				branch: `factory/t${fixture.ticket}/a${staleAttempt}`,
				head: fixture.head,
				evidence: [],
				attestation: { algorithm: "sha256", digest: "0".repeat(64), bytes: 1 },
				summary: "an earlier attempt that did not finish",
				advisory: [],
			}),
		}),
	);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	// The crash: the pull request is created and the sweep's first write is
	// refused, so the phase throws with two open PRs on one ticket.
	refusing[`/issues/${staleNumber}/comments`] = 500;
	await assert.rejects(integratePublish(fixture.store, fixture.clone, fixture.context));
	assert.equal(fixture.gitea.pulls.filter((pull) => pull.state === "open").length, 2);

	// The re-entry finishes the sweep rather than answering `integrated` over it.
	delete refusing[`/issues/${staleNumber}/comments`];
	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	assert.deepEqual(integrated.detail.superseded.map((entry) => entry.number), [staleNumber]);
	assert.equal(fixture.gitea.pulls.find((pull) => pull.number === staleNumber).state, "closed");
	assert.equal(fixture.gitea.pulls.filter((pull) => pull.state === "open").length, 1);
	assert.equal(fixture.gitea.pulls.length, 2, "the re-entry opened a second pull request");
});

test("a crash before §12.7's reclamation is finished by the re-entry, not answered over", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	// The crash: everything through the pull request lands, and the process dies
	// on the first worktree removal.
	let crashed = false;
	const dying = {
		...fixture.clone,
		removeWorktree: async (what) => {
			if (crashed) return fixture.clone.removeWorktree(what);
			crashed = true;
			throw new Error("the controller died reclaiming a worktree");
		},
	};
	await assert.rejects(integratePublish(fixture.store, dying, fixture.context));
	assert.equal(existsSync(fixture.worktreePath), true);
	assert.equal(existsSync(integrationWorktreePath(fixture.store.storeDir, fixture.attempt)), true);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	assert.equal(existsSync(fixture.worktreePath), false, "the attempt worktree survived an integrated success");
	assert.equal(existsSync(integrationWorktreePath(fixture.store.storeDir, fixture.attempt)), false);
	assert.equal(
		fixture.store.read((db) =>
			db.prepare("SELECT state FROM effect WHERE operation = 'worktree-delete'").get(),
		).state,
		"resolved",
	);
});

test("a crash mid-integration is repaired by reconcile settling what the world already did (§7.7)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);
	await integratePublish(fixture.store, fixture.clone, fixture.context);

	// The crash: the push and the PR happened, and the controller died before
	// either resolution committed. §14.1 forbids settling them by reasoning.
	fixture.store.transaction(({ db }) => {
		db.prepare(
			"UPDATE effect SET state = 'requested', resolved_at = NULL, resolved_seq = NULL, result = NULL " +
				"WHERE operation IN ('push', 'pr-create')",
		).run();
	});
	assert.equal(unresolvedEffects(fixture.store).length, 2);

	const probes = withTrackerProbes(createProbeRegistry(), { reader: fixture.context.reader, assignee: "factory-bot" });
	registerGitProbes(probes);
	const report = await reconcile(fixture.store, { probes, fencingGeneration: 1, at: FIXED_NOW + 1000 });

	assert.equal(report.settled, 2);
	assert.deepEqual(unresolvedEffects(fixture.store), []);

	// And integration re-runs end to end over the settled state, publishing
	// nothing twice.
	const again = await integratePublish(fixture.store, fixture.clone, fixture.context);
	assert.equal(again.outcome, "integrated");
	assert.equal(fixture.gitea.pulls.length, 1);
});

test("an automation retry publishes what the attempt before it verified (§8.5, §8.10)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	// §8.10 routes `integrate × push-failed` to an automation retry, which §8.5
	// re-enters under a fresh attempt id and rebuilds nothing: the automation
	// failed, not the work. The commit it publishes is the one verified before.
	const retried = `${fixture.run}-t${fixture.ticket}-a4`;
	// §6.5: the mint precedes every attempt-scoped effect, and the seam that
	// plans the retry is what performs it.
	fixture.store.append({
		kind: "attempt.launched",
		source: "controller",
		run: fixture.run,
		ticket: fixture.ticket,
		phase: "integrate",
		attempt: retried,
		occurredAt: FIXED_NOW,
		observedAt: FIXED_NOW,
		payload: { role: "implement", profile: "builder" },
	});

	const integrated = await integratePublish(fixture.store, fixture.clone, { ...fixture.context, attempt: retried });

	assert.equal(integrated.outcome, "integrated");
	assert.equal(git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]), integrated.detail.head);
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
