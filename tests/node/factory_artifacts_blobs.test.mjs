import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { FactoryArtifactError } from "../../factory/lib/artifacts/errors.mjs";
import {
	addressOfContent,
	artifactAddress,
	deleteArtifactBlob,
	probeArtifactBlob,
	readArtifactBlob,
	writeArtifactBlob,
} from "../../factory/lib/artifacts/blobs.mjs";

/**
 * §12.1's content-addressed half: blobs under the per-repo state root at
 * `artifacts/<algo>/<aa>/<digest>`, addressed by digest and by nothing else.
 *
 * The tests reach for the layout by hand — that is the acceptance criterion —
 * but the module under test never accepts one: every entry point takes a state
 * root and an address, so §14.28's "never referenced by path" is a property of
 * the surface rather than of a check inside it.
 */

/** A state root standing in for `<agent dir>/software-factory/repos/<slug>`. */
function makeStateRoot(t) {
	const root = mkdtempSync(join(tmpdir(), "factory-artifacts-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

/** The layout §12.1 fixes, spelled out here rather than imported from the code. */
function expectedBlobPath(stateRoot, digest) {
	return join(stateRoot, "artifacts", "sha256", digest.slice(0, 2), digest);
}

/** Every file under the artifacts root, as a path relative to it. */
function blobTree(stateRoot) {
	const root = join(stateRoot, "artifacts");
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)))
		.sort();
}

test("a blob lands under the state root, keyed by algorithm and digest (§12.1)", (t) => {
	const stateRoot = makeStateRoot(t);
	const content = "the run manifest";

	const written = writeArtifactBlob(stateRoot, content);

	assert.deepEqual(written, {
		algorithm: "sha256",
		digest: sha256(content),
		bytes: Buffer.byteLength(content),
		written: true,
	});
	assert.equal(readFileSync(expectedBlobPath(stateRoot, written.digest), "utf8"), content);
});

test("the tree is the address: two hex of fan-out, then the digest itself", (t) => {
	const stateRoot = makeStateRoot(t);

	const digests = ["alpha", "beta", "gamma"].map((content) => writeArtifactBlob(stateRoot, content).digest);

	assert.deepEqual(
		blobTree(stateRoot).sort(),
		digests.map((digest) => ["sha256", digest.slice(0, 2), digest].join(sep)).sort(),
		"a blob landed somewhere other than <algo>/<aa>/<digest>",
	);
});

test("writing the same content twice is one blob and one write", (t) => {
	const stateRoot = makeStateRoot(t);
	const content = "an attestation";

	const first = writeArtifactBlob(stateRoot, content);
	const second = writeArtifactBlob(stateRoot, Buffer.from(content, "utf8"));

	assert.equal(second.digest, first.digest);
	assert.equal(first.written, true);
	assert.equal(second.written, false, "byte-identical content was written a second time");
	assert.equal(blobTree(stateRoot).length, 1);
});

test("a blob that no longer re-hashes to its digest is written again, never reported as already there", (t) => {
	const stateRoot = makeStateRoot(t);
	const content = "the run manifest";

	const first = writeArtifactBlob(stateRoot, content);
	writeFileSync(expectedBlobPath(stateRoot, first.digest), "tampered, and the same length!!");

	// "Already there" is the probe's answer, not the file's size. Reporting this
	// write as done would hand the caller a reference to bytes that fail their
	// own re-hash — and the ledger row beside it would say the artifact is fine.
	const second = writeArtifactBlob(stateRoot, content);

	assert.equal(second.written, true);
	assert.equal(readFileSync(expectedBlobPath(stateRoot, first.digest), "utf8"), content);
});

test("a write leaves no temporary file behind, and never a blob under a name that is not its digest", (t) => {
	const stateRoot = makeStateRoot(t);

	// Temp-then-rename is what makes a crash mid-write leave *nothing* at the
	// digest path rather than a truncated blob that fails its own probe. The
	// temporary has to live inside the artifacts root — a rename across
	// filesystems is a copy, and the atomicity would be gone.
	writeArtifactBlob(stateRoot, "harvested check output");

	for (const path of blobTree(stateRoot)) {
		assert.match(path, /^sha256[/\\][0-9a-f]{2}[/\\][0-9a-f]{64}$/, `${path} is not a blob at its digest`);
	}
});

