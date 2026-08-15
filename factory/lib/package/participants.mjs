import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { FactoryPackageError } from "./errors.mjs";
import { finding } from "./findings.mjs";

/**
 * §11.7's four participating artifacts, resolved from the one manifest that
 * declares them.
 *
 * **The package root is derived from the running executable**, never
 * configured: the whole point of the handshake is to record what is executing,
 * and a configured root would be one more thing that can disagree with it. From
 * that anchor, each participant is resolved through its *declaration* — `bin`,
 * `pi.extensions`, `pi.skills` — so a participant that has wandered out of the
 * package is visible as a realpath outside the root rather than as a version
 * number nobody compared.
 */

/** §11.7's four, in the order the record lists them. */
export const HANDSHAKE_PARTICIPANTS = Object.freeze([
	"binary",
	"factory-extension",
	"monitor-extension",
	"skills-root",
]);

/** §11.8: `/factory` keeps its name, and so does the executable it fronts. */
const BINARY_NAME = "factory";

/**
 * Which declared extension entry is which participant, by the directory it
 * lives in. The names are code constants for the same reason §3.2's labels are:
 * a per-install spelling would make the anti-shadowing guard a naming
 * preference.
 */
const EXTENSION_DIRECTORIES = Object.freeze({
	"factory-extension": "factory",
	"monitor-extension": "factory-monitor",
});

/**
 * The package the executable belongs to: the nearest ancestor carrying a
 * `package.json`.
 *
 * Nearest rather than outermost, because an installed package sits inside the
 * consumer's tree and the consumer's manifest is not this package. The factory
 * binary never grows a manifest of its own between the two — one package, one
 * version (§11.7) — so nearest is exactly the root that declares it.
 *
 * @param {string} executable
 * @returns {{ root: string, manifest: object }}
 * @throws {FactoryPackageError} `package-root-unresolvable` · `package-manifest-unreadable`
 */
export function anchorPackage(executable) {
	const real = realpathOrNull(executable);
	if (real === null) {
		throw new FactoryPackageError(
			"package-root-unresolvable",
			`The factory executable ${executable} does not exist, so there is no package to pin (§11.7).`,
			{ at: "executable", found: executable },
		);
	}

	const root = packageRootOf(dirname(real));
	if (root === null) {
		throw new FactoryPackageError(
			"package-root-unresolvable",
			`No package.json above ${real}; §11.7 pins a package, and this executable belongs to none.`,
			{ at: "executable", found: real },
		);
	}

	return { root, manifest: readManifest(root) };
}

/**
 * Every participant the manifest declares, and every finding that declaration
 * produced.
 *
 * @param {{ root: string, manifest: object, executable: string, env: Record<string, string | undefined> }} anchor
 * @returns {{ participants: ReadonlyArray<object>, findings: ReadonlyArray<object> }}
 */
export function resolveParticipants({ root, manifest, executable, env }) {
	const participants = [];
	const findings = [];
	// §11.7 records the binary's resolved `PATH` entry **and** its realpath, so
	// both are looked up once and carried on the participant rather than being
	// recomputed by whoever compares them.
	const pathEntry = lookupOnPath(BINARY_NAME, env);
	const binaryPaths = Object.freeze({
		path_entry: pathEntry,
		path_entry_realpath: pathEntry === null ? null : realpathOrNull(pathEntry),
	});

	for (const kind of HANDSHAKE_PARTICIPANTS) {
		const declared = declarationFor(kind, manifest);
		if (declared === null) {
			// The monitor is the one participant §11.7 marks "when present": the
			// dependency is one-directional, and a missing monitor never fails a run.
			if (kind === "monitor-extension") continue;
			findings.push(
				finding("participant-missing", `The package at ${root} declares no ${kind} (${DECLARED_AT[kind]}).`, {
					kind,
					at: DECLARED_AT[kind],
					root,
				}),
			);
			continue;
		}

		for (const entry of declared) {
			const extra = kind === "binary" ? binaryPaths : {};
			const resolved = describe({ kind, declared: entry, root, manifest, extra });
			if (resolved === null) continue;

			participants.push(resolved.participant);
			findings.push(...resolved.findings);
		}
	}

	findings.push(...binaryFindings({ participants, root, executable }));

	return { participants: Object.freeze(participants), findings: Object.freeze(findings) };
}

/** Where in the manifest each participant is declared — for the refusal to cite. */
const DECLARED_AT = Object.freeze({
	binary: `bin.${BINARY_NAME}`,
	"factory-extension": "pi.extensions",
	"monitor-extension": "pi.extensions",
	"skills-root": "pi.skills",
});

/**
 * What the manifest says about one participant, as a list of declared paths, or
 * null when it says nothing. `pi.skills` is a list in the manifest and stays one
 * here: a package declaring two skill roots has two participants, and each is
 * held to the same root as the rest.
 */
function declarationFor(kind, manifest) {
	if (kind === "binary") {
		const bin = manifest.bin;
		const declared = typeof bin === "string" ? bin : (bin?.[BINARY_NAME] ?? null);
		return typeof declared === "string" ? [declared] : null;
	}

	if (kind === "skills-root") {
		const declared = asPathList(manifest.pi?.skills);
		return declared.length === 0 ? null : declared;
	}

	const directory = EXTENSION_DIRECTORIES[kind];
	const declared = asPathList(manifest.pi?.extensions).filter((entry) => segments(entry).includes(directory));
	return declared.length === 0 ? null : declared;
}

