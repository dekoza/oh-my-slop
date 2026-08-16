/**
 * §4.5's effect key: the semantic name the database itself enforces unique.
 *
 * ```
 * <run>/<ticket>/<phase>/<attempt>/<operation>[/<operand>]
 * ```
 *
 * Fixed-arity, with `run`, `ticket`, and `attempt` individually nullable as the
 * reserved literal `-` (§13.C) — so a repo-scoped effect, an orphaned artifact
 * blob or the controller's own pane, still produces a well-formed,
 * `UNIQUE`-constrainable key rather than a shorter one nothing can constrain.
 *
 * **When the attempt slot is filled, and when it is `-`** (#146). The rule is
 * one sentence and it lives here, because the alternative is call sites that
 * happen to agree:
 *
 * > An effect is keyed by the **attempt** when its subject is that attempt's own
 * > work — its branch, its worktree, its evidence ref, its pane. It is keyed by
 * > the **ticket execution**, attempt `-`, when its subject is something one
 * > ticket execution has exactly one of: the published branch (`push`,
 * > `pr-create`) and the ticket itself (`assign`, `label-add`, `comment-post`).
 *
 * The reason it matters is §4.5's own claim that *the database itself enforces
 * uniqueness*. A subject that outlives the attempt that made it, keyed by an
 * attempt, gets one row per attempt that touches it — and the uniqueness §4.5
 * promises quietly becomes a per-attempt property while every test stays green.
 */

import { IDENTITY_CHARSET, PHASES } from "../domain/vocabulary.mjs";
import { FactoryEffectError } from "./errors.mjs";

/** §4.5's reserved literal for an absent identity segment. */
export const NULL_SEGMENT = "-";

/**
 * Long enough for any label or branch name the factory writes, short enough that
 * a payload someone pasted into the slot is refused rather than stored.
 */
const MAX_OPERAND_LENGTH = 128;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const SHA256_SHAPE = /^[0-9a-f]{64}$/i;

/**
 * An operation is a lowercase, dash-joined verb — never a path segment. Declared
 * here, with the rest of the grammar, and imported by the registry: the shape a
 * key may carry and the shape a kind may register are one rule, or a caller of
 * the builder can forge a key the registry would have refused.
 */
export const OPERATION_SHAPE = /^[a-z][a-z0-9-]*$/;

/** A ticket segment is the tracker's own issue number, written as digits. */
const TICKET_SHAPE = /^[1-9][0-9]*$/;

/** The word that opens the HTML comment a posted body carries its key in. */
const EFFECT_KEY_MARKER = "factory-effect:";

/**
 * @param {{ run?: string | null, ticket?: number | null, phase: string,
 *           attempt?: string | null, operation: string, operand?: string | null }} parts
 * @returns {string}
 */
export function effectKey({ run = null, ticket = null, phase, attempt = null, operation, operand = null }) {
	requirePhase(phase);
	requireOperation(operation);
	if (run !== null) requireIdentitySegment(run, "run");
	if (attempt !== null) requireIdentitySegment(attempt, "attempt");
	if (ticket !== null) requireTicket(ticket);
	if (operand !== null) requireOperand(operand);

	const segments = [
		run ?? NULL_SEGMENT,
		ticket === null ? NULL_SEGMENT : String(ticket),
		phase,
		attempt ?? NULL_SEGMENT,
		operation,
	];
	if (operand !== null) segments.push(operand);
	return segments.join("/");
}

/**
 * The inverse, for the reader that has a key and wants the entity it names —
 * `doctor` listing unresolved effects, reconcile deciding which probe to run.
 *
 * The operand is whatever follows the fifth separator, taken whole: identity
 * segments cannot contain one (§2.1's charset), so the split is unambiguous even
 * when the operand is a branch name.
 *
 * @param {string} key
 * @returns {{ run: string | null, ticket: number | null, phase: string,
 *             attempt: string | null, operation: string, operand: string | null }}
 * @throws {FactoryEffectError} `effect-key-invalid`
 */
export function parseEffectKey(key) {
	if (typeof key !== "string") {
		refuse("key", `An effect key is a string; found ${JSON.stringify(key ?? null)}.`, { found: key ?? null });
	}

	const segments = key.split("/");
	if (segments.length < 5) {
		refuse("key", `${JSON.stringify(key)} is not a §4.5 effect key: five segments, plus an optional operand.`, {
			found: key,
		});
	}

	const [run, ticket, phase, attempt, operation] = segments;
	requirePhase(phase);
	requireOperation(operation);
	if (!absent(run)) requireIdentitySegment(run, "run");
	if (!absent(attempt)) requireIdentitySegment(attempt, "attempt");
	if (!absent(ticket) && !TICKET_SHAPE.test(ticket)) {
		// Reading it back as `NaN` would hand the caller a ticket number that
		// compares equal to nothing and renders as "NaN" on the operator's screen.
		refuse("ticket", `Ticket segment ${JSON.stringify(ticket)} is not an issue number.`, { found: ticket });
	}

	return {
		run: absent(run) ? null : run,
		ticket: absent(ticket) ? null : Number.parseInt(ticket, 10),
		phase,
		attempt: absent(attempt) ? null : attempt,
		operation,
		operand: segments.length === 5 ? null : segments.slice(5).join("/"),
	};
}

