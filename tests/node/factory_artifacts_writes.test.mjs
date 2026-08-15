import test from "node:test";
import assert from "node:assert/strict";

import { addressOfContent, probeArtifactBlob } from "../../factory/lib/artifacts/blobs.mjs";
import { artifactReference, ARTIFACT_ROLES, writeArtifact } from "../../factory/lib/artifacts/writes.mjs";
import { readArtifact, resolveArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { requestEffect } from "../../factory/lib/effects/records.mjs";
import { EFFECT_REGISTRY } from "../../factory/lib/effects/registry.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { canonicalJson } from "../../factory/lib/state/events.mjs";
import { attemptLaunched, openTestStore, refusalOf, runStarted } from "./helpers/factory-store.mjs";

/**
 * §4.5's artifact write: the effect pair that puts a blob in the store, and the
 * ledger row that commits with its resolution.
 */

const AT = 1_770_000_100_000;

async function storeWithRun(t) {
	const store = await openTestStore(t);
	const run = newUlid();
	store.append(runStarted(run));
	store.append(attemptLaunched(run, 94));
	return { store, run };
}

/** The write every test here starts from: a harvested check output, run-scoped. */
function harvest(store, run, overrides = {}) {
	return writeArtifact(store, {
		content: "unit: 41 passed, 0 failed",
		mediaType: "text/plain",
		role: "check-output",
		name: "unit",
		run,
		ticket: 94,
		phase: "verify",
		attempt: `${run}-t94-a1`,
		actor: "controller",
		fencingGeneration: 1,
		at: AT,
		...overrides,
	});
}

function eventsOfKind(store, kind) {
	return store.readEvents({}).filter((event) => event.kind === kind);
}

// ── The pair, and the row that rides it (§4.5, §12.1) ────────────────────────

test("an artifact write is an effect, and its ledger row commits with the resolution", async (t) => {
	const { store, run } = await storeWithRun(t);
	const content = "unit: 41 passed, 0 failed";

	const written = harvest(store, run);

	assert.equal(written.key, `${run}/94/verify/${run}-t94-a1/artifact-write/check-output/unit`);
	assert.equal(written.outcome, "written");

	const effect = store.read((db) => db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(written.key));
	assert.equal(effect.state, "resolved");
	assert.deepEqual(JSON.parse(effect.result), {
		algorithm: "sha256",
		digest: addressOfContent(content).digest,
		bytes: Buffer.byteLength(content),
	});

	assert.equal(eventsOfKind(store, "effect.requested").length, 1);
	assert.equal(eventsOfKind(store, "effect.resolved").length, 1);

	// The blob is on disk, the row resolves through the ledger, and the reference
	// is the §6.6 five: digest, media type, byte count, producer, retention class.
	assert.equal(probeArtifactBlob(store.storeDir, written.reference).digestMatches, true);
	assert.equal(resolveArtifact(store, written.reference).status, "available");
	assert.deepEqual({ ...written.reference }, {
		algorithm: "sha256",
		digest: addressOfContent(content).digest,
		media_type: "text/plain",
		bytes: Buffer.byteLength(content),
		producer: { run, ticket: 94, attempt: `${run}-t94-a1` },
		retention_class: "tier-1",
	});
});

test("the probe that settles an artifact write is file-exists-and-re-hashes-to-its-digest (§4.5)", () => {
	for (const operation of ["artifact-write", "attestation-write"]) {
		assert.deepEqual({ ...EFFECT_REGISTRY.probeFor(operation) }, {
			source: "artifact",
			call: "artifact.blob",
			match: "digest-rehash",
		});
	}
});

test("re-writing the same artifact is the same effect: one blob, one row, one record", async (t) => {
	const { store, run } = await storeWithRun(t);

	const first = harvest(store, run);
	const second = harvest(store, run, { at: AT + 5_000 });

	assert.equal(second.outcome, "already-written");
	assert.deepEqual({ ...second.reference }, { ...first.reference });

	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM effect").get().n), 1);
	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM artifact").get().n), 1);
	assert.equal(eventsOfKind(store, "effect.requested").length, 1);
	assert.equal(eventsOfKind(store, "effect.resolved").length, 1);
});

test("the same key with different content is a typed conflict, and nothing is written", async (t) => {
	const { store, run } = await storeWithRun(t);
	harvest(store, run);

	const conflict = refusalOf(() => harvest(store, run, { content: "unit: 40 passed, 1 failed" }));

	// The digest sits beside the key, never in it (§14.4): a second attestation
	// for the same attempt is two systems disagreeing about what happened, and
	// guessing which one is right is exactly what the conflict exists to stop.
	assert.equal(conflict.reason, "effect-payload-conflict");
	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM artifact").get().n), 1);
	assert.equal(
		probeArtifactBlob(store.storeDir, addressOfContent("unit: 40 passed, 1 failed")).present,
		false,
		"the refused content reached the blob store anyway",
	);
});

test("a request left unresolved by a crash is settled by the next write, not doubled", async (t) => {
	const { store, run } = await storeWithRun(t);
	const content = "unit: 41 passed, 0 failed";

	// What a controller killed between §4.5's `requested` record and its
	// resolution leaves behind. The blob may or may not exist; the write is
	// content-addressed, so redoing it is free and settling it is what reconcile
	// would otherwise have to do (§5.3).
	requestEffect(store, {
		run,
		ticket: 94,
		phase: "verify",
		attempt: `${run}-t94-a1`,
		operation: "artifact-write",
		operand: "check-output/unit",
		actor: "controller",
		fencingGeneration: 1,
		payload: {
			role: "check-output",
			algorithm: "sha256",
			digest: addressOfContent(content).digest,
			media_type: "text/plain",
			bytes: Buffer.byteLength(content),
			retention_class: "tier-1",
		},
		at: AT,
	});

	const written = harvest(store, run, { at: AT + 1_000 });

	assert.equal(written.outcome, "written");
	assert.equal(eventsOfKind(store, "effect.requested").length, 1);
	assert.equal(eventsOfKind(store, "effect.resolved").length, 1);
	assert.equal(resolveArtifact(store, written.reference).status, "available");
});

// ── §6.6: large output goes in by reference, never embedded ─────────────────

test("large worker output is referenced by digest, and never embedded in an event payload", async (t) => {
	const { store, run } = await storeWithRun(t);
	const stdout = `${"x".repeat(200_000)}\nMARKER-THE-WORKER-PRINTED`;

	const written = harvest(store, run, { content: stdout, role: "check-output", name: "stdout" });

	for (const event of store.readEvents({})) {
		const payload = canonicalJson(event.payload);
		assert.equal(payload.includes("MARKER-THE-WORKER-PRINTED"), false, `${event.kind} embedded the output`);
		assert.ok(payload.length < 1_000, `${event.kind} carries ${payload.length} bytes of payload`);
	}

	// What the journal carries instead is §6.6's list, and nothing else.
	assert.deepEqual(Object.keys(written.reference).sort(), [
		"algorithm",
		"bytes",
		"digest",
		"media_type",
		"producer",
		"retention_class",
	]);
	assert.equal(written.reference.bytes, Buffer.byteLength(stdout));

	const requested = eventsOfKind(store, "effect.requested")[0];
	assert.equal(requested.payload.effect_payload.digest, written.reference.digest);
	assert.equal(requested.payload.effect_payload.bytes, written.reference.bytes);
	assert.equal(requested.payload.effect_payload.retention_class, "tier-1");
});

test("a reference is the five §6.6 fields, and it never grows a path (§14.28)", async (t) => {
	const { store, run } = await storeWithRun(t);
	const reference = harvest(store, run).reference;

	assert.deepEqual(
		Object.keys(reference).filter((field) => /path|file|dir|location/i.test(field)),
		[],
	);
	assert.ok(Object.isFrozen(reference));

	// The reference of a row read back is the same value: one shape, whether the
	// artifact was just written or looked up years later.
	assert.deepEqual({ ...artifactReference(resolveArtifact(store, reference)) }, { ...reference });
});

// ── The write seam's own vocabulary (§12.1) ─────────────────────────────────

test("the role is §12.1's closed contents list, and an attestation is written as one", async (t) => {
	const { store, run } = await storeWithRun(t);

	assert.deepEqual(ARTIFACT_ROLES, [
		"attestation",
		"handshake",
		"run-manifest",
		"check-output",
		"review-verdict",
	]);

	for (const role of ["transcript", "logs", "", null]) {
		assert.equal(refusalOf(() => harvest(store, run, { role, name: null })).reason, "artifact-role-unknown");
	}

	// §4.5 lists "artifact and attestation writes" as two effect kinds, and the
	// catalogue declares both. The role picks between them rather than a third
	// name being invented for the same mutation.
	const attestation = harvest(store, run, {
		role: "attestation",
		name: null,
		phase: "verify",
		content: '{"commit":"9b27b20"}',
		mediaType: "application/json",
	});
	assert.equal(attestation.key, `${run}/94/verify/${run}-t94-a1/attestation-write`);
});

test("the write takes content, and its one free-text slot never reaches a path", async (t) => {
	const { store, run } = await storeWithRun(t);

	// A `name` discriminates two artifacts of the same role in one attempt — a
	// check's name, a review axis. It reaches the effect key and nothing else, and
	// it is still refused the shape of an escape: the operator reads these keys.
	for (const name of ["../evil", "a/b", "with space", "x".repeat(65), ""]) {
		assert.equal(refusalOf(() => harvest(store, run, { name })).reason, "artifact-name-invalid");
	}

	assert.equal(refusalOf(() => harvest(store, run, { content: { stdout: "x" } })).reason, "artifact-content-invalid");
});

test("an artifact write names its actor; the slot is never filled in for a caller who forgot", async (t) => {
	const { store, run } = await storeWithRun(t);

	// §4.5's slot says *who asked*. Defaulting it would record an operator verb's
	// artifact as the controller's, which is the one thing monitor O6's actor
	// exists to keep straight.
	assert.equal(refusalOf(() => harvest(store, run, { actor: undefined })).reason, "effect-actor-invalid");
});

test("binary content survives the round trip, bytes for bytes (§15)", async (t) => {
	const { store, run } = await storeWithRun(t);
	const log = Buffer.from([0x00, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xff, 0xfe, 0x0a, 0x00]);

	// §15 names binary logs beside the `../` case: a harvested check's output is
	// whatever the check printed, escape codes and stray bytes included, and a
	// store that only round-trips text would corrupt exactly the evidence an
	// operator is reading.
	const written = harvest(store, run, { content: log, mediaType: "application/octet-stream", name: "smoke" });

	assert.equal(written.reference.bytes, log.length);
	assert.deepEqual(readArtifact(store, written.reference), log);
	assert.equal(resolveArtifact(store, written.reference).media_type, "application/octet-stream");
});

test("a repo-scoped artifact is a whole effect on the controller stream, and it is permanent", async (t) => {
	const store = await openTestStore(t);

	// §12.1's five contents are all produced by a run, so this is the door §4.5
	// keeps open rather than one of them — "a repo-scoped effect … still produces
	// a well-formed, UNIQUE-constrainable key". The class follows: no run's expiry
	// ever names an artifact no run produced (§12.6).
	const written = writeArtifact(store, {
		content: "the package handshake",
		mediaType: "application/json",
		role: "handshake",
		phase: "preflight",
		actor: "operator:doctor",
		fencingGeneration: 1,
		at: AT,
	});

	assert.equal(written.key, "-/-/preflight/-/artifact-write/handshake");
	assert.equal(written.reference.retention_class, "permanent");
	assert.deepEqual({ ...written.reference.producer }, { run: null, ticket: null, attempt: null });

	const events = store.readEvents({ stream: "controller" });
	assert.deepEqual(
		events.map((event) => event.kind),
		["effect.requested", "effect.resolved"],
	);
	assert.equal(events[0].source, "operator");
});
