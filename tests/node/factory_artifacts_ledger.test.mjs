import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	addressOfContent,
	deleteArtifactBlob,
	writeArtifactBlob,
} from "../../factory/lib/artifacts/blobs.mjs";
import { FactoryArtifactError } from "../../factory/lib/artifacts/errors.mjs";
import {
	ARTIFACT_RETENTION_CLASSES,
	artifactBytesByClass,
	artifactBytesByRun,
	readArtifact,
	recordArtifact,
	resolveArtifact,
	retentionClassFor,
	tombstoneArtifact,
} from "../../factory/lib/artifacts/ledger.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { openTestStore, refusalOf, runStarted } from "./helpers/factory-store.mjs";

/**
 * §12.1's ledger: the table every artifact reference resolves through, and the
 * only thing that knows an artifact exists at all.
 */

const AT = 1_770_000_100_000;

/** A store with a live run, which is what an artifact is nearly always produced by. */
async function storeWithRun(t) {
	const store = await openTestStore(t);
	const run = newUlid();
	store.append(runStarted(run));
	return { store, run };
}

/**
 * Put content in the store and record it, the way `writeArtifact` does — minus
 * the effect pair, which is `writes.mjs`'s half of the story.
 */
function produce(store, content, producer = {}) {
	const written = writeArtifactBlob(store.storeDir, content);
	return store.transaction((tx) =>
		recordArtifact(tx, {
			...written,
			mediaType: "text/plain",
			at: AT,
			...producer,
		}),
	);
}

// ── The row (§12.1) ──────────────────────────────────────────────────────────

test("the ledger row carries digest, media type, bytes, producer, created-at, and retention class", async (t) => {
	const { store, run } = await storeWithRun(t);
	const content = "checks: 3 passed";
	const attempt = `${run}-t94-a1`;

	const row = produce(store, content, { run, ticket: 94, attempt, mediaType: "application/json" });

	assert.deepEqual(
		{ ...row },
		{
			algorithm: "sha256",
			digest: addressOfContent(content).digest,
			media_type: "application/json",
			bytes: Buffer.byteLength(content),
			retention_class: "tier-1",
			producer: { run, ticket: 94, attempt },
			created_at: AT,
			produced_at: AT,
			expired_at: null,
		},
	);
});

test("the ledger is keyed by the content, and it holds no path (§14.28)", async (t) => {
	const { store, run } = await storeWithRun(t);
	produce(store, "a review verdict", { run });

	const columns = store.read((db) => db.prepare("SELECT name, pk FROM pragma_table_info('artifact')").all());

	// Nothing here can name a location, so nothing that reads the ledger can be
	// handed one. The `../` escape is not rejected by this table; it is
	// unsayable in it.
	assert.deepEqual(
		columns.filter((column) => column.pk > 0).map((column) => column.name),
		["algorithm", "digest"],
	);
	assert.deepEqual(
		columns.filter((column) => /path|file|dir|location/i.test(column.name)),
		[],
	);
});

test("the retention class is derived from the producer, never chosen (§12.2)", async (t) => {
	const { store, run } = await storeWithRun(t);

	// "Artifacts inherit their run's tier" is not advice a caller may take or
	// leave: a row that disagreed with its producer would make byte accounting
	// per class a report about what somebody typed.
	assert.deepEqual(ARTIFACT_RETENTION_CLASSES, ["tier-1", "permanent"]);
	assert.equal(retentionClassFor({ run }), "tier-1");
	assert.equal(retentionClassFor({ run: null }), "permanent");

	assert.equal(produce(store, "harvested output", { run }).retention_class, "tier-1");
	// A repo-scoped artifact belongs to no run, so no run's expiry ever names it
	// (§12.6) — the honest class is the one that never comes up for expiry.
	assert.equal(produce(store, "the controller's own record", {}).retention_class, "permanent");
});

test("a ledger row names an identity the rest of the journal could carry", async (t) => {
	const store = await openTestStore(t);
	const written = writeArtifactBlob(store.storeDir, "x");

	for (const producer of [{ run: "not a run id" }, { run: newUlid(), ticket: 0 }, { attempt: "../escape" }]) {
		const error = refusalOf(() =>
			store.transaction((tx) => recordArtifact(tx, { ...written, mediaType: "text/plain", at: AT, ...producer })),
		);
		assert.ok(error instanceof FactoryArtifactError, `${JSON.stringify(producer)} was accepted as a producer`);
		assert.equal(error.reason, "artifact-producer-invalid");
	}
});

