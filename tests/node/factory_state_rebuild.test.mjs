import test from "node:test";
import assert from "node:assert/strict";

import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { runStream } from "../../factory/lib/state/events.mjs";
import { PROJECTIONS, REBUILD_REASONS } from "../../factory/lib/state/projections.mjs";
import { rebuildProjections } from "../../factory/lib/state/rebuild.mjs";
import { openDatabase } from "../../factory/lib/state/sqlite.mjs";
import { openStore, openStoreForRebuild, openStoreReadOnly } from "../../factory/lib/state/store.mjs";
import { deleteStreamWhole } from "../../factory/lib/state/truncation.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import {
	attemptLaunched,
	makeAgentDir,
	openTestStore,
	refusalOf,
	refusalOfAsync,
	runEnded,
	runStarted,
} from "./helpers/factory-store.mjs";

/**
 * §4.4's rebuild: projections are derived, therefore rebuildable — but only
 * under a recorded reason from the closed set, and never as a silent repair
 * that would make the fail-closed head compare decorative.
 */

test("a rebuild records its reason, its projector versions, and the head it rebuilt to", async (t) => {
	const store = await openTestStore(t);
	const runId = newUlid();
	store.append(runStarted(runId));
	store.append(attemptLaunched(runId, 90));
	const last = store.append(runEnded(runId));

	// A projection that drifted: the row says the run is still going.
	store.transaction(({ db }) => db.prepare("UPDATE run SET lifecycle = 'running' WHERE run_id = ?").run(runId));

	const rebuild = rebuildProjections(store, { reason: REBUILD_REASONS.operatorRequested, at: 1_770_001_000_000 });

	assert.equal(store.readRun(runId).lifecycle, "ended", "the rebuild did not replay the journal");
	assert.deepEqual(rebuild.head, { seq: last.seq, hash: last.hash });
	assert.equal(rebuild.replayed_events, 3);

	const [recorded] = store.readEvents({ sinceSeq: last.seq }).filter((e) => e.kind === "projection.rebuilt");
	assert.equal(recorded.payload.reason, "operator-requested");
	assert.deepEqual(recorded.payload.head, { seq: last.seq, hash: last.hash });
	// Read off the shipped projectors rather than pinned here: what this asserts
	// is that a rebuild records *which* versions it built at, not what today's
	// numbers happen to be.
	assert.deepEqual(
		recorded.payload.projectors,
		Object.fromEntries(PROJECTIONS.map((projection) => [projection.name, projection.version])),
	);
	assert.deepEqual(
		store.projectionHeads().map((head) => [head.name, head.last_seq]),
		[
			["attempt", recorded.seq],
			["run", recorded.seq],
			["run_digest", recorded.seq],
			["ticket_execution", recorded.seq],
			["ticket_index", recorded.seq],
		],
		"the rebuild record did not itself land in the projections it rebuilt",
	);
});

test("a reason outside §4.4's five is refused", async (t) => {
	const store = await openTestStore(t);
	store.append(runStarted(newUlid()));

	const error = refusalOf(() => rebuildProjections(store, { reason: "looked-wrong" }));

	assert.equal(error.reason, "invalid-rebuild");
	assert.deepEqual(store.readEvents({}).filter((event) => event.kind === "projection.rebuilt"), []);
});

test("a refused open names the rebuild that resolves it, and the rebuild resolves it", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const runId = newUlid();
	const first = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = first.dbPath;
	first.append(runStarted(runId));
	first.append(attemptLaunched(runId, 90));
	first.close();

	tamper(t, dbPath, "UPDATE projection_head SET last_seq = 1 WHERE name = 'attempt'");
	const refused = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));
	assert.equal(refused.details.rebuild_reason, "head-mismatch");

	// The compare is fail-closed, so the store the rebuild must open is the one
	// the compare refuses. This handle is that path and no other — and it carries
	// no `append`, so there is no way to move the head instead of rebuilding it.
	const forRebuild = await openStoreForRebuild({ repoRoot, agentDir });
	assert.equal(forRebuild.append, undefined, "a deferred compare handed back a write path");
	assert.equal(forRebuild.transaction, undefined, "a deferred compare handed back a write path");
	forRebuild.rebuild({ reason: refused.details.rebuild_reason });
	forRebuild.close();

	const reopened = await openTestStore(t, { repoRoot, agentDir });
	assert.equal(reopened.readAttempts({ runId }).length, 1);
});

