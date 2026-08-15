import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FactoryArtifactError } from "./errors.mjs";

/**
 * §12.1's content-addressed store: immutable blobs under the per-repo state
 * root at `artifacts/<algo>/<aa>/<digest>`.
 *
 * **Nothing here takes a path.** Every entry point takes the state root plus an
 * *address* — an algorithm from a closed set and a digest of fixed hex shape —
 * and derives the one location that address can name. That is what makes
 * §14.28's "an artifact is never referenced by path" a property of the surface
 * rather than a check somewhere inside it: the Babysitter audit's `../` escape
 * is not a thing this API can *express*, so there is no containment rule to get
 * wrong, and no place a future caller can slip one past.
 *
 * The ledger half — who produced it, what it is, when, and under which
 * retention class — is `ledger.mjs`. This file knows only bytes and their names.
 */

/** The one algorithm the factory hashes with; the journal's is the same (§4.3). */
export const ARTIFACT_ALGORITHM = "sha256";

/**
 * The closed set an address's algorithm is checked against. It is a set rather
 * than the single constant because the blob path carries the algorithm, so the
 * day a second one is added the old blobs keep resolving at their own spelling.
 */
export const ARTIFACT_ALGORITHMS = Object.freeze([ARTIFACT_ALGORITHM]);

/** The directory §12.1 puts the store in, relative to the state root. */
const ARTIFACTS_SEGMENT = "artifacts";

/**
 * Two hex characters of fan-out. Not a tuning knob: it is part of the address's
 * spelling on disk, so changing it would strand every existing blob.
 */
const FANOUT = 2;

/** Each algorithm's digest shape. Lowercase hex, exact length, nothing else. */
const DIGEST_SHAPES = Object.freeze({ sha256: /^[0-9a-f]{64}$/ });

/**
 * The address of a blob: the pair every reference resolves through (§14.28).
 *
 * @param {{ algorithm?: string, digest: string }} address
 * @returns {Readonly<{ algorithm: string, digest: string }>}
 * @throws {FactoryArtifactError} `artifact-address-invalid`
 */
export function artifactAddress({ algorithm = ARTIFACT_ALGORITHM, digest }) {
	if (typeof algorithm !== "string" || !ARTIFACT_ALGORITHMS.includes(algorithm)) {
		refuse(
			"algorithm",
			`An artifact is addressed by one of ${ARTIFACT_ALGORITHMS.join(", ")}; found ${JSON.stringify(algorithm ?? null)}.`,
			{ found: algorithm ?? null, expected: ARTIFACT_ALGORITHMS.join("|") },
		);
	}

	if (typeof digest !== "string" || !DIGEST_SHAPES[algorithm].test(digest)) {
		refuse(
			"digest",
			`${JSON.stringify(digest ?? null)} is not a ${algorithm} digest, and a digest is the only thing that addresses an artifact (§14.28).`,
			{ found: digest ?? null, expected: String(DIGEST_SHAPES[algorithm]) },
		);
	}

	return Object.freeze({ algorithm, digest });
}

/**
 * What the given content is called: hashed here, so a caller never chooses a
 * name and therefore never chooses a location.
 *
 * @param {string | Uint8Array} content
 * @returns {Readonly<{ algorithm: string, digest: string, bytes: number }>}
 * @throws {FactoryArtifactError} `artifact-content-invalid`
 */
export function addressOfContent(content) {
	const buffer = requireContent(content);
	return Object.freeze({
		algorithm: ARTIFACT_ALGORITHM,
		digest: createHash(ARTIFACT_ALGORITHM).update(buffer).digest("hex"),
		bytes: buffer.length,
	});
}

/**
 * Put content in the store, or notice it is already there.
 *
 * The write is temp-then-rename **inside the artifacts root**, so a crash
 * mid-write leaves nothing at the digest path rather than a truncated blob that
 * would fail its own probe; a temporary outside the root would make the rename a
 * cross-filesystem copy and lose the atomicity that buys.
 *
 * Content-addressed storage makes the re-write a no-op by definition: the same
 * bytes have the same name, so `written: false` is the honest answer rather than
 * an overwrite nobody can observe. **"Already there" is decided by the probe,
 * not by the file's size** — a blob that no longer re-hashes to its own digest is
 * not this content, and reporting the write as done would leave the caller
 * holding a reference to bytes nobody can verify.
 *
 * @param {string} stateRoot the per-repo state root (§4.1)
 * @param {string | Uint8Array} content
 * @returns {Readonly<{ algorithm: string, digest: string, bytes: number, written: boolean }>}
 * @throws {FactoryArtifactError} `artifact-content-invalid`
 */
