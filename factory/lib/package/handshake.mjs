import { writeArtifact } from "../artifacts/writes.mjs";
import { describeCheckout } from "../git/repo.mjs";
import { canonicalJson } from "../state/events.mjs";
import { FactoryPackageError } from "./errors.mjs";
import { finding } from "./findings.mjs";
import { anchorPackage, HANDSHAKE_PARTICIPANTS, resolveParticipants } from "./participants.mjs";
import { treeDigest } from "./tree.mjs";
import { satisfiesVersionRange } from "./version.mjs";

/**
 * §11.7's package handshake: **the static half**, per run.
 *
 * The four participating artifacts — the binary, the factory extension, the
 * monitor extension when present, and the skills root — are resolved, recorded,
 * and proven to be one package. That is what catches the audited split-brain, in
 * which a package declared SDK 6.0.3 while the executable on `PATH` resolved
 * 0.0.187 through a separate global install, **without anyone maintaining a
 * hash by hand**.
 *
 * The **live-probed** half — runtime version, effective production flags,
 * adapter identity, resolved model id — is the worker adapter's runtime probe
 * and is deliberately not here: this module never launches anything, which is
 * what lets `doctor` run it in report mode (§10.5) without touching the world.
 *
 * The result is a value, not a verdict acted on: preflight turns findings into
 * §11.7's automation failure before the first claim, and `doctor` prints the
 * same record. Nothing here throws over what it *found* — only over a package
 * it could not anchor or read at all.
 */

export { HANDSHAKE_PARTICIPANTS };

/**
 * Resolve, digest, and check the package the factory is running from.
 *
 * @param {object} [input]
 * @param {string} [input.executable] the running binary; the anchor everything
 *   else is resolved against, because the handshake records what *executes*
 * @param {object | null} [input.expect] `package.expect` from config (§11.7)
 * @param {Record<string, string | undefined>} [input.env] the environment whose
 *   `PATH` an operator's `factory` would resolve through
 * @returns {Readonly<object>} the handshake record — the artifact's own content
 * @throws {FactoryPackageError} `package-root-unresolvable` · `package-manifest-unreadable`
 */
export function packageHandshake({ executable = process.argv[1], expect = null, env = process.env } = {}) {
	const { root, manifest } = anchorPackage(executable);
	const { participants, findings } = resolveParticipants({ root, manifest, executable, env });
	const identity = Object.freeze({
		root,
		name: typeof manifest.name === "string" ? manifest.name : null,
		version: typeof manifest.version === "string" ? manifest.version : null,
	});
	const all = Object.freeze([...findings, ...expectationFindings(identity, expect)]);

	return Object.freeze({
		ok: all.length === 0,
		package: identity,
		participants,
		tree: treeDigest(root),
		// Recorded beside the digest, never instead of it (§11.7).
		git: Object.freeze(describeCheckout(root)),
		expect: expect === null ? null : Object.freeze({ ...expect }),
		findings: all,
	});
}

/**
 * Pin the run to this package: **one immutable handshake artifact per run**,
 * its digest recorded in a journal event by the effect pair that writes it
 * (§4.5), and cited by every attempt rather than re-embedded (§11.7).
 *
 * Immutability is structural rather than promised. The content is canonical
 * JSON, so the same handshake is the same digest and re-recording it is the
 * committed effect coming back; a *different* handshake under the same run is a
 * typed payload conflict — which is exactly §11.7's "a recheck producing a
 * different digest is a failure, not a new pin".
 *
 * It is written **before** `assertPackageIntact`, so a failed handshake is
 * durable evidence rather than a sentence in a dead process's stderr.
 *
 * @param {object} store an open store (`state/store.mjs`)
 * @param {Readonly<object>} handshake what `packageHandshake` returned
 * @param {{ run?: string | null, actor: string, fencingGeneration: number,
 *           at?: number, causalCommandId?: string | null }} context
 * @returns {Readonly<{ key: string, outcome: string, reference: object }>}
 */
export function recordPackageHandshake(
	store,
	handshake,
	{ run = null, actor, fencingGeneration, at = Date.now(), causalCommandId = null },
) {
	return writeArtifact(store, {
		content: canonicalJson(handshake),
		mediaType: "application/json",
		role: "handshake",
		run,
		phase: "preflight",
		actor,
		fencingGeneration,
		at,
		causalCommandId,
	});
}

/**
 * §11.7's automation failure, **before first claim**.
 *
 * The findings are a value everywhere else — `doctor` reports them, preflight
 * records them — and this is the one place they stop a run. There is no
 * inferred compatibility pass and no severity ladder: every finding here is a
 * statement that the package executing is not the package declared.
 *
 * @param {Readonly<object>} handshake
 * @returns {Readonly<object>} the same handshake, so it can be used inline
 * @throws {FactoryPackageError} `package-handshake-failed`
 */
export function assertPackageIntact(handshake) {
	if (handshake.ok) return handshake;

	throw new FactoryPackageError(
		"package-handshake-failed",
		`The package handshake failed before the first claim (§11.7): ${handshake.findings.map((entry) => entry.message).join(" ")}`,
		{ findings: handshake.findings, root: handshake.package.root, tree: handshake.tree.digest },
	);
}

/**
 * §11.7's declared expectation, compared. It covers **name and version only**:
 * the tree digest is recorded and compared across attempts within a run, and a
 * digest in config would be unmaintainable in development — which is why the
 * loader refuses one outright rather than this deciding what to do with it.
 */
function expectationFindings({ name, version }, expect) {
	if (expect === null) return [];

	const findings = [];
	if (expect.name !== undefined && expect.name !== name) {
		findings.push(
			finding("package-name-mismatch", `The package expected to be ${expect.name} is ${name} (§11.7).`, {
				at: "package.expect.name",
				expected: expect.name,
				found: name,
			}),
		);
	}

	if (expect.version !== undefined && !satisfiesVersionRange(version ?? "", expect.version)) {
		findings.push(
			finding(
				"package-version-mismatch",
				`The package's declared version ${JSON.stringify(version)} is outside package.expect.version ${expect.version} (§11.7).`,
				{ at: "package.expect.version", expected: expect.version, found: version },
			),
		);
	}

	return findings;
}