test("a media type is a type/subtype, and the same bytes never carry two of them", async (t) => {
	const { store, run } = await storeWithRun(t);
	const written = writeArtifactBlob(store.storeDir, "one body");

	for (const mediaType of ["json", "application/", "text/plain; charset=utf-8", "", null]) {
		const error = refusalOf(() =>
			store.transaction((tx) => recordArtifact(tx, { ...written, mediaType, run, at: AT })),
		);
		assert.equal(error.reason, "artifact-media-type-invalid", `${JSON.stringify(mediaType)} was accepted`);
	}

	produce(store, "one body", { run, mediaType: "text/plain" });
	const conflict = refusalOf(() => produce(store, "one body", { run, mediaType: "application/json" }));

	// One digest, one row: a caller told "your bytes are already there" and
	// handed back a reference declaring a media type it did not ask for would be
	// reading the wrong renderer out of the ledger.
	assert.equal(conflict.reason, "artifact-media-type-conflict");
});

// ── One blob, one row, however many producers ────────────────────────────────

test("byte-identical content produced twice is one blob and one row, restamped to the later producer", async (t) => {
	const { store, run } = await storeWithRun(t);
	const later = newUlid();
	store.append(runStarted(later, { at: AT + 1_000 }));

	const first = produce(store, "identical evidence", { run, ticket: 94 });
	const second = produce(store, "identical evidence", { run: later, ticket: 95, at: AT + 2_000 });

	assert.equal(second.digest, first.digest);
	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM artifact").get().n), 1);

	// The producer is the *most recent* production, and that is what keeps expiry
	// safe without a second table: expiring the earlier run reclaims only blobs no
	// later run has re-produced, and the later run's own expiry reclaims this one.
	assert.deepEqual({ ...second.producer }, { run: later, ticket: 95, attempt: null });
	assert.equal(second.created_at, AT, "the first production's date was overwritten");
	assert.equal(second.produced_at, AT + 2_000);

	assert.deepEqual(
		artifactBytesByClass(store).map((entry) => [entry.retention_class, entry.artifacts, entry.bytes]),
		[["tier-1", 1, Buffer.byteLength("identical evidence")]],
		"one blob on disk was counted twice",
	);
});

// ── Byte accounting (§12.1, §12.10) ──────────────────────────────────────────

test("byte accounting per retention class falls out of the ledger, with no separate bookkeeping", async (t) => {
	const { store, run } = await storeWithRun(t);
	produce(store, "aa", { run });
	produce(store, "bbbb", { run });
	produce(store, "cccccc", {});

	assert.deepEqual(artifactBytesByClass(store), [
		{ retention_class: "tier-1", artifacts: 2, bytes: 6, expired: 0, expired_bytes: 0 },
		{ retention_class: "permanent", artifacts: 1, bytes: 6, expired: 0, expired_bytes: 0 },
	]);

	// The numbers are the table's own SUM: there is nothing else to keep in step,
	// which is the whole reason the ledger holds the byte count (§12.1).
	assert.deepEqual(
		store.read((db) =>
			db
				.prepare("SELECT retention_class, COUNT(*) AS artifacts, SUM(bytes) AS bytes FROM artifact GROUP BY retention_class")
				.all(),
		).length,
		2,
	);

	assert.deepEqual(artifactBytesByRun(store), [
		{ run_id: null, artifacts: 1, bytes: 6, expired: 0, expired_bytes: 0 },
		{ run_id: run, artifacts: 2, bytes: 6, expired: 0, expired_bytes: 0 },
	]);
});

test("a tombstoned row is accounted as reclaimed, never as bytes still on disk", async (t) => {
	const { store, run } = await storeWithRun(t);
	const row = produce(store, "aa", { run });
	produce(store, "bbbb", { run });

	store.transaction((tx) => tombstoneArtifact(tx, row, { at: AT + 5_000 }));

	assert.deepEqual(artifactBytesByClass(store), [
		{ retention_class: "tier-1", artifacts: 2, bytes: 4, expired: 1, expired_bytes: 2 },
	]);
});

// ── Resolution: available, expired, unknown — never alike (§12.5) ────────────

