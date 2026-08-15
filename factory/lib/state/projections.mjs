import { RUN_END_REASONS, RUN_LIFECYCLE, RUN_LIFECYCLES } from "../domain/vocabulary.mjs";
import { canonicalJson } from "./events.mjs";
import { FactoryStateError } from "./errors.mjs";

/**
 * §4.4's five projections, and nothing else.
 *
 * Each one is a pure function of the journal, applied **inside the transaction
 * that appends the event** — which is what deletes the stale-projection failure
 * class rather than detecting it, and why no precedence rule between journal
 * and projection exists here to get wrong.
 *
 * The tables are the monitor's versioned read contract (O14): it reads them and
 * never re-derives state from events, so `version` is bumped whenever a
 * projector's output changes rather than migrated in place.
 *
 * The kinds a projector does not name still advance its rows' `last_seq`. This
 * slice's §4.3 enumeration carries no per-phase or per-disposition kind yet;
 * those arrive additively, and the columns waiting for them (`disposition`,
 * `outcome`, `outcome_chains`) are written by the slice that owns their
 * vocabulary.
 */

/** §10.3's first lifecycle value: preflight runs *after* the run exists. */
const INITIAL_LIFECYCLE = RUN_LIFECYCLE.preflight;

/**
 * §4.4's closed set of reasons a projection may be rebuilt. Declared here, with
 * the projectors, because the refusals that *name* one are raised at open time:
 * a rebuild path that invented a sixth reason, or spelled one of these
 * differently, would be recording an unreadable reason into the journal.
 */
export const REBUILD_REASONS = Object.freeze({
	schemaUpgrade: "schema-upgrade",
	projectorVersionChange: "projector-version-change",
	headMismatch: "head-mismatch",
	operatorRequested: "operator-requested",
	postQuarantine: "post-quarantine",
});

/**
 * §12.2's retention classes, as the rebuild path needs them.
 *
 * A `derived` projection is a pure function of the journal that still holds it,
 * so a rebuild clears and replays it whole. A `permanent` one outlives the
 * stream it was built from — the tier-2 digest and the cross-run reverse index
 * answer "was this ticket ever attempted?" for runs whose detail expired years
 * ago — so a rebuild clears only the runs the journal can still replay and
 * leaves the rest exactly as they are. Replaying a journal that legitimately no
 * longer holds a run must never be how that run's permanent history is lost:
 * expiry is purely subtractive (§12.3), and so is this.
 */
export const PROJECTION_CLASSES = Object.freeze({ derived: "derived", permanent: "permanent" });

const run = {
	name: "run",
	// v2 reads §10.3's `run.lifecycle-changed`: `preflight → running → draining`
	// were previously unreachable values, so a v1 reader would render a run's
	// whole middle as `preflight`.
	version: 2,
	retention: PROJECTION_CLASSES.derived,
	apply(db, event) {
		if (event.run === null) return;

		if (event.kind === "run.started") {
			refuseIfPresent(db, event);
			db.prepare(
				"INSERT INTO run(run_id, lifecycle, end_reason, scope, started_at, ended_at, last_seq) VALUES (?, ?, NULL, ?, ?, NULL, ?)",
			).run(
				event.run,
				INITIAL_LIFECYCLE,
				event.payload.scope === undefined ? null : canonicalJson(event.payload.scope),
				event.occurred_at,
				event.seq,
			);
			return;
		}

		requireRun(db, event);

		if (event.kind === "run.ended") {
			db.prepare(
				"UPDATE run SET lifecycle = 'ended', end_reason = ?, ended_at = ?, last_seq = ? WHERE run_id = ?",
			).run(requireEndReason(event), event.occurred_at, event.seq, event.run);
			return;
		}

		if (event.kind === "run.lifecycle-changed") {
			db.prepare("UPDATE run SET lifecycle = ?, last_seq = ? WHERE run_id = ?").run(
				requireLifecycle(event),
				event.seq,
				event.run,
			);
			return;
		}

		db.prepare("UPDATE run SET last_seq = ? WHERE run_id = ?").run(event.seq, event.run);
	},
};

