import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { readArtifact } from "../../factory/lib/artifacts/ledger.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import {
	assertPackageIntact,
	HANDSHAKE_PARTICIPANTS,
	packageHandshake,
	recordPackageHandshake,
} from "../../factory/lib/package/handshake.mjs";
import { treeDigest } from "../../factory/lib/package/tree.mjs";
import { canonicalJson } from "../../factory/lib/state/events.mjs";
import { commitAll, makePackage, makeTree, onPath, PACKAGE_MANIFEST, writeTree } from "./helpers/factory-package.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import { openTestStore, refusalOf, runStarted } from "./helpers/factory-store.mjs";

/**
 * §11.7's static half: the four participating artifacts, resolved and recorded,
 * and the anti-shadowing guard that proves they are one package.
 *
 * The live-probed half — runtime version, production flags, adapter identity,
 * resolved model id — belongs to the worker adapter's runtime probe (#105) and
 * is deliberately absent here.
 */

/** The fixed instant the recording tests date their records from. */
const AT = 1_770_000_100_000;

/** The package every test starts from, plus the executable inside it. */
function installed(t, options = {}) {
	const root = makePackage(t, options);
	const executable = join(root, "factory", "bin", "factory.mjs");
	return { root, executable, env: { PATH: onPath(t, executable) } };
}

function participant(handshake, kind) {
	return handshake.participants.find((entry) => entry.kind === kind) ?? null;
}

test("all four participants are resolved and recorded, and they are one package", (t) => {
	const { root, executable, env } = installed(t);

	const handshake = packageHandshake({ executable, env });

	assert.equal(handshake.ok, true);
	assert.deepEqual(handshake.findings, []);
	assert.deepEqual({ ...handshake.package }, { root, name: "oh-my-slop", version: "0.1.0" });

	assert.deepEqual(
		handshake.participants.map((entry) => entry.kind),
		[...HANDSHAKE_PARTICIPANTS],
	);
	for (const entry of handshake.participants) {
		assert.equal(entry.root, root, `${entry.kind} resolved to a different package root`);
		assert.equal(entry.name, "oh-my-slop");
		assert.equal(entry.version, "0.1.0");
	}

	assert.equal(participant(handshake, "factory-extension").path, join(root, "extensions", "factory"));
	assert.equal(participant(handshake, "monitor-extension").path, join(root, "extensions", "factory-monitor"));
	assert.equal(participant(handshake, "skills-root").path, join(root, "skills"));
});

test("the binary contributes both its resolved PATH entry and its realpath (§11.7)", (t) => {
	const { root, executable, env } = installed(t);

	const binary = participant(packageHandshake({ executable, env }), "binary");

	// The two are recorded separately because they are different facts: what an
	// operator typing `factory` gets, and which file that turned out to be. The
	// audited split-brain is exactly the case where they disagree.
	assert.equal(binary.path_entry, join(env.PATH, "factory"));
	assert.equal(binary.path, executable);
	assert.equal(binary.declared, "./factory/bin/factory.mjs");
	assert.equal(binary.root, root);
});

test("which artifact is which participant is decided in one place", () => {
	// A vocabulary with a second home has already started to drift, and this one
	// decides what §14.35 compares: a module that spelled "the factory extension"
	// its own way would be checking a different guard.
	const readers = factorySources()
		.filter(([, source]) => source.includes('"monitor-extension"'))
		.map(([path]) => path);

	assert.deepEqual(readers, ["lib/package/participants.mjs"]);
});

// ── The anti-shadowing guard (§11.7, §14.35) ────────────────────────────────

