import { CONTROLLER_LEASE } from "../domain/vocabulary.mjs";
import { canonicalJson, digest } from "../state/events.mjs";
import { FactoryEffectError } from "./errors.mjs";
import { effectKey } from "./keys.mjs";
import { EFFECT_REGISTRY } from "./registry.mjs";

/**
 * §4.5's requested / resolved pair.
 *
 * **Every mutation outside the database is an effect**, and the database itself
 * enforces idempotency: `effect_key` is the table's primary key, so a duplicate
 * request cannot become a second row however many controllers ask. The row is
 * canonical rather than a projection (§4.4) — it is never rebuilt from the
 * journal — and it still commits in the same transaction as the event that
 * records the intent, so there is nothing to reconcile between the two.
 *
 * The journal records **intent** and never establishes an external fact (§14.1):
 * a `requested` row with no resolution is settled by re-probing (§5.3), which is
 * why the registry refuses a kind with no probe.
 */

/**
 * Ask for a mutation, or discover that this exact one was already asked for.
 *
 * §4.5's digest rule lives here, on the issuing path, because that is where a
 * conflicting duplicate actually arrives: the payload digest sits **beside** the
 * key, and re-issuing the same key with an identical payload returns the
 * committed result, while a different payload is a typed conflict. Hashing the
 * payload into the key instead would turn that conflict into a different key and
 * two mutations nobody compared (§14.4).
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {object} request
 * @param {string} request.operation a registered effect kind (§4.5)
 * @param {string | null} [request.operand] a natural discriminator — a label, a branch
 * @param {string | null} [request.run] the run this effect belongs to, or null when repo-scoped
 * @param {number | null} [request.ticket] the tracker issue number, or null
 * @param {string} request.phase §2.2's phase, `cleanup` and `expiry` included
 * @param {string | null} [request.attempt] the attempt id, or null
 * @param {string} request.actor `controller`, or `operator:<verb>` (monitor O6)
 * @param {number} request.fencingGeneration the generation the requester holds (§4.6)
 * @param {object} request.payload what the mutation will carry — digested, never keyed
 * @param {number} [request.at] UTC epoch milliseconds; defaults to now
 * @param {string | null} [request.causalCommandId] the command this effect answers to
 * @returns {{ key: string, outcome: "requested" | "already-requested" | "already-resolved",
 *             state: string, result: unknown }}
 * @throws {FactoryEffectError}
 */
export function requestEffect(store, request) {
	return store.transaction((tx) => requestEffectIn(tx, request));
}

/**
 * The same, in a transaction the caller already opened.
 *
 * It exists because some effects commit **beside a canonical row of their own** —
 * §12.1's artifact ledger is the one today — and the row and the pair have to be
 * one transaction or an artifact ends up half-visible. The alternative, letting
 * that caller write the `effect` row itself, would put effect writes in two
 * places; §4.5 has exactly one.
 *
 * @param {{ appendEvent: (input: object) => object, db: object }} tx
 * @param {object} request the same request `requestEffect` takes
 */