const ticketExecution = {
	name: "ticket_execution",
	version: 1,
	retention: PROJECTION_CLASSES.derived,
	apply(db, event) {
		if (event.run === null || event.ticket === null) return;

		db.prepare(
			`INSERT INTO ticket_execution(run_id, ticket, phase, attempt_count, started_at, last_seq)
			 VALUES (?, ?, ?, 0, ?, ?)
			 ON CONFLICT(run_id, ticket) DO UPDATE SET
			   phase = COALESCE(excluded.phase, ticket_execution.phase),
			   last_seq = excluded.last_seq`,
		).run(event.run, event.ticket, event.phase, event.occurred_at, event.seq);

		if (event.kind === "attempt.launched") {
			db.prepare(
				"UPDATE ticket_execution SET attempt_count = MAX(attempt_count, ?) WHERE run_id = ? AND ticket = ?",
			).run(attemptOrdinal(event), event.run, event.ticket);
		}
	},
};

const attempt = {
	name: "attempt",
	version: 1,
	retention: PROJECTION_CLASSES.derived,
	apply(db, event) {
		if (event.attempt === null) return;

		if (event.kind === "attempt.launched") {
			if (event.phase === null) {
				throw refusal("phase", "An attempt is launched into a phase; the slot is empty.", event);
			}
			db.prepare(
				"INSERT INTO attempt(attempt_id, run_id, ticket, ordinal, phase, outcome, launched_at, ended_at, last_seq) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?)",
			).run(event.attempt, event.run, event.ticket, attemptOrdinal(event), event.phase, event.occurred_at, event.seq);
			return;
		}

		const updated = db
			.prepare("UPDATE attempt SET last_seq = ? WHERE attempt_id = ?")
			.run(event.seq, event.attempt);
		if (updated.changes === 0) {
			throw refusal("attempt", `No attempt ${event.attempt} was ever launched in this store.`, event);
		}
	},
};

/**
 * The cross-run reverse index (§2.3, §12.2): one tracker ticket may hold
 * several ticket executions, and they are a **list, never a merge** — merging
 * them would imply budgets and outcome chains carry across runs, and they do
 * not.
 */
const ticketIndex = {
	name: "ticket_index",
	version: 1,
	retention: PROJECTION_CLASSES.permanent,
	apply(db, event) {
		if (event.run === null || event.ticket === null) return;

		db.prepare(
			`INSERT INTO ticket_index(ticket, run_id, first_seen_at, last_seen_at, disposition, last_seq)
			 VALUES (?, ?, ?, ?, NULL, ?)
			 ON CONFLICT(ticket, run_id) DO UPDATE SET
			   last_seen_at = excluded.last_seen_at,
			   last_seq = excluded.last_seq`,
		).run(event.ticket, event.run, event.occurred_at, event.occurred_at, event.seq);
	},
};

/**
 * Tier 2, permanent, maintained continuously (§12.3). Under continuous
 * maintenance expiry is purely subtractive, and a run that *crashes* rather
 * than ends already has a complete digest up to the crash.
 */
