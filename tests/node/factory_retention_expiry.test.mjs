import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

import { probeArtifactBlob, writeArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import { recordArtifact, resolveArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { holdControllerLease } from "../../factory/lib/controller/lease-guard.mjs";
import { requestEffect, resolveEffect } from "../../factory/lib/effects/records.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { applyExpiry, planExpiry } from "../../factory/lib/retention/expiry.mjs";
import { DAY_MS } from "../../factory/lib/retention/horizon.mjs";
import { CONTROLLER_STREAM, HEARTBEAT_STREAM, runStream } from "../../factory/lib/state/events.mjs";
import { CONTROLLER_LEASE_TTL_MS, openLeases } from "../../factory/lib/state/leases.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import {
	attemptLaunched,
	heartbeat,
	manualTimers,
	openTestStore,
	refusalOf,
	runEnded,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §12's subtractive half: **the tier-1 horizon, the pins, and expiry**.
 *
 * Expiry is purely subtractive (§12.3) — the tier-2 digest is maintained
 * continuously, so nothing here ever writes the history it is about to delete.
 */

const AT = 1_770_000_000_000;
/** One run of count budget and thirty days, so a test can age a run out deliberately. */
const RETENTION = Object.freeze({ fullDetailRuns: 1, fullDetailDays: 30 });

/** A store, a controller holding its lease, and nothing else. */
async function openHeldStore(t) {
	const store = await openTestStore(t);
	const timers = manualTimers();
	const leases = openLeases(store, { now: () => AT });
	const hold = holdControllerLease({ store, leases, timers: timers.api });
	hold.recordStartupReconcile();
	return { store, hold };
}

/** A run that started and ended at the given moment, with one attempt in it. */
function endedRun(store, { startedAt, ticket = 90 }) {
	const run = newUlid();
	store.append(runStarted(run, { at: startedAt }));
	store.append(attemptLaunched(run, ticket, 1, { at: startedAt + 1000 }));
	store.append(runEnded(run, { at: startedAt + 2000 }));
	return run;
}

/** An artifact this run produced, in the store and in the ledger. */
function produce(store, run, content, { ticket = 90 } = {}) {
	const written = writeArtifactBlob(store.storeDir, content);
	return store.transaction((tx) =>
		recordArtifact(tx, { ...written, mediaType: "text/plain", run, ticket, at: AT }),
	);
}

test("an ended run past the horizon loses its stream whole and its tier-1 projections with it (§12.2, §12.3)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	const recent = endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });

	const report = applyExpiry(store, { retention: RETENTION, hold, at: AT });

	assert.deepEqual(
		report.expired.map((entry) => entry.run),
		[ancient],
	);
	assert.deepEqual(store.readEvents({ stream: runStream(ancient) }), [], "the run stream survived expiry");
	assert.equal(store.readRun(ancient), null, "the tier-1 run projection kept the expired run");
	assert.deepEqual(store.readTicketExecutions(ancient), []);
	assert.deepEqual(store.readAttempts({ runId: ancient }), []);

	// The run inside the horizon is untouched, detail and all.
	assert.notEqual(store.readRun(recent), null);
	assert.equal(store.readEvents({ stream: runStream(recent) }).length, 3);
});

test("a controller that lost the lease deletes nothing, and concedes rather than answering false (§14.6, §12.6)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	produce(store, ancient, "the evidence a successor still needs");

	// A successor took the row over. The in-memory latch still says held — a
	// successor adopts without asking — so only the compare inside the write's own
	// transaction can catch it, which is the whole reason `hold.transaction` exists.
	openLeases(store, { now: () => AT + CONTROLLER_LEASE_TTL_MS + 1 }).acquire({
		name: "controller",
		identity: { host: "successor", pid: 9999 },
	});

	const refusal = refusalOf(() => applyExpiry(store, { retention: RETENTION, hold, at: AT }));

	assert.equal(refusal.reason, "lease-lost");
	assert.equal(hold.lost, true);
	assert.equal(store.readEvents({ stream: runStream(ancient) }).length, 3, "a stale controller deleted a run stream");
	assert.notEqual(store.readRun(ancient), null);
	assert.deepEqual(store.readEvents({ stream: CONTROLLER_STREAM, kind: "run.expired" }), []);
});

