import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { readArtifact } from "../../factory/lib/artifacts/ledger.mjs";
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
import {
	commitInto,
	damagedTicketSegment,
	damagedTicketSegmentValue,
	moveRemoteBase,
	repairAttempt,
	workedAttempt,
} from "./helpers/factory-git.mjs";
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

/**
 * An advisory check that feeds nothing — #211's deferred set. It prints the head
 * of the worktree it ran in, so its recorded output is proof of *which commit*
 * the publication boundary measured.
 */
const deferred = (overrides = {}) => ({
	name: "e2e",
	command: "git rev-parse HEAD",
	timeout: 60,
	severity: "advisory",
	expectedFailureExitCodes: [1],
	...overrides,
});

/** §8.7's document, as the publication actually wrote it. */
function attestationOf(fixture, integrated) {
	return JSON.parse(readArtifact(fixture.store, integrated.detail.attestation).toString("utf8"));
}

/** How many executions of one check's output the store recorded (§4.5, §8.7). */
function recordedOutputs(fixture, name) {
	return fixture.store.read((db) =>
		db
			.prepare("SELECT count(*) AS n FROM effect WHERE effect_key LIKE ?")
			.get(`%/artifact-write/check-output/${name}-%`),
	).n;
}

async function integrating(t, { status = {}, repairs = [], checks = GREEN, ...options } = {}) {
	let fixture = await workedAttempt(t, options);
	for (const repair of repairs) {
		fixture = await repairAttempt(fixture, repair);
	}
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
		baseBranch: "main",
		checks,
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
	const output = verified.detail.checks[0].output;
	assert.match(output.digest, /^[0-9a-f]{64}$/, "verify did not retain the captured output by digest");
	assert.match(readArtifact(fixture.store, output).toString("utf8"), new RegExp(verified.detail.head));

	// §7.5: the pre-rebase head survives by contract.
	assert.equal(verified.detail.evidence_ref, evidenceRef(fixture.attempt));
	assert.equal(git(fixture.clone.dir, ["rev-parse", verified.detail.evidence_ref]), fixture.head);

	// §9.5: the lease is given up at the end of the span, so review runs without it.
	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
});

test("a repair's verify replays the implement commit it builds on, not only the repair (#161, §7.5, §8.5)", async (t) => {
	// The dangerous half of #161: the repair touches only a file the implement
	// commit did not create, so a rebase that excluded the implement commit would
	// replay **cleanly** — and a branch that quietly lost the work it repairs
	// would verify, and publish, as green.
	const fixture = await integrating(t, {
		files: { "worker.txt": "the implement's work\n" },
		repairs: [{ ordinal: 2, files: { "repair.txt": "the repair's own file\n" } }],
	});
	const implementHead = fixture.ownBase;
	moveRemoteBase(t, fixture.remote);

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);

	assert.equal(verified.outcome, "passed");
	// §7.5: the replay set is every commit the ticket execution produced that is
	// not already on the base branch — both of them, not the repair alone.
	assert.equal(verified.detail.commits.length, 2, "the implement commit was dropped from the replay set");
	// The implement's work exists at the head being published.
	assert.doesNotThrow(
		() => git(fixture.clone.dir, ["cat-file", "-e", `${verified.detail.head}:worker.txt`]),
		"the head being published does not carry the implement commit's file",
	);
	// And the pre-rebase evidence ref holds the repair attempt's head as the
	// worker left it, implement commit included.
	assert.equal(git(fixture.clone.dir, ["rev-parse", verified.detail.evidence_ref]), fixture.head);
	assert.doesNotThrow(() => git(fixture.clone.dir, ["merge-base", "--is-ancestor", implementHead, fixture.head]));
});

