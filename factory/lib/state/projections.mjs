import {
	ATTEMPT_OUTCOMES,
	CONTROLLER_EXIT_LEASE_LOST,
	NO_TRANSCRIPT_POINTER,
	PHASE_OUTCOME_DOMAINS,
	RUN_LIFECYCLE,
	RUN_LIFECYCLES,
	RUN_TERMINAL_REASONS,
	TICKET_DISPOSITIONS,
} from "../domain/vocabulary.mjs";
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
 * The kinds a projector does not name still advance its rows' `last_seq`. The
 * `disposition` column's writer is #98's abandon (the one member of §8.8's set
 * this package reaches), and the tracker actions beside it (#109) write the rest
 * additively; `outcome_chains` is #108's, filled from `stage.resolved`.
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
	// v2 read §10.3's `run.lifecycle-changed`: `preflight → running → draining`
	// were previously unreachable values, so a v1 reader would render a run's
	// whole middle as `preflight`. v3 branches the run terminal kinds on their
	// payload version (#97): a v2 projection could carry `end_reason:
	// "lease-lost"` — a state these projectors refuse to produce — so opening
	// one must be a recorded rebuild, not a silent pass.
	version: 3,
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
			if (!isLegacyTerminal(event)) refuseIfEnded(db, event);
			db.prepare(
				"UPDATE run SET lifecycle = 'ended', end_reason = ?, ended_at = ?, last_seq = ? WHERE run_id = ?",
			).run(requireEndReason(event), event.occurred_at, event.seq, event.run);
			return;
		}

		if (event.kind === "run.lifecycle-changed") {
			if (!isLegacyTerminal(event)) refuseIfEnded(db, event);
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
	// v2 reads §8.8's disposition from `ticket.disposition-changed` (#98):
	// abandon's `released` is the one value this package's writer reaches, and
	// a v1 reader would render a released execution as one still in flight —
	// the exact misreading §13.A exists to keep reconcile from making.
	version: 2,
	retention: PROJECTION_CLASSES.derived,
	apply(db, event) {
		if (event.run === null || event.ticket === null) return;

		if (event.kind === "ticket.disposition-changed") {
			const disposition = event.payload.disposition;
			if (!TICKET_DISPOSITIONS.includes(disposition)) {
				throw refusal(
					"payload.disposition",
					`A ticket execution settles at one of §8.8's dispositions (${TICKET_DISPOSITIONS.join(
						", ",
					)}); found ${JSON.stringify(disposition ?? null)}.`,
					event,
				);
			}
			// Before the generic upsert on purpose: a disposition has no ticket
			// execution to settle when no record ever carried that ticket, and
			// minting the row here would be a fact with no evidence behind it.
			const updated = db
				.prepare(
					"UPDATE ticket_execution SET disposition = ?, ended_at = ?, last_seq = ? WHERE run_id = ? AND ticket = ?",
				)
				.run(disposition, event.occurred_at, event.seq, event.run, event.ticket);
			if (updated.changes === 0) {
				throw refusal(
					"ticket",
					`Ticket ${event.ticket} has no execution in run ${event.run}; a disposition has nothing to settle.`,
					event,
				);
			}
			return;
		}

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
	// v2 reads §6.6's `attempt.ended` (#107): the `outcome` and `ended_at`
	// columns were unwritten under v1, so a v1 reader renders every harvested
	// attempt as still running — the state an operator most needs to be able to
	// tell apart from a live one.
	version: 2,
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

		if (event.kind === "attempt.ended") {
			// **An attempt ends once.** §6.6's "late outboxes are ignored for state"
			// is this refusal and not a rule the harvest path follows: a worker that
			// keeps writing after the controller decided, or a cancellation racing a
			// harvest, cannot move an attempt that already settled.
			refuseIfAttemptEnded(db, event);
			db.prepare("UPDATE attempt SET outcome = ?, ended_at = ?, last_seq = ? WHERE attempt_id = ?").run(
				requireAttemptOutcome(event),
				event.occurred_at,
				event.seq,
				event.attempt,
			);
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
	/**
	 * v3 for the same reasons the `run` projector is: it renders the same
	 * terminal state.
	 *
	 * v4 records §12.3's **transcript pointers**, which are tier-2 permanent and
	 * therefore have to be captured here rather than read back from a run stream
	 * that expires. §6.5 is explicit that no later heuristic can recover one:
	 * Herdr drops the reference when the pane goes away, and integration deletes the
	 * worktree pi's path is keyed on, so a pointer not written into the digest
	 * when it arrives is a transcript nobody can find again (§12.9).
	 *
	 * v5 records §8.10's **outcome chains** (#108), which are tier-2 permanent for
	 * the reason the transcripts are: the chain's *shape* is what an operator
	 * reads a finished run by, and the run stream it could otherwise be recomputed
	 * from expires at the tier-1 horizon. A v4 digest renders every ticket
	 * execution as having no history at all, which is indistinguishable from one
	 * that never ran a phase.
	 */
	version: 5,
	retention: PROJECTION_CLASSES.permanent,
	apply(db, event) {
		if (event.run === null) return;

		if (event.kind === "run.started") {
			db.prepare(
				"INSERT INTO run_digest(run_id, started_at, lifecycle, last_seq) VALUES (?, ?, ?, ?)",
			).run(event.run, event.occurred_at, INITIAL_LIFECYCLE, event.seq);
			return;
		}

		const row = db
			.prepare("SELECT dispositions, outcome_chains, attempt_count, transcripts FROM run_digest WHERE run_id = ?")
			.get(event.run);
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
			"UPDATE run_digest SET dispositions = ?, outcome_chains = ?, ticket_count = ?, attempt_count = ?, transcripts = ?, last_seq = ? WHERE run_id = ?",
		).run(
			canonicalJson(dispositions),
			canonicalJson(withStage(JSON.parse(row.outcome_chains), event)),
			Object.keys(dispositions).length,
			row.attempt_count + (event.kind === "attempt.launched" ? 1 : 0),
			canonicalJson(withTranscript(JSON.parse(row.transcripts), event)),
			event.seq,
			event.run,
		);
	},
};

/**
 * §6.5's `{worker_kind, transcript_kind, transcript_value, captured_at}`, keyed
 * by attempt, kept permanently (§12.3).
 *
 * A launch that captured nothing records the **absence** rather than nothing at
 * all: §6.5's `no-transcript-pointer` is a fact about that attempt — nobody can
 * ever recover the pointer — and a missing key would read as "this run predates
 * the field", which is a different thing entirely.
 */
function withTranscript(transcripts, event) {
	if (event.kind !== "attempt.correlated" || event.attempt === null) return transcripts;

	const pointer = event.payload.transcript ?? null;
	transcripts[event.attempt] =
		pointer === null
			? { worker_kind: event.payload.runtime ?? null, missing: NO_TRANSCRIPT_POINTER }
			: {
					worker_kind: event.payload.runtime ?? null,
					transcript_kind: pointer.kind ?? null,
					transcript_value: pointer.value ?? null,
					captured_at: pointer.captured_at ?? null,
				};
	return transcripts;
}

/**
 * §8.10's outcome chain, per ticket, in the tier-2 digest (§12.3).
 *
 * The **shape** is what survives tier-1 expiry, and the shape is the whole
 * point: an operator's next action depends on how a ticket execution got where
 * it is, not on where it ended. A ticket that failed verify twice and one that
 * was rejected once both end at `paused`, and they need different things.
 *
 * The outcome is held to the phase's declared domain **here**, on the write
 * path, for the same reason `requireAttemptOutcome` holds `attempt.ended` to
 * §8.8's set: a projector that accepted an outcome §8.10 cannot route would put
 * a step in a permanent chain that the machine reading it back can never act on.
 * The domain is read from the vocabulary rather than from the table, so the
 * state layer stays below the pipeline that walks it — and §8.10's own totality
 * test is what keeps the two in step.
 */
function withStage(chains, event) {
	if (event.kind !== "stage.resolved") return chains;

	const domain = PHASE_OUTCOME_DOMAINS[event.phase];
	if (domain === undefined || !domain.includes(event.payload.outcome)) {
		throw refusal(
			"payload.outcome",
			`§8.10 maps no outcome ${JSON.stringify(event.payload.outcome ?? null)} for phase ` +
				`${JSON.stringify(event.phase)}; a stage resolves to one of ${domain === undefined ? "a pipeline phase's outcomes" : domain.join(", ")}.`,
			event,
		);
	}

	const key = String(event.ticket);
	chains[key] = [
		...(chains[key] ?? []),
		{ phase: event.phase, outcome: event.payload.outcome, attempt: event.attempt },
	];
	return chains;
}

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

/**
 * Is this record from the run terminal kinds' v1 payload era?
 *
 * v1 `run.ended` and `run.lifecycle-changed` were written under §10.3's
 * original reading: `lease-lost` was an acceptable ending, a second ending
 * overwrote the first, and a move after the end moved the run. Those journals
 * were valid when written, and a replay that refused them would classify
 * compatibility as corruption — so v1 replays with v1's tolerance, and the
 * tightened contract binds from v2 on. The live write path cannot produce a v1
 * record: `buildEnvelope` stamps every kind with the version this binary
 * declares, which is what keeps this branch history-only.
 */
function isLegacyTerminal(event) {
	return event.payload_version === 1;
}

/**
 * The end reasons v1 payloads could carry: today's six plus `lease-lost`,
 * frozen here as history rather than imported as anyone's current vocabulary.
 */
const LEGACY_END_REASONS = Object.freeze([...RUN_TERMINAL_REASONS, CONTROLLER_EXIT_LEASE_LOST]);

/**
 * §10.3's mandatory reason, held to the six a run can actually end for.
 *
 * `lease-lost` is the published table's seventh row and is refused here: it
 * names a **controller process's** exit outcome, not a run's ending. The process
 * that lost its lease no longer owns the run — a successor may already be
 * adopting the same `run_id` — so a `run.ended` carrying that reason is a stale
 * writer closing somebody else's work. The rule is enforced on the write path
 * rather than left to the one call site that ends runs, because that is the
 * difference between an invariant and a habit. A v1 record is the one exception,
 * replayed under the contract it was written to.
 */
function requireEndReason(event) {
	const endReason = event.payload.end_reason;
	if (isLegacyTerminal(event)) {
		if (LEGACY_END_REASONS.includes(endReason)) return endReason;
		throw new FactoryStateError(
			"invalid-event",
			`A v1 run.ended carries one of its era's seven reasons; found ${JSON.stringify(endReason ?? null)}.`,
			{
				at: "payload.end_reason",
				found: endReason ?? null,
				expected: LEGACY_END_REASONS.join("|"),
				event_id: event.event_id,
			},
		);
	}
	if (!RUN_TERMINAL_REASONS.includes(endReason)) {
		throw new FactoryStateError(
			"invalid-event",
			endReason === CONTROLLER_EXIT_LEASE_LOST
				? `"${endReason}" is a controller process's exit, not a reason a run ends; the process that ` +
					"lost its lease leaves the run open for the successor that may already own it (§14.6)."
				: `A run ends for one of §10.3's reasons; found ${JSON.stringify(endReason ?? null)}.`,
			{
				at: "payload.end_reason",
				found: endReason ?? null,
				expected: RUN_TERMINAL_REASONS.join("|"),
				event_id: event.event_id,
			},
		);
	}
	return endReason;
}

/**
 * §8.8's attempt outcome, held to the closed set — worker-writable three plus
 * controller-derived seven. The enforcement is on the write path rather than at
 * the one call site that harvests, because that is the difference between an
 * invariant and a habit.
 */
function requireAttemptOutcome(event) {
	const outcome = event.payload.outcome;
	if (ATTEMPT_OUTCOMES.includes(outcome)) return outcome;

	throw new FactoryStateError(
		"invalid-event",
		`An attempt ends at one of §8.8's outcomes; found ${JSON.stringify(outcome ?? null)}.`,
		{
			at: "payload.outcome",
			found: outcome ?? null,
			expected: ATTEMPT_OUTCOMES.join("|"),
			event_id: event.event_id,
		},
	);
}

function refuseIfAttemptEnded(db, event) {
	const row = db.prepare("SELECT outcome FROM attempt WHERE attempt_id = ?").get(event.attempt);
	if (row === undefined) {
		throw refusal("attempt", `No attempt ${event.attempt} was ever launched in this store.`, event);
	}
	if (row.outcome !== null) {
		throw refusal(
			"attempt",
			`Attempt ${event.attempt} already ended as ${row.outcome}; the first result wins and later writes are evidence (§6.6).`,
			event,
		);
	}
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

function refuseIfEnded(db, event) {
	const row = db.prepare("SELECT lifecycle FROM run WHERE run_id = ?").get(event.run);
	if (row?.lifecycle === RUN_LIFECYCLE.ended) {
		throw refusal("run", `Run ${event.run} has already ended; its terminal reason is immutable.`, event);
	}
}

function refusal(at, message, event) {
	return new FactoryStateError("invalid-event", message, { at, kind: event.kind, event_id: event.event_id });
}
