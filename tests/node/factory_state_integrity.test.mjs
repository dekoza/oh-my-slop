import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { CONTROLLER_STREAM, HEARTBEAT_STREAM, runStream } from "../../factory/lib/state/events.mjs";
import { deleteStreamWhole, truncateStreamFront } from "../../factory/lib/state/truncation.mjs";
import {
	attemptLaunched,
	heartbeat,
	openTestStore,
	refusalOf,
	runEnded,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §4.7's verification half: what counts as tamper-evidence, and what does not.
 *
 * The whole point of §4.2's per-stream chaining is that the *global* sequence
 * is allowed to have holes — expiry is what makes them — so a verifier that
 * reads a gap as tampering would fail the controller on its own housekeeping.
 */

test("a healthy journal verifies stream by stream", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	store.append(attemptLaunched(runId, 90));
	store.append(runEnded(runId));

	const report = store.verifyJournal();

	assert.equal(report.ok, true);
	assert.deepEqual(report.broken, []);
	assert.deepEqual(
		report.streams.map((verdict) => [verdict.stream, verdict.events, verdict.ok]),
		[[runStream(runId), 3, true]],
	);
});

test("a global sequence gap is not evidence of tampering (§4.2)", async (t) => {
	const store = await openTestStore(t);
	const doomed = newUlid();
	const survivor = newUlid();
	store.append(runStarted(doomed));
	store.append(runStarted(survivor));
	store.append(attemptLaunched(doomed, 90));
	store.append(attemptLaunched(survivor, 91));

	// Expiry is whole-stream deletion, and it is what creates the holes: the
	// survivor's own records now sit at seq 2 and 4.
	store.transaction((tx) => deleteStreamWhole(tx, { stream: runStream(doomed) }));

	const report = store.verifyJournal();

	assert.equal(report.ok, true, "a hole left by whole-stream deletion read as tampering");
	assert.deepEqual(
		report.streams.map((verdict) => verdict.stream),
		[runStream(survivor)],
	);
});

test("an edited payload is caught in its own stream, and only there", async (t) => {
	const store = await openTestStore(t);
	const tampered = newUlid();
	const untouched = newUlid();
	store.append(runStarted(tampered));
	store.append(runStarted(untouched));
	const target = store.append(attemptLaunched(tampered, 90));
	store.append(attemptLaunched(untouched, 91));

	store.transaction(({ db }) =>
		db.prepare("UPDATE event SET payload = ? WHERE seq = ?").run('{"role":"review"}', target.seq),
	);

	const report = store.verifyJournal();

	assert.equal(report.ok, false);
	assert.deepEqual(report.broken, [runStream(tampered)]);
	const verdict = report.streams.find((entry) => entry.stream === runStream(tampered));
	assert.deepEqual(verdict.failure, {
		reason: "hash-mismatch",
		atSeq: target.seq,
		eventId: target.event_id,
	});
	assert.equal(
		report.streams.find((entry) => entry.stream === runStream(untouched)).ok,
		true,
		"a break in one run's stream travelled to another's",
	);
});

test("a deleted record inside a stream breaks that stream's chain", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	const middle = store.append(attemptLaunched(runId, 90));
	const last = store.append(runEnded(runId));

	store.transaction(({ db }) => db.prepare("DELETE FROM event WHERE seq = ?").run(middle.seq));

	const report = store.verifyJournal();

	assert.equal(report.ok, false);
	assert.deepEqual(report.broken, [runStream(runId)]);
	assert.deepEqual(report.streams[0].failure, {
		reason: "chain-break",
		atSeq: last.seq,
		eventId: last.event_id,
	});
});

test("a stream that begins mid-chain with no recorded boundary is a break", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	const first = store.append(runStarted(runId));
	const second = store.append(attemptLaunched(runId, 90));
	store.append(runEnded(runId));

	// Front-truncation is legitimate for the heartbeat stream and records its
	// boundary (§4.2). A silent front deletion records nothing, and that is
	// exactly the difference the verifier reads.
	store.transaction(({ db }) => db.prepare("DELETE FROM event WHERE seq = ?").run(first.seq));

	const report = store.verifyJournal();

	assert.equal(report.ok, false);
	assert.deepEqual(report.streams[0].failure, {
		reason: "unrecorded-truncation",
		atSeq: second.seq,
		eventId: second.event_id,
	});
});

// ── The only two ways a record leaves the journal (§4.2, §14.7) ─────────────

test("front-truncation records its boundary, and the retained prefix still verifies", async (t) => {
	const store = await openTestStore(t);
	const beats = [1, 2, 3, 4].map((n) => store.append(heartbeat({ at: 1_770_000_000_000 + n * 60_000 })));

	const truncation = store.transaction((tx) =>
		truncateStreamFront(tx, { stream: HEARTBEAT_STREAM, throughSeq: beats[1].seq, at: 1_770_000_500_000 }),
	);

	assert.equal(truncation.deleted, 2);
	assert.deepEqual(truncation.marker.payload, {
		stream: HEARTBEAT_STREAM,
		up_to_seq: beats[1].seq,
		up_to_hash: beats[1].hash,
	});
	assert.equal(truncation.marker.stream, CONTROLLER_STREAM, "the boundary record is itself truncatable");
	assert.deepEqual(
		store.readEvents({ stream: HEARTBEAT_STREAM }).map((event) => event.seq),
		[beats[2].seq, beats[3].seq],
	);
	assert.equal(store.verifyJournal().ok, true, "tamper-evidence did not survive the retained prefix");
});