test("four artifacts resolving to different package roots is a hard finding, with the foreign identity as evidence", (t) => {
	// The audited split-brain, laid out on disk: a second install, and one
	// participant pointing into it. §14.35 is a `never`, so the resolution is a
	// refusal rather than an inferred compatibility pass.
	const other = makePackage(t, { manifest: { name: "oh-my-slop", version: "0.0.187" } });
	const { root, executable, env } = installed(t, {
		files: {
			"extensions/factory/index.ts": null,
			"extensions/factory": { symlink: join(other, "extensions", "factory") },
		},
	});

	const handshake = packageHandshake({ executable, env });

	assert.equal(handshake.ok, false);
	assert.deepEqual(
		handshake.findings.map((entry) => entry.reason),
		["package-root-split"],
	);

	const split = handshake.findings[0];
	assert.equal(split.kind, "factory-extension");
	assert.equal(split.root, root);
	assert.equal(split.resolved_root, other);

	// "6.0.3 declared, 0.0.187 executing", written down: the escaped participant
	// carries the identity of the package it actually came from.
	const escaped = participant(handshake, "factory-extension");
	assert.equal(escaped.version, "0.0.187");
	assert.equal(escaped.root, other);
	assert.equal(handshake.package.version, "0.1.0");
});

test("an undeclared or unshipped participant is a finding, but a missing monitor is not", (t) => {
	const declaredOnly = installed(t, { files: {}, manifest: {} });

	// "When present" is the monitor's whole status (§11.1): the dependency is
	// one-directional and **a missing or broken monitor never fails a factory
	// run**, so neither an undeclared one nor a declared one that was never
	// shipped puts anything in the findings.
	for (const extensions of [["./extensions/factory"], ["./extensions/factory", "./extensions/factory-monitor"]]) {
		const withoutMonitor = packageHandshake({
			executable: installed(t, {
				manifest: { pi: { skills: ["./skills"], extensions } },
				files: { "extensions/factory-monitor/index.ts": null },
			}).executable,
			env: { PATH: "" },
		});

		assert.deepEqual(withoutMonitor.findings, []);
		assert.equal(participant(withoutMonitor, "monitor-extension"), null);
	}

	// A factory extension the manifest never declares is not optional, and
	// neither is one it declares and does not ship.
	const undeclared = packageHandshake({
		executable: installed(t, { manifest: { pi: { skills: ["./skills"], extensions: [] } } }).executable,
		env: { PATH: "" },
	});
	assert.deepEqual(
		undeclared.findings.map((entry) => [entry.reason, entry.kind, entry.at]),
		[["participant-missing", "factory-extension", "pi.extensions"]],
	);

	rmSync(join(declaredOnly.root, "skills"), { recursive: true });
	const unshipped = packageHandshake({ executable: declaredOnly.executable, env: { PATH: "" } });
	assert.deepEqual(
		unshipped.findings.map((entry) => [entry.reason, entry.kind, entry.declared]),
		[["participant-missing", "skills-root", "./skills"]],
	);
});

test("a `factory` on PATH from another install is the same split-brain, and it is refused", (t) => {
	const shadow = makePackage(t, { manifest: { version: "0.0.187" } });
	const { executable } = installed(t);

	// What the audit actually found: the package is coherent on disk, and the
	// name an operator types resolves through a separate global install.
	const handshake = packageHandshake({
		executable,
		env: { PATH: onPath(t, join(shadow, "factory", "bin", "factory.mjs")) },
	});

	assert.equal(handshake.ok, false);
	assert.deepEqual(
		handshake.findings.map((entry) => entry.reason),
		["binary-shadowed"],
	);
	assert.equal(handshake.findings[0].path_entry_realpath, join(shadow, "factory", "bin", "factory.mjs"));

	// Recorded either way: the record says what an operator would get, whether or
	// not it agrees with what ran.
	const binary = participant(handshake, "binary");
	assert.equal(binary.path_entry_realpath, join(shadow, "factory", "bin", "factory.mjs"));
	assert.equal(binary.path, executable);
});

