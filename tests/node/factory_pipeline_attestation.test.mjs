import test from "node:test";
import assert from "node:assert/strict";

import { readArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import {
	ATTESTATION_SCHEMA_VERSION,
	attestationSummary,
	attestedDocument,
	buildAttestation,
	writeAttestation,
} from "../../factory/lib/pipeline/attestation.mjs";
import { resolveStage } from "../../factory/lib/pipeline/stages.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import {
	attemptLaunched,
	FIXED_NOW,
	manualTimers,
	openTestStore,
	refusalOf,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §8.7: the per-attempt immutable attestation — the published commit, every
 * check with its required flag, **both** review verdicts with blocking and
 * advisory findings, and the before/after HEAD guard — referenced by digest and
 * never embedded.
 */

const TICKET = 42;
const COMMIT = "a".repeat(40);

const CHECKS = Object.freeze([
	{ name: "unit", command: "uv run pytest", severity: "required", result: "passed", exit_code: 0, duration_ms: 4200 },
	{ name: "lint", command: "ruff check", severity: "required", result: "passed", exit_code: 0, duration_ms: 300 },
	{ name: "e2e", command: "npm run e2e", severity: "advisory", result: "failed", exit_code: 1, duration_ms: 90_000 },
]);

/**
 * The `checks` block those records answer. §8.7's list is held complete against
 * the declaration (#211): two sets measure the published commit at two moments,
 * so "every declared check exactly once" is asserted rather than left as
 * arithmetic the caller cannot get wrong.
 */
const DECLARED = Object.freeze([
	{ name: "unit", command: "uv run pytest", timeout: 900, severity: "required", expectedFailureExitCodes: [1], feeds: [] },
	{ name: "lint", command: "ruff check", timeout: 120, severity: "required", expectedFailureExitCodes: [1], feeds: [] },
	{ name: "e2e", command: "npm run e2e", timeout: 900, severity: "advisory", expectedFailureExitCodes: [1], feeds: [] },
]);

const INTEGRATION = Object.freeze({
	rebased: true,
	evidence_ref: "refs/factory/evidence/x",
	evidence_sha: "b".repeat(40),
	commits: [COMMIT],
});

function finding(severity, statement) {
	return { severity, statement, citation: "§7.4", kind: "correctness" };
}

/** A ticket execution whose fan-out has already resolved both axes (§8.4). */
async function reviewed(t, { axes = null } = {}) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const hold = holdControllerLease({ store, leases: openLeases(store, { now: () => FIXED_NOW }), timers: timers.api });
	const opened = runStarted();
	const run = opened.run;
	const attempt = `${run}-t${TICKET}-a1`;

	store.append(opened);
	hold.recordStartupReconcile();
	hold.adopt(run);
	store.append(attemptLaunched(run, TICKET, 1, { at: FIXED_NOW }));

	const resolved =
		axes ??
		[
			{
				ordinal: 2,
				detail: {
					axis: "review-standards",
					profile: "builder",
					try: 1,
					verdict: "approved",
					findings: [finding("advisory", "this helper could be inlined")],
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
			{
				ordinal: 3,
				detail: {
					axis: "review-spec",
					profile: "builder",
					try: 1,
					verdict: "approved",
					findings: [],
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
		];

	for (const axis of resolved) {
		store.append(attemptLaunched(run, TICKET, axis.ordinal, { at: FIXED_NOW, phase: "review", role: "review" }));
		resolveStage(store, {
			hold,
			run,
			ticket: TICKET,
			phase: "review",
			attempt: `${run}-t${TICKET}-a${axis.ordinal}`,
			outcome: axis.outcome ?? "completed",
			detail: axis.detail,
			actor: "controller",
			at: FIXED_NOW,
		});
	}

	return { store, hold, run, attempt };
}

/** Everything §8.7 records, as one fixture — read by both doors into it. */
function attesting({ run, attempt }, overrides = {}) {
	return {
		run,
		ticket: TICKET,
		attempt,
		publishedCommit: COMMIT,
		branch: `factory/t${TICKET}/a${attempt}`,
		baseCommit: "c".repeat(40),
		packageRevision: "d".repeat(64),
		declared: DECLARED,
		checks: CHECKS,
		integration: INTEGRATION,
		...overrides,
	};
}

function build(store, context, overrides = {}) {
	return buildAttestation(store, attesting(context, overrides));
}

test("the attestation records §8.7's whole list, from durable state (§8.7)", async (t) => {
	const context = await reviewed(t);

	const document = build(context.store, context);

	assert.equal(document.schema_version, ATTESTATION_SCHEMA_VERSION);
	assert.deepEqual(document.identity, { run: context.run, ticket: TICKET, attempt: context.attempt });
	assert.equal(document.published.commit, COMMIT);
	assert.equal(document.published.package_revision, "d".repeat(64));
	assert.deepEqual(document.integration, INTEGRATION);

	// Every check, with its command, exit code, duration, and required flag —
	// advisory ones included, which is the one place §8.2's "record evidence and
	// never block" actually lands.
	assert.deepEqual(
		document.checks.map((check) => [check.name, check.command, check.exit_code, check.duration_ms, check.required]),
		[
			["unit", "uv run pytest", 0, 4200, true],
			["lint", "ruff check", 0, 300, true],
			["e2e", "npm run e2e", 1, 90_000, false],
		],
	);

	// **Both** verdicts, each with its guard result.
	assert.deepEqual(
		document.review.verdicts.map((axis) => [axis.axis, axis.verdict, axis.guard.mutated]),
		[
			["review-standards", "approved", false],
			["review-spec", "approved", false],
		],
	);
});

test("each verdict names the boundary it was rendered against (§8.7, §14.13, #165)", async (t) => {
	const boundary = { base_commit: "e".repeat(40), reviewed_commit: COMMIT };
	const context = await reviewed(t, {
		axes: [
			{
				ordinal: 2,
				detail: {
					axis: "review-standards",
					profile: "builder",
					try: 1,
					verdict: "approved",
					findings: [],
					...boundary,
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
			{
				ordinal: 3,
				detail: {
					axis: "review-spec",
					profile: "builder",
					try: 1,
					verdict: "approved",
					findings: [],
					...boundary,
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
		],
	});

	const document = build(context.store, context);

	// The scope of an approval is part of the approval: a repair chain's verdicts
	// gate the whole published diff, and the artifact says which diff that was.
	assert.deepEqual(
		document.review.verdicts.map((axis) => [axis.axis, axis.base_commit, axis.reviewed_commit]),
		[
			["review-standards", boundary.base_commit, boundary.reviewed_commit],
			["review-spec", boundary.base_commit, boundary.reviewed_commit],
		],
	);
});

test("blocking findings live in the artifact and never in the summary (§8.7)", async (t) => {
	const context = await reviewed(t, {
		axes: [
			{
				ordinal: 2,
				detail: {
					axis: "review-standards",
					verdict: "rejected",
					findings: [finding("blocking", "this swallows an error"), finding("advisory", "rename this")],
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
			{
				ordinal: 3,
				detail: {
					axis: "review-spec",
					verdict: "approved",
					findings: [],
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
		],
	});

	const document = build(context.store, context);

	assert.deepEqual(document.review.blocking.map((f) => f.statement), ["this swallows an error"]);
	assert.deepEqual(document.review.advisory.map((f) => f.statement), ["rename this"]);

	const summary = attestationSummary(document);
	assert.match(summary, /1 advisory finding/);
	assert.doesNotMatch(summary, /swallows an error|blocking/);
});

test("a retried axis leaves every attempt on the record, not only the survivor (§8.7)", async (t) => {
	const context = await reviewed(t, {
		axes: [
			{ ordinal: 2, outcome: "dead-worker", detail: { axis: "review-standards", try: 1, findings: [] } },
			{
				ordinal: 3,
				detail: {
					axis: "review-standards",
					try: 2,
					verdict: "approved",
					findings: [],
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
			{
				ordinal: 4,
				detail: {
					axis: "review-spec",
					verdict: "approved",
					findings: [],
					attestation: { mutated: false, reasons: [], before_head: COMMIT, after_head: COMMIT, leftovers: [] },
				},
			},
		],
	});

	const document = build(context.store, context);

	assert.deepEqual(
		document.review.verdicts.map((axis) => [axis.axis, axis.outcome]),
		[
			["review-standards", "dead-worker"],
			["review-standards", "completed"],
			["review-spec", "completed"],
		],
	);
});

test("an attestation is refused rather than written with a hole in it (§14.16)", async (t) => {
	const context = await reviewed(t);

	assert.equal(refusalOf(() => build(context.store, context, { publishedCommit: null })).reason, "attestation-incomplete");
	assert.equal(refusalOf(() => build(context.store, context, { checks: [] })).reason, "attestation-incomplete");

	// A ticket execution with no review stage at all: the attestation would claim
	// a review nobody ran.
	const bare = await openTestStore(t);
	bare.append(runStarted(context.run, { at: FIXED_NOW }));
	assert.equal(
		refusalOf(() =>
			buildAttestation(bare, {
				run: context.run,
				ticket: TICKET,
				attempt: context.attempt,
				publishedCommit: COMMIT,
				branch: "factory/t42/a1",
				baseCommit: "c".repeat(40),
				declared: DECLARED,
				checks: CHECKS,
				integration: INTEGRATION,
			}),
		).reason,
		"attestation-incomplete",
	);
});

test("#211: the check list is the declaration's, in the declaration's order, whatever order the sets arrive in", async (t) => {
	const context = await reviewed(t);

	// Two sets measure the published commit at two moments — §8.2's `verify`
	// selection and its `publication` one — and the publication path concatenates
	// them, so arrival order is an accident of composition. Here the deferred
	// check arrives first, and the document must still read as the config does:
	// two attestations of one commit that differ only in check order would show a
	// reordering as a change.
	const document = build(context.store, context, { checks: [CHECKS[2], CHECKS[0], CHECKS[1]] });

	assert.deepEqual(
		document.checks.map((check) => check.name),
		["unit", "lint", "e2e"],
	);
	// And `required` comes off the **declaration**, not off whatever severity the
	// record happened to carry.
	assert.deepEqual(
		document.checks.map((check) => check.required),
		[true, true, false],
	);
});

test("#211: an attestation short of a declared check is refused rather than published (§8.7, §14.16)", async (t) => {
	const context = await reviewed(t);

	// The failure mode the assembly exists to stop: the publication boundary's set
	// never ran, or its records were dropped between the run and the write, and
	// the document goes out claiming a set nobody completed.
	const refusal = refusalOf(() => build(context.store, context, { checks: CHECKS.slice(0, 2) }));

	assert.equal(refusal.reason, "attestation-incomplete");
	assert.equal(refusal.details.expected, "e2e");
	assert.match(refusal.message, /e2e/);
});

test("#211: the assembly refuses a duplicate result, a stray one, and no declaration at all (§8.7)", async (t) => {
	const context = await reviewed(t);

	// Two records for one check are two answers to what that check said at the
	// published commit.
	const duplicated = refusalOf(() => build(context.store, context, { checks: [...CHECKS, CHECKS[2]] }));
	assert.equal(duplicated.reason, "attestation-incomplete");
	assert.equal(duplicated.details.found, "e2e");

	// A result for a check the config does not declare is a set nobody can
	// reproduce from the repository.
	const stray = refusalOf(() =>
		build(context.store, context, { checks: [...CHECKS, { ...CHECKS[2], name: "undeclared" }] }),
	);
	assert.equal(stray.reason, "attestation-incomplete");
	assert.deepEqual(stray.details.found, ["undeclared"]);

	// And a document held complete against nothing is not held complete at all.
	const undeclared = refusalOf(() => build(context.store, context, { declared: [] }));
	assert.equal(undeclared.reason, "attestation-incomplete");
	assert.equal(undeclared.details.at, "declared");
});

test("#211: a written attestation is read back for the boundary that has to reuse it (§8.7)", async (t) => {
	const context = await reviewed(t);
	const wrote = { hold: context.hold, actor: "controller", at: FIXED_NOW };

	assert.equal(attestedDocument(context.store, { run: context.run, ticket: TICKET, attempt: context.attempt }), null);

	const written = writeAttestation(context.store, { ...wrote, ...attesting(context) });
	const read = attestedDocument(context.store, { run: context.run, ticket: TICKET, attempt: context.attempt });

	// Found through the effect the write composed and the ledger that holds the
	// bytes — the same key, not a second spelling of it.
	assert.deepEqual(read, JSON.parse(JSON.stringify(written.document)));
	assert.equal(read.published.commit, COMMIT);
});

test("#211: an attestation written but unreadable refuses by name rather than inviting a re-measure (§4.5, §8.7)", async (t) => {
	const context = await reviewed(t);
	writeAttestation(context.store, { hold: context.hold, actor: "controller", at: FIXED_NOW, ...attesting(context) });

	// The blob goes, the effect stays: §12.2's horizon on a long-idle run, a
	// tombstone, a failed re-hash. Treating that as "nobody wrote one" would send
	// the publication boundary off to measure again, and §4.5 keys that write by
	// content — two runs of one check differ in a duration, so the rebuilt
	// document would meet a payload conflict on a branch that may already be out
	// there. The storage failure is named instead.
	context.store.transaction((tx) => tx.db.prepare("DELETE FROM artifact").run());

	const refusal = refusalOf(() =>
		attestedDocument(context.store, { run: context.run, ticket: TICKET, attempt: context.attempt }),
	);

	assert.equal(refusal.reason, "attestation-unreadable");
	assert.match(refusal.message, /cannot be read back/);
});

test("it is written once, referenced by digest, and re-entering returns the same reference (§12.1, §14.28)", async (t) => {
	const context = await reviewed(t);
	const wrote = { hold: context.hold, actor: "controller", at: FIXED_NOW };

	const first = writeAttestation(context.store, { ...wrote, ...attesting(context) });
	const again = writeAttestation(context.store, { ...wrote, ...attesting(context) });

	assert.equal(first.outcome, "written");
	assert.equal(again.outcome, "already-written");
	assert.equal(again.reference.digest, first.reference.digest);
	assert.equal(first.reference.media_type, "application/json");
	assert.equal(Object.hasOwn(first.reference, "path"), false, "an artifact was referenced by path");

	// The bytes are in the store, and they are the document.
	assert.deepEqual(
		JSON.parse(readArtifactBlob(context.store.storeDir, first.reference).toString("utf8")),
		JSON.parse(JSON.stringify(first.document)),
	);

	// One effect, of the kind §4.5 names for an attestation specifically.
	assert.deepEqual(
		context.store
			.read((db) => db.prepare("SELECT operation, phase, state FROM effect").all())
			.map((row) => ({ ...row })),
		[{ operation: "attestation-write", phase: "integrate", state: "resolved" }],
	);
});

test("the summary names what a human reads on the PR and in the ticket comment (§8.7)", async (t) => {
	const context = await reviewed(t);

	const summary = attestationSummary(build(context.store, context));

	assert.match(summary, /2 of 2 required check\(s\) green at aaaaaaaaaaaa/);
	assert.match(summary, /1 advisory recorded/);
	assert.match(summary, /review-standards approved, review-spec approved/);
});

test("the summary counts what the checks *did*, not how many were required (§8.7, §14.16)", async (t) => {
	const context = await reviewed(t);

	// The sentence is the human-facing half of §7.5's PR body and §8.9's ticket
	// comment, and §8.7's whole point is that "the controller verified this" is a
	// checkable claim. A count of how many checks carried the `required` flag is
	// not that claim: it prints "green" over a red set, and reads exactly as
	// convincingly.
	const summary = attestationSummary(
		build(context.store, context, {
			declared: DECLARED.slice(0, 2),
			checks: [
				{ name: "unit", command: "uv run pytest", severity: "required", result: "failed", exit_code: 1, duration_ms: 10 },
				{ name: "lint", command: "ruff check", severity: "required", result: "passed", exit_code: 0, duration_ms: 10 },
			],
		}),
	);

	assert.match(summary, /1 of 2 required check\(s\) green/);
	assert.match(summary, /red: unit/);
	assert.doesNotMatch(summary, /2 of 2/);
});
