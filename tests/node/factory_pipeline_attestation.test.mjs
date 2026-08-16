import test from "node:test";
import assert from "node:assert/strict";

import { readArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import {
	ATTESTATION_SCHEMA_VERSION,
	attestationSummary,
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
				checks: CHECKS,
				integration: INTEGRATION,
			}),
		).reason,
		"attestation-incomplete",
	);
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