test("the tier-2 digest, the transcript pointers, and the ticket index outlive the detail (§12.3, §12.9)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	store.append({
		kind: "attempt.correlated",
		source: "controller",
		run: ancient,
		ticket: 90,
		phase: "implement",
		attempt: `${ancient}-t90-a1`,
		occurredAt: AT - 60 * DAY_MS + 1500,
		observedAt: AT - 60 * DAY_MS + 1500,
		payload: {
			runtime: "claude",
			transcript: { kind: "session-id", value: "abc-123", captured_at: AT - 60 * DAY_MS },
		},
	});

	applyExpiry(store, { retention: RETENTION, hold, at: AT });

	const digest = store.readRunDigest(ancient);
	assert.notEqual(digest, null, "the permanent digest expired with the detail");
	assert.equal(digest.end_reason, "drained");
	assert.deepEqual(digest.transcripts[`${ancient}-t90-a1`], {
		worker_kind: "claude",
		transcript_kind: "session-id",
		transcript_value: "abc-123",
		captured_at: AT - 60 * DAY_MS,
	});
	assert.deepEqual(
		store.readTicketIndex(90).map((row) => row.run_id),
		[ancient],
	);
});

test("the expiry record lands on the controller stream, naming the run it deleted (§12.2)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	const artifact = produce(store, ancient, "checks: 3 passed");

	applyExpiry(store, { retention: RETENTION, hold, at: AT });

	const [recorded] = store.readEvents({ stream: CONTROLLER_STREAM, kind: "run.expired" });
	assert.equal(recorded.run, null, "the record rode the stream it was deleting");
	assert.equal(recorded.source, "controller");
	assert.deepEqual(recorded.payload, {
		run_id: ancient,
		bytes_reclaimed: artifact.bytes,
		artifact_count: 1,
		at: AT,
	});
});

test("expiry reports what each run's transaction actually dropped", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	const settled = requestEffect(store, {
		operation: "worktree-delete",
		operand: "t90-a1",
		run: ancient,
		ticket: 90,
		phase: "cleanup",
		actor: "controller",
		fencingGeneration: hold.fencingGeneration,
		payload: { worktree: "t90-a1" },
	});
	resolveEffect(store, {
		key: settled.key,
		actor: "controller",
		fencingGeneration: hold.fencingGeneration,
		result: { gone: true },
	});

	const [expired] = applyExpiry(store, { retention: RETENTION, hold, at: AT }).expired;

	// §12.2: effect rows expire with their run, and the derived projections go
	// with the stream while the permanent ones stay.
	assert.equal(expired.effects_deleted, 1);
	assert.deepEqual(expired.projections_cleared, { run: 1, ticket_execution: 1, attempt: 1 });
	assert.equal(expired.events_deleted, 5, "the whole stream, and only it");
});

test("an operator-driven pass records itself as the operator's (§12.6, §12.8)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	endedRun(store, { startedAt: AT - 60 * DAY_MS });
	// Between the two runs, so it falls behind the surviving run's first record
	// and is what the front-truncation takes (§12.2).
	store.append(heartbeat({ at: AT - 60 * DAY_MS + 500 }));
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	store.append(heartbeat({ at: AT - DAY_MS + 500 }));

	// The second caller §12.6 names is `cleanup-execute`, which already holds the
	// lease. Its records are the operator's, not a controller's.
	applyExpiry(store, { retention: RETENTION, hold, at: AT, actor: "operator:cleanup-execute" });

	assert.equal(store.readEvents({ stream: CONTROLLER_STREAM, kind: "run.expired" })[0].source, "operator");
	assert.equal(store.readEvents({ stream: CONTROLLER_STREAM, kind: "stream.truncated" })[0].source, "operator");
});

test("an expired artifact resolves to a dated tombstone, never to an unknown digest (§12.5, §14.31)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	const artifact = produce(store, ancient, "the reviewer's verdict");

	const report = applyExpiry(store, { retention: RETENTION, hold, at: AT });

	assert.equal(report.blobs_removed, 1, "the bytes are still on disk");
	assert.equal(probeArtifactBlob(store.storeDir, artifact).present, false);

	const resolved = resolveArtifact(store, artifact);
	assert.equal(resolved.status, "unavailable");
	assert.equal(resolved.reason, "retention-expired");
	assert.equal(resolved.expired_at, AT);
	assert.equal(resolved.bytes, artifact.bytes);
	assert.equal(resolved.retention_class, "tier-1");
	assert.deepEqual(resolved.producer, { run: ancient, ticket: 90, attempt: null });

	// Expired and never-existed must never look alike (§12.5).
	const unknown = resolveArtifact(store, { digest: "0".repeat(64) });
	assert.equal(unknown.status, "unknown");
	assert.equal(unknown.reason, "never-recorded");
});

test("a pinned run stays in tier 1 however old it is, and the plan says which pin holds it (§12.4)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	requestEffect(store, {
		operation: "worktree-delete",
		operand: "t90-a1",
		run: ancient,
		ticket: 90,
		phase: "cleanup",
		actor: "controller",
		fencingGeneration: hold.fencingGeneration,
		payload: { worktree: "t90-a1" },
	});

	const plan = planExpiry(store, { retention: RETENTION, at: AT });
	assert.deepEqual(plan.expiring, []);
	assert.deepEqual(
		plan.held.map((entry) => [entry.run, entry.reason, entry.pins.map((pin) => pin.pin)]),
		[[ancient, "pinned", ["unresolved-effect"]]],
	);

	applyExpiry(store, { retention: RETENTION, hold, at: AT });
	assert.notEqual(store.readRun(ancient), null, "a pinned run was expired");
});