test("a reference resolves through the ledger by digest", async (t) => {
	const { store, run } = await storeWithRun(t);
	const content = "the attestation";
	const row = produce(store, content, { run, ticket: 94, mediaType: "application/json" });

	assert.deepEqual(resolveArtifact(store, row), {
		status: "available",
		reason: null,
		algorithm: "sha256",
		digest: row.digest,
		media_type: "application/json",
		bytes: Buffer.byteLength(content),
		retention_class: "tier-1",
		producer: { run, ticket: 94, attempt: null },
		created_at: AT,
		produced_at: AT,
		expired_at: null,
	});

	assert.equal(readArtifact(store, row).toString("utf8"), content);
});

test("an expired artifact resolves to a dated tombstone, and an unknown digest never looks like one", async (t) => {
	const { store, run } = await storeWithRun(t);
	const row = produce(store, "a two-year-old PR body's digest", { run });

	// §12.5: expiry deletes the blob and keeps digest, byte count, class, and
	// producer — a few dozen bytes, permanently. A stale deep link that resolved
	// to "unknown digest" would be indistinguishable from a mis-click.
	store.transaction((tx) => tombstoneArtifact(tx, row, { at: AT + 9_000 }));
	deleteArtifactBlob(store.storeDir, row);

	const expired = resolveArtifact(store, row);
	assert.equal(expired.status, "unavailable");
	assert.equal(expired.reason, "retention-expired");
	assert.equal(expired.expired_at, AT + 9_000);
	assert.equal(expired.bytes, Buffer.byteLength("a two-year-old PR body's digest"));
	assert.equal(expired.retention_class, "tier-1");
	assert.equal(expired.producer.run, run);

	const never = resolveArtifact(store, addressOfContent("nothing ever wrote this"));
	assert.equal(never.status, "unknown");
	assert.equal(never.reason, "never-recorded");
	assert.equal(never.bytes, null);
	assert.equal(never.expired_at, null);

	assert.equal(refusalOf(() => readArtifact(store, row)).reason, "artifact-unavailable");
	assert.equal(refusalOf(() => readArtifact(store, never)).reason, "artifact-unknown");
});

test("a blob that is gone, or that no longer re-hashes, is not an expired one", async (t) => {
	const { store, run } = await storeWithRun(t);
	const missing = produce(store, "swept by something that was not expiry", { run });
	const tampered = produce(store, "the bytes changed underneath", { run });

	deleteArtifactBlob(store.storeDir, missing);
	writeFileSync(
		join(store.storeDir, "artifacts", "sha256", tampered.digest.slice(0, 2), tampered.digest),
		"not what the ledger says",
	);

	// Three different stories an operator has to be able to tell apart: this run
	// is still in full detail and its evidence was swept (§12.4's unification is
	// broken), the blob is corrupt (§15's digest mismatch), or the horizon passed.
	assert.equal(resolveArtifact(store, missing).reason, "blob-missing");
	assert.equal(resolveArtifact(store, tampered).reason, "digest-mismatch");
	assert.equal(resolveArtifact(store, missing).status, "unavailable");
	assert.equal(resolveArtifact(store, tampered).status, "unavailable");
});

test("re-producing an expired artifact brings its row back to life", async (t) => {
	const { store, run } = await storeWithRun(t);
	const content = "identical evidence, produced again";
	const row = produce(store, content, { run });

	store.transaction((tx) => tombstoneArtifact(tx, row, { at: AT + 9_000 }));
	deleteArtifactBlob(store.storeDir, row);

	const again = produce(store, content, { run, at: AT + 10_000 });

	// The digest exists again, so resolving it as `retention-expired` would be
	// the ledger lying about bytes that are right there.
	assert.equal(again.expired_at, null);
	assert.equal(resolveArtifact(store, again).status, "available");
});

test("a tombstone is only ever set on a digest the ledger knows, and only once", async (t) => {
	const { store, run } = await storeWithRun(t);
	const row = produce(store, "one production", { run });

	const unknown = refusalOf(() =>
		store.transaction((tx) => tombstoneArtifact(tx, addressOfContent("never recorded"), { at: AT })),
	);
	assert.equal(unknown.reason, "artifact-unknown");

	store.transaction((tx) => tombstoneArtifact(tx, row, { at: AT + 1_000 }));
	const second = store.transaction((tx) => tombstoneArtifact(tx, row, { at: AT + 2_000 }));

	assert.equal(second.expired_at, AT + 1_000, "a second expiry redated the tombstone");
});
