import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { WORKER_WRITABLE_OUTCOMES } from "../../factory/lib/domain/vocabulary.mjs";
import { MAX_OUTBOX_BYTES, OUTBOX_SCHEMA_VERSION, OUTBOX_STATES, readOutbox } from "../../factory/lib/worker/outbox.mjs";
import { makeAgentDir } from "./helpers/factory-store.mjs";

/**
 * §6.6: the outbox is the authoritative **domain** result, and the reader's
 * verdict is a closed set of states rather than a boolean — because
 * silent-completion, wrote-but-hung, and invalid-result have to stay distinct
 * outcomes, and they are distinguished here.
 */

const IDENTITY = Object.freeze({
	run: "01JRUN0000000000000000000A",
	ticket: 42,
	phase: "implement",
	attempt: "01JRUN0000000000000000000A-t42-a1",
});

function outbox(t, content) {
	const dir = join(makeAgentDir(t), "attempts");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "outbox.json");
	if (content !== undefined) writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
	return path;
}

function completed(overrides = {}) {
	return {
		schema_version: OUTBOX_SCHEMA_VERSION,
		status: "completed",
		...IDENTITY,
		summary: "did the thing",
		commits: ["a1b2c3d"],
		...overrides,
	};
}

// ── The five states ──────────────────────────────────────────────────────────

test("the reader's verdicts are a closed set", () => {
	assert.deepEqual(OUTBOX_STATES, ["absent", "unreadable", "invalid", "foreign", "valid"]);
});

test("no file at turn-end and a present-but-invalid file are different answers (§6.6)", (t) => {
	assert.equal(readOutbox(outbox(t), IDENTITY).state, "absent");

	// The expected shape of a worker that wrote in place instead of
	// temp-and-rename — which is exactly what "written atomically" prevents.
	const partial = readOutbox(outbox(t, '{"schema_version": 1, "status": "comp'), IDENTITY);
	assert.equal(partial.state, "invalid");
	assert.match(partial.problems[0], /not JSON/);
});

test("a valid record is normalised down to §6.6's own fields", (t) => {
	const read = readOutbox(outbox(t, completed({ smuggled: "unreviewed prose on its way to a monitor" })), IDENTITY);

	assert.equal(read.state, "valid");
	assert.equal(read.record.status, "completed");
	assert.deepEqual([...read.record.commits], ["a1b2c3d"]);
	assert.equal(read.record.smuggled, undefined, "whatever a worker adds does not ride into an event payload");
});

// ── The status set is the worker-writable three, and only those ──────────────

test("a worker may not write a controller-derived outcome", (t) => {
	for (const status of ["timeout", "automation-failure", "dead-worker", "cancelled", "wrote-but-hung"]) {
		const read = readOutbox(outbox(t, completed({ status })), IDENTITY);
		assert.equal(read.state, "invalid", `${status} was accepted from a worker`);
		assert.ok(read.problems.some((problem) => problem.includes("worker-writable")));
	}

	for (const status of WORKER_WRITABLE_OUTCOMES) {
		const record = completed({ status, reason_class: "product-ambiguity", question: "which?", explanation: "why" });
		assert.equal(readOutbox(outbox(t, record), IDENTITY).state, "valid", `${status} was refused`);
	}
});

test("each worker-writable status carries what §6.6 says it carries", (t) => {
	const cases = [
		[{ status: "completed", commits: undefined }, /commit SHAs/],
		[{ status: "needs-human", reason_class: undefined, question: "which?" }, /reason class/],
		[{ status: "needs-human", reason_class: "product-ambiguity", question: "  " }, /exact question/],
		[{ status: "worker-failed", explanation: undefined }, /classification and an explanation/],
	];

	for (const [overrides, expected] of cases) {
		const read = readOutbox(outbox(t, completed(overrides)), IDENTITY);
		assert.equal(read.state, "invalid");
		assert.ok(read.problems.some((problem) => expected.test(problem)), `${JSON.stringify(overrides)}: ${read.problems}`);
	}
});

test("the schema version is checked, so a future worker's record is invalid rather than misread", (t) => {
	const read = readOutbox(outbox(t, completed({ schema_version: 2 })), IDENTITY);
	assert.equal(read.state, "invalid");
	assert.match(read.problems[0], /schema_version/);
});

// ── Correlation is mandatory (§6.5) ──────────────────────────────────────────

test("a record that does not echo the minted tuple is foreign, not merely invalid", (t) => {
	const read = readOutbox(outbox(t, completed({ attempt: "01JRUN0000000000000000000A-t42-a2" })), IDENTITY);

	// Distinct from `invalid` because the two are different failures: an invalid
	// record is a worker that wrote badly, and this is two attempts' results
	// having crossed — §6.5's automation failure.
	assert.equal(read.state, "foreign");
	assert.match(read.problems[0], /attempt echoes/);
});

test("the minted tuple travels with derived fields beside it, and only the four are compared", (t) => {
	// `requireAttemptIdentity` hands back the tuple **plus** its ordinal, and a
	// comparison over every key of that object would call every valid outbox
	// foreign — the four slots §6.5 names are the whole of the check.
	const read = readOutbox(outbox(t, completed()), { ...IDENTITY, ordinal: 1 });

	assert.equal(read.state, "valid");
});

test("a missing tuple slot is invalid: correlation is never optional", (t) => {
	for (const field of ["run", "ticket", "phase", "attempt"]) {
		const read = readOutbox(outbox(t, completed({ [field]: undefined })), IDENTITY);
		assert.equal(read.state, "invalid", `a record with no ${field} was accepted`);
		assert.ok(read.problems.some((problem) => problem.startsWith(field)));
	}
});

// ── Large output belongs in artifacts (§6.6, §12.1) ──────────────────────────

test("an artifact reference names a digest, never a path", (t) => {
	const byDigest = completed({
		evidence: [{ algorithm: "sha256", digest: "a".repeat(64), media_type: "text/plain", bytes: 12 }],
	});
	assert.equal(readOutbox(outbox(t, byDigest), IDENTITY).state, "valid");

	const byPath = completed({ evidence: [{ path: "/tmp/log.txt" }] });
	const read = readOutbox(outbox(t, byPath), IDENTITY);
	assert.equal(read.state, "invalid");
	assert.ok(read.problems.some((problem) => /referenced by digest alone/.test(problem)));
});

test("an outbox over the ceiling is invalid rather than read into the controller", (t) => {
	const huge = JSON.stringify(completed({ summary: "x".repeat(MAX_OUTBOX_BYTES) }));
	const read = readOutbox(outbox(t, huge), IDENTITY);

	assert.equal(read.state, "invalid");
	assert.match(read.problems[0], /large output belongs in artifacts/i);
});

test("worker-reported test evidence rides as text and is never parsed into a verdict", (t) => {
	const read = readOutbox(outbox(t, completed({ test_evidence: "12 passed", verdict: "approve" })), IDENTITY);

	assert.equal(read.record.test_evidence, "12 passed");
	assert.equal(read.record.verdict, "approve", "§8.4's reviewer verdict is a field, not an interpretation");
});
