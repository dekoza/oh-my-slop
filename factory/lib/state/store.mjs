import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { FactoryStateError } from "./errors.mjs";
import { buildEnvelope, canonicalJson, GENESIS_PREV_HASH, streamFor } from "./events.mjs";
import { resolveAgentDir, resolveStorePaths } from "./location.mjs";
import { PROJECTIONS, REBUILD_REASONS } from "./projections.mjs";
import { SCHEMA_STATEMENTS, STORE_SCHEMA_VERSION } from "./schema.mjs";
import { openDatabase } from "./sqlite.mjs";

/**
 * The per-repo durable store (§4).
 *
 * One database per repository, holding a per-stream hash-chained journal and
 * the projections derived from it. **An event append and its projection update
 * commit in one transaction** — the legacy `job-pipeline` had a checksummed
 * journal *and* a step-rank heuristic that let a stored snapshot beat the
 * replay, and this is the design that makes such a rule impossible to need.
 *
 * The journal records **intent** and never establishes an external fact (§14.1).
 */

/**
 * @param {{ repoRoot: string, agentDir?: string | null }} where `agentDir`
 *   defaults to the pi SDK's `getAgentDir()`; tests and `doctor` pass their own.
 * @returns {Promise<object>} the open store
 * @throws {FactoryStateError}
 */
export async function openStore({ repoRoot, agentDir = null }) {
	const agent = agentDir ?? (await resolveAgentDir()).path;
	const paths = resolveStorePaths({ repoRoot, agentDir: agent });

	const primary = adopt(paths.primary, paths.canonicalPath);
	if (primary !== null) return primary;

	// §4.1: the slug is occupied by a different canonical path — two checkouts
	// whose paths fold to one slug — so this repository moves to the hashed
	// spelling rather than sharing another repository's brain.
	const hashed = adopt(paths.onCollision, paths.canonicalPath);
	if (hashed !== null) return hashed;

	throw new FactoryStateError(
		"repo-path-mismatch",
		`${paths.onCollision.dbPath} records a different repository than ${paths.canonicalPath}.`,
		{ store: paths.onCollision.dbPath, expected: paths.canonicalPath },
	);
}

/**
 * A reader's view: the same projection tables, no append path, and no write
 * lock (§4.1). The monitor never re-derives state from events, so this is the
 * whole of what it needs.
 *
 * @param {{ dbPath: string }} where
 */
export function openStoreReadOnly({ dbPath }) {
	const db = openDatabase(dbPath, { readOnly: true });
	return Object.freeze({ dbPath, ...readSurface(db), close: () => db.close() });
}

/**
 * Ownership is settled **before** anything else is read or written: a store
 * that turns out to belong to the repository next door is none of our business,
 * and version-checking or schema-writing it first would let a neighbour on a
 * future schema version lock this repository out of its own store (§4.1).
 *
 * @returns {object | null} the open store, or null when the directory is somebody else's
 */
function adopt(candidate, canonicalPath) {
	mkdirSync(candidate.dir, { recursive: true });
	const db = openDatabase(candidate.dbPath);

	try {
		const recorded = recordedRepoPath(db);
		if (recorded !== null && recorded !== canonicalPath) {
			db.close();
			return null;
		}

		const identity = initialise(db, canonicalPath);
		verifyProjectionHeads(db, candidate.dbPath);
		return makeStore({ db, candidate, canonicalPath, identity });
	} catch (error) {
		db.close();
		throw error;
	}
}

/**
 * The canonical path this store records, or `null` when there is no store here
 * yet. Read without the schema, because an unrecognised store is exactly the
 * case where we must not touch anything.
 */
function recordedRepoPath(db) {
	const table = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_identity'")
		.get();
	if (table === undefined) return null;

	const row = db.prepare("SELECT canonical_repo_path FROM store_identity WHERE id = 1").get();
	return row === undefined ? null : row.canonical_repo_path;
}

/**
 * Schema, then identity. A store that already exists keeps its journal instance
 * uuid: the monitor's SSE cursor is the pair `(instance_uuid, seq)`, so minting
 * a new one on reopen would force a full resync every restart.
 */
