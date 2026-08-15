import { envelopeHash, GENESIS_PREV_HASH } from "./events.mjs";
import { isCorruptionError } from "./sqlite.mjs";

/**
 * §4.7's verification half. **It reads, it reports, and it never repairs** —
 * Babysitter's repair mode, which dropped corrupt events and reassigned ids, is
 * the design this file exists instead of (§14.10).
 *
 * Two scopes, and the difference between them is the whole of §4.7:
 *
 * - **SQLite-level corruption** is global. Nothing in the file can be trusted to
 *   answer a question, so the store is quarantined whole (`quarantine.mjs`).
 * - **A hash-chain break inside one stream** is that stream's alone. Streams
 *   chain independently (§4.2), so a tampered run costs exactly that run's
 *   detail and leaves every other run verifiable.
 *
 * What is deliberately *not* evidence: a hole in the global sequence. Expiry is
 * what creates the holes — whole-stream deletion and front-truncation — and a
 * verifier that read one as tampering would fail the controller on its own
 * housekeeping the first time a run aged out.
 */

/** SQLite's own answer when nothing is wrong with the file. */
const INTEGRITY_OK = "ok";

/** Why a stream stopped verifying. Closed, because it reaches the operator. */
export const INTEGRITY_BREAKS = Object.freeze({
	/** The record does not hash to the hash stored beside it. */
	hashMismatch: "hash-mismatch",
	/** `prev_hash` does not name this stream's preceding record. */
	chainBreak: "chain-break",
	/**
	 * The stream begins mid-chain with no `stream.truncated` record for the
	 * boundary. Front-truncation is legitimate and records its boundary (§4.2);
	 * a silent front deletion records nothing, and that is the difference.
	 */
	unrecordedTruncation: "unrecorded-truncation",
});

/**
 * Is this file still a SQLite database at all?
 *
 * @param {object} db an open connection from `sqlite.mjs`
 * @returns {{ ok: boolean, problems: string[] }} `problems` is SQLite's own
 *   wording, kept verbatim — it names the page, and a paraphrase would not.
 */
export function checkDatabaseIntegrity(db) {
	let rows;
	try {
		rows = db.prepare("PRAGMA integrity_check").all();
	} catch (error) {
		// A file too damaged to answer the question has answered it.
		if (!isCorruptionError(error)) throw error;
		return Object.freeze({ ok: false, problems: [error.message] });
	}

	const problems = rows.map((row) => Object.values(row)[0]).filter((answer) => answer !== INTEGRITY_OK);
	return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

/**
 * Verify every stream's chain, or one named stream's.
 *
 * @param {object} db
 * @param {{ stream?: string | null }} [options]
 * @returns {{ ok: boolean, streams: ReadonlyArray<object>, broken: ReadonlyArray<string> }}
 *   one verdict per stream, in stream-name order, each carrying its first
 *   failure or `null`. The first failure and not every failure: a chain stops
 *   being evidence at the point it stops verifying, and everything after the
 *   break is unverifiable rather than individually wrong.
 */
export function verifyJournal(db, { stream = null } = {}) {
	const boundaries = recordedBoundaries(db);
	const names =
		stream === null
			? db.prepare("SELECT DISTINCT stream FROM event ORDER BY stream").all().map((row) => row.stream)
			: [stream];

	const streams = names.map((name) => verifyStream(db, name, boundaries));
	const broken = streams.filter((verdict) => !verdict.ok).map((verdict) => verdict.stream);

	return Object.freeze({ ok: broken.length === 0, streams: Object.freeze(streams), broken: Object.freeze(broken) });
}

/**
 * @returns {Readonly<{ stream: string, events: number, firstSeq: number | null,
 *   lastSeq: number | null, run: string | null, ok: boolean,
 *   failure: null | { reason: string, atSeq: number, eventId: string } }>}
 */
function verifyStream(db, stream, boundaries) {
	const rows = db.prepare("SELECT * FROM event WHERE stream = ? ORDER BY seq ASC").all(stream);

	let previous = null;
	let failure = null;
	for (const row of rows) {
		failure = failureAt(row, previous, boundaries);
		if (failure !== null) break;
		previous = row;
	}

	return Object.freeze({
		stream,
		events: rows.length,
		firstSeq: rows.length === 0 ? null : rows[0].seq,
		lastSeq: rows.length === 0 ? null : rows.at(-1).seq,
		// A run stream names its run in every record; the controller streams name
		// none. Reported so a caller can scope a break to a run without parsing
		// the stream name back apart.
		run: rows.length === 0 ? null : rows[0].run,
		ok: failure === null,
		failure,
	});
}

function failureAt(row, previous, boundaries) {
	if (recordedHash(row) !== row.hash) return breakAt(INTEGRITY_BREAKS.hashMismatch, row);

	if (previous === null) {
		if (row.prev_hash === GENESIS_PREV_HASH) return null;
		return boundaries.some(
			(boundary) =>
				boundary.stream === row.stream && boundary.up_to_hash === row.prev_hash && boundary.up_to_seq < row.seq,
		)
			? null
			: breakAt(INTEGRITY_BREAKS.unrecordedTruncation, row);
	}

	return row.prev_hash === previous.hash ? null : breakAt(INTEGRITY_BREAKS.chainBreak, row);
}

/**
 * The hash the stored record *should* carry, recomputed from the record itself.
 * A payload that no longer parses is a mismatch rather than a crash: the
 * verifier's job is to report damage, not to be stopped by it.
 */
function recordedHash(row) {
	const { hash, payload, ...rest } = row;
	try {
		return envelopeHash({ ...rest, payload: JSON.parse(payload) });
	} catch {
		return null;
	}
}

function breakAt(reason, row) {
	return Object.freeze({ reason, atSeq: row.seq, eventId: row.event_id });
}

/**
 * The front-truncation boundaries the journal itself records (§4.2). They
 * explain a stream that legitimately begins mid-chain; they never *repair* one,
 * and a boundary nobody recorded leaves the break standing.
 */
function recordedBoundaries(db) {
	return db
		.prepare("SELECT payload FROM event WHERE kind = 'stream.truncated' ORDER BY seq ASC")
		.all()
		.map((row) => JSON.parse(row.payload));
}
