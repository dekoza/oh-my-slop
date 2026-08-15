import { createHash } from "node:crypto";

import { IDENTITY_CHARSET, PHASES } from "../domain/vocabulary.mjs";
import { isUlid, newUlid } from "../identity/ulid.mjs";
import { FactoryStateError } from "./errors.mjs";

/**
 * The §4.3 event envelope: what a journal record must carry, and what it
 * refuses to carry.
 *
 * The record is built and hashed in one place because the hash covers the whole
 * envelope — Babysitter's checksum covered `{type, recordedAt, data}` alone,
 * which is precisely why deletion, reordering, and renaming were not
 * tamper-evident there.
 */

/** The envelope's own shape version. Per-kind payload versions are separate. */
export const ENVELOPE_VERSION = 1;

/** §4.2's chain root: the first record in a stream links to nothing. */
export const GENESIS_PREV_HASH = "";

const HASH_ALGORITHM = "sha256";

/**
 * §4.3's three-value class. Two values cannot express "real, but only when you
 * are looking at this node", and the requirement is that internals stay
 * *filterable* rather than *unemitted*.
 */
export const VISIBILITY_CLASSES = Object.freeze(["operator", "detail", "diagnostic"]);

/**
 * §4.3's closed, dotted `<entity>.<verb>` enumeration, additive-only. Each kind
 * carries **its own** payload version: a journal-wide bump would force every
 * unchanged kind to lie about having changed.
 *
 * `visibility` here is the kind's default; an emitter may narrow or widen a
 * single record, and the value is validated either way.
 */
export const EVENT_KINDS = Object.freeze({
	"run.started": { payloadVersion: 1, visibility: "operator" },
	"run.lifecycle-changed": { payloadVersion: 1, visibility: "operator" },
	"run.ended": { payloadVersion: 1, visibility: "operator" },
	"preflight.checked": { payloadVersion: 1, visibility: "operator" },
	"attempt.launched": { payloadVersion: 1, visibility: "operator" },
	"effect.requested": { payloadVersion: 1, visibility: "detail" },
	"effect.resolved": { payloadVersion: 1, visibility: "detail" },
	"observation.recorded": { payloadVersion: 1, visibility: "detail" },
	"observation.degraded": { payloadVersion: 1, visibility: "operator" },
	"reconcile.concluded": { payloadVersion: 1, visibility: "operator" },
	"controller.heartbeat": { payloadVersion: 1, visibility: "diagnostic" },
	"controller.lease-lost": { payloadVersion: 1, visibility: "operator" },
	"projection.rebuilt": { payloadVersion: 1, visibility: "diagnostic" },
	"journal.integrity-failed": { payloadVersion: 1, visibility: "operator" },
	"stream.truncated": { payloadVersion: 1, visibility: "diagnostic" },
	"run.expired": { payloadVersion: 1, visibility: "operator" },
	"capacity.granted": { payloadVersion: 1, visibility: "detail" },
	"capacity.released": { payloadVersion: 1, visibility: "detail" },
	"capacity.waiting": { payloadVersion: 1, visibility: "detail" },
});

/**
 * Who the record came from (§3.4's mandatory source tag). `foreign` is the
 * observed-not-authored mark: a foreign record must carry that system's own
 * stable id, and its raw timestamp string verbatim in the payload (§4.3), so
 * re-polling is idempotent and the evidence survives our normalisation.
 */
export const EVENT_SOURCES = Object.freeze({
	controller: { foreign: false },
	operator: { foreign: false },
	gitea: { foreign: true },
	git: { foreign: true },
	herdr: { foreign: true },
	outbox: { foreign: true },
});

/**
 * The payload key holding a foreign system's own timestamp string. Gitea
 * returns RFC3339 with the server's local offset; we store integer UTC
 * milliseconds *and* keep the original, because normalising in place destroys
 * evidence.
 */
export const FOREIGN_TIMESTAMP_KEY = "occurred_at_raw";

export const CONTROLLER_STREAM = "controller";
export const HEARTBEAT_STREAM = "controller.heartbeat";

/** @param {string} runId @returns {string} */
export function runStream(runId) {
	return `run:${runId}`;
}

/**
 * @param {object} input the envelope's authored fields
 * @param {number} input.seq the journal-assigned global sequence
 * @param {string} input.prevHash the previous hash **in this stream**
 * @returns {Readonly<object>} the complete, hashed envelope
 * @throws {FactoryStateError} `invalid-event`
 */
