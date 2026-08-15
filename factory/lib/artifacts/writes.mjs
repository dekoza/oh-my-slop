import { requestEffect, resolveEffectIn } from "../effects/records.mjs";
import { addressOfContent, writeArtifactBlob } from "./blobs.mjs";
import { FactoryArtifactError } from "./errors.mjs";
import { artifactMediaType, recordArtifact, retentionClassFor } from "./ledger.mjs";

/**
 * The one way an artifact enters the store (§4.5, §12.1).
 *
 * **An artifact write is a mutation outside the database, so it is an effect**:
 * a requested/resolved pair keyed by §4.5's grammar, settled by the probe that
 * says the file exists and re-hashes to its digest. The ledger row commits in
 * the *same* transaction as the resolution — a row without its resolution, or a
 * resolution without its row, is an artifact half the system can see.
 *
 * **The caller hands over content, never a name and never a path.** The digest
 * decides where the bytes go, so §14.28 holds at the only door that writes: the
 * `../` the Babysitter audit found has nowhere to be typed.
 *
 * The value handed back is §6.6's reference — digest, media type, byte count,
 * producer, retention class. That is what goes into an outbox, a PR body, or an
 * event payload; the bytes themselves never do.
 */

/**
 * §12.1's contents, closed: "That is the complete set — §9 introduced none."
 *
 * A role is what an artifact *is*, and it discriminates the effect key. A sixth
 * kind of artifact is a specification change, not a caller's decision, so an
 * unknown role is refused here rather than silently keyed.
 */
export const ARTIFACT_ROLES = Object.freeze([
	"attestation",
	"handshake",
	"run-manifest",
	"check-output",
	"review-verdict",
]);

/**
 * §4.5 names "artifact and attestation writes" separately and the catalogue
 * declares both kinds, so the role picks between them. Inventing a third name
 * for the same mutation would dilute what the `UNIQUE` constraint covers.
 */
const OPERATION_BY_ROLE = Object.freeze({ attestation: "attestation-write" });
const DEFAULT_OPERATION = "artifact-write";

/**
 * A short natural discriminator for two artifacts of the same role in one
 * attempt — a check's name, a review axis. It reaches the effect key and nothing
 * else, and it is still held to a shape: the operator reads these keys.
 */
const NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Put content in the store, as an effect, and record it in the ledger.
 *
 * Idempotent by construction, twice over: the same key with the same content is
 * the committed effect returned rather than a second write (§4.5), and the same
 * content under any key is the same blob (§12.1). The same key with *different*
 * content is a typed conflict — two callers disagreeing about what an attempt
 * produced, which is never something to guess at.
 *
 * **It opens two transactions with the blob write between them**, because the
 * mutation is outside the database by definition (§4.5). So it is called from a
 * caller's ordinary control flow, never from inside a transaction of that
 * caller's own — the store refuses nesting, and a blob write held open inside
 * one would keep a write lock across a filesystem call.
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {object} write
 * @param {string | Uint8Array} write.content the bytes; hashed here, never named by the caller
 * @param {string} write.mediaType `type/subtype`
 * @param {string} write.role one of `ARTIFACT_ROLES`
 * @param {string | null} [write.name] discriminator within the role — a check name, a review axis
 * @param {string | null} [write.run] the producing run, or null for a repo-scoped artifact
 * @param {number | null} [write.ticket]
 * @param {string} write.phase §2.2's phase
 * @param {string | null} [write.attempt]
 * @param {string} write.actor `controller`, or `operator:<verb>` — named, never defaulted:
 *   §4.5's slot says *who asked*, and filling it in for a caller who forgot would record an
 *   operator verb's artifact as the controller's
 * @param {number} write.fencingGeneration the generation the writer holds (§4.6)
 * @param {number} [write.at] UTC epoch milliseconds
 * @param {string | null} [write.causalCommandId]
 * @returns {Readonly<{ key: string, outcome: "written" | "already-written", reference: object }>}
 * @throws {FactoryArtifactError} · {FactoryEffectError}
 */
