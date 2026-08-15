import { DatabaseSync } from "node:sqlite";

import { FactoryStateError } from "./errors.mjs";

/**
 * The one thin adapter over `node:sqlite` (§4.1).
 *
 * Every other module in the factory reaches SQLite through this file, so the
 * substrate decision is one import to revisit rather than a habit spread across
 * the codebase. `node:sqlite` is chosen over `better-sqlite3` deliberately: the
 * file format is stable SQLite whatever the JS API does, and a native module
 * inside a pi package would be a real cost for a cosmetic gain. Its
 * `ExperimentalWarning` is accepted rather than suppressed.
 */

/**
 * The primary result codes SQLite reports for a damaged file. `errcode` carries
 * the extended code, whose low byte is the primary one.
 */
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/**
 * Does a SQLite error mean the file is *damaged*, rather than busy, locked, or
 * somebody else's to open? Only damage may lead to a quarantine (§4.7), so the
 * question is answered from the driver's result code — in the one module that
 * knows the driver — rather than by matching message text at the call site.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isCorruptionError(error) {
	const primary = typeof error?.errcode === "number" ? error.errcode & 0xff : null;
	return primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
}

/**
 * @param {string} path
 * @param {{ readOnly?: boolean }} [options]
 * @returns {{
 *   path: string,
 *   readOnly: boolean,
 *   exec: (sql: string) => void,
 *   prepare: (sql: string) => object,
 *   pragma: (name: string) => unknown,
 *   transaction: <T>(body: () => T) => T,
 *   inTransaction: () => boolean,
 *   close: () => void,
 * }}
 * @throws {FactoryStateError} `store-unopenable`
 */
export function openDatabase(path, { readOnly = false } = {}) {
	let database;
	try {
		database = new DatabaseSync(path, { readOnly });

		// WAL is load-bearing: it is what lets the monitor read while the
		// controller writes, without a write lock and without ever seeing a
		// partial record.
		// `synchronous = FULL` is the durability half — a journal that survives a
		// crash is the whole point of writing one.
		//
		// These first statements are also where a damaged file usually announces
		// itself, which is why they sit inside the same `try`: the caller decides
		// what to do about corruption (§4.7), and it can only decide if the
		// refusal says that is what happened.
		if (!readOnly) {
			database.exec("PRAGMA journal_mode = WAL");
			database.exec("PRAGMA synchronous = FULL");
			database.exec("PRAGMA foreign_keys = ON");
		}
	} catch (error) {
		closeQuietly(database);
		throw new FactoryStateError("store-unopenable", `Cannot open ${path}: ${error.message}`, {
			store: path,
			readOnly,
			corrupt: isCorruptionError(error),
			problems: [error.message],
		});
	}

	let depth = 0;
	let closed = false;

	return Object.freeze({
		path,
		readOnly,
		exec: (sql) => database.exec(sql),
		prepare: (sql) => database.prepare(sql),
		pragma: (name) => {
			const row = database.prepare(`PRAGMA ${name}`).get();
			return row === undefined ? undefined : Object.values(row)[0];
		},

		/**
		 * `BEGIN IMMEDIATE`, because every transaction the factory opens intends
		 * to write and a deferred one would discover that only at the first
		 * upgrade — mid-way through the work it was meant to make atomic.
		 *
		 * Nesting is refused rather than flattened: a caller that believes it has
		 * its own transaction, but is in fact inside somebody else's, is exactly
		 * how an event and its projection end up committing separately (§14.8).
		 */
		transaction: (body) => {
			if (depth > 0) {
				throw new FactoryStateError(
					"invalid-transaction",
					"A transaction is already open on this connection; the factory does not nest them.",
					{ store: path },
				);
			}

			depth = 1;
			database.exec("BEGIN IMMEDIATE");
			try {
				const value = body();
				database.exec("COMMIT");
				return value;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			} finally {
				depth = 0;
			}
		},

		inTransaction: () => depth > 0,

		/** Idempotent: a caller that closes early and a lifetime owner that
		 * closes at the end are both ordinary, and neither is an error. */
		close: () => {
			if (closed) return;
			closed = true;
			database.close();
		},
	});
}

/**
 * A handle abandoned on the failure path. Whatever it says on the way out is
 * less informative than the error already in hand, and losing that one to a
 * second failure during cleanup would leave the caller with nothing to report.
 */
function closeQuietly(database) {
	try {
		database?.close();
	} catch {
		// Deliberately ignored: see above.
	}
}