export function buildEnvelope({
	seq,
	prevHash,
	kind,
	source,
	occurredAt,
	observedAt,
	payload,
	stream,
	run = null,
	ticket = null,
	phase = null,
	attempt = null,
	causalCommandId = null,
	foreignSourceId = null,
	visibility,
	eventId = newUlid(),
}) {
	const declaration = EVENT_KINDS[kind];
	if (declaration === undefined) {
		refuse("kind", `Unknown event kind ${JSON.stringify(kind ?? null)}; §4.3's enumeration is closed.`, {
			found: kind ?? null,
		});
	}

	requireSequence(seq);
	requireString(prevHash, "prev_hash");
	requireTimestamp(occurredAt, "occurred_at");
	requireTimestamp(observedAt, "observed_at");

	const sourceDeclaration = EVENT_SOURCES[source];
	if (sourceDeclaration === undefined) {
		refuse("source", `Unknown event source ${JSON.stringify(source ?? null)}; the source tag is mandatory.`, {
			found: source ?? null,
			expected: Object.keys(EVENT_SOURCES).join("|"),
		});
	}

	const resolvedVisibility = visibility ?? declaration.visibility;
	if (!VISIBILITY_CLASSES.includes(resolvedVisibility)) {
		refuse("visibility", `Visibility must be one of ${VISIBILITY_CLASSES.join(", ")}.`, {
			found: resolvedVisibility,
			expected: VISIBILITY_CLASSES.join("|"),
		});
	}

	requirePayload(payload);
	const identity = requireIdentity({ run, ticket, phase, attempt });
	const resolvedStream = requireStream(stream ?? streamFor(kind, identity.run), identity.run);
	requireForeignEvidence(sourceDeclaration, foreignSourceId, payload);

	if (!isUlid(eventId)) {
		refuse("event_id", `event_id must be a ULID; found ${JSON.stringify(eventId)}.`, { found: eventId });
	}

	const withoutHash = {
		seq,
		event_id: eventId,
		envelope_version: ENVELOPE_VERSION,
		kind,
		payload_version: declaration.payloadVersion,
		visibility: resolvedVisibility,
		stream: resolvedStream,
		run: identity.run,
		ticket: identity.ticket,
		phase: identity.phase,
		attempt: identity.attempt,
		causal_command_id: causalCommandId ?? null,
		source,
		occurred_at: occurredAt,
		observed_at: observedAt,
		foreign_source_id: foreignSourceId ?? null,
		payload,
		payload_digest: digest(canonicalJson(payload)),
		prev_hash: prevHash,
	};

	return Object.freeze({ ...withoutHash, hash: envelopeHash(withoutHash) });
}

/**
 * §4.3: `hash = sha256(prev_hash ‖ canonical_json(envelope_minus_hash))`. The
 * prefix is what chains the record to its predecessor **within its stream**;
 * the body is what makes every other field tamper-evident.
 *
 * @param {object} envelopeMinusHash
 * @returns {string} hex digest
 */
export function envelopeHash(envelopeMinusHash) {
	return createHash(HASH_ALGORITHM)
		.update(envelopeMinusHash.prev_hash)
		.update(canonicalJson(envelopeMinusHash))
		.digest("hex");
}

/**
 * Deterministic JSON: keys sorted, no whitespace, and nothing that JSON cannot
 * represent exactly. A hash is only evidence if the same value always
 * serialises the same way, so a `Date`, a `NaN`, or an `undefined` is a refusal
 * rather than a silent coercion to `null` or to an ISO string.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
	if (value === null) return "null";

	switch (typeof value) {
		case "string":
			return JSON.stringify(value);
		case "boolean":
			return value ? "true" : "false";
		case "number":
			if (!Number.isFinite(value)) throw new TypeError(`${value} has no JSON representation`);
			return JSON.stringify(value);
		case "object":
			break;
		default:
			throw new TypeError(`A ${typeof value} has no JSON representation`);
	}

	if (Array.isArray(value)) {
		return `[${value.map((element) => canonicalJson(element)).join(",")}]`;
	}

	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
		throw new TypeError(`${value.constructor?.name ?? "This object"} is not a plain JSON value`);
	}

	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		.join(",")}}`;
}

/** @param {string} canonical @returns {string} hex digest */
export function digest(canonical) {
	return createHash(HASH_ALGORITHM).update(canonical).digest("hex");
}

/**
 * §4.2's three streams, derived from the record itself. Exported because the
 * journal must chain against the *same* stream the envelope will carry: deriving
 * it twice is how every heartbeat ends up chained to nothing.
 *
 * @param {string} kind
 * @param {string | null} run
 * @returns {string}
 */
export function streamFor(kind, run) {
	if (kind === "controller.heartbeat") return HEARTBEAT_STREAM;
	return run === null || run === undefined ? CONTROLLER_STREAM : runStream(run);
}