function initialise(db, canonicalPath) {
	const version = db.pragma("user_version");
	if (version !== 0 && version !== STORE_SCHEMA_VERSION) {
		throw new FactoryStateError(
			"store-schema-version",
			`${db.path} is a v${version} store; this factory reads v${STORE_SCHEMA_VERSION}.`,
			{ store: db.path, found: version, expected: STORE_SCHEMA_VERSION },
		);
	}

	return db.transaction(() => {
		for (const statement of SCHEMA_STATEMENTS) db.exec(statement);

		const existing = db.prepare("SELECT * FROM store_identity WHERE id = 1").get();
		if (existing !== undefined) return existing;

		const identity = {
			id: 1,
			instance_uuid: randomUUID(),
			canonical_repo_path: canonicalPath,
			created_at: Date.now(),
		};
		db.prepare(
			"INSERT INTO store_identity(id, instance_uuid, canonical_repo_path, created_at) VALUES (1, ?, ?, ?)",
		).run(identity.instance_uuid, identity.canonical_repo_path, identity.created_at);
		db.prepare("INSERT INTO journal_head(id, last_seq, last_hash) VALUES (1, 0, ?)").run(GENESIS_PREV_HASH);
		db.prepare("INSERT INTO fencing_generation(id, value) VALUES (1, 0)").run();
		for (const projection of PROJECTIONS) {
			db.prepare(
				"INSERT INTO projection_head(name, last_seq, projector_version, chain_hash) VALUES (?, 0, ?, ?)",
			).run(projection.name, projection.version, GENESIS_PREV_HASH);
		}
		db.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION}`);

		return identity;
	});
}

/**
 * §4.4's startup compare, **fail-closed with no "compare only when both
 * present" downgrade** — that downgrade is the hole the Babysitter audit found,
 * and a missing head row is therefore a mismatch rather than a skipped check.
 *
 * Repair is not this function's business: rebuilding a projection is #91's
 * recorded, reasoned operation, and rebuilding one silently here would make the
 * compare decorative.
 */
function verifyProjectionHeads(db, dbPath) {
	const journalHead = readJournalHead(db);

	for (const projection of PROJECTIONS) {
		const head = db.prepare("SELECT * FROM projection_head WHERE name = ?").get(projection.name);

		if (head === undefined) {
			throw new FactoryStateError(
				"projection-head-mismatch",
				`Projection "${projection.name}" has no head in ${dbPath}; it cannot be compared against the journal.`,
				{ store: dbPath, projection: projection.name, expected: journalHead.seq, found: null },
			);
		}

		if (head.projector_version !== projection.version) {
			throw new FactoryStateError(
				"projector-version-change",
				`Projection "${projection.name}" was built by projector v${head.projector_version}; this factory ships v${projection.version}. It needs a recorded rebuild, not a silent migration.`,
				{
					store: dbPath,
					projection: projection.name,
					found: head.projector_version,
					expected: projection.version,
					rebuild_reason: REBUILD_REASONS.projectorVersionChange,
				},
			);
		}

		if (head.last_seq !== journalHead.seq || head.chain_hash !== journalHead.hash) {
			throw new FactoryStateError(
				"projection-head-mismatch",
				`Projection "${projection.name}" is at seq ${head.last_seq}, the journal at ${journalHead.seq}.`,
				{
					store: dbPath,
					projection: projection.name,
					found: head.last_seq,
					expected: journalHead.seq,
					rebuild_reason: REBUILD_REASONS.headMismatch,
				},
			);
		}
	}
}

function makeStore({ db, candidate, canonicalPath, identity }) {
	/**
	 * The one write path. Sequence, chain, envelope, row, and every projection
	 * happen here, inside the caller's transaction — §14.8 holds because there
	 * is nowhere else an event can be written from.
	 */
	function appendEvent(input) {
		// The stream is settled once, here: chaining against a stream the
		// envelope then turns out not to carry is how a chain silently forks.
		const stream = input.stream ?? streamFor(input.kind, input.run ?? null);
		const envelope = buildEnvelope({
			...input,
			stream,
			seq: readJournalHead(db).seq + 1,
			prevHash: streamHead(db, stream),
		});

		db.prepare(
			`INSERT INTO event(seq, event_id, envelope_version, kind, payload_version, visibility, stream, run,
			                   ticket, phase, attempt, causal_command_id, source, occurred_at, observed_at,
			                   foreign_source_id, payload, payload_digest, prev_hash, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			envelope.seq,
			envelope.event_id,
			envelope.envelope_version,
			envelope.kind,
			envelope.payload_version,
			envelope.visibility,
			envelope.stream,
			envelope.run,
			envelope.ticket,
			envelope.phase,
			envelope.attempt,
			envelope.causal_command_id,
			envelope.source,
			envelope.occurred_at,
			envelope.observed_at,
			envelope.foreign_source_id,
			canonicalJson(envelope.payload),
			envelope.payload_digest,
			envelope.prev_hash,
			envelope.hash,
		);

		for (const projection of PROJECTIONS) {
			projection.apply(db, envelope);
			db.prepare("UPDATE projection_head SET last_seq = ?, chain_hash = ? WHERE name = ?").run(
				envelope.seq,
				envelope.hash,
				projection.name,
			);
		}

		db.prepare("UPDATE journal_head SET last_seq = ?, last_hash = ? WHERE id = 1").run(
			envelope.seq,
			envelope.hash,
		);

		return envelope;
	}

	return Object.freeze({
		dbPath: candidate.dbPath,
		storeDir: candidate.dir,
		slug: candidate.slug,
		canonicalPath,
		instanceUuid: identity.instance_uuid,

		/** One event in its own transaction. */
		append: (input) => db.transaction(() => appendEvent(input)),

		/**
		 * Several events, or an event beside a canonical `effect` or `lease` row,
		 * in one transaction. Those rows are not projections (§4.4) and still
		 * emit their events here, so there is no drift to reconcile.
		 *
		 * @param {(tx: { appendEvent: (input: object) => object, db: object }) => unknown} body
		 */
		transaction: (body) => db.transaction(() => body({ appendEvent, db })),

		head: () => readJournalHead(db),
		projectionHeads: () => db.prepare("SELECT * FROM projection_head ORDER BY name").all(),
		checkCursor: (cursor) => checkCursor(db, identity, cursor),

		...readSurface(db),

		close: () => db.close(),
	});
}

