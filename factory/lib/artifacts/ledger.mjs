import { IDENTITY_CHARSET } from "../domain/vocabulary.mjs";
import { artifactAddress, probeArtifactBlob, readArtifactBlob } from "./blobs.mjs";
import { FactoryArtifactError } from "./errors.mjs";

/**
 * §12.1's artifact ledger: the table every reference resolves through.
 *
 * **Nothing references an artifact by path — only by digest, resolved through
 * the ledger** (§14.28). The row carries digest, media type, byte count, the
 * producing run/ticket/attempt, created-at, and retention class, and it carries
 * no location at all: a reader holding a row cannot be handed a path, so the
 * audited `../` escape has nowhere to appear.
 *
 * The row is **canonical rather than a projection** (§4.4). It is not derivable
 * from the journal — §12.5's tombstone outlives the tier-1 run stream that
 * produced the blob by years — and like `effect` and `lease` it rides the same
 * transaction as the event that records the write, so there is no drift.
 */

/**
 * §12.2's classes, as an artifact wears them.
 *
 * `tier-1` is "inherit their run's tier": the blob dies with its run's stream at
 * the horizon, leaving a dated tombstone row. `permanent` is what a repo-scoped
 * artifact gets, because no run's expiry ever names it (§12.6) — the honest
 * class is the one that never comes up for expiry, not a tier borrowed from a
 * run that does not exist.
 */
export const ARTIFACT_RETENTION_CLASSES = Object.freeze(["tier-1", "permanent"]);

/** `type/subtype`, no parameters: the factory records what it wrote, not how to decode it. */
const MEDIA_TYPE_SHAPE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/;

/**
 * The class this producer's artifacts belong to. **Derived, never chosen** —
 * §12.2 says artifacts inherit their run's tier, and a row that disagreed with
 * its producer would turn byte accounting per class into a report about what
 * somebody typed.
 *
 * @param {{ run?: string | null }} producer
 * @returns {string}
 */
export function retentionClassFor({ run = null }) {
	return run === null ? "permanent" : "tier-1";
}

/**
 * Record a production, in the caller's transaction.
 *
 * It takes a `tx` rather than a store because the row commits **with** the
 * effect resolution that says the blob was written (§4.5): a ledger row without
 * its resolution, or a resolution without its row, is an artifact half the
 * system can see.
 *
 * A second production of byte-identical content is not a second artifact. The
 * row is kept, its `created_at` with it, and the producer is restamped to the
 * later production — which is what lets expiry reclaim a blob exactly once,
 * from the last run that produced it, with no reference counting anywhere.
 *
 * @param {{ appendEvent: (input: object) => object, db: object }} tx
 * @param {{ algorithm?: string, digest: string, mediaType: string, bytes: number,
 *           run?: string | null, ticket?: number | null, attempt?: string | null,
 *           at?: number }} production
 * @returns {Readonly<object>} the ledger row
 * @throws {FactoryArtifactError}
 */
export function recordArtifact(
	tx,
	{ algorithm, digest, mediaType, bytes, run = null, ticket = null, attempt = null, at = Date.now() },
) {
	const address = artifactAddress({ algorithm, digest });
	artifactMediaType(mediaType);
	requireProducer({ run, ticket, attempt });

	const existing = row(tx.db, address);
	if (existing !== null && existing.media_type !== mediaType) {
		throw new FactoryArtifactError(
			"artifact-media-type-conflict",
			`Artifact ${address.digest} is recorded as ${existing.media_type}; the same bytes never carry two media types.`,
			{ digest: address.digest, expected: existing.media_type, found: mediaType },
		);
	}

	tx.db
		.prepare(
			`INSERT INTO artifact(algorithm, digest, media_type, bytes, run_id, ticket, attempt_id,
			                      created_at, produced_at, retention_class, expired_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			 ON CONFLICT(algorithm, digest) DO UPDATE SET run_id = excluded.run_id,
			                                              ticket = excluded.ticket,
			                                              attempt_id = excluded.attempt_id,
			                                              produced_at = excluded.produced_at,
			                                              retention_class = excluded.retention_class,
			                                              -- The digest exists again, so resolving it as
			                                              -- expired would be the ledger lying about bytes
			                                              -- that are right there (§12.5).
			                                              expired_at = NULL`,
		)
		.run(
			address.algorithm,
			address.digest,
			mediaType,
			bytes,
			run,
			ticket,
			attempt,
			at,
			at,
			retentionClassFor({ run }),
		);

	return Object.freeze(describe(row(tx.db, address)));
}