test("an executable resolving outside its declared package root is a failure, never a pass (§11.7)", (t) => {
	const { root, executable, env } = installed(t, { manifest: { bin: { factory: "./factory/bin/other.mjs" } } });
	writeTree(root, { "factory/bin/other.mjs": "#!/usr/bin/env node\n" });

	const handshake = packageHandshake({ executable, env });

	assert.equal(handshake.ok, false);
	assert.deepEqual(
		handshake.findings.map((entry) => entry.reason),
		["binary-shadowed", "binary-shadowed"],
	);
	assert.equal(handshake.findings[0].running, executable);
	assert.equal(handshake.findings[0].path, join(root, "factory", "bin", "other.mjs"));
});

// ── The checkout, recorded as metadata and nothing more (§11.7) ─────────────

test("git commit and a dirty flag are metadata; the digest does not change because a checkout appeared", (t) => {
	const { root, executable, env } = installed(t);

	// Not a checkout at all — the common installed shape, and it is answered
	// rather than special-cased.
	const installedShape = packageHandshake({ executable, env });
	assert.deepEqual({ ...installedShape.git }, { commit: null, dirty: null });

	const commit = commitAll(root);
	const clean = packageHandshake({ executable, env });
	assert.deepEqual({ ...clean.git }, { commit, dirty: false });

	// The whole point of "authoritative uniformly for every install shape": the
	// same files digest the same whether or not git is watching them, so a dev run
	// and an installed run are comparable.
	assert.equal(clean.tree.digest, installedShape.tree.digest);

	writeTree(root, { "skills/practice/tdd/SKILL.md": "# tdd, edited\n" });
	const dirty = packageHandshake({ executable, env });
	assert.deepEqual({ ...dirty.git }, { commit, dirty: true });
	assert.notEqual(dirty.tree.digest, clean.tree.digest, "the digest is what moved, not the metadata");
});

test("a package installed inside somebody else's repo reports no commit of its own", (t) => {
	const consumer = makeTree(t, { "README.md": "a repo that depends on us\n" });
	writeTree(consumer, {
		"node_modules/oh-my-slop/package.json": JSON.stringify(PACKAGE_MANIFEST),
		"node_modules/oh-my-slop/factory/bin/factory.mjs": "#!/usr/bin/env node\n",
		"node_modules/oh-my-slop/extensions/factory/index.ts": "export const factory = true;\n",
		"node_modules/oh-my-slop/skills/practice/tdd/SKILL.md": "# tdd\n",
	});
	commitAll(consumer);

	const root = join(consumer, "node_modules", "oh-my-slop");
	const handshake = packageHandshake({
		executable: join(root, "factory", "bin", "factory.mjs"),
		env: { PATH: "" },
	});

	// The nearest manifest is the package; the consumer's commit is a fact about
	// the consumer, and recording it here would pin the wrong tree.
	assert.equal(handshake.package.root, root);
	assert.deepEqual({ ...handshake.git }, { commit: null, dirty: null });
	assert.deepEqual(handshake.findings, []);
});

// ── The declared expectation, and the observed digest beside it (§11.7) ─────

test("an optional package.expect compares name and version, exact or range", (t) => {
	const { executable, env } = installed(t);
	const handshake = (expect) => packageHandshake({ executable, expect, env });

	assert.deepEqual(handshake({ name: "oh-my-slop", version: "^0.1.0" }).findings, []);
	assert.deepEqual(handshake({ name: "oh-my-slop", version: "0.1.0" }).findings, []);

	const wrongName = handshake({ name: "oh-my-slop-fork", version: "0.1.0" });
	assert.equal(wrongName.ok, false);
	assert.deepEqual(
		wrongName.findings.map((entry) => [entry.reason, entry.expected, entry.found]),
		[["package-name-mismatch", "oh-my-slop-fork", "oh-my-slop"]],
	);

	const wrongVersion = handshake({ name: "oh-my-slop", version: ">=0.2.0" });
	assert.deepEqual(
		wrongVersion.findings.map((entry) => [entry.reason, entry.expected, entry.found]),
		[["package-version-mismatch", ">=0.2.0", "0.1.0"]],
	);

	// The expectation is recorded beside the observation, so the artifact says
	// what was asked for as well as what was there.
	assert.deepEqual({ ...wrongVersion.expect }, { name: "oh-my-slop", version: ">=0.2.0" });
});