function absent(segment) {
	return segment === NULL_SEGMENT;
}

/**
 * §4.5's comment probe reaches for the key **embedded in the body as an HTML
 * comment**, so this is where a posted body carries it.
 *
 * A visible marker would be the weakest link in the scheme: comment bodies are
 * silently editable, and the operator's own edit would then delete the factory's
 * only handle on its effect. The key rides invisibly and survives any rewrite of
 * the prose around it.
 *
 * @param {string} body the comment the factory means to post
 * @param {string} key
 * @returns {string}
 */
export function embedEffectKey(body, key) {
	return `${body}\n\n<!-- ${EFFECT_KEY_MARKER} ${key} -->`;
}

/**
 * **Exact on the embedded key, never a prefix match** (§4.5). A prefix would
 * make a neighbouring key that merely extends this one indistinguishable from
 * it, and the probe would report somebody else's comment as ours.
 *
 * @param {string} body a comment body as the tracker returns it
 * @param {string} key
 * @returns {boolean}
 */
export function commentCarriesEffectKey(body, key) {
	if (typeof body !== "string") return false;
	return new RegExp(`<!--\\s*${EFFECT_KEY_MARKER}\\s+${escapeForRegExp(key)}\\s*-->`).test(body);
}

function escapeForRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * §2.2's enum, closed. It is read from `domain/vocabulary.mjs` rather than
 * restated here: a phase list with a second home has already started to drift,
 * and the whole point of §13.C's widening was that one enum covers pipeline
 * phases, cleanup, and expiry alike.
 */
function requirePhase(phase) {
	if (!PHASES.includes(phase)) {
		refuse("phase", `Phase must be one of ${PHASES.join(", ")}; found ${JSON.stringify(phase ?? null)}.`, {
			found: phase ?? null,
			expected: PHASES.join("|"),
		});
	}
}

/**
 * The operation is the segment that names the mutation, and the only one the
 * registry also has an opinion about. Checked here as well, because the builder
 * is exported: an operation carrying a separator would produce a key
 * `parseEffectKey` reads back as a different effect entirely.
 */
function requireOperation(operation) {
	if (typeof operation !== "string" || !OPERATION_SHAPE.test(operation)) {
		refuse("operation", `An operation matches ${OPERATION_SHAPE}; found ${JSON.stringify(operation ?? null)}.`, {
			found: operation ?? null,
		});
	}
}

/**
 * §2.1's charset, which is what makes the grammar fixed-arity: nothing an
 * identity slot can hold adds a segment, so a run id can never spell a key
 * belonging to somebody else.
 *
 * The *shape* of an attempt id — `<run>-t<ticket>-a<n>` — is deliberately not
 * re-checked here. Every effect record rides an event carrying the same identity
 * tuple, and `state/events.mjs` enforces it there; a second copy of that rule is
 * a second place for it to drift.
 */
function requireIdentitySegment(value, field) {
	if (typeof value !== "string" || !IDENTITY_CHARSET.test(value)) {
		refuse(field, `${field} must match ${IDENTITY_CHARSET} (§2.1); found ${JSON.stringify(value)}.`, {
			found: value,
		});
	}
	if (value === NULL_SEGMENT) {
		refuse(field, `${field} is the reserved absent literal "${NULL_SEGMENT}"; pass null instead.`, { found: value });
	}
}

/**
 * §4.5: a **natural** discriminator — a label name, a branch name — and §14.4:
 * **never a hash of the payload**. The digest sits beside the key, and hashing
 * it into the key instead would make a conflicting duplicate silently become a
 * *different* key, which is the one thing the UNIQUE constraint exists to catch.
 *
 * The shape check refuses a bare sha256, the digest this factory computes
 * everywhere; `records.mjs` adds the exact check against the payload's own
 * digest, where that value is actually in hand. Nothing natural is 64 hex
 * characters, and the artifact writes §12 keys by role are where the temptation
 * to reach for a content digest lives.
 */
function requireOperand(operand) {
	if (typeof operand !== "string" || operand.length === 0 || operand.length > MAX_OPERAND_LENGTH) {
		refuse("operand", `An operand is a short natural discriminator, 1–${MAX_OPERAND_LENGTH} characters (§4.5).`, {
			found: typeof operand === "string" ? operand.length : (operand ?? null),
		});
	}
	if (operand.trim() !== operand || CONTROL_CHARACTER.test(operand)) {
		refuse("operand", `An operand is one printable line; found ${JSON.stringify(operand)}.`, { found: operand });
	}
	if (SHA256_SHAPE.test(operand)) {
		refuse("operand", `An effect key never carries a hash (§14.4); ${operand} is a digest, not a name.`, {
			found: operand,
		});
	}
}

function requireTicket(ticket) {
	if (!Number.isSafeInteger(ticket) || ticket <= 0) {
		refuse("ticket", `Ticket must be a positive issue number; found ${JSON.stringify(ticket)}.`, { found: ticket });
	}
}

function refuse(at, message, details) {
	throw new FactoryEffectError("effect-key-invalid", message, { at, ...details });
}
