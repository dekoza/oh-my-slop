import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { FactoryStateError } from "../../factory/lib/state/errors.mjs";
import { openStore, openStoreReadOnly } from "../../factory/lib/state/store.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import {
	corruptDatabaseFile,
	makeAgentDir,
	openTestStore,
	refusalOfAsync,
	runStarted,
	trashDatabaseHeader,
} from "./helpers/factory-store.mjs";

/**
 * §4.7's global scope: **SQLite-level corruption stops everything**. The
 * controller refuses to start, the file is quarantined rather than repaired,
 * and a minimal fresh store records the typed fact so `status` and `doctor`
 * still have something to answer from.
 */

/** A store with one run in it, closed, and then damaged on disk. */
async function damagedStore(t, damage) {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(newUlid()));
	store.close();

	const damagedBytes = damage(dbPath);
	return { agentDir, repoRoot, dbPath, damagedBytes };
}

test("a corrupt store refuses to open, and is quarantined rather than repaired", async (t) => {
	const { agentDir, repoRoot, dbPath, damagedBytes } = await damagedStore(t, corruptDatabaseFile);

	const error = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	assert.ok(error instanceof FactoryStateError);
	assert.equal(error.reason, "journal-integrity-failed");
	assert.equal(error.details.scope, "store");
	assert.ok(error.details.quarantine_path.startsWith(join(dirname(dbPath), "quarantine")));
	assert.deepEqual(
		readFileSync(error.details.quarantine_path),
		damagedBytes,
		"the quarantined file was repaired, truncated, or rewritten",
	);
});

test("the fresh store records the typed fact, so status and doctor can still answer", async (t) => {
	const { agentDir, repoRoot, dbPath } = await damagedStore(t, corruptDatabaseFile);
	const error = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	const reader = openStoreReadOnly({ dbPath });
	t.after(() => reader.close());
	const [recorded] = reader.readEvents({}).filter((event) => event.kind === "journal.integrity-failed");

	assert.equal(recorded.visibility, "operator");
	assert.equal(recorded.payload.scope, "store");
	assert.equal(recorded.payload.quarantine_path, error.details.quarantine_path);
	assert.ok(recorded.payload.problems.length > 0, "the fact records no problem to explain itself");
	assert.equal(reader.verifyJournal().ok, true, "the fresh store did not start from a clean chain");
});

test("the fresh store records why the projections a monitor reads are empty", async (t) => {
	const { agentDir, repoRoot, dbPath } = await damagedStore(t, corruptDatabaseFile);
	await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	const reader = openStoreReadOnly({ dbPath });
	t.after(() => reader.close());
	const [rebuilt] = reader.readEvents({}).filter((event) => event.kind === "projection.rebuilt");

	assert.equal(rebuilt.payload.reason, "post-quarantine");
	assert.equal(rebuilt.payload.replayed_events, 1, "the fresh store replayed a journal it does not have");
	assert.deepEqual(
		reader.projectionContract().filter((entry) => !entry.ok),
		[],
		"the fresh store the operator is left with cannot be read",
	);
});

test("a second corrupt open quarantines to its own path rather than overwriting the first", async (t) => {
	const { agentDir, repoRoot, dbPath } = await damagedStore(t, corruptDatabaseFile);
	const first = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	// The fresh store is healthy; damage it too, the way a failing disk would.
	corruptDatabaseFile(dbPath);
	const second = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	assert.notEqual(second.details.quarantine_path, first.details.quarantine_path);
	assert.ok(existsSync(first.details.quarantine_path));
	assert.equal(readdirSync(join(dirname(dbPath), "quarantine")).length, 2);
});

test("a file that is not a database at all is quarantined too", async (t) => {
	const { agentDir, repoRoot } = await damagedStore(t, trashDatabaseHeader);

	const error = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	assert.equal(error.reason, "journal-integrity-failed");
	assert.match(error.message, /not a database/);
});

test("the store opened after a quarantine is a working store", async (t) => {
	const { agentDir, repoRoot } = await damagedStore(t, corruptDatabaseFile);
	await refusalOfAsync(() => openStore({ repoRoot, agentDir }));

	const store = await openTestStore(t, { repoRoot, agentDir });
	const runId = newUlid();
	const appended = store.append(runStarted(runId));

	assert.equal(store.readRun(runId).run_id, runId);
	assert.equal(appended.prev_hash, "", "the new journal chained onto a hash from the quarantined one");
});