test("a projector version change is resolved by a recorded rebuild, never a silent migration", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const first = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = first.dbPath;
	first.append(runStarted(newUlid()));
	first.close();

	// The store was built by an older projector than this factory ships.
	tamper(t, dbPath, "UPDATE projection_head SET projector_version = 0 WHERE name = 'run'");
	const refused = await refusalOfAsync(() => openStore({ repoRoot, agentDir }));
	assert.equal(refused.details.rebuild_reason, "projector-version-change");

	const forRebuild = await openStoreForRebuild({ repoRoot, agentDir });
	const rebuild = forRebuild.rebuild({ reason: refused.details.rebuild_reason });
	forRebuild.close();

	const shipped = PROJECTIONS.find((projection) => projection.name === "run").version;
	assert.equal(rebuild.projectors.run, shipped);
	const reopened = await openTestStore(t, { repoRoot, agentDir });
	assert.equal(
		reopened.projectionHeads().find((head) => head.name === "run").projector_version,
		shipped,
		"the rebuild left the store claiming a version it was not built at",
	);
});

test("nothing can append its way out of a mismatch, because appending would repair it", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const runId = newUlid();
	const first = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = first.dbPath;
	first.append(runStarted(runId));
	first.append(attemptLaunched(runId, 90));
	first.close();

	// A head rewound *and* its rows dropped: replaying is the only thing that can
	// make this projection true again. `appendEvent` moves every head to the
	// event it writes, so one ordinary append would leave the heads agreeing and
	// the table empty — the silent repair §4.4's compare exists to catch.
	tamper(t, dbPath, "UPDATE projection_head SET last_seq = 1 WHERE name = 'attempt'");
	tamper(t, dbPath, "DELETE FROM attempt");

	const forRebuild = await openStoreForRebuild({ repoRoot, agentDir });
	t.after(() => forRebuild.close());

	assert.deepEqual(
		Object.keys(forRebuild).filter((key) => ["append", "transaction", "read"].includes(key)),
		[],
		"the rebuild handle exposes a way to write without recording a rebuild",
	);
	assert.equal(forRebuild.projectionContract().find((entry) => entry.name === "attempt").ok, false);
});

// ── A break scopes to its stream (§4.7) ─────────────────────────────────────

test("a chain break costs that run alone, and leaves the others rebuilt", async (t) => {
	const store = await openTestStore(t);
	const broken = newUlid();
	const intact = newUlid();
	store.append(runStarted(broken));
	store.append(runStarted(intact));
	const target = store.append(attemptLaunched(broken, 90));
	store.append(attemptLaunched(intact, 91));

	store.transaction(({ db }) =>
		db.prepare("UPDATE event SET payload = ? WHERE seq = ?").run('{"role":"review"}', target.seq),
	);

	const rebuild = rebuildProjections(store, { reason: REBUILD_REASONS.operatorRequested, at: 1_770_002_000_000 });

	assert.deepEqual(rebuild.unrecoverable_streams, [
		{ stream: runStream(broken), run: broken, at_seq: target.seq, reason: "hash-mismatch" },
	]);
	assert.equal(store.readRun(intact).run_id, intact, "an intact run lost its detail to another run's break");
	assert.equal(store.readAttempts({ runId: intact }).length, 1);

	// The broken run's detail is not derivable, and is not invented: what is left
	// is the permanent digest and a typed fact saying why (§4.7).
	assert.equal(store.readRun(broken), null);
	assert.equal(store.readRunDigest(broken).run_id, broken);
	const [recorded] = store.readEvents({}).filter((event) => event.kind === "journal.integrity-failed");
	assert.deepEqual(recorded.payload, {
		scope: "stream",
		stream: runStream(broken),
		run: broken,
		at_seq: target.seq,
		event_id: target.event_id,
		reason: "hash-mismatch",
	});

	// Twice is once: a second rebuild does not turn one break into a pile.
	rebuildProjections(store, { reason: REBUILD_REASONS.operatorRequested, at: 1_770_003_000_000 });
	assert.equal(store.readEvents({}).filter((event) => event.kind === "journal.integrity-failed").length, 1);
});