const runDigest = {
	name: "run_digest",
	/** v2 for the same reason the `run` projector is: it carries a lifecycle too. */
	version: 2,
	retention: PROJECTION_CLASSES.permanent,
	apply(db, event) {
		if (event.run === null) return;

		if (event.kind === "run.started") {
			db.prepare(
				"INSERT INTO run_digest(run_id, started_at, lifecycle, last_seq) VALUES (?, ?, ?, ?)",
			).run(event.run, event.occurred_at, INITIAL_LIFECYCLE, event.seq);
			return;
		}

		const row = db.prepare("SELECT dispositions, attempt_count FROM run_digest WHERE run_id = ?").get(event.run);
		if (row === undefined) {
			throw refusal("run", `No run ${event.run} was ever started in this store.`, event);
		}

		if (event.kind === "run.ended") {
			db.prepare(
				"UPDATE run_digest SET lifecycle = 'ended', end_reason = ?, ended_at = ?, last_seq = ? WHERE run_id = ?",
			).run(requireEndReason(event), event.occurred_at, event.seq, event.run);
			return;
		}

		if (event.kind === "run.lifecycle-changed") {
			db.prepare("UPDATE run_digest SET lifecycle = ?, last_seq = ? WHERE run_id = ?").run(
				requireLifecycle(event),
				event.seq,
				event.run,
			);
			return;
		}

		// Per-ticket final disposition is the digest's own map, so membership and
		// counts survive tier-1 expiry without consulting a table that will not.
		const dispositions = JSON.parse(row.dispositions);
		if (event.ticket !== null && !Object.hasOwn(dispositions, String(event.ticket))) {
			dispositions[String(event.ticket)] = null;
		}

		db.prepare(
			"UPDATE run_digest SET dispositions = ?, ticket_count = ?, attempt_count = ?, last_seq = ? WHERE run_id = ?",
		).run(
			canonicalJson(dispositions),
			Object.keys(dispositions).length,
			row.attempt_count + (event.kind === "attempt.launched" ? 1 : 0),
			event.seq,
			event.run,
		);
	},
};

/** Application order is the order they are declared here. */
export const PROJECTIONS = Object.freeze([run, ticketExecution, attempt, ticketIndex, runDigest]);

/** §2.1: the attempt id is `<run>-t<ticket>-a<n>`, so `n` is read off it. */
function attemptOrdinal(event) {
	return Number.parseInt(event.attempt.slice(event.attempt.lastIndexOf("-a") + 2), 10);
}

/**
 * A transition's destination, held to §10.3's four — and never to `ended`.
 *
 * An ended run carries a **mandatory** end reason, and `run.ended` is the record
 * that carries one. A `lifecycle-changed` allowed to say `ended` would be a way
 * to reach that state with the reason slot empty, which is the one thing §10.3
 * does not permit a run to be.
 */
function requireLifecycle(event) {
	const lifecycle = event.payload.lifecycle;
	if (!RUN_LIFECYCLES.includes(lifecycle) || lifecycle === RUN_LIFECYCLE.ended) {
		throw new FactoryStateError(
			"invalid-event",
			`A run moves to one of §10.3's lifecycles, and reaches "${RUN_LIFECYCLE.ended}" only ` +
				"through run.ended, which carries the mandatory reason; found " +
				`${JSON.stringify(lifecycle ?? null)}.`,
			{
				at: "payload.lifecycle",
				found: lifecycle ?? null,
				expected: RUN_LIFECYCLES.filter((value) => value !== RUN_LIFECYCLE.ended).join("|"),
				event_id: event.event_id,
			},
		);
	}
	return lifecycle;
}

function requireEndReason(event) {
	const endReason = event.payload.end_reason;
	if (!RUN_END_REASONS.includes(endReason)) {
		throw new FactoryStateError(
			"invalid-event",
			`A run ends for one of §10.3's seven reasons; found ${JSON.stringify(endReason ?? null)}.`,
			{
				at: "payload.end_reason",
				found: endReason ?? null,
				expected: RUN_END_REASONS.join("|"),
				event_id: event.event_id,
			},
		);
	}
	return endReason;
}

function requireRun(db, event) {
	if (db.prepare("SELECT 1 FROM run WHERE run_id = ?").get(event.run) === undefined) {
		throw refusal("run", `No run ${event.run} was ever started in this store.`, event);
	}
}

function refuseIfPresent(db, event) {
	if (db.prepare("SELECT 1 FROM run WHERE run_id = ?").get(event.run) !== undefined) {
		throw refusal("run", `Run ${event.run} has already started; a run id is minted once.`, event);
	}
}

function refusal(at, message, event) {
	return new FactoryStateError("invalid-event", message, { at, kind: event.kind, event_id: event.event_id });
}
