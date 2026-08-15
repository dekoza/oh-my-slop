import test from "node:test";
import assert from "node:assert/strict";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { FactoryStateError } from "../../factory/lib/state/errors.mjs";
import { PROJECTIONS } from "../../factory/lib/state/projections.mjs";
import { openDatabase } from "../../factory/lib/state/sqlite.mjs";
import { openStore, openStoreReadOnly } from "../../factory/lib/state/store.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import {
	attemptLaunched,
	makeAgentDir,
	openTestStore,
	refusalOfAsync,
	runEnded,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §4.4's projections: the five tables the monitor reads, maintained inside the
 * transaction that appends the event, and refused at startup when their head
 * does not match the journal's.
 */

async function storeWithRun(t) {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	return { store, runId };
}

// ── The five, and what they are not (§4.4) ───────────────────────────────────

test("all five projections exist and none of them is an effect or a lease", () => {
	assert.deepEqual(
		PROJECTIONS.map((projection) => projection.name).sort(),
		["attempt", "run", "run_digest", "ticket_execution", "ticket_index"],
	);

	for (const projection of PROJECTIONS) {
		assert.equal(typeof projection.version, "number", `${projection.name} carries no projector version`);
	}
});

test("effect and lease rows are canonical tables, not projections (§4.4)", async (t) => {
	const store = await openTestStore(t);
	const tables = store
		.read((db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
		.map((row) => row.name);

	assert.ok(tables.includes("effect"));
	assert.ok(tables.includes("lease"));

	// The effect table needs a real uniqueness constraint for the database
	// itself to enforce idempotency, and a lease needs CAS against a real row —
	// neither is derivable from the journal, so neither is rebuildable.
	const effectKey = store.read((db) =>
		db.prepare("SELECT name, pk FROM pragma_table_info('effect')").all().filter((column) => column.pk > 0),
	);
	assert.deepEqual(
		effectKey.map((column) => column.name),
		["effect_key"],
	);

	const leaseKey = store.read((db) =>
		db.prepare("SELECT name, pk FROM pragma_table_info('lease')").all().filter((column) => column.pk > 0),
	);
	assert.deepEqual(
		leaseKey.map((column) => column.name),
		["name"],
	);
});

// ── Same transaction, always (§4.4, §14.8) ───────────────────────────────────

test("an event and its projection never commit in separate transactions (§14.8)", async (t) => {
	const agentDir = makeAgentDir(t);
	const store = await openTestStore(t, { repoRoot: makeRepo(t), agentDir });
	const runId = newUlid();

	const reader = openStoreReadOnly({ dbPath: store.dbPath });
	t.after(() => reader.close());
	const seen = () => ({
		events: reader.readEvents({}).length,
		runs: reader.readRun(runId) === null ? 0 : 1,
	});

	assert.deepEqual(seen(), { events: 0, runs: 0 });

	store.transaction(({ appendEvent }) => {
		appendEvent(runStarted(runId));
		// Mid-transaction the reader sees neither half — there is no window in
		// which the journal is ahead of the projection or behind it.
		assert.deepEqual(seen(), { events: 0, runs: 0 });
	});

	assert.deepEqual(seen(), { events: 1, runs: 1 });
});

test("a projector that throws takes its event down with it", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));

	// `run.ended` with an unknown reason is refused by the projector, after the
	// event has been built and inserted.
	assert.throws(() => store.append(runEnded(runId, { endReason: "finished" })), FactoryStateError);

	assert.equal(store.readEvents({}).length, 1);
	assert.equal(store.readRun(runId).lifecycle, "preflight");
	assert.deepEqual(store.head(), { seq: 1, hash: store.readEvents({})[0].hash });
});

test("every projection head advances with every event, to the journal's own head", async (t) => {
	const { store, runId } = await storeWithRun(t);
	store.append(attemptLaunched(runId, 90));

	const head = store.head();
	for (const row of store.projectionHeads()) {
		assert.equal(row.last_seq, head.seq, `${row.name} lags the journal`);
		assert.equal(row.chain_hash, head.hash, `${row.name} carries another chain's hash`);
	}
});

// ── What the projections hold ────────────────────────────────────────────────

test("the run projection carries lifecycle, end reason, and both timestamps", async (t) => {
	const { store, runId } = await storeWithRun(t);

	assert.deepEqual(store.readRun(runId), {
		run_id: runId,
		lifecycle: "preflight",
		end_reason: null,
		scope: { kind: "direct-ticket", tickets: [90] },
		started_at: 1_770_000_000_000,
		ended_at: null,
		last_seq: 1,
	});

	store.append(runEnded(runId, { at: 1_770_000_600_000, endReason: "circuit-breaker" }));
	const ended = store.readRun(runId);

	assert.equal(ended.lifecycle, "ended");
	assert.equal(ended.end_reason, "circuit-breaker");
	assert.equal(ended.ended_at, 1_770_000_600_000);
});

test("a ticket execution is keyed by (run, ticket) and counts its attempts", async (t) => {
	const { store, runId } = await storeWithRun(t);
	store.append(attemptLaunched(runId, 90, 1));
	store.append(attemptLaunched(runId, 90, 2));
	store.append(attemptLaunched(runId, 91, 1));

	const executions = store.readTicketExecutions(runId);

	assert.deepEqual(
		executions.map((row) => [row.run_id, row.ticket, row.attempt_count]),
		[
			[runId, 90, 2],
			[runId, 91, 1],
		],
	);
});

