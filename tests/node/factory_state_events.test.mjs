import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { FactoryStateError } from "../../factory/lib/state/errors.mjs";
import {
	buildEnvelope,
	canonicalJson,
	ENVELOPE_VERSION,
	EVENT_KINDS,
	EVENT_SOURCES,
	GENESIS_PREV_HASH,
	runStream,
	VISIBILITY_CLASSES,
} from "../../factory/lib/state/events.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";

/**
 * §4.3's envelope. Everything here is about the record itself — what it must
 * carry, what it refuses to carry, and what its hash covers. Chaining across
 * records belongs to the journal tests.
 */

const RUN_ID = newUlid();

function envelope(overrides = {}) {
	return buildEnvelope({
		seq: 1,
		prevHash: GENESIS_PREV_HASH,
		kind: "run.started",
		source: "controller",
		occurredAt: 1_770_000_000_000,
		observedAt: 1_770_000_000_005,
		run: RUN_ID,
		payload: { scope: { kind: "direct-ticket", tickets: [90] } },
		...overrides,
	});
}

function refusal(overrides) {
	try {
		envelope(overrides);
	} catch (error) {
		return error;
	}
	throw new assert.AssertionError({ message: "expected the envelope to be refused" });
}

// ── The field list (§4.3) ────────────────────────────────────────────────────

test("the envelope carries every §4.3 field", () => {
	const built = envelope({ causalCommandId: "cmd-1" });

	assert.deepEqual(Object.keys(built).sort(), [
		"attempt",
		"causal_command_id",
		"envelope_version",
		"event_id",
		"foreign_source_id",
		"hash",
		"kind",
		"observed_at",
		"occurred_at",
		"payload",
		"payload_digest",
		"payload_version",
		"phase",
		"prev_hash",
		"run",
		"seq",
		"source",
		"stream",
		"ticket",
		"visibility",
	]);
	assert.equal(built.envelope_version, ENVELOPE_VERSION);
	assert.equal(built.stream, runStream(RUN_ID));
	assert.match(built.event_id, /^[0-9A-HJKMNP-TV-Z]{26}$/, "event_id is a ULID");
});

test("the identity tuple slots are individually nullable", () => {
	const built = envelope({ kind: "controller.heartbeat", run: null, stream: "controller.heartbeat" });

	assert.equal(built.run, null);
	assert.equal(built.ticket, null);
	assert.equal(built.phase, null);
	assert.equal(built.attempt, null);
});

// ── Kinds, visibility, versions (§4.3) ───────────────────────────────────────

test("the kind enumeration is §4.3's closed, dotted list", () => {
	assert.deepEqual(
		Object.keys(EVENT_KINDS).sort(),
		[
			"attempt.correlated",
			"attempt.ended",
			"attempt.launched",
			"attempt.rechecked",
			"capacity.admitted",
			"capacity.exhausted",
			"capacity.granted",
			"capacity.released",
			"capacity.waiting",
			"controller.heartbeat",
			"controller.lease-lost",
			"effect.requested",
			"effect.resolved",
			"journal.integrity-failed",
			"observation.degraded",
			"observation.recorded",
			"observation.unrecognised",
			"preflight.checked",
			"projection.rebuilt",
			"reconcile.concluded",
			"run.ended",
			"run.expired",
			"run.lifecycle-changed",
			"run.started",
			"run.stop-requested",
			"run.abandon-requested",
			"stage.resolved",
			"stream.truncated",
			"ticket.disposition-changed",
		].sort(),
	);

	for (const kind of Object.keys(EVENT_KINDS)) {
		assert.match(kind, /^[a-z]+\.[a-z-]+$/, `${kind} is not <entity>.<verb>`);
	}
});

test("§10.5's stop and abandon requests are run-scoped operator facts", () => {
	// The stop request lands on the run's stream so the monitor watching that
	// run sees `draining` the moment it is *requested* rather than when the
	// phase ends — and it is an operator fact: the verb's process writes it,
	// not the controller.
	for (const kind of ["run.stop-requested", "run.abandon-requested"]) {
		assert.equal(EVENT_KINDS[kind].visibility, "operator", kind);
		assert.equal(EVENT_KINDS[kind].payloadVersion, 1, kind);

		const built = envelope({ kind, payload: { actor: "operator:stop" } });
		assert.equal(built.run, RUN_ID, `${kind} left the run's stream`);
		assert.equal(built.stream, `run:${RUN_ID}`);
	}
});

