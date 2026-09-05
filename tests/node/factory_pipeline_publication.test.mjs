import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { writeAttestation } from "../../factory/lib/pipeline/attestation.mjs";
import { publicationChecks } from "../../factory/lib/pipeline/publication.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { attemptLaunched, FIXED_NOW, manualTimers, openTestStore, runStarted } from "./helpers/factory-store.mjs";

/**
 * #211: **an advisory check that feeds nothing is paid for once per published
 * ticket, not once per attempt.**
 *
 * The set runs at §7.5's publication boundary, against the exact commit about to
 * be pushed, and a re-entry stands on what the attestation of that same commit
 * already records. These drive real processes in a real directory, for
 * `checks/run.mjs`'s reason: whether a check ran is a statement about a process,
 * and no mock can make it.
 */

const TICKET = 42;
const CANDIDATE = "a".repeat(40);
const MOVED = "b".repeat(40);

/** The declaration under test: one required check, one fed advisory, one deferred. */
const DECLARED = Object.freeze([
	{ name: "unit", command: "true", timeout: 30, severity: "required", expectedFailureExitCodes: [1], feeds: [] },
	{
		name: "mutation",
		command: "true",
		timeout: 30,
		severity: "advisory",
		expectedFailureExitCodes: [],
		feeds: ["implement"],
	},
	{
		name: "e2e",
		command: "echo ran >> ran; echo the-browser-tier",
		timeout: 30,
		severity: "advisory",
		expectedFailureExitCodes: [1],
		feeds: [],
	},
]);

/** What §8.1's verify recorded for the two checks the attempt pays for. */
const VERIFIED = Object.freeze([
	{ name: "unit", command: "true", severity: "required", result: "passed", exit_code: 0, duration_ms: 10, output: null },
	{
		name: "mutation",
		command: "true",
		severity: "advisory",
		result: "passed",
		exit_code: 0,
		duration_ms: 10,
		output: null,
	},
]);

function workspace(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-publication-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** How many times the deferred check actually ran in this worktree. */
function ranTimes(cwd) {
	try {
		return readFileSync(join(cwd, "ran"), "utf8").trim().split("\n").length;
	} catch {
		return 0;
	}
}

/** A ticket execution with both review axes resolved, so §8.7 has verdicts to attest. */
async function reviewed(t) {
	const store = await openTestStore(t);
	const hold = holdControllerLease({
		store,
		leases: openLeases(store, { now: () => FIXED_NOW }),
		timers: manualTimers().api,
	});
	const opened = runStarted();
	const run = opened.run;
	const attempt = `${run}-t${TICKET}-a1`;

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(run);
	store.append(attemptLaunched(run, TICKET, 1, { at: FIXED_NOW }));

	for (const [ordinal, axis] of [
		[2, "review-standards"],
		[3, "review-spec"],
	]) {
		store.append(attemptLaunched(run, TICKET, ordinal, { at: FIXED_NOW, phase: "review", role: "review" }));
		resolveStage(store, {
			hold,
			run,
			ticket: TICKET,
			phase: "review",
			attempt: `${run}-t${TICKET}-a${ordinal}`,
			outcome: "completed",
			detail: {
				axis,
				verdict: "approved",
				findings: [],
				attestation: { mutated: false, reasons: [], before_head: null, after_head: null, leftovers: [] },
			},
			actor: "controller",
			at: FIXED_NOW,
		});
	}

	return { store, hold, run, attempt };
}

function boundary({ store, hold, run, attempt }, { cwd, candidateCommit = CANDIDATE, checks = DECLARED }) {
	return publicationChecks(store, {
		hold,
		run,
		ticket: TICKET,
		attempt,
		checks,
		candidateCommit,
		cwd,
		actor: "controller",
		now: () => FIXED_NOW,
	});
}

/** §8.7's artifact, as the first pass wrote it — the durable record a re-entry stands on. */
function attest(context, { publishedCommit, records }) {
	return writeAttestation(context.store, {
		hold: context.hold,
		actor: "controller",
		at: FIXED_NOW,
		run: context.run,
		ticket: TICKET,
		attempt: context.attempt,
		publishedCommit,
		branch: `factory/t${TICKET}/a1`,
		baseCommit: "c".repeat(40),
		declared: DECLARED,
		checks: [...VERIFIED, ...records],
		integration: { rebased: false, evidence_ref: null, commits: [publishedCommit] },
	});
}

test("the deferred set runs at the publication boundary, and its output is recorded as evidence (§8.7)", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);

	const answer = await boundary(context, { cwd });

	assert.equal(answer.reused, false);
	assert.deepEqual(answer.names, ["e2e"]);
	assert.deepEqual(
		answer.records.map((record) => [record.name, record.result]),
		[["e2e", "passed"]],
	);
	assert.equal(ranTimes(cwd), 1);

	// The bytes are in the store and reachable by digest, exactly as a verify-time
	// check's output is (§8.7, §12.1) — the record carries the reference, never
	// the output itself.
	const output = answer.records[0].output;
	assert.match(output.digest, /^[0-9a-f]{64}$/);
	assert.match(readArtifact(context.store, output).toString("utf8"), /the-browser-tier/);
});

