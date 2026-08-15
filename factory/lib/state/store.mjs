import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { FactoryStateError } from "./errors.mjs";
import { buildEnvelope, canonicalJson, GENESIS_PREV_HASH, streamFor } from "./events.mjs";
import { checkDatabaseIntegrity, verifyJournal } from "./integrity.mjs";
import { resolveAgentDir, resolveStorePaths } from "./location.mjs";
import {
	compareProjectionHead,
	compareProjectionHeads,
	projectionUnreadable,
	refuseMismatchedHeads,
} from "./projection-contract.mjs";
import { PROJECTIONS, REBUILD_REASONS } from "./projections.mjs";
import { quarantineDatabase } from "./quarantine.mjs";
import { rebuildProjections } from "./rebuild.mjs";
import { SCHEMA_STATEMENTS, STORE_SCHEMA_VERSION } from "./schema.mjs";
import { isCorruptionError, openDatabase } from "./sqlite.mjs";

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
	return open({ repoRoot, agentDir, compareHeads: true });
}

/**
 * The one handle that may open a store whose §4.4 compare fails — because a
 * rebuild is what *resolves* that failure, and a fail-closed compare would
 * otherwise lock the operator out of the only operation that fixes it.
 *
 * **It carries no append path and no transaction**, and that is the whole point.
 * `appendEvent` moves every projection head to the event it just wrote, so a
 * single ordinary append on a store whose compare was skipped would silently
 * repair a head mismatch — leaving projections that never replayed, no
 * `projection.rebuilt` record, and a compare that had been made decorative.
 * The only way forward from here is `rebuild()`, which records what it did.
 *
 * @param {{ repoRoot: string, agentDir?: string | null }} where
 * @returns {Promise<{ rebuild: (why: object) => object, close: () => void }>}
 */
export async function openStoreForRebuild({ repoRoot, agentDir = null }) {
	const store = await open({ repoRoot, agentDir, compareHeads: false });

	return Object.freeze({
		dbPath: store.dbPath,
		storeDir: store.storeDir,
		slug: store.slug,
		canonicalPath: store.canonicalPath,
		instanceUuid: store.instanceUuid,

		head: store.head,
		projectionHeads: store.projectionHeads,
		projectionContract: store.projectionContract,
		verifyJournal: store.verifyJournal,
		readEvents: store.readEvents,

		/** @param {{ reason: string, at?: number, actor?: string }} why */
		rebuild: (why) => rebuildProjections(store, why),
		close: store.close,
	});
}

async function open({ repoRoot, agentDir, compareHeads }) {
	const agent = agentDir ?? (await resolveAgentDir()).path;
	const paths = resolveStorePaths({ repoRoot, agentDir: agent });

	const primary = adopt(paths.primary, paths.canonicalPath, compareHeads);
	if (primary !== null) return primary;

	// §4.1: the slug is occupied by a different canonical path — two checkouts
	// whose paths fold to one slug — so this repository moves to the hashed
	// spelling rather than sharing another repository's brain.
	const hashed = adopt(paths.onCollision, paths.canonicalPath, compareHeads);
	if (hashed !== null) return hashed;

	throw new FactoryStateError(
		"repo-path-mismatch",
		`${paths.onCollision.dbPath} records a different repository than ${paths.canonicalPath}.`,
		{ store: paths.onCollision.dbPath, expected: paths.canonicalPath },
	);
}

/**
 * This repository's store, opened **read-only and never created** — the handle
 * `doctor` diagnoses through (§10.5).
 *
 * It answers `null` for a repository the factory has never run in, because
 * "there is no state yet" is a fact `doctor` reports rather than a store it
 * quietly brings into existence: §14.24's "appends nothing, writes no
 * projection" would be a strange promise to keep while creating the file.
 *
 * Which of §4.1's two spellings holds the store is settled the same way
 * `openStore` settles it — by the recorded canonical path, never by guessing
 * from the slug.
 *
 * @param {{ repoRoot: string, agentDir?: string | null }} where
 * @returns {Promise<object | null>} the read-only store, or null when there is none
 */
export async function openRepoStoreReadOnly({ repoRoot, agentDir = null }) {
	const agent = agentDir ?? (await resolveAgentDir()).path;
	const paths = resolveStorePaths({ repoRoot, agentDir: agent });

	for (const candidate of [paths.primary, paths.onCollision]) {
		if (!existsSync(candidate.dbPath)) continue;

		const reader = openStoreReadOnly({ dbPath: candidate.dbPath });
		if (reader.canonicalPath === paths.canonicalPath) return reader;
		reader.close();
	}

	return null;
}

