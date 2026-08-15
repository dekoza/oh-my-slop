/**
 * The per-repo store's tables (§4).
 *
 * Three groups, and the difference between them is the whole design:
 *
 * - **the journal** — append-only, hash-chained, never rewritten (§4.2);
 * - **projections** — derived from the journal, committed in the same
 *   transaction as the event that changes them, and therefore rebuildable
 *   (§4.4);
 * - **canonical rows** — `effect` and `lease`, which are *not* projections. The
 *   effect table needs a real `UNIQUE` constraint for the database itself to
 *   enforce idempotency, and a lease needs compare-and-swap against a real row.
 *   Their semantics belong to §4.5 and §4.6; this file owns only their shape.
 */

/**
 * Bumped when these statements change. A store on another version refuses.
 *
 * v2 made `lease.expires_at` nullable for §9.4's untimed capacity slots. Every
 * statement is `IF NOT EXISTS`, so an existing v1 store would keep the old
 * column and fail at the first slot rather than at open — which is precisely
 * the confusion this version guard exists to prevent.
 */
export const STORE_SCHEMA_VERSION = 2;

export const SCHEMA_STATEMENTS = Object.freeze([
	// ── Identity (§4.1) ─────────────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS store_identity (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		instance_uuid TEXT NOT NULL,
		canonical_repo_path TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,

	// ── The journal (§4.2, §4.3) ────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS event (
		seq INTEGER PRIMARY KEY,
		event_id TEXT NOT NULL UNIQUE,
		envelope_version INTEGER NOT NULL,
		kind TEXT NOT NULL,
		payload_version INTEGER NOT NULL,
		visibility TEXT NOT NULL CHECK (visibility IN ('operator', 'detail', 'diagnostic')),
		stream TEXT NOT NULL,
		run TEXT,
		ticket INTEGER,
		phase TEXT,
		attempt TEXT,
		causal_command_id TEXT,
		source TEXT NOT NULL,
		occurred_at INTEGER NOT NULL,
		observed_at INTEGER NOT NULL,
		foreign_source_id TEXT,
		payload TEXT NOT NULL,
		payload_digest TEXT NOT NULL,
		prev_hash TEXT NOT NULL,
		hash TEXT NOT NULL
	)`,
	"CREATE INDEX IF NOT EXISTS event_by_stream ON event (stream, seq)",
	"CREATE INDEX IF NOT EXISTS event_by_run ON event (run, seq)",

	/**
	 * The journal's head, kept as a row rather than derived from `MAX(seq)`.
	 * Expiry deletes whole streams (§4.2), so a derived head would walk
	 * *backwards* and every projection head would read as tampered-with the
	 * first time a run expired. The counter is monotonic and never reused, which
	 * is exactly §4.2's "monotonic but not gapless".
	 */
	`CREATE TABLE IF NOT EXISTS journal_head (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		last_seq INTEGER NOT NULL,
		last_hash TEXT NOT NULL
	)`,

	// ── Projections (§4.4) ──────────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS run (
		run_id TEXT PRIMARY KEY,
		lifecycle TEXT NOT NULL,
		end_reason TEXT,
		scope TEXT,
		started_at INTEGER NOT NULL,
		ended_at INTEGER,
		last_seq INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS ticket_execution (
		run_id TEXT NOT NULL,
		ticket INTEGER NOT NULL,
		phase TEXT,
		disposition TEXT,
		attempt_count INTEGER NOT NULL DEFAULT 0,
		started_at INTEGER NOT NULL,
		ended_at INTEGER,
		last_seq INTEGER NOT NULL,
		PRIMARY KEY (run_id, ticket)
	)`,
	`CREATE TABLE IF NOT EXISTS attempt (
		attempt_id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL,
		ticket INTEGER NOT NULL,
		ordinal INTEGER NOT NULL,
		phase TEXT NOT NULL,
		outcome TEXT,
		launched_at INTEGER NOT NULL,
		ended_at INTEGER,
		last_seq INTEGER NOT NULL
	)`,
	"CREATE INDEX IF NOT EXISTS attempt_by_execution ON attempt (run_id, ticket, ordinal)",

	/**
	 * The cross-run reverse index. Tier 2, permanent (§12.2): it must outlive
	 * the tier-1 streams, or "was this ticket ever attempted?" starts silently
	 * lying at the horizon — the one question cross-run history exists to
	 * answer.
	 */
	`CREATE TABLE IF NOT EXISTS ticket_index (
		ticket INTEGER NOT NULL,
		run_id TEXT NOT NULL,
		first_seen_at INTEGER NOT NULL,
		last_seen_at INTEGER NOT NULL,
		disposition TEXT,
		last_seq INTEGER NOT NULL,
		PRIMARY KEY (ticket, run_id)
	)`,

	/**
	 * Tier 2, permanent, and maintained continuously — never built at expiry
	 * time (§12.3). Building it at expiry would make a bug in the expiry path
	 * lose history irrecoverably, and a run that *crashes* would have no digest
	 * at all.
	 */
	`CREATE TABLE IF NOT EXISTS run_digest (
		run_id TEXT PRIMARY KEY,
		started_at INTEGER NOT NULL,
		ended_at INTEGER,
		lifecycle TEXT NOT NULL,
		end_reason TEXT,
		ticket_count INTEGER NOT NULL DEFAULT 0,
		attempt_count INTEGER NOT NULL DEFAULT 0,
		dispositions TEXT NOT NULL DEFAULT '{}',
		outcome_chains TEXT NOT NULL DEFAULT '{}',
		links TEXT NOT NULL DEFAULT '{}',
		attention TEXT NOT NULL DEFAULT '[]',
		transcripts TEXT NOT NULL DEFAULT '{}',
		last_seq INTEGER NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS projection_head (
		name TEXT PRIMARY KEY,
		last_seq INTEGER NOT NULL,
		projector_version INTEGER NOT NULL,
		chain_hash TEXT NOT NULL
	)`,

	// ── Canonical rows: not projections (§4.4, §4.5, §4.6) ──────────────────
	`CREATE TABLE IF NOT EXISTS effect (
		effect_key TEXT PRIMARY KEY,
		run_id TEXT,
		ticket INTEGER,
		phase TEXT NOT NULL,
		attempt_id TEXT,
		operation TEXT NOT NULL,
		operand TEXT,
		payload_digest TEXT NOT NULL,
		actor TEXT NOT NULL,
		fencing_generation INTEGER NOT NULL,
		state TEXT NOT NULL CHECK (state IN ('requested', 'resolved')),
		requested_at INTEGER NOT NULL,
		requested_seq INTEGER NOT NULL,
		resolved_at INTEGER,
		resolved_seq INTEGER,
		result TEXT
	)`,
	"CREATE INDEX IF NOT EXISTS effect_unresolved ON effect (state, run_id)",

	/**
	 * `expires_at` is nullable because §9.4's capacity slots carry **no TTL**: an
	 * expiring slot would free itself while its pane is still alive, double-booking
	 * a resource that physically has one slot (invariant 22). A null expiry is the
	 * row saying "no clock frees this" rather than a sentinel a reader must decode.
	 */
	`CREATE TABLE IF NOT EXISTS lease (
		name TEXT PRIMARY KEY,
		holder_token TEXT NOT NULL,
		fencing_generation INTEGER NOT NULL,
		expires_at INTEGER,
		renewed_at INTEGER NOT NULL,
		identity TEXT
	)`,

	/**
	 * One DB-wide monotonic counter, so fencing generations are totally ordered
	 * across *all* leases rather than per lease (§4.6).
	 */
	`CREATE TABLE IF NOT EXISTS fencing_generation (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		value INTEGER NOT NULL
	)`,
]);