test("a kind outside the enumeration is refused", () => {
	const error = refusal({ kind: "run.paused" });

	assert.ok(error instanceof FactoryStateError);
	assert.equal(error.reason, "invalid-event");
	assert.equal(error.details.at, "kind");
});

test("visibility is the three-value class, defaulted per kind", () => {
	assert.deepEqual([...VISIBILITY_CLASSES], ["operator", "detail", "diagnostic"]);
	assert.equal(envelope().visibility, "operator");
	assert.equal(
		envelope({ kind: "controller.heartbeat", run: null, stream: "controller.heartbeat" }).visibility,
		"diagnostic",
	);
});

test("a visibility outside the three classes is refused, and a boolean is not one", () => {
	assert.equal(refusal({ visibility: "internal" }).details.at, "visibility");
	assert.equal(refusal({ visibility: true }).details.at, "visibility");
});

test("schema versioning is per kind, never per journal", () => {
	// The version travels with the kind, so a change to one kind's payload
	// cannot force every unchanged kind to claim it changed too.
	for (const [kind, declaration] of Object.entries(EVENT_KINDS)) {
		assert.equal(typeof declaration.payloadVersion, "number", `${kind} declares no payload version`);
	}

	assert.equal(envelope().payload_version, EVENT_KINDS["run.started"].payloadVersion);
	assert.equal(
		envelope({ kind: "capacity.waiting", payload: { resource: "local" } }).payload_version,
		EVENT_KINDS["capacity.waiting"].payloadVersion,
	);
});

test("the run terminal kinds are on payload v2: v1 spoke the legacy end-reason contract", () => {
	// #97: v1 `run.ended` could carry `lease-lost`, end a run twice, and be
	// followed by lifecycle moves. Those journals were valid when written, so the
	// semantics change is a version bump the replay path can branch on — not a
	// rewrite of what the old records meant.
	assert.equal(EVENT_KINDS["run.ended"].payloadVersion, 2);
	assert.equal(EVENT_KINDS["run.lifecycle-changed"].payloadVersion, 2);
});

test("§8.6: a disposition is on payload v2, because v1 could not say whose fault it was", () => {
	// #111: the circuit breaker counts **automation** failures, and a v1 record
	// carries a disposition with no fault beside it. Reading its absence as "not
	// the automation's fault" would make every historical failure look like a
	// product verdict — a silent wrong answer rather than a refusal, which is
	// exactly what a version exists to prevent (§4.3).
	assert.equal(EVENT_KINDS["ticket.disposition-changed"].payloadVersion, 2);
});

test("§8.10: a stage result is on payload v2, because v1 had no pass to name", () => {
	// #146: the semantic key gained a `try` slot when §8.10's automation retry of a
	// controller phase got its answer — it mints no attempt, so the pass is what
	// varies. A v1 record predates any way of re-entering a controller phase at
	// all, which is why it reads as the first pass rather than as a gap.
	assert.equal(EVENT_KINDS["stage.resolved"].payloadVersion, 2);
});

test("§13.B: an ending is on payload v2, because v1's agent_stopped was a race", () => {
	// #152: v1 wrote the pane read taken on the line after the quit sequence, so
	// its `false` records a teardown in flight as often as a refusal — #114's two
	// runs recorded it for every attempt while the workers had in fact gone. From
	// v2 the value is what a bounded re-probe observed, and a stop that could not
	// be confirmed names itself in `stop_anomaly` instead of borrowing that false.
	assert.equal(EVENT_KINDS["attempt.ended"].payloadVersion, 2);
});

// ── Sources and foreign facts (§4.3, §5.1) ───────────────────────────────────

test("source is mandatory and comes from the closed set", () => {
	assert.equal(refusal({ source: undefined }).details.at, "source");
	assert.equal(refusal({ source: "somewhere" }).details.at, "source");
	assert.ok(EVENT_SOURCES.gitea.foreign, "gitea is a foreign source");
	assert.equal(EVENT_SOURCES.controller.foreign, false);
});

test("a foreign fact carries the foreign id and the raw timestamp verbatim", () => {
	const built = envelope({
		kind: "observation.recorded",
		source: "gitea",
		foreignSourceId: "comment:41231",
		occurredAt: 1_769_999_000_000,
		payload: { occurred_at_raw: "2026-08-14T21:03:20+02:00", fact: "label-added" },
	});

	assert.equal(built.foreign_source_id, "comment:41231");
	assert.equal(built.payload.occurred_at_raw, "2026-08-14T21:03:20+02:00");
});