/**
 * §12.5's tombstone: the blob is gone, the row stays. Digest, byte count, class,
 * and producer are a few dozen bytes kept permanently, so a digest written into
 * a two-year-old PR body resolves to `unavailable(retention-expired)` **with a
 * date** rather than to "unknown digest" — expired and never-existed must never
 * look alike.
 *
 * **This row is the record of the deletion**, which is why expiry marks it
 * *before* unlinking rather than behind an `artifact-delete` effect: a crash in
 * between leaves a digest that still resolves to the right answer, dated, and
 * the next pass re-attempts the unlink. §4.5's pair stays cleanup's, for the
 * orphaned blobs that have no row to be the record (§12.8). The sequencing is
 * `retention/expiry.mjs`'s.
 *
 * @param {{ appendEvent: (input: object) => object, db: object }} tx
 * @param {{ algorithm?: string, digest: string }} address
 * @param {{ at?: number }} [when]
 * @returns {Readonly<object>} the tombstoned row
 * @throws {FactoryArtifactError} `artifact-unknown`
 */
export function tombstoneArtifact(tx, address, { at = Date.now() } = {}) {
	const resolved = artifactAddress(address);
	const existing = row(tx.db, resolved);
	if (existing === null) throw unknown(resolved);

	// Only the first expiry dates the tombstone. A re-run of expiry over a row
	// whose blob is already gone would otherwise keep moving the date forward,
	// and the date is the operator's only evidence of *when* the bytes went.
	if (existing.expired_at === null) {
		tx.db
			.prepare("UPDATE artifact SET expired_at = ? WHERE algorithm = ? AND digest = ?")
			.run(at, resolved.algorithm, resolved.digest);
	}

	return Object.freeze(describe(row(tx.db, resolved)));
}

/**
 * What this digest resolves to, and why.
 *
 * Four answers, kept apart on purpose: an available blob, a **dated tombstone**
 * (§12.5), a blob that is gone without having expired, and a digest the ledger
 * has never seen. A stale deep link and a mis-click are different mistakes, and
 * so are "the horizon passed" and "something swept evidence a pin should have
 * held" (§12.4).
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {{ algorithm?: string, digest: string }} address
 * @returns {Readonly<object>} the resolution
 */
export function resolveArtifact(store, address) {
	const resolved = artifactAddress(address);
	const found = store.read((db) => row(db, resolved));

	if (found === null) {
		return Object.freeze({
			status: "unknown",
			reason: "never-recorded",
			...resolved,
			media_type: null,
			bytes: null,
			retention_class: null,
			producer: Object.freeze({ run: null, ticket: null, attempt: null }),
			created_at: null,
			produced_at: null,
			expired_at: null,
		});
	}

	return Object.freeze({ ...describe(found), ...availability(store, found) });
}

/**
 * The bytes, for a caller that has a digest and wants what it names.
 *
 * There is no path-returning counterpart, deliberately: a caller handed a path
 * would be one refactor away from putting it in a payload, and §14.28 would then
 * hold everywhere except where it mattered.
 *
 * @param {object} store
 * @param {{ algorithm?: string, digest: string }} address
 * @returns {Buffer}
 * @throws {FactoryArtifactError} `artifact-unknown` · `artifact-unavailable`
 */
export function readArtifact(store, address) {
	const resolution = resolveArtifact(store, address);
	if (resolution.status === "unknown") throw unknown(resolution);

	const content = resolution.status === "available" ? readArtifactBlob(store.storeDir, resolution) : null;
	if (content === null) {
		throw new FactoryArtifactError(
			"artifact-unavailable",
			`Artifact ${resolution.digest} is ${resolution.reason}.`,
			{ digest: resolution.digest, reason: resolution.reason, expired_at: resolution.expired_at },
		);
	}

	return content;
}

/**
 * §12.10's per-class accounting: **it falls out of the ledger**, because the row
 * already carries the byte count and the class. There is nothing else to keep in
 * step, and therefore nothing that can disagree.
 *
 * `bytes` is what is still on disk; `expired_bytes` is what tombstones remember
 * having reclaimed. **Accounting reports and never triggers** (§12.10) — the
 * horizon and the pins are the only expiry triggers.
 *
 * @param {object} store
 * @returns {ReadonlyArray<object>} one entry per class present, in §12.2's order
 */
export function artifactBytesByClass(store) {
	return Object.freeze(
		totalsBy(store, "retention_class").sort(
			(left, right) =>
				ARTIFACT_RETENTION_CLASSES.indexOf(left.retention_class) -
				ARTIFACT_RETENTION_CLASSES.indexOf(right.retention_class),
		),
	);
}

/**
 * The same numbers per run — §12.10's other half, and what `status` reports
 * beside a run. Repo-scoped artifacts answer under `run_id: null` rather than
 * being dropped: they are bytes on the same disk.
 *
 * @param {object} store
 * @returns {ReadonlyArray<object>}
 */
export function artifactBytesByRun(store) {
	return Object.freeze(totalsBy(store, "run_id", "ORDER BY run_id"));
}

