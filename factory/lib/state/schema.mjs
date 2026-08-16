/**
 * The per-repo store's tables (§4).
 *
 * Three groups, and the difference between them is the whole design:
 *
 * - **the journal** — append-only, hash-chained, never rewritten (§4.2);
 * - **projections** — derived from the journal, committed in the same
 *   transaction as the event that changes them, and therefore rebuildable
 *   (§4.4);
 * - **canonical rows** — `effect`, `lease`, `artifact`, and §5.1's two
 *   observation tables, which are *not* projections. The effect table needs a
 *   real `UNIQUE` constraint for the database itself to enforce idempotency, a
 *   lease needs compare-and-swap against a real row, the artifact ledger
 *   outlives the journal records that produced it — §12.5's tombstone is
 *   permanent while the run stream that wrote the blob is tier 1 — and an
 *   observation cursor is a watermark rather than a derived view. Their
 *   semantics belong to §4.5, §4.6, §12.1, and §5.1; this file owns only their
 *   shape.
 */

/**
 * Bumped when these statements change. A store on another version refuses.
 *
 * v2 made `lease.expires_at` nullable for §9.4's untimed capacity slots. Every
 * statement is `IF NOT EXISTS`, so an existing v1 store would keep the old
 * column and fail at the first slot rather than at open — which is precisely
 * the confusion this version guard exists to prevent.
 *
 * v3 added the §12.1 `artifact` ledger.
 *
 * v4 added §5.1's `observation_cursor` and `observed_issue`, and the partial
 * unique index that makes an observation's foreign id enforce its own dedup.
 */
export const STORE_SCHEMA_VERSION = 4;

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
	 * §5.1's dedup, enforced by the database rather than by the poll behaving
	 * itself — the same reasoning the `effect` table's primary key rests on: a
	 * duplicate must not be able to become a second row however many times a
	 * crashed poll re-runs.
	 *
	 * **Partial**, because uniqueness is a property of observations and not of
	 * the journal. A `reconcile.concluded` and an `effect.resolved` may both
	 * carry the foreign id of the same probe answer, and they are different
	 * records of it; two `observation.recorded` rows for one foreign fact are the
	 * same record twice.
	 *
	 * It doubles as the lookup that makes deduping cheap. A 15-second poll with a
	 * 60-second overlap asks "have I already recorded this?" about every record
	 * it sees, four times over, so the alternative is a table scan that grows
	 * with the repository for the life of the store.
	 */
	`CREATE UNIQUE INDEX IF NOT EXISTS event_by_foreign_source ON event (foreign_source_id)
	 WHERE kind = 'observation.recorded' AND foreign_source_id IS NOT NULL`,

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
	 * §12.1's artifact ledger. **Keyed by the content**, because a
	 * content-addressed artifact *is* its content: two productions of
	 * byte-identical output are one blob on disk and one row, so counting bytes
	 * over this table counts the disk rather than the writes.
	 *
	 * The producer columns name the **most recent** production, which is what
	 * keeps expiry safe without a second table: expiring a run reclaims only the
	 * blobs no later run has re-produced, and the later run's own expiry reclaims
	 * those. `created_at` is the first production, kept because §12.5's tombstone
	 * is dated.
	 *
	 * There is no path column, and that is the point (§14.28): nothing that reads
	 * the ledger can be handed a location, so a `../` is not a thing the store can
	 * be *told* — rather than a thing it checks for.
	 */
	`CREATE TABLE IF NOT EXISTS artifact (
		algorithm TEXT NOT NULL,
		digest TEXT NOT NULL,
		media_type TEXT NOT NULL,
		bytes INTEGER NOT NULL,
		run_id TEXT,
		ticket INTEGER,
		attempt_id TEXT,
		created_at INTEGER NOT NULL,
		produced_at INTEGER NOT NULL,
		retention_class TEXT NOT NULL CHECK (retention_class IN ('tier-1', 'permanent')),
		expired_at INTEGER,
		PRIMARY KEY (algorithm, digest)
	)`,
	"CREATE INDEX IF NOT EXISTS artifact_by_run ON artifact (run_id, created_at)",

	/**
	 * §5.1's durable observation cursor, `(scope, last_updated_at,
	 * last_foreign_id)` — the tuple the specification names, as the row it is.
	 *
	 * Canonical rather than a projection, for the same reason a lease is: it is
	 * a **watermark**, not a view of the journal. Rebuilding it from events
	 * would answer "how far did we get" with "as far as the records we kept",
	 * and §12.2 expires run streams — so the first expiry would silently re-poll
	 * a repository's whole history.
	 *
	 * Keyed by the scope because §5.1 keys it by the scope: two runs watching
	 * different selectors have different watermarks, and reading one against the
	 * other's poll would skip whatever the two do not share.
	 */
	`CREATE TABLE IF NOT EXISTS observation_cursor (
		scope TEXT PRIMARY KEY,
		source TEXT NOT NULL,
		last_updated_at INTEGER NOT NULL,
		last_updated_at_raw TEXT,
		last_foreign_id TEXT,
		opened_at INTEGER NOT NULL,
		polled_at INTEGER,
		polls INTEGER NOT NULL DEFAULT 0
	)`,

	/**
	 * §5.1's `content_version` per issue: **the cheap body-edit detector.**
	 *
	 * A body edit moves `updated_at` like everything else does, so the counter
	 * is what separates "somebody rewrote the acceptance criteria" from "a label
	 * was added" without fetching and diffing the body. Keeping the last value
	 * seen is the whole mechanism, and it lives beside the cursor because it is
	 * the same kind of thing: how far observation has got, not a view of it.
	 */
	`CREATE TABLE IF NOT EXISTS observed_issue (
		ticket INTEGER PRIMARY KEY,
		content_version INTEGER,
		state TEXT,
		updated_at INTEGER NOT NULL,
		observed_at INTEGER NOT NULL,
		last_seq INTEGER NOT NULL
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
