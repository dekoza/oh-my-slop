import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../../factory/lib/state/sqlite.mjs";
import { FactoryStateError } from "../../factory/lib/state/errors.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";

/**
 * §4.1's substrate: `node:sqlite` behind one thin adapter, WAL and
 * `synchronous=FULL`, and a reader that can never observe a partial record nor
 * take a write lock.
 */

function scratchDb(t, name = "state.db") {
	const dir = mkdtempSync(join(tmpdir(), "factory-sqlite-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return join(dir, name);
}

function openWritable(t, path) {
	const db = openDatabase(path);
	t.after(() => db.close());
	return db;
}

test("a writable connection runs in WAL with synchronous=FULL", (t) => {
	const db = openWritable(t, scratchDb(t));

	assert.equal(db.pragma("journal_mode"), "wal");
	assert.equal(db.pragma("synchronous"), 2);
});

test("a read-only connection observes no partial record mid-transaction", (t) => {
	const path = scratchDb(t);
	const writer = openWritable(t, path);
	writer.exec("CREATE TABLE note(id INTEGER PRIMARY KEY)");

	const reader = openDatabase(path, { readOnly: true });
	t.after(() => reader.close());
	const count = () => reader.prepare("SELECT count(*) AS n FROM note").get().n;

	writer.transaction(() => {
		writer.prepare("INSERT INTO note(id) VALUES (?)").run(1);
		assert.equal(count(), 0, "the reader saw a record that had not committed");
	});

	assert.equal(count(), 1);
});

test("a reader takes no write lock: a write commits while a read transaction is open", (t) => {
	const path = scratchDb(t);
	const writer = openWritable(t, path);
	writer.exec("CREATE TABLE note(id INTEGER PRIMARY KEY)");
	writer.transaction(() => writer.prepare("INSERT INTO note(id) VALUES (1)").run());

	const reader = openDatabase(path, { readOnly: true });
	t.after(() => reader.close());
	reader.exec("BEGIN");
	reader.prepare("SELECT count(*) AS n FROM note").get();

	writer.transaction(() => writer.prepare("INSERT INTO note(id) VALUES (2)").run());
	reader.exec("COMMIT");

	assert.equal(writer.prepare("SELECT count(*) AS n FROM note").get().n, 2);
});

test("a read-only connection refuses to write", (t) => {
	const path = scratchDb(t);
	const writer = openWritable(t, path);
	writer.exec("CREATE TABLE note(id INTEGER PRIMARY KEY)");

	const reader = openDatabase(path, { readOnly: true });
	t.after(() => reader.close());

	assert.throws(() => reader.exec("INSERT INTO note(id) VALUES (1)"));
});

test("a throwing transaction body commits nothing", (t) => {
	const db = openWritable(t, scratchDb(t));
	db.exec("CREATE TABLE note(id INTEGER PRIMARY KEY)");

	assert.throws(
		() =>
			db.transaction(() => {
				db.prepare("INSERT INTO note(id) VALUES (1)").run();
				throw new Error("halfway");
			}),
		/halfway/,
	);

	assert.equal(db.prepare("SELECT count(*) AS n FROM note").get().n, 0);
	// The rollback left the connection usable rather than stuck inside a
	// transaction nobody can close.
	db.transaction(() => db.prepare("INSERT INTO note(id) VALUES (2)").run());
	assert.equal(db.prepare("SELECT count(*) AS n FROM note").get().n, 1);
});

test("a nested transaction is refused rather than silently flattened", (t) => {
	const db = openWritable(t, scratchDb(t));

	assert.throws(
		() => db.transaction(() => db.transaction(() => {})),
		(error) => error instanceof FactoryStateError && error.reason === "invalid-transaction",
	);
});

test("a store that cannot be opened refuses with a typed reason", (t) => {
	const missing = join(scratchDb(t, "no-such-dir"), "state.db");

	assert.throws(
		() => openDatabase(missing),
		(error) => error instanceof FactoryStateError && error.reason === "store-unopenable",
	);
});

test("node:sqlite is imported by exactly one factory source (§4.1)", () => {
	const importers = factorySources()
		.filter(([, source]) => source.includes("node:sqlite"))
		.map(([path]) => path);

	assert.deepEqual(importers, ["lib/state/sqlite.mjs"]);
});