test("a run that has not ended is never expired, whatever its age (§12.6)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const orphan = newUlid();
	store.append(runStarted(orphan, { at: AT - 90 * DAY_MS }));
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });

	const report = applyExpiry(store, { retention: RETENTION, hold, at: AT });

	assert.deepEqual(report.expired, []);
	assert.deepEqual(
		report.held.map((entry) => [entry.run, entry.reason]),
		[[orphan, "live"]],
	);
	assert.notEqual(store.readRun(orphan), null);
});

test("heartbeats front-truncate to wherever tier 1 now starts — one knob, not two (§12.2)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	store.append(heartbeat({ at: AT - 60 * DAY_MS + 500 }));
	const recent = endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });
	store.append(heartbeat({ at: AT - DAY_MS + 500 }));

	applyExpiry(store, { retention: RETENTION, hold, at: AT });

	const beats = store.readEvents({ stream: HEARTBEAT_STREAM });
	assert.equal(beats.length, 1, "a heartbeat older than the surviving detail was kept");
	const [firstRetained] = store.readEvents({ stream: runStream(recent) });
	assert.equal(beats[0].seq > firstRetained.seq, true);

	// §4.2: the boundary is recorded, and on the indefinite stream.
	const [marker] = store.readEvents({ stream: CONTROLLER_STREAM, kind: "stream.truncated" });
	assert.equal(marker.payload.stream, HEARTBEAT_STREAM);
	assert.equal(store.verifyJournal().ok, true, `the journal stopped verifying after expiring ${ancient}`);
});

test("the factory never deletes a transcript — expiry keeps the pointer and does not touch the file (§12.9, §14.29)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const ancient = endedRun(store, { startedAt: AT - 60 * DAY_MS });
	endedRun(store, { startedAt: AT - DAY_MS, ticket: 91 });

	// A transcript where a harness keeps one: the factory persists a *pointer* to
	// it and nothing else, so this file is another component's storage.
	const transcript = join(mkdtempSync(join(tmpdir(), "factory-transcript-")), "session.jsonl");
	t.after(() => rmSync(dirname(transcript), { recursive: true, force: true }));
	writeFileSync(transcript, '{"turn":1}\n');
	store.append({
		kind: "attempt.correlated",
		source: "controller",
		run: ancient,
		ticket: 90,
		phase: "implement",
		attempt: `${ancient}-t90-a1`,
		occurredAt: AT - 60 * DAY_MS + 1500,
		observedAt: AT - 60 * DAY_MS + 1500,
		payload: {
			runtime: "pi",
			transcript: { kind: "path", value: transcript, captured_at: AT - 60 * DAY_MS },
		},
	});

	applyExpiry(store, { retention: RETENTION, hold, at: AT });

	assert.equal(existsSync(transcript), true, "expiry reached into a harness's own storage");
	assert.equal(store.readRunDigest(ancient).transcripts[`${ancient}-t90-a1`].transcript_value, transcript);
});

test("retention reaches outside the database only through a blob's address, and schedules nothing (§14.29, §14.30)", () => {
	const modules = factorySources().filter(([path]) => path.includes(`${sep}retention${sep}`));

	assert.equal(modules.length, 3, "the retention modules moved; this check stopped looking at them");
	for (const [path, source] of modules) {
		assert.equal(
			/from\s+"node:fs/.test(source),
			false,
			`${path} imports the filesystem directly; expiry's only reach outside the database is a blob's own address`,
		);
		// §14.30: never on a timer. There is no interval here to be started, and
		// nothing to start one with.
		assert.equal(/setInterval|setTimeout/.test(source), false, `${path} schedules expiry`);
	}
});

test("expiry is never size-triggered: bytes under the horizon are reported and reclaim nothing (§12.10, §14.30)", async (t) => {
	const { store, hold } = await openHeldStore(t);
	const recent = endedRun(store, { startedAt: AT - DAY_MS });
	produce(store, recent, "x".repeat(5_000_000));

	const plan = planExpiry(store, { retention: RETENTION, at: AT });

	assert.deepEqual(plan.expiring, []);
	assert.equal(plan.reclaimable_bytes, 0);
	assert.equal(
		plan.bytes.by_run.find((entry) => entry.run_id === recent).bytes,
		5_000_000,
		"the bytes were not even reported",
	);
	assert.deepEqual(applyExpiry(store, { retention: RETENTION, hold, at: AT }).expired, []);
});
