import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { FactoryStateError } from "../../factory/lib/state/errors.mjs";
import { envelopeHash, GENESIS_PREV_HASH, runStream } from "../../factory/lib/state/events.mjs";
import { openDatabase } from "../../factory/lib/state/sqlite.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { attemptLaunched, makeAgentDir, openTestStore, runEnded, runStarted } from "./helpers/factory-store.mjs";

/**
 * §4.1's store and §4.2's chained journal: where the database lives, that it is
 * the right one, and that its records chain per stream while the global
 * sequence stays monotonic without promising to stay gapless.
 */

// ── Location and identity (§4.1) ─────────────────────────────────────────────

test("the store lands under <agent dir>/software-factory/repos/<slug>/state.db", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = realpathSync(makeRepo(t));

	const store = await openTestStore(t, { repoRoot, agentDir });

	assert.equal(store.dbPath, join(agentDir, "software-factory", "repos", store.slug, "state.db"));
	assert.equal(store.canonicalPath, repoRoot);
	assert.ok(existsSync(store.dbPath));
});

test("the canonical repo path is recorded in the store and compared at open", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);

	const first = await openTestStore(t, { repoRoot, agentDir });
	const firstUuid = first.instanceUuid;
	first.close();

	const reopened = await openTestStore(t, { repoRoot, agentDir });

	assert.equal(reopened.canonicalPath, realpathSync(repoRoot));
	assert.equal(reopened.instanceUuid, firstUuid, "reopening minted a second journal identity");
});

test("a slug collision on a differing canonical path appends a realpath hash", async (t) => {
	const agentDir = makeAgentDir(t);
	// Two real repositories whose paths fold to one slug: `<base>/a-b` and
	// `<base>/a/b` are both `…-a-b` once every separator becomes a dash.
	const base = makeAgentDir(t);
	mkdirSync(join(base, "a-b"), { recursive: true });
	mkdirSync(join(base, "a", "b"), { recursive: true });

	const mine = await openStore({ repoRoot: join(base, "a-b"), agentDir });
	t.after(() => mine.close());
	const other = await openStore({ repoRoot: join(base, "a", "b"), agentDir });
	t.after(() => other.close());

	assert.notEqual(other.dbPath, mine.dbPath);
	assert.match(other.slug, new RegExp(`^${mine.slug}-[0-9a-f]{8}$`));
	assert.notEqual(other.instanceUuid, mine.instanceUuid);
	// Reopening either one still lands on its own store.
	const reopened = await openStore({ repoRoot: join(base, "a", "b"), agentDir });
	t.after(() => reopened.close());
	assert.equal(reopened.dbPath, other.dbPath);
});

test("a neighbour's unreadable store does not block a repo from its own", async (t) => {
	const agentDir = makeAgentDir(t);
	const base = makeAgentDir(t);
	mkdirSync(join(base, "a-b"), { recursive: true });
	mkdirSync(join(base, "a", "b"), { recursive: true });

	const neighbour = await openStore({ repoRoot: join(base, "a-b"), agentDir });
	const neighbourPath = neighbour.dbPath;
	neighbour.close();

	// The neighbour is written by a factory this one does not understand. It is
	// not our store, so its version is not our business — the canonical path
	// settles ownership before anything else is read.
	const db = openDatabase(neighbourPath);
	db.exec("PRAGMA user_version = 99");
	db.close();

	const mine = await openStore({ repoRoot: join(base, "a", "b"), agentDir });
	t.after(() => mine.close());

	assert.notEqual(mine.dbPath, neighbourPath);
	assert.equal(mine.canonicalPath, realpathSync(join(base, "a", "b")));
});

test("a journal instance uuid makes a cursor from another journal detectable", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	const appended = store.append(runStarted(runId));

	assert.match(store.instanceUuid, /^[0-9a-f-]{36}$/);
	assert.deepEqual(store.checkCursor({ instanceUuid: store.instanceUuid, seq: appended.seq }), {
		ok: true,
		resumeFrom: appended.seq,
	});
	assert.deepEqual(store.checkCursor({ instanceUuid: newUlid(), seq: 1 }), {
		ok: false,
		reason: "foreign-journal",
	});
	assert.deepEqual(store.checkCursor({ instanceUuid: store.instanceUuid, seq: appended.seq + 5 }), {
		ok: false,
		reason: "ahead-of-head",
	});
});

// ── Streams and chaining (§4.2) ──────────────────────────────────────────────

test("prev_hash chains within a stream, and each stream starts at genesis", async (t) => {
	const store = await openTestStore(t);
	const runA = newUlid();
	const runB = newUlid();

	const a1 = store.append(runStarted(runA));
	const b1 = store.append(runStarted(runB));
	const a2 = store.append(attemptLaunched(runA, 90));
	const b2 = store.append(runEnded(runB));

	assert.equal(a1.prev_hash, GENESIS_PREV_HASH);
	assert.equal(b1.prev_hash, GENESIS_PREV_HASH, "a new stream does not chain onto another stream's head");
	assert.equal(a2.prev_hash, a1.hash);
	assert.equal(b2.prev_hash, b1.hash);
	assert.equal(a2.stream, runStream(runA));
});

test("the controller and heartbeat streams chain too, without being named", async (t) => {
	const store = await openTestStore(t);
	const heartbeat = () => ({
		kind: "controller.heartbeat",
		source: "controller",
		occurredAt: 1_770_000_000_000,
		observedAt: 1_770_000_000_000,
		payload: { watching: 0 },
	});

	const first = store.append(heartbeat());
	const second = store.append(heartbeat());

	assert.equal(first.stream, "controller.heartbeat");
	assert.equal(first.prev_hash, GENESIS_PREV_HASH);
	assert.equal(second.prev_hash, first.hash, "the heartbeat stream restarted at genesis");
});