test("a rebuild is subtractive: a run whose stream expired keeps its permanent history", async (t) => {
	const store = await openTestStore(t);
	const expired = newUlid();
	const current = newUlid();
	store.append(runStarted(expired));
	store.append(attemptLaunched(expired, 90));
	store.append(runEnded(expired));
	store.append(runStarted(current));

	store.transaction((tx) => deleteStreamWhole(tx, { stream: runStream(expired) }));
	const rebuild = rebuildProjections(store, { reason: REBUILD_REASONS.headMismatch });

	assert.equal(rebuild.retained_permanent_runs, 1);
	assert.equal(store.readRun(expired), null, "tier-1 detail outlived the journal it is derived from");
	assert.equal(store.readRunDigest(expired).end_reason, "drained", "the permanent digest was lost to a rebuild");
	assert.deepEqual(
		store.readTicketIndex(90).map((row) => row.run_id),
		[expired],
		"the cross-run reverse index was lost to a rebuild",
	);
	assert.equal(store.readRun(current).run_id, current);
});

// ── The versioned read contract (§4.4, §14.9) ───────────────────────────────

test("a mismatched reader refuses the affected values and still answers the rest", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const runId = newUlid();
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(runId));
	store.close();

	// The monitor is reading a store whose digest was written by a projector it
	// does not have. Rendering it anyway means guessing at a shape.
	const shipped = PROJECTIONS.find((projection) => projection.name === "run_digest").version;
	const ahead = shipped + 1;
	tamper(t, dbPath, `UPDATE projection_head SET projector_version = ${ahead} WHERE name = 'run_digest'`);

	const reader = openStoreReadOnly({ dbPath });
	t.after(() => reader.close());

	const error = refusalOf(() => reader.readRunDigest(runId));
	assert.equal(error.reason, "projection-unreadable");
	assert.equal(error.details.projection, "run_digest");
	assert.deepEqual([error.details.found, error.details.expected], [ahead, shipped]);

	assert.equal(reader.readRun(runId).run_id, runId, "an unrelated projection was withheld too");
	assert.deepEqual(
		reader.projectionContract().filter((entry) => !entry.ok),
		[
			{
				name: "run_digest",
				ok: false,
				reason: "projector-version-change",
				expected: shipped,
				found: ahead,
				rebuild_reason: "projector-version-change",
			},
		],
	);
});

test("a reader whose journal has moved past a projection refuses that projection", async (t) => {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const runId = newUlid();
	const store = await openTestStore(t, { repoRoot, agentDir });
	const dbPath = store.dbPath;
	store.append(runStarted(runId));
	store.close();

	tamper(t, dbPath, "UPDATE projection_head SET last_seq = 0 WHERE name = 'ticket_index'");

	const reader = openStoreReadOnly({ dbPath });
	t.after(() => reader.close());

	assert.equal(refusalOf(() => reader.readTicketIndex(90)).details.rebuild_reason, "head-mismatch");
	assert.equal(reader.readRun(runId).lifecycle, "preflight");
	assert.equal(reader.readEvents({}).length, 1, "the journal itself was withheld over a projection's head");
});

function tamper(t, dbPath, statement) {
	const db = openDatabase(dbPath);
	t.after(() => db.close());
	db.exec(statement);
	db.close();
}