export function writeArtifactBlob(stateRoot, content) {
	const buffer = requireContent(content);
	const address = addressOfContent(buffer);
	const path = blobPath(stateRoot, address);

	if (probeArtifactBlob(stateRoot, address).digestMatches) {
		return Object.freeze({ ...address, written: false });
	}

	mkdirSync(join(stateRoot, ARTIFACTS_SEGMENT), { recursive: true });
	const temporary = join(stateRoot, ARTIFACTS_SEGMENT, `.tmp-${randomUUID()}`);
	try {
		writeFileSync(temporary, buffer);
		mkdirSync(dirOf(stateRoot, address), { recursive: true });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}

	return Object.freeze({ ...address, written: true });
}

/**
 * §4.5's artifact probe: **file exists and re-hashes to its digest**.
 *
 * Presence alone is not proof — a blob whose bytes changed under us is exactly
 * what re-hashing catches (§15's digest mismatch) — so the answer carries both
 * facts separately instead of collapsing them into one boolean nobody can
 * interpret.
 *
 * @param {string} stateRoot
 * @param {{ algorithm?: string, digest: string }} address
 * @returns {{ present: boolean, bytes: number | null, digestMatches: boolean }}
 */
export function probeArtifactBlob(stateRoot, address) {
	const content = readArtifactBlob(stateRoot, address, { verify: false });
	if (content === null) return { present: false, bytes: null, digestMatches: false };

	return {
		present: true,
		bytes: content.length,
		digestMatches: addressOfContent(content).digest === artifactAddress(address).digest,
	};
}

/**
 * The blob's bytes, or `null` when there is none — the read half of "resolved
 * through the ledger by digest", and the reason nothing needs a path to hand
 * around.
 *
 * @param {string} stateRoot
 * @param {{ algorithm?: string, digest: string }} address
 * @param {{ verify?: boolean }} [options] `verify: false` is the probe's own
 *   read, which must see the bytes *before* anything judges them.
 * @returns {Buffer | null}
 */
export function readArtifactBlob(stateRoot, address, { verify = true } = {}) {
	const resolved = artifactAddress(address);
	let content;
	try {
		content = readFileSync(blobPath(stateRoot, resolved));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}

	if (verify && addressOfContent(content).digest !== resolved.digest) return null;
	return content;
}

/**
 * Remove a blob. **Deleting one is a mutation outside the database and therefore
 * an effect** (§4.5's `artifact-delete`); this is the mechanism, and sequencing
 * it behind that pair belongs to expiry (§12.6) and cleanup (§12.8).
 *
 * @param {string} stateRoot
 * @param {{ algorithm?: string, digest: string }} address
 * @returns {boolean} whether there was a blob to remove
 */
export function deleteArtifactBlob(stateRoot, address) {
	const path = blobPath(stateRoot, artifactAddress(address));
	if (blobBytes(path) === null) return false;

	rmSync(path, { force: true });
	return true;
}

/**
 * The one place an address becomes a location, and it is not exported. Every
 * segment is either a constant or a validated address, so the result is under
 * the artifacts root by construction — there is no input that could aim it
 * elsewhere.
 */
function blobPath(stateRoot, address) {
	const resolved = artifactAddress(address);
	return join(dirOf(stateRoot, resolved), resolved.digest);
}

function dirOf(stateRoot, address) {
	return join(stateRoot, ARTIFACTS_SEGMENT, address.algorithm, address.digest.slice(0, FANOUT));
}

function blobBytes(path) {
	try {
		return statSync(path).size;
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

/**
 * Text is encoded as UTF-8 and bytes are taken as they are. Anything else is
 * refused here rather than hashed as whatever `createHash` makes of it: an
 * object silently hashed as `[object Object]` would give three different
 * artifacts the same digest.
 */
function requireContent(content) {
	if (typeof content === "string") return Buffer.from(content, "utf8");
	if (content instanceof Uint8Array) return Buffer.from(content.buffer, content.byteOffset, content.byteLength);

	throw new FactoryArtifactError(
		"artifact-content-invalid",
		`An artifact's content is bytes or text; found ${content === null ? "null" : typeof content}.`,
		{ at: "content", found: content === null ? null : typeof content },
	);
}

function refuse(at, message, details) {
	throw new FactoryArtifactError("artifact-address-invalid", message, { at, ...details });
}