/**
 * A record's stream and its `run` slot say the same thing or the record is
 * refused. Expiry records land on the `controller` stream naming their run in
 * the payload precisely because deleting a run's stream cannot be recorded
 * inside it (§12.2) — so a run-slotted record on the controller stream would be
 * a record about to be deleted by the thing it documents.
 */
function requireStream(stream, run) {
	if (run !== null) {
		if (stream !== runStream(run)) {
			refuse("stream", `A record carrying run ${run} belongs on ${runStream(run)}, not ${stream}.`, {
				found: stream,
				expected: runStream(run),
			});
		}
		return stream;
	}

	if (stream !== CONTROLLER_STREAM && stream !== HEARTBEAT_STREAM) {
		refuse("stream", `A record with no run belongs on ${CONTROLLER_STREAM} or ${HEARTBEAT_STREAM}.`, {
			found: stream,
			expected: `${CONTROLLER_STREAM}|${HEARTBEAT_STREAM}`,
		});
	}
	return stream;
}

function requireIdentity({ run, ticket, phase, attempt }) {
	if (run !== null) requireIdentitySegment(run, "run");
	if (phase !== null && !PHASES.includes(phase)) {
		refuse("phase", `Phase must be one of ${PHASES.join(", ")}; found ${JSON.stringify(phase)}.`, {
			found: phase,
			expected: PHASES.join("|"),
		});
	}
	if (ticket !== null && (!Number.isSafeInteger(ticket) || ticket <= 0)) {
		refuse("ticket", `Ticket must be a positive issue number; found ${JSON.stringify(ticket)}.`, {
			found: ticket,
		});
	}
	if (attempt !== null) {
		requireIdentitySegment(attempt, "attempt");
		// §2.1: the attempt id is `<run>-t<ticket>-a<n>`, and it is globally
		// unique so run 2's `t42/a1` cannot collide with run 1's published branch.
		if (run !== null && ticket !== null && !new RegExp(`^${run}-t${ticket}-a\\d+$`).test(attempt)) {
			refuse("attempt", `Attempt id ${attempt} does not name run ${run} ticket ${ticket} (§2.1).`, {
				found: attempt,
				expected: `${run}-t${ticket}-a<n>`,
			});
		}
	}

	return { run, ticket, phase, attempt };
}

function requireIdentitySegment(value, field) {
	if (typeof value !== "string" || !IDENTITY_CHARSET.test(value)) {
		refuse(field, `${field} must match ${IDENTITY_CHARSET} (§2.1); found ${JSON.stringify(value)}.`, {
			found: value,
		});
	}
}

function requireForeignEvidence(sourceDeclaration, foreignSourceId, payload) {
	if (!sourceDeclaration.foreign) return;

	if (typeof foreignSourceId !== "string" || foreignSourceId.length === 0) {
		refuse("foreign_source_id", "A foreign fact carries that system's own stable id (§4.3, §5.1).", {
			found: foreignSourceId ?? null,
		});
	}

	const raw = payload[FOREIGN_TIMESTAMP_KEY];
	if (typeof raw !== "string" || raw.length === 0) {
		refuse(
			`payload.${FOREIGN_TIMESTAMP_KEY}`,
			`A foreign fact retains that system's raw timestamp string verbatim in its payload as "${FOREIGN_TIMESTAMP_KEY}" (§4.3) — normalising in place destroys the evidence.`,
			{ found: raw ?? null },
		);
	}
}

function requirePayload(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
		refuse("payload", `Payload must be an object; found ${JSON.stringify(payload ?? null)}.`, {
			found: payload === undefined ? null : typeof payload,
		});
	}

	try {
		canonicalJson(payload);
	} catch (error) {
		refuse("payload", `Payload is not canonically serialisable: ${error.message}.`, {});
	}
}

function requireSequence(seq) {
	if (!Number.isSafeInteger(seq) || seq <= 0) {
		refuse("seq", `Sequence must be a positive integer; found ${JSON.stringify(seq ?? null)}.`, { found: seq });
	}
}

function requireString(value, field) {
	if (typeof value !== "string") {
		refuse(field, `${field} must be a string; found ${JSON.stringify(value ?? null)}.`, { found: value });
	}
}

/** §4.3: both timestamps are UTC epoch milliseconds — integers, never strings. */
function requireTimestamp(value, field) {
	if (!Number.isSafeInteger(value)) {
		refuse(
			field,
			`${field} must be UTC epoch milliseconds as an integer; found ${JSON.stringify(value ?? null)}.`,
			{ found: value ?? null },
		);
	}
}

function refuse(at, message, details) {
	throw new FactoryStateError("invalid-event", message, { at, ...details });
}