test("the probe is file-exists-and-re-hashes-to-its-digest (§4.5)", (t) => {
	const stateRoot = makeStateRoot(t);
	const content = "a review verdict";
	const address = addressOfContent(content);

	assert.deepEqual(probeArtifactBlob(stateRoot, address), { present: false, bytes: null, digestMatches: false });

	writeArtifactBlob(stateRoot, content);
	assert.deepEqual(probeArtifactBlob(stateRoot, address), {
		present: true,
		bytes: Buffer.byteLength(content),
		digestMatches: true,
	});

	// Present is not proof: a blob whose bytes changed under us is exactly what
	// re-hashing exists to catch (§15's digest mismatch).
	writeFileSync(expectedBlobPath(stateRoot, address.digest), "a different verdict");
	assert.deepEqual(probeArtifactBlob(stateRoot, address), {
		present: true,
		bytes: Buffer.byteLength("a different verdict"),
		digestMatches: false,
	});
});

test("a malicious `../` artifact path is unexpressible rather than rejected (§14.28, §15)", (t) => {
	const stateRoot = makeStateRoot(t);

	// There is no path parameter anywhere on this surface to sanitise: every
	// entry point takes the state root plus an *address*, and an address is an
	// algorithm from a closed set and a digest of fixed hex shape. `../` has
	// nowhere to be typed — the escape the Babysitter audit found is not a thing
	// this API can express.
	for (const digest of [
		"../../etc/passwd",
		"..",
		`${sha256("x").slice(0, 60)}/../..`,
		sha256("x").toUpperCase(),
		sha256("x").slice(0, 63),
		`${sha256("x")}0`,
		"",
		null,
	]) {
		const error = refusal(() => artifactAddress({ digest }));
		assert.ok(error instanceof FactoryArtifactError, `${JSON.stringify(digest)} was accepted as a digest`);
		assert.equal(error.reason, "artifact-address-invalid");
		assert.equal(error.details.at, "digest");
	}

	for (const algorithm of ["../sha256", "sha256/..", "md5", "SHA256", "", null]) {
		const error = refusal(() => artifactAddress({ algorithm, digest: sha256("x") }));
		assert.equal(error.reason, "artifact-address-invalid");
		assert.equal(error.details.at, "algorithm");
	}

	// And the writing half takes *content*, never a name: whatever a caller hands
	// over is hashed, and the hash is where the blob goes.
	const escape = writeArtifactBlob(stateRoot, "../../etc/passwd");
	assert.equal(escape.digest, sha256("../../etc/passwd"));
	assert.deepEqual(blobTree(stateRoot), [["sha256", escape.digest.slice(0, 2), escape.digest].join(sep)]);
});

test("an address is a frozen pair, and the algorithm defaults to the one the factory hashes with", () => {
	const digest = sha256("x");

	assert.deepEqual({ ...artifactAddress({ digest }) }, { algorithm: "sha256", digest });
	assert.ok(Object.isFrozen(artifactAddress({ digest })));
	assert.deepEqual({ ...addressOfContent("x") }, { algorithm: "sha256", digest, bytes: 1 });
});

test("content is bytes or text, and anything else is a typed refusal", (t) => {
	const stateRoot = makeStateRoot(t);

	for (const content of [null, undefined, 42, { body: "x" }, ["x"]]) {
		const error = refusal(() => writeArtifactBlob(stateRoot, content));
		assert.ok(error instanceof FactoryArtifactError, `${JSON.stringify(content ?? null)} was accepted as content`);
		assert.equal(error.reason, "artifact-content-invalid");
	}

	assert.equal(writeArtifactBlob(stateRoot, Buffer.from([0x00, 0xff])).bytes, 2, "binary content was refused");
});

test("reading and deleting a blob answer by address, and say plainly when there is nothing there", (t) => {
	const stateRoot = makeStateRoot(t);
	const content = "a handshake artifact";
	const address = artifactAddress({ digest: sha256(content) });

	assert.equal(readArtifactBlob(stateRoot, address), null);
	assert.equal(deleteArtifactBlob(stateRoot, address), false);

	writeArtifactBlob(stateRoot, content);
	assert.equal(readArtifactBlob(stateRoot, address).toString("utf8"), content);

	assert.equal(deleteArtifactBlob(stateRoot, address), true);
	assert.equal(readArtifactBlob(stateRoot, address), null);
});

function refusal(body) {
	try {
		body();
	} catch (error) {
		return error;
	}
	throw new assert.AssertionError({ message: "expected a refusal" });
}