test("#211: a re-entry at the same candidate commit stands on the attestation, and runs nothing", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);
	const first = await boundary(context, { cwd });
	attest(context, { publishedCommit: CANDIDATE, records: first.records });

	const again = await boundary(context, { cwd });

	assert.equal(again.reused, true);
	assert.equal(ranTimes(cwd), 1, "the tier was paid for twice to publish one commit");
	// Byte-for-byte what the first pass recorded, so §4.5's content-addressed
	// attestation key is offered one payload rather than two.
	assert.deepEqual(again.records, first.records);
});

test("#211: a different candidate commit is a different measurement, so the set runs again", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);
	const first = await boundary(context, { cwd });
	// §9.5's compare-and-publish loop re-verified onto a base a human moved, so
	// the commit about to be pushed is not the one this record measured.
	attest(context, { publishedCommit: MOVED, records: first.records });

	const again = await boundary(context, { cwd, candidateCommit: CANDIDATE });

	assert.equal(again.reused, false, "a record of a different tree was reused as this publication's evidence");
	assert.equal(ranTimes(cwd), 2);
});

test("a declaration whose advisory checks all feed a later phase owes the boundary nothing", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);

	const answer = await boundary(context, { cwd, checks: DECLARED.slice(0, 2) });

	assert.deepEqual(answer.names, []);
	assert.deepEqual(answer.records, []);
	assert.equal(answer.reused, false);
	assert.equal(ranTimes(cwd), 0);
});

test("a deferred check that fails is evidence and blocks nothing (§8.2)", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);
	const failing = [DECLARED[0], { ...DECLARED[2], command: "echo ran >> ran; echo survivors; exit 1" }];

	const answer = await boundary(context, { cwd, checks: failing });

	assert.deepEqual(
		answer.records.map((record) => [record.name, record.result]),
		[["e2e", "failed"]],
	);
	// And it is still evidence: the publication goes on to attest it, which is
	// what "records evidence and never blocks" means at this boundary too.
	assert.match(readArtifact(context.store, answer.records[0].output).toString("utf8"), /survivors/);
});

test("a deferred check nobody could run is evidence too, and blocks nothing either (§8.2)", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);
	// Exit 9 is outside the declared contract, so §8.2's fault attribution calls
	// it `unrunnable` — a broken check rather than a failing one. The boundary
	// returns it as a record like any other: it never reads the runner's verdict,
	// because an advisory set has no required check to base one on.
	const broken = [DECLARED[0], { ...DECLARED[2], command: "echo ran >> ran; exit 9" }];

	const answer = await boundary(context, { cwd, checks: broken });

	assert.deepEqual(
		answer.records.map((record) => [record.name, record.result, record.reason]),
		[["e2e", "unrunnable", "unexpected-exit-code"]],
	);
});

test("#211: an attestation whose bytes are gone refuses rather than re-measuring into a conflict (§4.5)", async (t) => {
	const context = await reviewed(t);
	const cwd = workspace(t);
	const first = await boundary(context, { cwd });
	attest(context, { publishedCommit: CANDIDATE, records: first.records });

	// §12.2's horizon on a long-idle run, a tombstone, a failed re-hash. The
	// attestation write has resolved, so its document cannot be rebuilt from a
	// second measurement — §4.5 keys it by content, and two runs of one check
	// differ in a duration. Re-measuring here would meet a payload conflict at a
	// point where the branch may already be pushed, so the storage failure is
	// named instead, and nothing is re-run in the meantime.
	context.store.transaction((tx) => tx.db.prepare("DELETE FROM artifact").run());

	await assert.rejects(
		() => boundary(context, { cwd }),
		(error) => error.name === "FactoryPipelineError" && error.reason === "attestation-unreadable",
	);
	assert.equal(ranTimes(cwd), 1);
});