function asPathList(value) {
	if (typeof value === "string") return [value];
	return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function segments(declared) {
	return declared.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
}

/**
 * One participant's record and whatever resolving it found — what was declared,
 * where it actually is, and which package that place belongs to. A participant
 * that resolved out of the package carries **the foreign package's own name and
 * version**, because that pair is the evidence: "6.0.3 declared, 0.0.187
 * executing" is the audited failure written down.
 *
 * @returns {{ participant: object, findings: object[] } | null} null only for a
 *   monitor that is not there
 */
function describe({ kind, declared, root, manifest, extra }) {
	const path = realpathOrNull(resolve(root, declared));

	if (path === null) {
		// §11.1: **a missing or broken monitor never fails a factory run.** A
		// manifest that declares one it does not ship is one of the ways it can be
		// missing, so it leaves no participant and no finding — while a monitor that
		// *is* there is held to the same root as everything else (§14.35).
		if (kind === "monitor-extension") return null;

		return {
			participant: frozenParticipant({ kind, declared, path: null, ...extra, root: null, name: null, version: null }),
			findings: [
				finding("participant-missing", `The package at ${root} declares ${kind} at ${declared}, which is not there.`, {
					kind,
					at: DECLARED_AT[kind],
					declared,
					root,
				}),
			],
		};
	}

	const owner = contains(root, path) ? root : packageRootOf(dirname(path));
	const identity = owner === root ? manifest : (owner === null ? {} : tryManifest(owner));
	const split = finding(
		"package-root-split",
		`The ${kind} declared at ${declared} resolves to ${path}, outside the package root ${root} (§14.35).`,
		{ kind, declared, path, root, resolved_root: owner },
	);

	return {
		participant: frozenParticipant({
			kind,
			declared,
			path,
			...extra,
			root: owner,
			name: typeof identity.name === "string" ? identity.name : null,
			version: typeof identity.version === "string" ? identity.version : null,
		}),
		findings: owner === root ? [] : [split],
	};
}

/**
 * §11.7's anti-shadowing guard for the binary: what an operator typing
 * `factory` gets, and what is running right now, must both be the executable
 * this package declares. **The `PATH` entry and its realpath are recorded
 * separately** because the audited split-brain is exactly the case where a name
 * resolves through one install to another one's file.
 */
function binaryFindings({ participants, root, executable }) {
	const binary = participants.find((entry) => entry.kind === "binary");
	if (binary === undefined || binary.path === null) return [];

	const running = realpathOrNull(executable);
	const findings = [];

	if (running !== null && running !== binary.path) {
		findings.push(
			finding(
				"binary-shadowed",
				`The running executable is ${running}, not the ${binary.declared} the package at ${root} declares (§11.7).`,
				{ kind: "binary", declared: binary.declared, path: binary.path, running, root },
			),
		);
	}

	if (binary.path_entry !== null && binary.path_entry_realpath !== binary.path) {
		findings.push(
			finding(
				"binary-shadowed",
				`\`${BINARY_NAME}\` on PATH is ${binary.path_entry} → ${binary.path_entry_realpath}, not ${binary.path} (§11.7).`,
				{
					kind: "binary",
					path_entry: binary.path_entry,
					path_entry_realpath: binary.path_entry_realpath,
					path: binary.path,
					root,
				},
			),
		);
	}

	return findings;
}

/**
 * The first executable of that name on `PATH`, or null when the name is not on
 * it at all. Absence is not a finding: nothing disagrees with nothing, and a
 * factory run from a checkout is a supported install shape (§11.7).
 */
function lookupOnPath(name, env) {
	for (const directory of (env.PATH ?? "").split(delimiter)) {
		if (directory === "") continue;

		const candidate = join(directory, name);
		try {
			if (!statSync(candidate).isFile()) continue;
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}

	return null;
}

/** The nearest ancestor of `directory`, inclusive, carrying a `package.json`. */
function packageRootOf(directory) {
	let current = resolve(directory);
	for (;;) {
		try {
			if (statSync(join(current, "package.json")).isFile()) return current;
		} catch {
			// Not here; keep walking. An unreadable manifest is the caller's problem
			// to report, and it reports it by reading the one it settled on.
		}

		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * A package's manifest, as an object.
 *
 * @throws {FactoryPackageError} `package-manifest-unreadable`
 */
function readManifest(root) {
	const path = join(root, "package.json");
	let source;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		throw new FactoryPackageError("package-manifest-unreadable", `Cannot read ${path}: ${error.message}`, {
			at: path,
		});
	}

	let manifest;
	try {
		manifest = JSON.parse(source);
	} catch (error) {
		throw new FactoryPackageError("package-manifest-unreadable", `Invalid JSON in ${path}: ${error.message}`, {
			at: path,
		});
	}

	if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new FactoryPackageError("package-manifest-unreadable", `${path} is not a JSON object.`, { at: path });
	}

	return manifest;
}

/**
 * The same, for a package the handshake merely *found* — a foreign root a
 * participant escaped into. Its manifest is evidence, not policy, so an
 * unreadable one leaves the identity blank instead of stopping the report the
 * operator needs.
 */
function tryManifest(root) {
	try {
		return readManifest(root);
	} catch {
		return {};
	}
}

function frozenParticipant(fields) {
	return Object.freeze({ ...fields });
}

function contains(root, path) {
	return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function realpathOrNull(path) {
	try {
		return realpathSync(isAbsolute(path) ? path : resolve(path));
	} catch {
		return null;
	}
}