test("the tree digest is the package's own files, and it is recorded observationally", (t) => {
	const { root, executable, env } = installed(t);

	const handshake = packageHandshake({ executable, env });

	assert.deepEqual({ ...handshake.tree }, { ...treeDigest(root) });
	assert.equal(handshake.expect, null);
});

// ── Preflight's one immutable artifact per run (§11.7, §12.1) ───────────────

test("preflight writes one immutable handshake artifact, and the journal carries its digest", async (t) => {
	const store = await openTestStore(t);
	const run = newUlid();
	store.append(runStarted(run));
	const { executable, env } = installed(t);
	const handshake = packageHandshake({ executable, env });

	const pinned = recordPackageHandshake(store, handshake, { run, actor: "controller", fencingGeneration: 1, at: AT });

	assert.equal(pinned.outcome, "written");
	assert.equal(pinned.key, `${run}/-/preflight/-/artifact-write/handshake`);
	assert.equal(pinned.reference.media_type, "application/json");
	assert.deepEqual(JSON.parse(readArtifact(store, pinned.reference).toString("utf8")), JSON.parse(JSON.stringify(handshake)));

	// §11.7's persistence rule: the digest is in a journal event, and what an
	// attempt cites is that digest — never the payload again.
	const events = store.readEvents({ stream: `run:${run}` }).filter((event) => event.kind.startsWith("effect."));
	assert.deepEqual(
		events.map((event) => event.kind),
		["effect.requested", "effect.resolved"],
	);
	for (const event of events) {
		const payload = canonicalJson(event.payload);
		assert.ok(payload.includes(pinned.reference.digest), `${event.kind} does not carry the handshake digest`);
		assert.equal(payload.includes(handshake.package.root), false, `${event.kind} re-embedded the handshake payload`);
	}
});

test("re-recording the same handshake is the same pin; a different one is a conflict, never a new pin", async (t) => {
	const store = await openTestStore(t);
	const run = newUlid();
	store.append(runStarted(run));
	const { root, executable, env } = installed(t);
	const pin = (at) =>
		recordPackageHandshake(store, packageHandshake({ executable, env }), {
			run,
			actor: "controller",
			fencingGeneration: 1,
			at,
		});

	const first = pin(AT);
	const again = pin(AT + 1_000);

	assert.equal(again.outcome, "already-written");
	assert.deepEqual({ ...again.reference }, { ...first.reference });
	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM artifact").get().n), 1);

	// §11.7's recheck rule, structurally: the pin is immutable for the run, so a
	// package that changed under the controller cannot quietly become the new one.
	writeTree(root, { "skills/practice/tdd/SKILL.md": "# tdd, edited mid-run\n" });
	const conflict = refusalOf(() => pin(AT + 2_000));

	assert.equal(conflict.reason, "effect-payload-conflict");
	assert.equal(store.read((db) => db.prepare("SELECT COUNT(*) AS n FROM artifact").get().n), 1);
});

test("findings are a report until somebody is about to claim, and then they are an automation failure", (t) => {
	const { executable, env } = installed(t);
	const clean = packageHandshake({ executable, env });
	const split = packageHandshake({ executable, expect: { name: "somebody-else", version: "1.0.0" }, env });

	// §10.5's `doctor` runs the same handshake in report mode, so the record is a
	// value first. §11.7's "before first claim" is this call, and preflight makes
	// it after the artifact is written — a failed handshake is evidence too.
	assert.equal(assertPackageIntact(clean), clean);

	const refusal = refusalOf(() => assertPackageIntact(split));
	assert.equal(refusal.reason, "package-handshake-failed");
	assert.deepEqual(refusal.details.findings, split.findings);
});