test("a foreign fact without its raw timestamp string is refused", () => {
	const error = refusal({
		kind: "observation.recorded",
		source: "gitea",
		foreignSourceId: "comment:41231",
		payload: { fact: "label-added" },
	});

	assert.equal(error.details.at, "payload.occurred_at_raw");
	assert.match(error.message, /verbatim|raw/i);
});

test("a foreign fact without a foreign source id is refused", () => {
	assert.equal(
		refusal({
			kind: "observation.recorded",
			source: "gitea",
			payload: { occurred_at_raw: "2026-08-14T21:03:20+02:00" },
		}).details.at,
		"foreign_source_id",
	);
});

test("a source that states no time carries no raw timestamp, and may not fake one", () => {
	// Verified against Herdr protocol 19: a `pane_agent_status_changed` frame is
	// `{pane_id, workspace_id, agent_status, agent}` and nothing more, and no
	// answer anywhere in its API is dated. So there is nothing to retain — and
	// the slot §4.3 reserves for the foreign system's own string must not be
	// filled with ours under its name.
	assert.equal(EVENT_SOURCES.herdr.foreign, true);
	assert.equal(EVENT_SOURCES.herdr.statesTime, false);

	const built = envelope({
		kind: "observation.recorded",
		source: "herdr",
		foreignSourceId: "herdr:w1:p2:R-t42-a1:3",
		payload: { fact: "worker.alive", status: "blocked" },
	});
	assert.equal(built.payload.occurred_at_raw, undefined);
	assert.equal(built.observed_at, 1_770_000_000_005, "receipt is the only moment anyone observed");

	const error = refusal({
		kind: "observation.recorded",
		source: "herdr",
		foreignSourceId: "herdr:w1:p2:R-t42-a1:3",
		payload: { fact: "worker.alive", occurred_at_raw: "2026-08-15T09:00:00+02:00" },
	});
	assert.equal(error.details.at, "payload.occurred_at_raw");
	assert.match(error.message, /states no time/);
});

// ── Timestamps (§4.3) ────────────────────────────────────────────────────────

test("both timestamps are UTC epoch milliseconds, and a string is not one", () => {
	assert.equal(refusal({ occurredAt: "2026-08-14T21:03:20+02:00" }).details.at, "occurred_at");
	assert.equal(refusal({ observedAt: "2026-08-14T21:03:20Z" }).details.at, "observed_at");
	assert.equal(refusal({ occurredAt: 1.5 }).details.at, "occurred_at");
});

// ── The hash (§4.2, §4.3) ────────────────────────────────────────────────────

test("the hash is sha256(prev_hash ‖ canonical_json(envelope minus hash))", () => {
	const built = envelope();
	const { hash, ...rest } = built;

	assert.equal(hash, createHash("sha256").update(built.prev_hash).update(canonicalJson(rest)).digest("hex"));
});

test("the hash covers the whole envelope — every field moves it", () => {
	const baseline = envelope({ causalCommandId: "cmd-1" }).hash;
	const variants = {
		seq: { seq: 2 },
		kind: { kind: "run.ended", payload: { end_reason: "drained" } },
		visibility: { visibility: "detail" },
		source: { source: "operator" },
		occurred_at: { occurredAt: 1_770_000_000_001 },
		observed_at: { observedAt: 1_770_000_000_006 },
		causal_command_id: { causalCommandId: "cmd-2" },
		payload: { payload: { scope: { kind: "direct-ticket", tickets: [91] } } },
		prev_hash: { prevHash: "a".repeat(64) },
		ticket: { ticket: 90 },
	};

	for (const [field, override] of Object.entries(variants)) {
		assert.notEqual(envelope({ causalCommandId: "cmd-1", ...override }).hash, baseline, `${field} is unhashed`);
	}
});

test("the payload digest is over the payload alone", () => {
	const payload = { scope: { kind: "direct-ticket", tickets: [90] } };

	assert.equal(
		envelope({ payload }).payload_digest,
		createHash("sha256").update(canonicalJson(payload)).digest("hex"),
	);
});

test("canonical json is key-order independent and stable", () => {
	assert.equal(canonicalJson({ b: 1, a: [3, { d: 4, c: 5 }] }), canonicalJson({ a: [3, { c: 5, d: 4 }], b: 1 }));
	assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("a payload that cannot be canonicalised is refused rather than silently coerced", () => {
	assert.equal(refusal({ payload: { at: new Date(0) } }).details.at, "payload");
	assert.equal(refusal({ payload: { n: Number.NaN } }).details.at, "payload");
	assert.equal(refusal({ payload: { missing: undefined } }).details.at, "payload");
});