export function writeArtifact(
	store,
	{
		content,
		mediaType,
		role,
		name = null,
		run = null,
		ticket = null,
		phase,
		attempt = null,
		actor,
		fencingGeneration,
		at = Date.now(),
		causalCommandId = null,
	},
) {
	requireRole(role);
	if (name !== null) requireName(name);
	artifactMediaType(mediaType);
	const address = addressOfContent(content);

	// Everything the reference will carry, minus the producer the key already
	// names. It is the effect's payload, so re-issuing this key with different
	// content is the typed conflict rather than a second, uncompared mutation.
	const requested = requestEffect(store, {
		operation: OPERATION_BY_ROLE[role] ?? DEFAULT_OPERATION,
		operand: operandFor(role, name),
		run,
		ticket,
		phase,
		attempt,
		actor,
		fencingGeneration,
		at,
		causalCommandId,
		payload: {
			role,
			algorithm: address.algorithm,
			digest: address.digest,
			media_type: mediaType,
			bytes: address.bytes,
			retention_class: retentionClassFor({ run }),
		},
	});

	// Outside the database, between the intent and its resolution — exactly where
	// §5.3 expects a crash to leave a `requested` record nothing has settled. The
	// write is content-addressed, so redoing it costs nothing and settles it.
	writeArtifactBlob(store.storeDir, content);

	const row = store.transaction((tx) => {
		resolveEffectIn(tx, {
			key: requested.key,
			actor,
			fencingGeneration,
			result: { algorithm: address.algorithm, digest: address.digest, bytes: address.bytes },
			at,
			causalCommandId,
		});

		return recordArtifact(tx, { ...address, mediaType, run, ticket, attempt, at });
	});

	return Object.freeze({
		key: requested.key,
		outcome: requested.outcome === "already-resolved" ? "already-written" : "written",
		reference: artifactReference(row),
	});
}

/**
 * §6.6's reference: **digest, media type, byte count, producer, and retention
 * class** — the whole of what a payload ever carries about an artifact. Large
 * output goes into the store and this comes back; the bytes are never embedded
 * in an outbox or an event.
 *
 * @param {object} row a ledger row or resolution (`ledger.mjs`)
 * @returns {Readonly<object>}
 */
export function artifactReference(row) {
	return Object.freeze({
		algorithm: row.algorithm,
		digest: row.digest,
		media_type: row.media_type,
		bytes: row.bytes,
		producer: Object.freeze({ ...row.producer }),
		retention_class: row.retention_class,
	});
}

/**
 * The operand discriminates **within** an operation, so a role that already has
 * its own effect kind is not repeated in it: `…/attestation-write` rather than
 * `…/attestation-write/attestation`. The operator reads these keys, and a
 * segment that says what the previous one said is noise in every one of them.
 */
function operandFor(role, name) {
	const segments = [OPERATION_BY_ROLE[role] === undefined ? role : null, name].filter((segment) => segment !== null);
	return segments.length === 0 ? null : segments.join("/");
}

function requireRole(role) {
	if (!ARTIFACT_ROLES.includes(role)) {
		throw new FactoryArtifactError(
			"artifact-role-unknown",
			`An artifact's role is one of ${ARTIFACT_ROLES.join(", ")} (§12.1); found ${JSON.stringify(role ?? null)}.`,
			{ at: "role", found: role ?? null, expected: ARTIFACT_ROLES.join("|") },
		);
	}
}

function requireName(name) {
	if (typeof name !== "string" || !NAME_SHAPE.test(name)) {
		throw new FactoryArtifactError(
			"artifact-name-invalid",
			`An artifact's name is a short discriminator matching ${NAME_SHAPE}; found ${JSON.stringify(name ?? null)}.`,
			{ at: "name", found: name ?? null, expected: String(NAME_SHAPE) },
		);
	}
}