test("the recorded hash is the one §4.3 defines over the stored record", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));

	const [stored] = store.readEvents({ stream: runStream(runId) });
	const { hash, ...rest } = stored;

	assert.equal(hash, envelopeHash(rest));
});

test("the global sequence is monotonic across streams", async (t) => {
	const store = await openTestStore(t);
	const runA = newUlid();
	const runB = newUlid();

	const seqs = [
		store.append(runStarted(runA)).seq,
		store.append(runStarted(runB)).seq,
		store.append(attemptLaunched(runA, 90)).seq,
	];

	assert.deepEqual(seqs, [1, 2, 3]);
	assert.deepEqual(store.head(), { seq: 3, hash: store.readEvents({ sinceSeq: 2 })[0].hash });
});

test("a gap in the global sequence is not evidence of tampering (§4.2)", async (t) => {
	const store = await openTestStore(t);
	const doomed = newUlid();
	const survivor = newUlid();
	store.append(runStarted(doomed));
	store.append(runStarted(survivor));
	store.append(attemptLaunched(doomed, 90));

	// Expiry is whole-stream deletion, and it is what creates the gaps.
	store.transaction(({ db }) => db.prepare("DELETE FROM event WHERE stream = ?").run(runStream(doomed)));
	const next = store.append(attemptLaunched(survivor, 91));

	assert.equal(next.seq, 4, "sequence numbers are never reused after a deletion");
	assert.deepEqual(
		store.readEvents({}).map((event) => event.seq),
		[2, 4],
	);
	// The survivor's own chain is untouched by its neighbour's deletion.
	assert.equal(next.prev_hash, store.readEvents({ stream: runStream(survivor) })[0].hash);
});

test("reopening a store keeps counting from the recorded head", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const runId = newUlid();

	const first = await openTestStore(t, { repoRoot, agentDir });
	first.append(runStarted(runId));
	first.close();

	const reopened = await openTestStore(t, { repoRoot, agentDir });
	const second = reopened.append(attemptLaunched(runId, 90));

	assert.equal(second.seq, 2);
	assert.equal(second.prev_hash, reopened.readEvents({ stream: runStream(runId) })[0].hash);
});

// ── Ordering (§14.37) ────────────────────────────────────────────────────────

test("events read back in sequence order, never in clock order", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId, { at: 1_770_000_000_000 }));
	// A tracker fact discovered now, but authored before the run started — a
	// wall-clock sort would place it ahead of the attempt that explains it.
	store.append({
		kind: "observation.recorded",
		source: "gitea",
		run: runId,
		occurredAt: 1_700_000_000_000,
		observedAt: 1_770_000_200_000,
		foreignSourceId: "comment:1",
		payload: { occurred_at_raw: "2023-11-14T22:13:20+01:00", fact: "label-added" },
	});
	store.append(attemptLaunched(runId, 90, 1, { at: 1_770_000_100_000 }));

	assert.deepEqual(
		store.readEvents({ stream: runStream(runId) }).map((event) => event.kind),
		["run.started", "observation.recorded", "attempt.launched"],
	);
});

test("no read path orders by a clock column", () => {
	// §14.37 is an invariant about the code, not only about one query: an
	// `ORDER BY occurred_at` added later would pass every behavioural test above
	// until a foreign fact arrived late.
	const source = storeSources();
	assert.equal(/ORDER BY\s+(?:\w+\.)?(?:occurred_at|observed_at)/i.test(source), false);
});

test("the foreign system's raw timestamp survives the round trip", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	store.append({
		kind: "observation.recorded",
		source: "gitea",
		run: runId,
		occurredAt: 1_770_000_050_000,
		observedAt: 1_770_000_200_000,
		foreignSourceId: "comment:1",
		payload: { occurred_at_raw: "2026-08-14T21:03:20+02:00", fact: "label-added" },
	});

	const [stored] = store.readEvents({ sinceSeq: 1 });

	assert.equal(stored.payload.occurred_at_raw, "2026-08-14T21:03:20+02:00");
	assert.equal(stored.occurred_at, 1_770_000_050_000);
	assert.equal(stored.observed_at, 1_770_000_200_000);
});

// ── Refusals ────────────────────────────────────────────────────────────────

test("an event ending a run this store never saw start is refused", async (t) => {
	const store = await openTestStore(t);

	assert.throws(
		() => store.append(runEnded(newUlid())),
		(error) => error instanceof FactoryStateError && error.reason === "invalid-event",
	);
	assert.deepEqual(store.head(), { seq: 0, hash: GENESIS_PREV_HASH }, "a refused append moved the head");
});

test("an end reason outside §10.3's seven is refused", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));

	const error = refusalOf(() => store.append(runEnded(runId, { endReason: "finished" })));

	assert.ok(error instanceof FactoryStateError);
	assert.equal(error.details.at, "payload.end_reason");
});

function refusalOf(body) {
	try {
		body();
	} catch (error) {
		return error;
	}
	throw new assert.AssertionError({ message: "expected a refusal" });
}

function storeSources() {
	return ["store.mjs", "projections.mjs", "schema.mjs"]
		.map((name) => readFileSync(new URL(`../../factory/lib/state/${name}`, import.meta.url), "utf8"))
		.join("\n");
}
