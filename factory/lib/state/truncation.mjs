import { FactoryStateError } from "./errors.mjs";
import { CONTROLLER_STREAM, HEARTBEAT_STREAM, sourceForActor } from "./events.mjs";

/**
 * **The only two ways a record ever leaves the journal** (§4.2, §14.7):
 * whole-stream deletion and front-truncation. Every deletion in the factory is
 * one of the two statements below, which is what makes §14.7 a checkable
 * property of the tree rather than a review convention — and why
 * `tests/node/factory_state_integrity.test.mjs` greps for a third.
 *
 * **Each stream class has exactly one legal shape**, and the classes are §12.2's:
 *
 * | Stream | Shape |
 * |---|---|
 * | `controller` | none — indefinite, and it holds the boundary records |
 * | `controller.heartbeat` | front-truncation |
 * | `run:<id>` | whole-stream deletion |
 *
 * A run stream front-truncated would be a run whose start is gone while its
 * detail claims to be complete; a heartbeat stream deleted whole would take
 * "was the controller alive at time T" with it for runs whose detail survives.
 *
 * **Neither shape renumbers or rewrites anything.** A global sequence hole is
 * the *expected* residue (§4.2), and `journal_head` is a row rather than
 * `MAX(seq)` precisely so the head does not walk backwards when one appears.
 *
 * Policy — which streams, at what horizon, under which pins — belongs to §12
 * and is #117's. What lives here is the mechanism and its refusals.
 */

/**
 * Front-truncate a stream, recording the boundary it truncated to.
 *
 * The `stream.truncated {stream, up_to_seq, up_to_hash}` record lands on the
 * **`controller`** stream, not inside the stream it describes. A boundary
 * record sitting in a front-truncatable stream is itself deletable — the
 * property §4.2 designs out when it rejects a re-anchoring `journal.compacted`
 * record — and §12.2 already lands expiry's records on the controller stream
 * for the same reason.
 *
 * @param {{ appendEvent: (input: object) => object, db: object }} tx an open
 *   store transaction: the deletion and its boundary record commit together or
 *   not at all, or a crash between them leaves a stream that verifies as
 *   tampered-with.
 * @param {{ stream: string, throughSeq: number, at?: number, actor?: string }} what
 *   every record with `seq <= throughSeq` in `stream` is deleted.
 * @returns {{ stream: string, deleted: number, upToSeq: number | null, upToHash: string | null, marker: object | null }}
 * @throws {FactoryStateError} `invalid-truncation`
 */
export function truncateStreamFront(tx, { stream, throughSeq, at = Date.now(), actor = "controller" }) {
	if (stream !== HEARTBEAT_STREAM) {
		refuse(
			`Only ${HEARTBEAT_STREAM} truncates from the front (§4.2, §12.2); ${stream} does not.`,
			{ stream, expected: HEARTBEAT_STREAM },
		);
	}

	const boundary = tx.db
		.prepare("SELECT seq, hash FROM event WHERE stream = ? AND seq <= ? ORDER BY seq DESC LIMIT 1")
		.get(stream, throughSeq);

	// Nothing to truncate is not a truncation: recording a boundary here would
	// be recording a deletion that did not happen.
	if (boundary === undefined) {
		return Object.freeze({ stream, deleted: 0, upToSeq: null, upToHash: null, marker: null });
	}

	const retained = tx.db
		.prepare("SELECT COUNT(*) AS remaining FROM event WHERE stream = ? AND seq > ?")
		.get(stream, boundary.seq).remaining;
	if (retained === 0) {
		// The retained head is what the boundary record points *at*. Empty the
		// stream and the next append silently starts again at genesis, which is a
		// stream whose front deletion nothing can distinguish from a fresh start.
		refuse(`Front-truncating ${stream} through seq ${boundary.seq} would retain nothing.`, {
			stream,
			up_to_seq: boundary.seq,
		});
	}

	const deleted = tx.db
		.prepare("DELETE FROM event WHERE stream = ? AND seq <= ?")
		.run(stream, boundary.seq).changes;

	const marker = tx.appendEvent({
		kind: "stream.truncated",
		source: sourceForActor(actor),
		stream: CONTROLLER_STREAM,
		occurredAt: at,
		observedAt: at,
		payload: { stream, up_to_seq: boundary.seq, up_to_hash: boundary.hash },
	});

	return Object.freeze({ stream, deleted, upToSeq: boundary.seq, upToHash: boundary.hash, marker });
}

/**
 * Delete a run's stream whole (§4.2, §12.2).
 *
 * The record *of* the deletion — §12.2's `run.expired {run_id, bytes_reclaimed,
 * artifact_count, at}` — is the caller's to append in this same transaction: it
 * cannot be written inside the stream being deleted, and its byte and artifact
 * counts belong to the artifact ledger rather than to the journal. The tier-1
 * projection rows the run leaves behind are expiry's business too (§12.3).
 *
 * @param {{ appendEvent: (input: object) => object, db: object }} tx
 * @param {{ stream: string }} what
 * @returns {{ stream: string, deleted: number }}
 * @throws {FactoryStateError} `invalid-truncation`
 */
export function deleteStreamWhole(tx, { stream }) {
	if (stream === CONTROLLER_STREAM || stream === HEARTBEAT_STREAM) {
		refuse(`${stream} is never deleted whole (§12.2); only a run stream is.`, { stream });
	}

	return Object.freeze({
		stream,
		deleted: tx.db.prepare("DELETE FROM event WHERE stream = ?").run(stream).changes,
	});
}

function refuse(message, details) {
	throw new FactoryStateError("invalid-truncation", message, details);
}
