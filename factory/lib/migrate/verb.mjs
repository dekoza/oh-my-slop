import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { EXIT_REFUSED, EXIT_USAGE } from "../cli/exit-codes.mjs";
import { discoverConfigPath } from "../config/discover.mjs";
import { FactoryConfigError } from "../config/errors.mjs";
import { migrateDocument, PRESERVED_LEGACY_BASENAME, TODO } from "./document.mjs";
import { readMandatoryCommands } from "./matrix.mjs";

/**
 * `factory migrate` (§11.8), from the operator's side.
 *
 * It is a **sibling of `doctor`, never a flag on it** (§10.2). Doctor's whole
 * invariant is that it appends nothing in either mode; migration writes the
 * operator's own config file, a durable mutation of a different category, and
 * putting the two behind one verb would mean doctor's read-only reputation
 * needed an asterisk.
 *
 * It is also the one verb that does **not** require a loadable config: it is
 * what turns an unloadable v1 file into a loadable one, so depending on a
 * successful load would make it unreachable exactly when it is needed.
 *
 * Two things are true of everything below, and they are why the order is what it
 * is. **Nothing is written until the whole migration has succeeded**, so a
 * refusal leaves the operator exactly where they were. And **the file being
 * replaced is preserved first**, under a name that already exists on disk before
 * `.pi/factory.json` is touched — the legacy rules and the dormant
 * post-subscription set are what a human re-authors the holes from, and losing
 * them would make the holes unresolvable.
 *
 * @param {object} invocation
 * @param {string} invocation.cwd the invocation directory; discovery walks up to
 *   the repo root from here, exactly as a loading verb would
 * @returns {Promise<{ message: string, report: object } | { error: object, exitCode: number }>}
 */
export async function runMigrate({ cwd }) {
	let configPath;
	let legacy;
	let migrated;
	try {
		const discovered = discoverConfigPath(cwd);
		configPath = discovered.configPath;
		legacy = readLegacy(configPath);
		migrated = migrateDocument(legacy.document, { matrix: readMandatoryCommands(discovered.repoRoot) });
	} catch (error) {
		if (!(error instanceof FactoryConfigError)) throw error;
		return {
			error: { kind: error.reason, message: error.message, file: configPath ?? null, ...error.details },
			// §10.3 reserves 1 for the operator's line being wrong, which a config
			// this verb cannot read is: the remedy is to the file, not to a run.
			exitCode: EXIT_USAGE,
		};
	}

	const preserved = join(dirname(configPath), PRESERVED_LEGACY_BASENAME);
	if (existsSync(preserved)) {
		return {
			error: {
				kind: "preserved-copy-exists",
				message: `${preserved} already exists, so migration would overwrite a file it did not write. Move it aside and run \`factory migrate\` again.`,
				file: preserved,
			},
			exitCode: EXIT_REFUSED,
		};
	}

	// The copy lands first and the rewrite second, so no window exists in which
	// the legacy policy is neither on disk nor preserved.
	writeAtomic(preserved, legacy.source);
	writeAtomic(configPath, `${JSON.stringify(migrated.document, null, 2)}\n`);

	const holes = migrated.dispositions.filter((row) => row.disposition === TODO).map((row) => row.to);

	return {
		message:
			`factory migrate rewrote ${configPath} as schemaVersion 2: ` +
			`${countOf(migrated.dispositions, "mapped")} mapped, ${countOf(migrated.dispositions, "dropped")} dropped, ` +
			`${holes.length} TODO ${holes.length === 1 ? "hole" : "holes"} to resolve before it loads.`,
		report: {
			config: configPath,
			preserved,
			dispositions: migrated.dispositions,
			holes,
			next: "The loader refuses every one of these holes until a human resolves it (§11.2). Nothing runs from this file until then.",
		},
	};
}

/**
 * The legacy file, kept as **both** its parsed form and its exact bytes: the
 * preserved copy is a byte copy rather than a re-serialisation, so an operator's
 * comments-by-convention, key order, and formatting survive intact for them to
 * re-author from.
 */
function readLegacy(configPath) {
	let source;
	try {
		source = readFileSync(configPath, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new FactoryConfigError(
				"file-missing",
				`Missing ${configPath}. There is nothing to migrate; \`factory migrate\` rewrites an existing v1 file, it does not author a new one.`,
				{ file: configPath },
			);
		}
		throw new FactoryConfigError("unreadable", `Cannot read ${configPath}: ${error.message}`, { file: configPath });
	}

	try {
		return { source, document: JSON.parse(source) };
	} catch (error) {
		throw new FactoryConfigError("parse-error", `Invalid JSON in ${configPath}: ${error.message}`, {
			file: configPath,
		});
	}
}

function countOf(dispositions, disposition) {
	return dispositions.filter((row) => row.disposition === disposition).length;
}

/**
 * Temp-and-rename. A half-written policy file is the one outcome worse than
 * either the old file or the new one, and it is what a crash mid-write leaves
 * behind on a plain `writeFileSync`.
 */
function writeAtomic(path, content) {
	const temporary = `${path}.factory-tmp`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, path);
}