test("a second truncation moves the boundary, and the first stops explaining anything", async (t) => {
	const store = await openTestStore(t);
	const beats = [1, 2, 3, 4].map((n) => store.append(heartbeat({ at: 1_770_000_000_000 + n * 60_000 })));

	store.transaction((tx) => truncateStreamFront(tx, { stream: HEARTBEAT_STREAM, throughSeq: beats[0].seq }));
	store.transaction((tx) => truncateStreamFront(tx, { stream: HEARTBEAT_STREAM, throughSeq: beats[2].seq }));

	assert.equal(store.verifyJournal().ok, true);
	assert.deepEqual(
		store.readEvents({ stream: HEARTBEAT_STREAM }).map((event) => event.seq),
		[beats[3].seq],
	);
});

test("a truncation with nothing to delete records no boundary", async (t) => {
	const store = await openTestStore(t);
	const first = store.append(heartbeat());

	const truncation = store.transaction((tx) =>
		truncateStreamFront(tx, { stream: HEARTBEAT_STREAM, throughSeq: first.seq - 1 }),
	);

	assert.deepEqual(truncation, { stream: HEARTBEAT_STREAM, deleted: 0, upToSeq: null, upToHash: null, marker: null });
	assert.deepEqual(store.readEvents({ stream: CONTROLLER_STREAM }), [], "a boundary was recorded for no boundary");
});

test("front-truncation never empties a stream", async (t) => {
	const store = await openTestStore(t);
	const beats = [1, 2].map((n) => store.append(heartbeat({ at: 1_770_000_000_000 + n * 60_000 })));

	const error = refusalOf(() =>
		store.transaction((tx) => truncateStreamFront(tx, { stream: HEARTBEAT_STREAM, throughSeq: beats[1].seq })),
	);

	assert.equal(error.reason, "invalid-truncation");
	assert.deepEqual(
		store.readEvents({ stream: HEARTBEAT_STREAM }).map((event) => event.seq),
		[beats[0].seq, beats[1].seq],
		"a refused truncation deleted records anyway",
	);
});

test("each stream class has exactly one legal deletion shape (§4.2, §12.2)", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	store.append(attemptLaunched(runId, 90));
	store.append(heartbeat());

	// Run streams die whole; the heartbeat stream truncates from the front; the
	// controller stream is indefinite and holds the boundary records themselves.
	assert.equal(
		refusalOf(() => store.transaction((tx) => truncateStreamFront(tx, { stream: runStream(runId), throughSeq: 1 })))
			.reason,
		"invalid-truncation",
	);
	assert.equal(
		refusalOf(() =>
			store.transaction((tx) => truncateStreamFront(tx, { stream: CONTROLLER_STREAM, throughSeq: 1 })),
		).reason,
		"invalid-truncation",
	);
	assert.equal(
		refusalOf(() => store.transaction((tx) => deleteStreamWhole(tx, { stream: HEARTBEAT_STREAM }))).reason,
		"invalid-truncation",
	);
	assert.equal(
		refusalOf(() => store.transaction((tx) => deleteStreamWhole(tx, { stream: CONTROLLER_STREAM }))).reason,
		"invalid-truncation",
	);
});

test("whole-stream deletion takes one run's records and no other's", async (t) => {
	const store = await openTestStore(t);
	const doomed = newUlid();
	const survivor = newUlid();
	store.append(runStarted(doomed));
	store.append(runStarted(survivor));
	store.append(attemptLaunched(doomed, 90));

	const deletion = store.transaction((tx) => deleteStreamWhole(tx, { stream: runStream(doomed) }));
	const next = store.append(attemptLaunched(survivor, 91));

	assert.deepEqual(deletion, { stream: runStream(doomed), deleted: 2 });
	assert.equal(store.verifyJournal().ok, true);
	assert.equal(next.seq, 4, "a sequence number was reused after a deletion");
});

test("no truncate-mid-stream, renumber, or rewrite path exists in the code (§14.7, §14.10)", () => {
	// The invariant is about the tree, not only about the two functions below: a
	// `DELETE FROM event WHERE seq = ?` added to a future expiry pass would pass
	// every behavioural test in this file while making the journal rewritable.
	for (const [file, source] of factorySources()) {
		const deletions = [...source.matchAll(/DELETE\s+FROM\s+event\b[^;`"']*/gi)].map((match) =>
			match[0].replace(/\s+/g, " ").trim(),
		);

		// Rewriting is checked everywhere, `truncation.mjs` included: it is the
		// file most likely to grow one, and exempting it would leave §14.10
		// guarded everywhere except where it matters.
		assert.equal(/UPDATE\s+event\b/i.test(source), false, `${file} rewrites a journal record`);

		assert.deepEqual(
			deletions.sort(),
			file.endsWith("state/truncation.mjs")
				? ["DELETE FROM event WHERE stream = ?", "DELETE FROM event WHERE stream = ? AND seq <= ?"]
				: [],
			`${file} deletes journal records in a shape that is neither whole-stream nor front`,
		);
	}
});

test("verification reads the journal and writes nothing (§14.10, §14.24)", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	const before = store.head();

	store.verifyJournal();

	assert.deepEqual(store.head(), before);
	assert.deepEqual(
		store.readEvents({ stream: CONTROLLER_STREAM }),
		[],
		"verification appended a record of its own",
	);
});

/**
 * Every module the binary ships, as `[path, source]` — `factory/` whole, not
 * `factory/lib` alone, so a deletion added to the entry point is in scope too.
 */
function factorySources(dir = fileURLToPath(new URL("../../factory", import.meta.url))) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return factorySources(path);
		return entry.name.endsWith(".mjs") ? [[path, readFileSync(path, "utf8")]] : [];
	});
}