test("attempts carry their ordinal, phase, and identity tuple", async (t) => {
	const { store, runId } = await storeWithRun(t);
	store.append(attemptLaunched(runId, 90, 1, { phase: "implement" }));
	store.append(attemptLaunched(runId, 90, 2, { phase: "review" }));

	const attempts = store.readAttempts({ runId, ticket: 90 });

	assert.deepEqual(
		attempts.map((row) => [row.attempt_id, row.ordinal, row.phase]),
		[
			[`${runId}-t90-a1`, 1, "implement"],
			[`${runId}-t90-a2`, 2, "review"],
		],
	);
});

test("the ticket index answers cross-run history as a list, never a merge (§2.3)", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openTestStore(t, { repoRoot, agentDir });

	const runA = newUlid();
	store.append(runStarted(runA));
	store.append(attemptLaunched(runA, 90));
	store.append(runEnded(runA));

	const runB = newUlid();
	store.append(runStarted(runB, { at: 1_770_100_000_000 }));
	store.append(attemptLaunched(runB, 90, 1, { at: 1_770_100_100_000 }));

	assert.deepEqual(
		store.readTicketIndex(90).map((row) => row.run_id),
		[runA, runB],
	);
	assert.deepEqual(store.readTicketIndex(4242), []);
});

test("the run digest is maintained continuously, not built at expiry (§12.3)", async (t) => {
	const { store, runId } = await storeWithRun(t);

	// A crashed run — one that never reaches `run.ended` — still has a digest
	// covering everything up to the crash.
	store.append(attemptLaunched(runId, 90));
	const midRun = store.readRunDigest(runId);

	assert.equal(midRun.lifecycle, "preflight");
	assert.equal(midRun.ticket_count, 1);
	assert.equal(midRun.attempt_count, 1);
	assert.equal(midRun.ended_at, null);

	store.append(runEnded(runId, { endReason: "drained" }));
	const ended = store.readRunDigest(runId);

	assert.equal(ended.lifecycle, "ended");
	assert.equal(ended.end_reason, "drained");
	assert.equal(ended.ticket_count, 1);
});

// ── The startup head compare, fail-closed (§4.4) ─────────────────────────────

test("a projection head behind the journal refuses to open", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(newUlid()));
	store.close();

	tamper(t, dbPath, "UPDATE projection_head SET last_seq = 0 WHERE name = 'run_digest'");

	const error = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	assert.ok(error instanceof FactoryStateError);
	assert.equal(error.reason, "projection-head-mismatch");
	assert.equal(error.details.projection, "run_digest");
});

test("a missing projection head is a mismatch, never a skipped compare (§4.4)", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(newUlid()));
	store.close();

	tamper(t, dbPath, "DELETE FROM projection_head WHERE name = 'attempt'");

	const error = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	assert.equal(error.reason, "projection-head-mismatch");
	assert.equal(error.details.projection, "attempt");
	assert.equal(error.details.found, null);
});

test("a head whose chain hash disagrees refuses even at the right sequence", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(newUlid()));
	store.close();

	tamper(t, dbPath, `UPDATE projection_head SET chain_hash = '${"0".repeat(64)}' WHERE name = 'run'`);

	assert.equal((await refusalOfAsync(() => openStore({ repoRoot, agentDir }))).reason, "projection-head-mismatch");
});

test("a projection built by another projector version refuses with its own reason", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(newUlid()));
	store.close();

	tamper(t, dbPath, "UPDATE projection_head SET projector_version = projector_version + 1 WHERE name = 'run'");

	const error = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	assert.equal(error.reason, "projector-version-change");
	assert.equal(error.details.projection, "run");
});

test("an empty store opens: heads at zero match a journal at zero", async (t) => {
	const store = await openTestStore(t);

	assert.deepEqual(store.head(), { seq: 0, hash: "" });
	assert.equal(store.projectionHeads().length, PROJECTIONS.length);
});

// ── Effects and leases still ride the same transaction (§4.4) ────────────────

test("a canonical effect row and its event commit together or not at all", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));

	const key = `${runId}/90/implement/-/label-add/ready-for-agent`;
	store.transaction(({ appendEvent, db }) => {
		const event = appendEvent({
			kind: "effect.requested",
			source: "controller",
			run: runId,
			ticket: 90,
			phase: "implement",
			occurredAt: 1_770_000_200_000,
			observedAt: 1_770_000_200_000,
			payload: { effect_key: key },
		});
		db.prepare(
			"INSERT INTO effect(effect_key, run_id, ticket, phase, attempt_id, operation, operand, payload_digest, actor, fencing_generation, state, requested_at, requested_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)",
		).run(key, runId, 90, "implement", null, "label-add", "ready-for-agent", event.payload_digest, "controller", 1, 1_770_000_200_000, event.seq);
	});

	assert.equal(store.read((db) => db.prepare("SELECT count(*) AS n FROM effect").get()).n, 1);

	// The same key twice is the database's own refusal, not a policy check.
	assert.throws(() =>
		store.transaction(({ appendEvent, db }) => {
			appendEvent({
				kind: "effect.requested",
				source: "controller",
				run: runId,
				ticket: 90,
				phase: "implement",
				occurredAt: 1_770_000_300_000,
				observedAt: 1_770_000_300_000,
				payload: { effect_key: key },
			});
			db.prepare(
				"INSERT INTO effect(effect_key, run_id, ticket, phase, attempt_id, operation, operand, payload_digest, actor, fencing_generation, state, requested_at, requested_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)",
			).run(key, runId, 90, "implement", null, "label-add", "ready-for-agent", "deadbeef", "controller", 1, 1_770_000_300_000, 99);
		}),
	);

	assert.equal(store.readEvents({}).length, 2, "the refused effect left its event behind");
	assert.equal(store.head().seq, 2);
});

function tamper(_t, dbPath, sql) {
	const db = openDatabase(dbPath);
	try {
		db.transaction(() => db.exec(sql));
	} finally {
		db.close();
	}
}