test("a repair editing a file the implement commit created verifies clean, not as a conflict (#161, §7.5)", async (t) => {
	// #114's observed shape: the repair edits a file that does not exist on the
	// base branch at all. A rebase whose replay set excludes the implement commit
	// has nothing to apply the edit to, and reports a conflict over work that is
	// sound and already verified.
	const fixture = await integrating(t, {
		files: { "worker.txt": "the implement's work\n" },
		repairs: [{ ordinal: 2, files: { "worker.txt": "the implement's work, repaired\n" } }],
	});
	moveRemoteBase(t, fixture.remote);

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);

	assert.equal(verified.outcome, "passed");
	assert.equal(verified.detail.commits.length, 2);
	assert.equal(
		git(fixture.clone.dir, ["show", `${verified.detail.head}:worker.txt`]),
		"the implement's work, repaired",
	);
});

test("a repair chain of two tiers publishes all three commits, through the same path verify took (#161, §7.5, §8.5, §8.6)", async (t) => {
	// Two repairs stacked on one implement — ordinals 4 and 5, because §8.4's
	// review axes mint 2 and 3 into the same ordinal space. The base then moves
	// during review, so §9.5's compare-and-publish loop re-rebases on the
	// publication path too: both halves of rebaseAndVerify's double duty.
	const fixture = await integrating(t, {
		files: { "worker.txt": "the implement's work\n" },
		repairs: [
			{ ordinal: 4, files: { "worker.txt": "repaired once\n" } },
			{ ordinal: 5, files: { "repair-two.txt": "repaired twice\n" } },
		],
	});
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);
	moveRemoteBase(t, fixture.remote);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	const remoteHead = git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]);
	assert.equal(remoteHead, integrated.detail.head);
	const fresh = git(fixture.clone.dir, ["rev-parse", "refs/factory/base/main"]);
	assert.equal(git(fixture.clone.dir, ["rev-list", "--count", `${fresh}..${remoteHead}`]), "3");
	assert.equal(git(fixture.clone.dir, ["show", `${remoteHead}:worker.txt`]), "repaired once");
	assert.doesNotThrow(() => git(fixture.clone.dir, ["cat-file", "-e", `${remoteHead}:repair-two.txt`]));
	assert.equal(fixture.gitea.pulls.length, 1);
});

test("a rebase that drops a commit fails verify as a typed refusal, and nothing is adopted (#161, §7.5, §11.2)", async (t) => {
	const fixture = await integrating(t);
	// A human cherry-picked the attempt's only commit onto the default branch, so
	// the replay drops it as already applied and the result carries nothing.
	moveRemoteBase(t, fixture.remote, { "worker.txt": "attempt work\n" });

	await assert.rejects(
		integrationVerify(fixture.store, fixture.clone, fixture.context),
		(error) => error.name === "FactoryGitError" && error.reason === "rebase-dropped-commits",
	);

	// The branch still holds the worker's work, nothing reached the remote, and
	// the lease is back for the next lane.
	assert.equal(git(fixture.clone.dir, ["rev-parse", `refs/heads/${fixture.branch}`]), fixture.head);
	assert.throws(() => git(fixture.remote, ["rev-parse", "--verify", `refs/heads/${fixture.branch}`]));
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
	// The branch is untouched: nothing was adopted, so §8.5's rebase-repair starts
	// from a branch that still holds exactly what the worker wrote (#194).
	assert.equal(git(fixture.clone.dir, ["rev-parse", `refs/heads/${fixture.branch}`]), fixture.head);
	assert.equal(fixture.leases.inspect(LEASE_NAMES.integration), null);
	// #194: the retained worktree is the attempt's tip — the rebase was aborted —
	// with the pre-rebase head under the evidence ref; and the base's own movement
	// rides the detail as the controller read it, for the prompt to carry.
	assert.equal(git(integrationWorktreePath(fixture.store.storeDir, fixture.attempt), ["rev-parse", "HEAD"]), fixture.head);
	assert.equal(git(fixture.clone.dir, ["rev-parse", verified.detail.evidence_ref]), fixture.head);
	assert.equal(verified.detail.previous_base, fixture.base.commit);
	assert.match(verified.detail.base_movement, /contested\.txt/);
	assert.match(verified.detail.base_movement, /1 file changed/);
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

test("#211: the deferred advisory set is paid at the publication boundary, at the commit being pushed", async (t) => {
	const fixture = await integrating(t, { checks: [...GREEN, deferred()] });

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);
	recordVerify(fixture, verified);
	recordReview(fixture);

	// Every verify — after the implement and after each repair — leaves it
	// outstanding rather than running it.
	assert.deepEqual(
		verified.detail.checks.map((check) => check.name),
		["unit"],
	);
	assert.deepEqual(verified.detail.deferred, ["e2e"]);
	assert.equal(recordedOutputs(fixture, "e2e"), 0);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	assert.deepEqual(integrated.detail.publication_checks, { names: ["e2e"], reused: false });

	// §8.7 still carries every declared check exactly once, in declaration order,
	// with its required flag — assembled from the two sets that measured this
	// commit rather than from one run of the whole list.
	const document = attestationOf(fixture, integrated);
	assert.deepEqual(
		document.checks.map((check) => [check.name, check.result, check.required]),
		[
			["unit", "passed", true],
			["e2e", "passed", false],
		],
	);
	// And it ran at the **candidate commit**: the check printed the head of the
	// worktree it was given, and that head is the one that was pushed.
	assert.equal(readArtifact(fixture.store, document.checks[1].output).toString("utf8").trim(), integrated.detail.head);
	assert.equal(git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]), integrated.detail.head);
});

