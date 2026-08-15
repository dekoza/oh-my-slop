import { FactoryStateError } from "./errors.mjs";
import { PROJECTIONS, REBUILD_REASONS } from "./projections.mjs";

/**
 * §4.4's compare, in one place: **is this projection's head the journal's head,
 * built by the projector this build ships?**
 *
 * Three callers ask it and none of them may answer differently — the store's
 * fail-closed open, a reader deciding whether it may render a projection's
 * values (§14.9), and the monitor asking what to show where it cannot. Split
 * across three sites, the three would drift, and a store that opens while its
 * reader refuses is precisely the disagreement the operator cannot adjudicate.
 *
 * The compare is **fail-closed with no "compare only when both present"
 * downgrade** — that downgrade is the hole the Babysitter audit found, so a
 * missing head row is a mismatch rather than a skipped check.
 *
 * Repair is not this module's business. Rebuilding a projection is `rebuild.mjs`'s
 * recorded, reasoned operation, and a compare that quietly repaired what it
 * found would be decorative.
 */

/**
 * One entry per projection, in declaration order.
 *
 * `expected` and `found` speak the units of the mismatch they describe:
 * projector versions for a version change, journal sequences for a head that
 * has fallen behind.
 *
 * @param {object} db
 * @param {{ seq: number, hash: string }} journalHead
 * @returns {ReadonlyArray<{ name: string, ok: boolean, reason: string | null,
 *   expected: number, found: number | null, rebuild_reason: string | null }>}
 */
export function compareProjectionHeads(db, journalHead) {
	return PROJECTIONS.map((projection) => compareProjectionHead(db, projection, journalHead));
}

/**
 * @param {object} db
 * @param {{ name: string, version: number }} projection
 * @param {{ seq: number, hash: string }} journalHead
 */
export function compareProjectionHead(db, projection, journalHead) {
	const head = db.prepare("SELECT * FROM projection_head WHERE name = ?").get(projection.name);

	if (head === undefined) {
		return mismatch(projection.name, "projection-head-mismatch", journalHead.seq, null, REBUILD_REASONS.headMismatch);
	}
	if (head.projector_version !== projection.version) {
		return mismatch(
			projection.name,
			"projector-version-change",
			projection.version,
			head.projector_version,
			REBUILD_REASONS.projectorVersionChange,
		);
	}
	if (head.last_seq !== journalHead.seq || head.chain_hash !== journalHead.hash) {
		return mismatch(
			projection.name,
			"projection-head-mismatch",
			journalHead.seq,
			head.last_seq,
			REBUILD_REASONS.headMismatch,
		);
	}

	return Object.freeze({
		name: projection.name,
		ok: true,
		reason: null,
		expected: projection.version,
		found: projection.version,
		rebuild_reason: null,
	});
}

/**
 * The open path's refusal: the first mismatch stops the store, carrying the
 * rebuild reason that resolves it so the operator is not left guessing which of
 * §4.4's five to name.
 *
 * @throws {FactoryStateError} `projection-head-mismatch` · `projector-version-change`
 */
export function refuseMismatchedHeads(contract, dbPath) {
	for (const entry of contract) {
		if (entry.ok) continue;
		throw new FactoryStateError(entry.reason, openRefusalMessage(entry, dbPath), {
			store: dbPath,
			projection: entry.name,
			expected: entry.expected,
			found: entry.found,
			rebuild_reason: entry.rebuild_reason,
		});
	}
}

/**
 * A reader's refusal, which is narrower on purpose: **the affected values are
 * withheld and the rest still answer** (§14.9). A digest written by a projector
 * this build does not have says nothing about whether the `run` table is
 * readable, and blanking a whole screen over one stale head sends the operator
 * back to `sqlite3` — which is the silence the monitor exists to end.
 *
 * @returns {FactoryStateError} `projection-unreadable`, for the caller to throw
 */
export function projectionUnreadable(entry, dbPath) {
	return new FactoryStateError(
		"projection-unreadable",
		`Projection "${entry.name}" does not match this reader's contract (${entry.reason}); it needs a recorded rebuild before its values mean anything.`,
		{
			store: dbPath,
			projection: entry.name,
			expected: entry.expected,
			found: entry.found,
			rebuild_reason: entry.rebuild_reason,
		},
	);
}

function mismatch(name, reason, expected, found, rebuildReason) {
	return Object.freeze({ name, ok: false, reason, expected, found, rebuild_reason: rebuildReason });
}

function openRefusalMessage(entry, dbPath) {
	if (entry.found === null) {
		return `Projection "${entry.name}" has no head in ${dbPath}; it cannot be compared against the journal.`;
	}
	if (entry.reason === "projector-version-change") {
		return `Projection "${entry.name}" was built by projector v${entry.found}; this factory ships v${entry.expected}. It needs a recorded rebuild, not a silent migration.`;
	}
	return `Projection "${entry.name}" is at seq ${entry.found}, the journal at ${entry.expected}.`;
}
