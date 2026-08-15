import { FactoryStateError } from "./errors.mjs";
import { verifyJournal } from "./integrity.mjs";
import { PROJECTION_CLASSES, PROJECTIONS, REBUILD_REASONS } from "./projections.mjs";

/**
 * §4.4's rebuild: **projections are derived, therefore safe to rebuild — and
 * only ever under a recorded reason.**
 *
 * This is the whole of what §4.7 permits after an integrity failure. The
 * journal itself is never truncated, renumbered, or rewritten (§14.10); what
 * can be redone is the part that was only ever a function of it. A rebuild that
 * ran silently would make the fail-closed head compare at open decorative — it
 * would repair whatever it was meant to detect — so every rebuild emits
 * `projection.rebuilt` naming its reason from §4.4's closed five, the projector
 * versions it rebuilt at, and the head it rebuilt to.
 *
 * **A broken stream is not replayed.** A hash-chain break scopes to one stream
 * (§4.7), so the rebuild replays every other stream in full, records a typed
 * `journal.integrity-failed` fact naming the broken one, and leaves that run's
 * permanent digest standing — it is now the only evidence of the run, and
 * rebuilding it "from external evidence" is a human's job, not this function's.
 */

const REASONS = Object.freeze(Object.values(REBUILD_REASONS));

/**
 * @param {object} store an open store (`store.mjs`)
 * @param {{ reason: string, at?: number, actor?: "controller" | "operator" }} why
 * @returns {Readonly<object>} the record's payload, plus the emitted envelope
 * @throws {FactoryStateError} `invalid-rebuild`
 */
export function rebuildProjections(store, { reason, at = Date.now(), actor = "controller" }) {
	if (!REASONS.includes(reason)) {
		throw new FactoryStateError(
			"invalid-rebuild",
			`A projection is rebuilt for one of §4.4's five reasons; found ${JSON.stringify(reason ?? null)}.`,
			{ found: reason ?? null, expected: REASONS.join("|") },
		);
	}

	return store.transaction((tx) => {
		const unrecoverable = brokenStreams(tx.db);
		const replayable = new Set(
			tx.db
				.prepare("SELECT DISTINCT stream FROM event ORDER BY stream")
				.all()
				.map((row) => row.stream),
		);
		for (const verdict of unrecoverable) replayable.delete(verdict.stream);

		const replayableRuns = tx.db
			.prepare("SELECT DISTINCT run FROM event WHERE run IS NOT NULL")
			.all()
			.map((row) => row.run)
			.filter((run) => !unrecoverable.some((verdict) => verdict.run === run));

		clearProjections(tx.db, replayableRuns);
		const replayed = replay(tx.db, replayable);
		const head = writeHeads(tx.db);

		for (const verdict of unrecoverable) recordStreamFailure(tx, verdict, at);

		const payload = {
			reason,
			projectors: Object.fromEntries(PROJECTIONS.map((projection) => [projection.name, projection.version])),
			head,
			replayed_events: replayed,
			unrecoverable_streams: unrecoverable.map((verdict) => ({
				stream: verdict.stream,
				run: verdict.run,
				at_seq: verdict.failure.atSeq,
				reason: verdict.failure.reason,
			})),
			retained_permanent_runs: retainedPermanentRuns(tx.db, replayableRuns),
		};

		const event = tx.appendEvent({
			kind: "projection.rebuilt",
			source: actor === "operator" ? "operator" : "controller",
			occurredAt: at,
			observedAt: at,
			payload,
		});

		return Object.freeze({ ...payload, event });
	});
}

function brokenStreams(db) {
	return verifyJournal(db).streams.filter((verdict) => !verdict.ok);
}

/**
 * Derived projections go whole; permanent ones lose only the runs the journal
 * can still replay (§12.2, §12.3). The rows left standing are runs whose detail
 * legitimately expired — or whose stream no longer verifies — and dropping them
 * here would make a rebuild the way permanent history is lost.
 */
function clearProjections(db, replayableRuns) {
	for (const projection of PROJECTIONS) {
		if (projection.retention === PROJECTION_CLASSES.derived) {
			db.prepare(`DELETE FROM ${projection.name}`).run();
			continue;
		}
		if (replayableRuns.length === 0) continue;
		db.prepare(`DELETE FROM ${projection.name} WHERE run_id IN (${placeholders(replayableRuns)})`).run(
			...replayableRuns,
		);
	}
}

/** `?, ?, ?` for an `IN` clause — the values are always bound, never inlined. */
function placeholders(values) {
	return values.map(() => "?").join(", ");
}

/**
 * The journal, in sequence order, through the same projectors the append path
 * uses. Ordering is by sequence, never by clock (§14.37) — a replay that sorted
 * on a timestamp would rebuild a *different* state from the same journal.
 */
function replay(db, replayable) {
	const rows = db.prepare("SELECT * FROM event ORDER BY seq ASC").all();
	let replayed = 0;

	for (const row of rows) {
		if (!replayable.has(row.stream)) continue;
		const event = { ...row, payload: JSON.parse(row.payload) };
		for (const projection of PROJECTIONS) projection.apply(db, event);
		replayed += 1;
	}

	return replayed;
}

/**
 * Every head, including one that was missing: a missing head is a mismatch at
 * open (§4.4) and therefore one of the states a rebuild exists to resolve.
 */
function writeHeads(db) {
	const journalHead = db.prepare("SELECT last_seq, last_hash FROM journal_head WHERE id = 1").get();

	for (const projection of PROJECTIONS) {
		db.prepare(
			`INSERT INTO projection_head(name, last_seq, projector_version, chain_hash) VALUES (?, ?, ?, ?)
			 ON CONFLICT(name) DO UPDATE SET
			   last_seq = excluded.last_seq,
			   projector_version = excluded.projector_version,
			   chain_hash = excluded.chain_hash`,
		).run(projection.name, journalHead.last_seq, projection.version, journalHead.last_hash);
	}

	return { seq: journalHead.last_seq, hash: journalHead.last_hash };
}

/**
 * The typed §4.7 fact for a stream that no longer verifies. It lands on the
 * `controller` stream and names its run in the payload: a record of a broken
 * chain cannot be trusted to the chain it is about, and appending to that
 * stream would chain the report onto the tampered head it is reporting.
 *
 * Recorded once. A rebuild that ran twice would otherwise turn one break into a
 * growing pile of identical facts, and the operator counting them would read
 * that as damage spreading.
 */
function recordStreamFailure(tx, verdict, at) {
	const already = tx.db
		.prepare("SELECT payload FROM event WHERE kind = 'journal.integrity-failed'")
		.all()
		.map((row) => JSON.parse(row.payload))
		.some(
			(payload) =>
				payload.scope === "stream" &&
				payload.stream === verdict.stream &&
				payload.at_seq === verdict.failure.atSeq &&
				payload.reason === verdict.failure.reason,
		);
	if (already) return;

	tx.appendEvent({
		kind: "journal.integrity-failed",
		source: "controller",
		occurredAt: at,
		observedAt: at,
		payload: {
			scope: "stream",
			stream: verdict.stream,
			run: verdict.run,
			at_seq: verdict.failure.atSeq,
			event_id: verdict.failure.eventId,
			reason: verdict.failure.reason,
		},
	});
}

/** How many runs the permanent projections still carry that no journal can. */
function retainedPermanentRuns(db, replayableRuns) {
	const clause = replayableRuns.length === 0 ? "" : ` WHERE run_id NOT IN (${placeholders(replayableRuns)})`;
	return db.prepare(`SELECT COUNT(*) AS retained FROM run_digest${clause}`).get(...replayableRuns).retained;
}
