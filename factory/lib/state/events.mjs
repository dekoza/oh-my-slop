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
	// #98: §10.5's stop and its escalation. Operator facts on the run's stream:
	// the request is durable, carries the actor slot, and is polled by the
	// controller at ticket boundaries. `abandon-requested` supersedes a pending
	// stop rather than being one — the two leave the world in different states
	// (§13.A).
	"run.stop-requested": { payloadVersion: 1, visibility: "operator" },
	"run.abandon-requested": { payloadVersion: 1, visibility: "operator" },
	// v2 for both run terminal kinds (#97): v1 `run.ended` could carry
	// `lease-lost`, end a run twice, and be followed by lifecycle moves. Those
	// journals were valid when written, so the projectors replay v1 with the
	// legacy tolerance and enforce the tightened contract from v2 on — the
	// version is what lets them tell history from a current writer's mistake.
	"run.lifecycle-changed": { payloadVersion: 2, visibility: "operator" },
	"run.ended": { payloadVersion: 2, visibility: "operator" },
	"preflight.checked": { payloadVersion: 1, visibility: "operator" },
	"attempt.launched": { payloadVersion: 1, visibility: "operator" },
	// #105: §6.2's layer 3 — the per-attempt static recheck. It cites the run's
	// pinned handshake digest rather than re-embedding the payload (§11.7), and
	// carries the observed resolved model id whose within-run stability the
	// recheck enforces.
	"attempt.rechecked": { payloadVersion: 1, visibility: "detail" },
	// #107: §6.5's correlation record — what only the harness can say, once it
	// has said it. `attempt.launched` is the **mint**, appended before any
	// attempt-scoped effect because the projections refuse a record for a tuple
	// nothing minted; the Herdr agent and pane ids, and the transcript pointer
	// polled out of Herdr after the agent came up, are not known then. It is
	// also the marker that the launch *finished*: an attempt with a mint and no
	// correlation is one a controller died in the middle of.
	//
	// #114 puts it on **payload v2**: `herdr.kind`, the agent kind Herdr was
	// asked to start. §5.5's adoption test compares a live pane's agent against
	// it, and a v1 record has nowhere to read it from — `worker/adoption.mjs`
	// falls back to the mint's runtime there, which is the same value for both
	// shipped runtimes but is a derivation rather than an observation. The
	// version is what lets a reader tell the two apart.
	"attempt.correlated": { payloadVersion: 2, visibility: "detail" },
	// #107: §6.6's typed completion. One attempt ends once, carrying the outcome
	// §8.8 names and — for a cancellation — who asked and why. It is the record
	// that makes "late outboxes are ignored for state" structural: the projector
	// refuses a second ending, so a worker that writes after the harvest is
	// writing evidence.
	//
	// #152 puts it on **payload v2**: `agent_stopped`. A v1 record carries the
	// pane read taken on the line after the quit sequence — a race, not an
	// observation, and one #114's two runs lost every time: every attempt
	// recorded `false` while the workers' session files stopped growing at the
	// exact second of the record. From v2 the value is what a bounded re-probe
	// saw, `null` where Herdr would not answer, and a stop that could not be
	// confirmed names the surviving pane in `stop_anomaly` rather than leaving a
	// later reader to guess which of the three a bare `false` meant (§11.2, §13.B).
	"attempt.ended": { payloadVersion: 2, visibility: "operator" },
	// #108: §8.10's stage result, and the record the outcome chain is read back
	// from. One per `(run, ticket, phase, attempt, try)` — §2.1's stage identity,
	// the attempt it was resolved under, and which pass through the phase it was.
	// A repair re-enters a phase with a new attempt and that is a new result
	// rather than a contradiction of the old one. A second, identical result under
	// one key is returned idempotently; a conflicting one is §8.10's typed
	// conflict.
	//
	// #146 puts it on **payload v2**: the `try` slot. A controller phase has no
	// worker (§8.8), so §8.10's automation retry of one mints no attempt and the
	// attempt slot cannot vary — the pass is what does. A v1 record predates any
	// way of re-entering a controller phase, so it reads as the first pass.
	"stage.resolved": { payloadVersion: 2, visibility: "operator" },
	// #98: §8.8's disposition as a durable ticket-execution fact. The value is
	// held to the closed set at the projector; `released` is the one member
	// this package's writer reaches (abandon, §9.6), and the column speaks the
	// whole set so the slice that owns the rest writes it additively.
	//
	// #111 puts it on **payload v2**: the record now carries the reason class and
	// the fault the execution settled under, which is what makes §8.6's "N
	// consecutive automation failures in terminal-commit order" reconstructible
	// from the journal at all. A v1 record has a disposition and no fault, and
	// reading that absence as "not the automation's fault" would count every
	// historical failure as a product verdict — the silent wrong answer §4.3's
	// per-kind versioning exists to turn into a visible one.
	"ticket.disposition-changed": { payloadVersion: 2, visibility: "operator" },
	"effect.requested": { payloadVersion: 1, visibility: "detail" },
	"effect.resolved": { payloadVersion: 1, visibility: "detail" },
	"observation.recorded": { payloadVersion: 1, visibility: "detail" },
	"observation.degraded": { payloadVersion: 1, visibility: "operator" },
	// #149: a frame for our pane whose wire name the build does not know. Loud
	// rather than the silent null that means "another pane's frame" (§5.1,
	// §11.2) — but a `diagnostic`, not a degradation: the socket is healthy, the
	// vocabulary is what fell behind. Herdr states no id for it, so it is
	// deduped in-memory per attempt rather than by the foreign-id index.
	"observation.unrecognised": { payloadVersion: 1, visibility: "diagnostic" },
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
	// #154: §9's time-boxed provider-exhaustion memo. A class a provider refused
	// for quota or rate reasons is unavailable until the recorded expiry, and the
	// pair is the state: an exhaustion whose expiry passed is re-admitted **only**
	// by a probe's admission record, never by the clock (§5.2). Both ride the
	// `controller` stream with no run in the envelope — the memo outlives the run
	// that observed the refusal and is consulted by the next one — with the
	// observation it came from carried in the payload.
	"capacity.exhausted": { payloadVersion: 1, visibility: "operator" },
	"capacity.admitted": { payloadVersion: 1, visibility: "operator" },
});