/**
 * A reader's view: the same projection tables, no append path, and no write
 * lock (§4.1). The monitor never re-derives state from events, so this is the
 * whole of what it needs.
 *
 * `storeDir` rides along because the artifact blobs live beside the database
 * under the same per-repo state root (§12.1), and a reader resolving a digest
 * through the ledger has to know which repository's store it is reading.
 *
 * @param {{ dbPath: string }} where
 */
export function openStoreReadOnly({ dbPath }) {
	const db = openDatabase(dbPath, { readOnly: true });
	// The identity a writer would have found, so a reader can say *which*
	// repository and which journal it is answering about. Null when the file
	// carries no identity yet — a store half-created by a writer that is still
	// inside its first transaction.
	const identity = readIdentity(db);

	return Object.freeze({
		dbPath,
		storeDir: dirname(dbPath),
		canonicalPath: identity?.canonical_repo_path ?? null,
		instanceUuid: identity?.instance_uuid ?? null,
		head: () => readJournalHead(db),
		projectionHeads: () => db.prepare("SELECT * FROM projection_head ORDER BY name").all(),
		...readSurface(db),
		close: () => db.close(),
	});
}

function readIdentity(db) {
	const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_identity'").get();
	return table === undefined ? null : (db.prepare("SELECT * FROM store_identity WHERE id = 1").get() ?? null);
}

/**
 * Ownership is settled **before** anything else is read or written: a store
 * that turns out to belong to the repository next door is none of our business,
 * and version-checking or schema-writing it first would let a neighbour on a
 * future schema version lock this repository out of its own store (§4.1).
 *
 * @returns {object | null} the open store, or null when the directory is somebody else's
 */
function adopt(candidate, canonicalPath, compareHeads) {
	mkdirSync(candidate.dir, { recursive: true });
	const db = openCandidateDatabase(candidate, canonicalPath);

	try {
		const recorded = recordedRepoPath(db);
		if (recorded !== null && recorded !== canonicalPath) {
			db.close();
			return null;
		}

		// Ownership first, damage second: a store that says it belongs to the
		// repository next door is none of our business to quarantine. A store too
		// damaged to say whose it is *is* ours, because the hashed spelling exists
		// only to avoid sharing with a repository that can still name itself
		// (§4.1, §4.7).
		const integrity = checkDatabaseIntegrity(db);
		if (!integrity.ok) {
			db.close();
			throw quarantineAndRefuse(candidate, canonicalPath, integrity.problems);
		}

		const identity = initialise(db, canonicalPath);
		if (compareHeads) {
			refuseMismatchedHeads(compareProjectionHeads(db, readJournalHead(db)), candidate.dbPath);
		}
		return makeStore({ db, candidate, canonicalPath, identity });
	} catch (error) {
		db.close();
		throw error;
	}
}

/**
 * Damage most often announces itself on the very first statement, before
 * anything has had a chance to ask the file a question — so the open itself is
 * a place §4.7 can fire from, and it fires the same way as any other corruption
 * rather than surfacing as a generic "cannot open".
 */
function openCandidateDatabase(candidate, canonicalPath) {
	try {
		return openDatabase(candidate.dbPath);
	} catch (error) {
		if (error?.details?.corrupt !== true) throw error;
		throw quarantineAndRefuse(candidate, canonicalPath, error.details.problems);
	}
}

/**
 * The canonical path this store records, or `null` when there is no store here
 * yet — or when the file is too damaged to say, which the caller reads as the
 * same "no claim on this directory" and settles a moment later.
 *
 * Read without the schema, because an unrecognised store is exactly the case
 * where we must not touch anything.
 */
function recordedRepoPath(db) {
	try {
		const table = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_identity'")
			.get();
		if (table === undefined) return null;

		const row = db.prepare("SELECT canonical_repo_path FROM store_identity WHERE id = 1").get();
		return row === undefined ? null : row.canonical_repo_path;
	} catch (error) {
		if (!isCorruptionError(error)) throw error;
		return null;
	}
}

/**
 * §4.7's global stop, in the order the operator needs it to have happened: the
 * damaged file is moved aside intact, a minimal fresh store takes its place,
 * and the typed `journal.integrity-failed` fact goes into it — so `status` and
 * `doctor` have somewhere to answer from — before the refusal is thrown.
 *
 * The fresh store is a *different journal*: it mints its own instance uuid, so
 * a monitor holding a cursor into the quarantined one is told to resync rather
 * than shown a sequence that now means something else (§4.1).
 */