test("#211: a re-entered publication stands on the recorded result rather than paying for the tier twice", async (t) => {
	const fixture = await integrating(t, { checks: [...GREEN, deferred()] });
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);
	const published = await integratePublish(fixture.store, fixture.clone, fixture.context);

	// §8.10 routes `integrate × push-failed` to an automation retry, and a human
	// merging this very PR moves the base under it (#146).
	moveRemoteBase(t, fixture.remote);
	const retried = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(retried.outcome, "integrated");
	assert.deepEqual(retried.detail.publication_checks, { names: ["e2e"], reused: true });
	assert.equal(recordedOutputs(fixture, "e2e"), 1, "the retry re-ran a set the attestation already recorded");
	assert.equal(retried.detail.attestation.digest, published.detail.attestation.digest);
});

test("#211: a deferred advisory check that fails is evidence on the attestation and publishes anyway (§8.2)", async (t) => {
	const fixture = await integrating(t, { checks: [...GREEN, deferred({ command: "echo survivors; exit 1" })] });
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated", "an advisory result at the boundary blocked a publication");
	const document = attestationOf(fixture, integrated);
	assert.deepEqual(
		document.checks.map((check) => [check.name, check.result]),
		[
			["unit", "passed"],
			["e2e", "failed"],
		],
	);
	assert.match(integrated.detail.summary, /1 of 1 required check\(s\) green/);
	assert.match(integrated.detail.summary, /1 advisory recorded/);
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

test("the phase that read the trailers is the phase that records them (§8.7, #210)", async (t) => {
	// §8.7 attests what verify measured at the commit it measured. Re-deriving the
	// reading at publication would be a second answer to a question durable state
	// already holds — the same rule the commit list is under.
	const fixture = await integrating(t, { trailer: damagedTicketSegment });

	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);

	assert.deepEqual(
		verified.detail.misstamped.map((entry) => ({ ...entry })),
		[{ commit: verified.detail.head, trailer: damagedTicketSegmentValue(fixture) }],
	);
});

test("a fumbled trailer segment publishes, and §8.7 records that it did (§7.3, #210)", async (t) => {
	// The whole pipeline said yes — verify passed and both axes approved — and the
	// only thing wrong was one mangled segment of a string the worker itself
	// wrote. Discarding the deliverable over it is the defect this closes.
	const fixture = await integrating(t, { trailer: damagedTicketSegment });
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	assert.equal(fixture.gitea.pulls.length, 1);
	const misspelling = damagedTicketSegmentValue(fixture);
	assert.deepEqual(
		integrated.detail.misstamped.map((entry) => ({ ...entry })),
		[{ commit: integrated.detail.head, trailer: misspelling }],
	);

	// Recorded where an incident review reads, not only in the journal: §8.7's
	// attestation is the immutable statement of what was published.
	const attested = JSON.parse(readArtifact(fixture.store, integrated.detail.attestation).toString("utf8"));
	assert.deepEqual(attested.integration.misstamped, [{ commit: integrated.detail.head, trailer: misspelling }]);
});

test("a verify record written before #210 is attested from the re-derivation, never as clean (§8.7, #210)", async (t) => {
	// The upgrade window: an execution that verified under the old code reaches
	// integrate with no trailer reading on its record. Attesting that absence as
	// an empty list would state the damaged trailer was not there, so the range —
	// which is the recorded one, at the recorded head — is read again instead.
	const fixture = await integrating(t, { trailer: damagedTicketSegment });
	const verified = await integrationVerify(fixture.store, fixture.clone, fixture.context);
	const { misstamped, ...beforeThisTicket } = verified.detail;
	recordVerify(fixture, { outcome: verified.outcome, detail: beforeThisTicket });
	recordReview(fixture);

	const integrated = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(integrated.outcome, "integrated");
	const attested = JSON.parse(readArtifact(fixture.store, integrated.detail.attestation).toString("utf8"));
	assert.deepEqual(attested.integration.misstamped, [
		{ commit: integrated.detail.head, trailer: damagedTicketSegmentValue(fixture) },
	]);
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

test("a retried integrate after a successful publication neither re-pushes nor rewrites (§7.7, §14.11, §14.12, #146)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);
	const published = await integratePublish(fixture.store, fixture.clone, fixture.context);
	const remoteHead = git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]);

	// §8.10 routes `integrate × push-failed` to an automation retry, and #146's
	// answer is that it mints nothing: `integrate` has no worker (§8.8), so the
	// phase re-enters under the attempt already being walked. The base has moved
	// under it in the meantime — a human merging this very PR is how it moves —
	// so a re-entry that went into §9.5's loop would rebase and re-push a branch
	// that is already out there.
	moveRemoteBase(t, fixture.remote);
	const retried = await integratePublish(fixture.store, fixture.clone, fixture.context);

	assert.equal(retried.outcome, "integrated");
	assert.equal(retried.detail.pr.number, published.detail.pr.number);
	assert.equal(retried.detail.head, published.detail.head);
	assert.equal(git(fixture.remote, ["rev-parse", `refs/heads/${fixture.branch}`]), remoteHead, "§14.12");
	assert.equal(fixture.gitea.pulls.length, 1);
	assert.equal(
		fixture.store.read((db) => db.prepare("SELECT count(*) AS n FROM effect WHERE operation = 'push'").get()).n,
		1,
		"§4.5: one ticket execution, one branch, one push effect (#146)",
	);
});

test("the publication is found from a re-entry that never saw it, because its key names no attempt (§4.5, #146)", async (t) => {
	const fixture = await integrating(t);
	recordVerify(fixture, await integrationVerify(fixture.store, fixture.clone, fixture.context));
	recordReview(fixture);
	await integratePublish(fixture.store, fixture.clone, fixture.context);

	const keys = fixture.store.read((db) =>
		db.prepare("SELECT effect_key FROM effect WHERE operation IN ('push', 'pr-create') ORDER BY operation").all(),
	);

	assert.deepEqual(
		keys.map((row) => row.effect_key),
		[
			`${fixture.run}/${fixture.ticket}/implement/-/pr-create/${fixture.branch}`,
			`${fixture.run}/${fixture.ticket}/integrate/-/push/${fixture.branch}`,
		],
		"both name the published branch and neither names an attempt, so both are one convention",
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