/**
 * The one aggregate, grouped by whichever column the caller reports along. The
 * column names are this module's own literals, never a caller's string.
 */
function totalsBy(store, column, order = "") {
	return store.read((db) =>
		db
			.prepare(
				`SELECT ${column},
				        COUNT(*) AS artifacts,
				        COALESCE(SUM(CASE WHEN expired_at IS NULL THEN bytes ELSE 0 END), 0) AS bytes,
				        COUNT(expired_at) AS expired,
				        COALESCE(SUM(CASE WHEN expired_at IS NULL THEN 0 ELSE bytes END), 0) AS expired_bytes
				 FROM artifact
				 GROUP BY ${column} ${order}`,
			)
			.all()
			// Rebuilt rather than passed through: these go to `status`, `doctor`,
			// and the monitor, and the driver's own row object is a null-prototype
			// bag whose shape is the driver's business.
			.map((entry) =>
				Object.freeze({
					[column]: entry[column],
					artifacts: entry.artifacts,
					bytes: entry.bytes,
					expired: entry.expired,
					expired_bytes: entry.expired_bytes,
				}),
			),
	);
}

/**
 * The ledger's view of a row: §12.1's fields with the producer gathered up.
 *
 * **One shape, whichever door a caller came through** — recording, tombstoning,
 * and resolving all answer in it, so nothing downstream has to know whether the
 * artifact in hand was just written or just looked up.
 */
function describe(found) {
	return {
		algorithm: found.algorithm,
		digest: found.digest,
		media_type: found.media_type,
		bytes: found.bytes,
		retention_class: found.retention_class,
		producer: Object.freeze({ run: found.run_id, ticket: found.ticket, attempt: found.attempt_id }),
		created_at: found.created_at,
		produced_at: found.produced_at,
		expired_at: found.expired_at,
	};
}

/**
 * The row says whether the blob *should* be there; the probe says whether it is,
 * and §4.5's probe for an artifact write is "file exists and re-hashes to its
 * digest" — so a blob whose bytes changed is neither available nor missing, and
 * saying so is what makes §15's digest-mismatch case visible.
 */
function availability(store, found) {
	if (found.expired_at !== null) return { status: "unavailable", reason: "retention-expired" };

	const probe = probeArtifactBlob(store.storeDir, found);
	if (!probe.present) return { status: "unavailable", reason: "blob-missing" };
	if (!probe.digestMatches) return { status: "unavailable", reason: "digest-mismatch" };

	return { status: "available", reason: null };
}

function row(db, address) {
	return (
		db
			.prepare("SELECT * FROM artifact WHERE algorithm = ? AND digest = ?")
			.get(address.algorithm, address.digest) ?? null
	);
}

function unknown({ digest }) {
	return new FactoryArtifactError(
		"artifact-unknown",
		`No artifact with digest ${digest} was ever recorded (§12.5) — an expired one would still resolve, dated.`,
		{ digest },
	);
}

/**
 * The declared media type, checked. Exported because the write seam validates it
 * **before** requesting the effect: a media type refused only at recording time
 * would leave a `requested` record for a write nothing is going to make.
 *
 * @param {string} mediaType
 * @returns {string}
 * @throws {FactoryArtifactError} `artifact-media-type-invalid`
 */
export function artifactMediaType(mediaType) {
	if (typeof mediaType !== "string" || !MEDIA_TYPE_SHAPE.test(mediaType)) {
		throw new FactoryArtifactError(
			"artifact-media-type-invalid",
			`An artifact records a type/subtype media type; found ${JSON.stringify(mediaType ?? null)}.`,
			{ at: "mediaType", found: mediaType ?? null, expected: String(MEDIA_TYPE_SHAPE) },
		);
	}

	return mediaType;
}

/**
 * §2.1's charset, checked here as well as on the event the write rides. A row
 * recorded through this primitive directly — expiry re-recording, a future
 * operator verb — must not be able to name a producer no journal record could.
 */
function requireProducer({ run, ticket, attempt }) {
	for (const [field, value] of [
		["run", run],
		["attempt", attempt],
	]) {
		if (value !== null && (typeof value !== "string" || !IDENTITY_CHARSET.test(value))) {
			refuseProducer(field, `${field} must match ${IDENTITY_CHARSET} (§2.1); found ${JSON.stringify(value)}.`, value);
		}
	}

	if (ticket !== null && (!Number.isSafeInteger(ticket) || ticket <= 0)) {
		refuseProducer("ticket", `Ticket must be a positive issue number; found ${JSON.stringify(ticket)}.`, ticket);
	}
}

function refuseProducer(at, message, found) {
	throw new FactoryArtifactError("artifact-producer-invalid", message, { at, found });
}