export function requestEffectIn(
	tx,
	{
		operation,
		operand = null,
		run = null,
		ticket = null,
		phase,
		attempt = null,
		actor,
		fencingGeneration,
		payload,
		at = Date.now(),
		causalCommandId = null,
	},
) {
	// The lookup is the gate: an unregistered kind has no probe, and an effect
	// nothing can re-probe is one the journal would have to assert (§14.1).
	EFFECT_REGISTRY.probeFor(operation);
	requireActor(actor);
	requireGeneration(fencingGeneration);

	const key = effectKey({ run, ticket, phase, attempt, operation, operand });
	const payloadDigest = digestOf(payload);
	requireOperandIsNotTheDigest(operand, payloadDigest);

	const existing = readRow(tx.db, key);
	if (existing !== null) return settleDuplicate(existing, payloadDigest);

	const event = tx.appendEvent({
		kind: "effect.requested",
		source: sourceOf(actor),
		run,
		ticket,
		phase,
		attempt,
		causalCommandId,
		occurredAt: at,
		observedAt: at,
		payload: {
			effect_key: key,
			operation,
			operand,
			actor,
			fencing_generation: fencingGeneration,
			effect_payload: payload,
			effect_payload_digest: payloadDigest,
		},
	});

	tx.db
		.prepare(
			`INSERT INTO effect(effect_key, run_id, ticket, phase, attempt_id, operation, operand, payload_digest,
			                    actor, fencing_generation, state, requested_at, requested_seq)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
		)
		.run(key, run, ticket, phase, attempt, operation, operand, payloadDigest, actor, fencingGeneration, at, event.seq);

	return { key, outcome: "requested", state: "requested", result: null };
}

/**
 * Record what the world did, under the generation the resolver holds.
 *
 * **An effect resolving under a superseded fencing generation is rejected**
 * (§14.5) — that is what makes the fencing real rather than decorative, and it
 * is the backstop that lets a controller which lost its lease simply exit
 * instead of having to win a race (§4.6).
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {object} resolution
 * @param {string} resolution.key the effect key, as `requestEffect` returned it
 * @param {string} resolution.actor `controller`, or `operator:<verb>` (monitor O6)
 * @param {number} resolution.fencingGeneration the generation the resolver holds
 * @param {unknown} resolution.result what the external system answered
 * @param {number} [resolution.at] UTC epoch milliseconds; defaults to now
 * @param {string | null} [resolution.causalCommandId] the command this resolution answers to
 * @returns {{ key: string, outcome: "resolved" | "already-resolved", state: string, result: unknown }}
 * @throws {FactoryEffectError}
 */
export function resolveEffect(store, resolution) {
	return store.transaction((tx) => resolveEffectIn(tx, resolution));
}

/**
 * The same, in a transaction the caller already opened — the resolution half of
 * `requestEffectIn`, and the one an artifact write commits its ledger row beside
 * (§12.1).
 *
 * @param {{ appendEvent: (input: object) => object, db: object }} tx
 * @param {object} resolution the same resolution `resolveEffect` takes
 */
export function resolveEffectIn(tx, { key, actor, fencingGeneration, result, at = Date.now(), causalCommandId = null }) {
	requireActor(actor);
	requireGeneration(fencingGeneration);
	const serialisedResult = serialise(result ?? null);

	const row = readRow(tx.db, key);
	if (row === null) {
		throw new FactoryEffectError(
			"effect-unrequested",
			`Effect ${key} was never requested; a resolution is an outcome for a recorded intent (§14.1).`,
			{ key },
		);
	}

	requireCurrentGeneration(tx.db, row, fencingGeneration);

	// A second resolution of the same effect is the reconcile path arriving
	// after the controller already settled it. It is not an error and it is
	// not a second record: the committed result stands.
	if (row.state === "resolved") {
		return { key, outcome: "already-resolved", state: row.state, result: decodeResult(row.result) };
	}

	const event = tx.appendEvent({
		kind: "effect.resolved",
		source: sourceOf(actor),
		run: row.run_id,
		ticket: row.ticket,
		phase: row.phase,
		attempt: row.attempt_id,
		causalCommandId,
		occurredAt: at,
		observedAt: at,
		payload: {
			effect_key: key,
			operation: row.operation,
			actor,
			fencing_generation: fencingGeneration,
			result: result ?? null,
		},
	});

	tx.db
		.prepare("UPDATE effect SET state = 'resolved', resolved_at = ?, resolved_seq = ?, result = ? WHERE effect_key = ?")
		.run(at, event.seq, serialisedResult, key);

	return { key, outcome: "resolved", state: "resolved", result: result ?? null };
}

/**
 * Every unsettled effect, oldest first — §5.4's reconcile scope, and §12.3's
 * fourth retention pin. A run held here for weeks means an effect nothing can
 * settle, which is an alarm rather than a leak.
 *
 * Rows come back with `result` decoded, the same shape `requestEffect` and
 * `resolveEffect` return it in — one table, one shape, whichever door a caller
 * came through.
 *
 * @param {object} store
 * @param {{ run?: string | null }} [scope]
 */
export function unresolvedEffects(store, { run = null } = {}) {
	return store
		.read((db) =>
			db
				.prepare(
					`SELECT * FROM effect
					 WHERE state = 'requested' AND (? IS NULL OR run_id = ?)
					 ORDER BY requested_seq`,
				)
				.all(run, run),
		)
		.map((row) => ({ ...row, result: decodeResult(row.result) }));
}

/**
 * One effect by key, with its `result` decoded — or `null` for a key nobody has
 * requested.
 *
 * It exists because **re-entry sometimes has to ask what the world already did
 * before deciding whether to do anything at all**, which is a different question
 * from the one `requestEffect` answers. §7.5's publication is the case: a
 * re-entered integration that simply re-issued its effects would first rebase and
 * re-verify a branch that is already pushed, which §14.12 forbids — and would
 * only meet the refusal after the rewrite. Asking first makes "a published branch
 * is never touched again" structural rather than a refusal met late.
 *
 * @param {object} store an open store, controller or read-only
 * @param {string} key a §4.5 effect key
 * @returns {object | null}
 */
export function effectByKey(store, key) {
	const row = store.read((db) => db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(key));
	return row === undefined ? null : { ...row, result: decodeResult(row.result) };
}

/**
 * §4.5: "older than the current holder's" is the comparison, and the current
 * holder is the `controller` lease's — not the DB-wide counter's latest value,
 * which also advances when the *same* controller acquires an integration or
 * capacity lease and would fence a live controller out of its own effects.
 *
 * With no lease row there is no holder to be superseded by, so the requester's
 * own generation is the floor. That is not the "compare only when present"
 * downgrade §4.4 rejects: the check never becomes a no-op, it only loses the
 * comparator that does not exist yet. Writing that row belongs to the lease
 * primitive.
 */
function requireCurrentGeneration(db, row, fencingGeneration) {
	const holder = db.prepare("SELECT fencing_generation FROM lease WHERE name = ?").get(CONTROLLER_LEASE);
	const floor = Math.max(row.fencing_generation, holder?.fencing_generation ?? 0);

	if (fencingGeneration < floor) {
		throw new FactoryEffectError(
			"effect-superseded-generation",
			`Effect ${row.effect_key} was offered a resolution under generation ${fencingGeneration}; generation ${floor} has superseded it.`,
			{ key: row.effect_key, found: fencingGeneration, expected: floor },
		);
	}
}

/**
 * §4.5: the same key with the same payload is the same effect, so re-issuing it
 * returns what was committed rather than mutating twice. A different payload
 * under the same key is a **typed conflict** — the two callers disagree about
 * what the world should look like, and guessing which one is right is how a
 * label ends up flapping.
 */
function settleDuplicate(existing, payloadDigest) {
	if (existing.payload_digest !== payloadDigest) {
		throw new FactoryEffectError(
			"effect-payload-conflict",
			`Effect ${existing.effect_key} was requested with a different payload; the same key never carries two intents.`,
			{
				key: existing.effect_key,
				expected: existing.payload_digest,
				found: payloadDigest,
				state: existing.state,
			},
		);
	}

	return {
		key: existing.effect_key,
		outcome: existing.state === "resolved" ? "already-resolved" : "already-requested",
		state: existing.state,
		result: decodeResult(existing.result),
	};
}

function readRow(db, key) {
	return db.prepare("SELECT * FROM effect WHERE effect_key = ?").get(key) ?? null;
}

function decodeResult(result) {
	return result === null || result === undefined ? null : JSON.parse(result);
}

/**
 * §4.5's actor slot (monitor O6, carried by §13.D): who asked for this. The
 * read-only first release enumerates no operator verbs, but naming the actor on
 * the pair being built now makes a future write path additive instead of a
 * redesign — and a closed grammar is what keeps it an identity rather than a
 * free-text note.
 */
function requireActor(actor) {
	if (actor !== "controller" && !/^operator:[a-z][a-z0-9-]*$/.test(actor ?? "")) {
		throw new FactoryEffectError(
			"effect-actor-invalid",
			`An effect names its actor: "controller", or "operator:<verb>". Found ${JSON.stringify(actor ?? null)}.`,
			{ at: "actor", found: actor ?? null },
		);
	}
}

/**
 * §14.4, checked against the payload actually in hand. `keys.mjs` refuses the
 * *shape* of a full sha256; this refuses a truncation of this payload's own
 * digest, which is the spelling somebody reaches for when they want the key to
 * look tidy. Either way the effect would key itself by its content, and the
 * "same key, different payload ⇒ typed conflict" rule would have nothing to
 * compare — a conflicting duplicate would just be a different key.
 */
function requireOperandIsNotTheDigest(operand, payloadDigest) {
	if (operand !== null && operand.length >= 8 && payloadDigest.startsWith(operand.toLowerCase())) {
		throw new FactoryEffectError(
			"effect-key-invalid",
			`Operand ${operand} is this effect's own payload digest. The digest sits beside the key, never in it (§14.4).`,
			{ at: "operand", found: operand, expected: "a natural discriminator" },
		);
	}
}

function sourceOf(actor) {
	return actor === "controller" ? "controller" : "operator";
}

/**
 * A malformed generation is the caller's bug, and it gets its own reason: the
 * reason reaches the operator's `--json` output, and reporting this as
 * supersession would tell them another controller adopted the repository.
 */
function requireGeneration(generation) {
	if (!Number.isSafeInteger(generation) || generation < 0) {
		throw new FactoryEffectError(
			"effect-generation-invalid",
			`An effect carries the fencing generation that requested it; found ${JSON.stringify(generation ?? null)}.`,
			{ at: "fencingGeneration", found: generation ?? null },
		);
	}
}

/**
 * §4.5's digest, over the effect's payload. A payload the canonical serialiser
 * cannot represent exactly — a `Date`, a `NaN` — would hash differently on the
 * way back in, so it is refused here rather than allowed to escape as a raw
 * `TypeError` from a hash function.
 */
function digestOf(payload) {
	return digest(serialise(payload, "payload"));
}

function serialise(value, at = "result") {
	try {
		return canonicalJson(value);
	} catch (error) {
		throw new FactoryEffectError(
			"effect-payload-invalid",
			`An effect's ${at} must be canonically serialisable: ${error.message}.`,
			{ at },
		);
	}
}
