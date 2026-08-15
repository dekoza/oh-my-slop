import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * §4.7's global scope: **the database is moved aside, never mended.**
 *
 * Babysitter's repair mode dropped corrupt events and reassigned ids, which
 * turns a detectable failure into an undetectable one — the journal afterwards
 * looks perfect and is no longer what happened. So the corrupt file is renamed
 * byte-for-byte into a dated quarantine directory beside the store, where a
 * human (or `sqlite3 .recover`) can still work on it, and the controller
 * refuses to start (§14.10).
 *
 * The write-ahead log and shared-memory files travel with it: they are part of
 * the same database, and leaving a `-wal` behind would let it be replayed into
 * the *fresh* store on the next open.
 */

/** SQLite's sidecar files. A database is these three, not just the first. */
const SIDECAR_SUFFIXES = Object.freeze(["", "-wal", "-shm"]);

/**
 * @param {{ dbPath: string, at?: number }} what
 * @returns {{ path: string, directory: string, moved: string[] }} `path` is the
 *   quarantined database itself — the one an operator is told about.
 * @throws {Error} the filesystem's own, unwrapped: a quarantine that cannot be
 *   written is not a state the caller may continue past.
 */
export function quarantineDatabase({ dbPath, at = Date.now() }) {
	const directory = freeDirectory(join(dirname(dbPath), "quarantine"), stamp(at));
	mkdirSync(directory, { recursive: true });

	const moved = [];
	for (const suffix of SIDECAR_SUFFIXES) {
		const source = `${dbPath}${suffix}`;
		if (!existsSync(source)) continue;
		const destination = join(directory, `${basename(dbPath)}${suffix}`);
		renameSync(source, destination);
		moved.push(destination);
	}

	return Object.freeze({ path: join(directory, basename(dbPath)), directory, moved: Object.freeze(moved) });
}

/** A sortable, filename-safe UTC stamp: quarantines read in the order taken. */
function stamp(at) {
	return new Date(at).toISOString().replace(/[:.]/g, "-");
}

/**
 * A quarantine never lands on top of an earlier one. `mkdirSync` is happy to
 * adopt an existing directory, and the rename that followed would overwrite the
 * previous corrupt database — destroying evidence, which is the one thing this
 * whole path exists to avoid.
 */
function freeDirectory(root, name) {
	let candidate = join(root, name);
	for (let ordinal = 2; existsSync(candidate); ordinal += 1) {
		candidate = join(root, `${name}-${ordinal}`);
	}
	return candidate;
}