/**
 * The read half, shared with `openStoreReadOnly` so a reader and the controller
 * cannot disagree about what a projection row says.
 */
function readSurface(db) {
	return {
		readEvents: ({ stream = null, sinceSeq = 0, limit = null } = {}) =>
			db
				.prepare(
					`SELECT * FROM event
					 WHERE seq > ? AND (? IS NULL OR stream = ?)
					 ORDER BY seq ASC
					 LIMIT ?`,
				)
				.all(sinceSeq, stream, stream, limit ?? -1)
				.map(toEnvelope),

		readRun: (runId) => decodeRun(db.prepare("SELECT * FROM run WHERE run_id = ?").get(runId)),
		readTicketExecutions: (runId) =>
			db.prepare("SELECT * FROM ticket_execution WHERE run_id = ? ORDER BY ticket").all(runId),
		readAttempts: ({ runId, ticket = null }) =>
			db
				.prepare(
					"SELECT * FROM attempt WHERE run_id = ? AND (? IS NULL OR ticket = ?) ORDER BY ticket, ordinal",
				)
				.all(runId, ticket, ticket),
		readTicketIndex: (ticket) =>
			db.prepare("SELECT * FROM ticket_index WHERE ticket = ? ORDER BY first_seen_at, run_id").all(ticket),
		readRunDigest: (runId) => decodeDigest(db.prepare("SELECT * FROM run_digest WHERE run_id = ?").get(runId)),

		/** Escape hatch for the modules that own the canonical tables (§4.5, §4.6). */
		read: (body) => body(db),
	};
}

/**
 * §4.2: `prev_hash` links **within a stream**, so a new stream starts at
 * genesis however busy its neighbours are.
 */
function streamHead(db, stream) {
	const row = db.prepare("SELECT hash FROM event WHERE stream = ? ORDER BY seq DESC LIMIT 1").get(stream);
	return row === undefined ? GENESIS_PREV_HASH : row.hash;
}

function readJournalHead(db) {
	const row = db.prepare("SELECT last_seq, last_hash FROM journal_head WHERE id = 1").get();
	return { seq: row.last_seq, hash: row.last_hash };
}

/**
 * The monitor's cursor is the pair `(instance_uuid, seq)` (§4.1): a cursor
 * presented against a different journal is detectable, and forces a full
 * resync rather than a silently wrong resume.
 */
function checkCursor(db, identity, { instanceUuid, seq }) {
	if (instanceUuid !== identity.instance_uuid) return { ok: false, reason: "foreign-journal" };
	if (seq > readJournalHead(db).seq) return { ok: false, reason: "ahead-of-head" };
	return { ok: true, resumeFrom: seq };
}

function toEnvelope(row) {
	return Object.freeze({ ...row, payload: JSON.parse(row.payload) });
}

function decodeRun(row) {
	if (row === undefined) return null;
	return { ...row, scope: row.scope === null ? null : JSON.parse(row.scope) };
}

function decodeDigest(row) {
	if (row === undefined) return null;
	return {
		...row,
		dispositions: JSON.parse(row.dispositions),
		outcome_chains: JSON.parse(row.outcome_chains),
		links: JSON.parse(row.links),
		attention: JSON.parse(row.attention),
		transcripts: JSON.parse(row.transcripts),
	};
}