/**
 * Who the record came from (§3.4's mandatory source tag). `foreign` is the
 * observed-not-authored mark: a foreign record must carry that system's own
 * stable id, and its raw timestamp string verbatim in the payload (§4.3), so
 * re-polling is idempotent and the evidence survives our normalisation.
 *
 * **`statesTime: false` is a property of the source, not an escape a record
 * may claim.** Herdr's event frames carry no timestamp and no id — verified
 * against protocol 19, where a `pane_agent_status_changed` frame is
 * `{pane_id, workspace_id, agent_status, agent}` and nothing more. There is
 * therefore no raw timestamp string to retain, and writing our own clock into
 * the slot reserved for the foreign system's would be the one thing §4.3's
 * rule exists to prevent: a normalised value presented as the original. So the
 * source declares that it states no time, the key is refused on it outright,
 * and `observed_at` alone dates the frame — which is the honest reading, since
 * receipt is the only moment anyone observed.
 */
export const EVENT_SOURCES = Object.freeze({
	controller: { foreign: false },
	operator: { foreign: false },
	gitea: { foreign: true },
	git: { foreign: true },
	herdr: { foreign: true, statesTime: false },
	outbox: { foreign: true },
});

/**
 * Which §4.3 `source` a §4.5 actor writes as.
 *
 * The actor grammar is `controller` or `operator:<verb>` (monitor O6, §13.D) and
 * the source vocabulary is the six above, so the mapping is a collapse: every
 * operator verb writes as `operator`. It lives here, with `EVENT_SOURCES`,
 * because five callers need it from four layers — the effect pair, the
 * truncation primitive, §12.6's expiry, §10.3's preflight stage and §5.3's
 * reconcile conclusion — and the state layer cannot import from `effects/`.
 * Copies of one ternary are how the day arrives that a record from
 * `operator:cleanup-execute` is attributed to the controller.
 *
 * **The last two arrived late** (#176): the extraction converted three call
 * sites and left two writing the expression out, which reads as finished from
 * everywhere except a search for the expression rather than the name. That is
 * what `factory_state_events` now asserts structurally.
 *
 * It does not validate: the grammar's refusal is §4.5's, at the one place an
 * actor enters a pair.
 *
 * @param {string} actor
 * @returns {string} a member of `EVENT_SOURCES`
 */
export function sourceForActor(actor) {
	return actor === "controller" ? "controller" : "operator";
}

/**
 * The payload key holding a foreign system's own timestamp string. Gitea
 * returns RFC3339 with the server's local offset; we store integer UTC
 * milliseconds *and* keep the original, because normalising in place destroys
 * evidence.
 */
export const FOREIGN_TIMESTAMP_KEY = "occurred_at_raw";

export const CONTROLLER_STREAM = "controller";
export const HEARTBEAT_STREAM = "controller.heartbeat";

/**
 * What every run stream's name begins with. Named because a reader sometimes
 * asks about the *class* rather than one run — §12.2's heartbeat boundary is
 * "the first record of the oldest surviving run stream" — and a second spelling
 * of `run:` in a `LIKE` somewhere else is a prefix waiting to disagree with this
 * one.
 */
export const RUN_STREAM_PREFIX = "run:";

/** @param {string} runId @returns {string} */
export function runStream(runId) {
	return `${RUN_STREAM_PREFIX}${runId}`;
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

	if (sourceDeclaration.statesTime === false) {
		// The refusal is the load-bearing half: a source that states no time has
		// nothing to retain, so anything in this slot is our clock wearing the
		// foreign system's name.
		if (raw !== undefined) {
			refuse(
				`payload.${FOREIGN_TIMESTAMP_KEY}`,
				`This source states no time of its own, so "${FOREIGN_TIMESTAMP_KEY}" would carry our clock under its name (§4.3). observed_at dates the record.`,
				{ found: raw },
			);
		}
		return;
	}

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