function quarantineAndRefuse(candidate, canonicalPath, problems) {
	const at = Date.now();
	const quarantined = quarantineDatabase({ dbPath: candidate.dbPath, at });

	const fresh = openDatabase(candidate.dbPath);
	try {
		const store = makeStore({
			db: fresh,
			candidate,
			canonicalPath,
			identity: initialise(fresh, canonicalPath),
		});
		store.append({
			kind: "journal.integrity-failed",
			source: "controller",
			occurredAt: at,
			observedAt: at,
			payload: { scope: "store", quarantine_path: quarantined.path, problems: [...problems] },
		});
		// §4.4's `post-quarantine`: the projections a monitor is about to read are
		// empty, and the record says that is because the journal behind them was
		// quarantined — not because nothing ever happened here.
		rebuildProjections(store, { reason: REBUILD_REASONS.postQuarantine, at });
	} finally {
		fresh.close();
	}

	return new FactoryStateError(
		"journal-integrity-failed",
		`${candidate.dbPath} is corrupt: ${problems.join("; ")}. It is quarantined at ${quarantined.path}, and never repaired (§4.7, §14.10).`,
		{
			store: candidate.dbPath,
			scope: "store",
			quarantine_path: quarantined.path,
			problems: [...problems],
		},
	);
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
 *
 * **The projection tables are a versioned read contract (§4.4, monitor O14),
 * and a mismatched reader refuses to render the affected values rather than
 * guessing at them** (§14.9). The refusal is per projection: a digest written by
 * a projector this build does not have says nothing about whether the `run`
 * table is readable, and blanking a whole screen over one stale head would push
 * the operator back to `sqlite3`.
 *
 * The journal readers are not gated. Events are the thing projections are
 * derived *from*; their shape is the envelope's, versioned per kind (§4.3).
 */
function readSurface(db) {
	const rendering = (name, read) => {
		const projection = PROJECTIONS.find((candidate) => candidate.name === name);
		return (...args) => {
			// Compared on every read rather than cached at open: a rebuild resolves
			// a mismatch *while* a store is open, and a reader holding the answer it
			// was given at open would keep refusing values that are now correct.
			const entry = compareProjectionHead(db, projection, readJournalHead(db));
			if (!entry.ok) throw projectionUnreadable(entry, db.path);
			return read(...args);
		};
	};

	return {
		projectionContract: () => compareProjectionHeads(db, readJournalHead(db)),

		/**
		 * `kind` narrows to one §4.3 kind. It exists because the alarms `doctor`
		 * must not miss — `journal.integrity-failed` above all — live on the
		 * *indefinite* controller stream, and finding them by reading that stream
		 * whole would cost more every day the repository is used.
		 */
		readEvents: ({ stream = null, kind = null, sinceSeq = 0, limit = null } = {}) =>
			db
				.prepare(
					`SELECT * FROM event
					 WHERE seq > ? AND (? IS NULL OR stream = ?) AND (? IS NULL OR kind = ?)
					 ORDER BY seq ASC
					 LIMIT ?`,
				)
				.all(sinceSeq, stream, stream, kind, kind, limit ?? -1)
				.map(toEnvelope),

		/** §4.7's per-stream verification. A read, so a reader may run it too. */
		verifyJournal: (options) => verifyJournal(db, options),

		readRun: rendering("run", (runId) => decodeRun(db.prepare("SELECT * FROM run WHERE run_id = ?").get(runId))),

		/**
		 * §5.4's reconcile scope, and §10.4's re-entry candidates: every run whose
		 * lifecycle is not `ended`. Oldest first, because a controller re-entering
		 * a repository takes them in the order they happened (§14.37).
		 */
		readUnendedRuns: rendering("run", () =>
			db
				.prepare("SELECT * FROM run WHERE lifecycle <> 'ended' ORDER BY started_at, run_id")
				.all()
				.map(decodeRun),
		),
		readTicketExecutions: rendering("ticket_execution", (runId) =>
			db.prepare("SELECT * FROM ticket_execution WHERE run_id = ? ORDER BY ticket").all(runId),
		),
		readAttempts: rendering("attempt", ({ runId, ticket = null }) =>
			db
				.prepare(
					"SELECT * FROM attempt WHERE run_id = ? AND (? IS NULL OR ticket = ?) ORDER BY ticket, ordinal",
				)
				.all(runId, ticket, ticket),
		),
		readTicketIndex: rendering("ticket_index", (ticket) =>
			db.prepare("SELECT * FROM ticket_index WHERE ticket = ? ORDER BY first_seen_at, run_id").all(ticket),
		),
		readRunDigest: rendering("run_digest", (runId) =>
			decodeDigest(db.prepare("SELECT * FROM run_digest WHERE run_id = ?").get(runId)),
		),

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
