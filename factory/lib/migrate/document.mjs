import { FactoryConfigError } from "../config/errors.mjs";
import { CONFIG_SCHEMA_VERSION } from "../config/load.mjs";

/**
 * §11.8's legacy key disposition table, as data.
 *
 * **Migration is never silent.** Every key a `version: 1` file carries leaves
 * this module in exactly one of three states — mapped to its v2 home, reported
 * and dropped, or replaced by a `TODO` hole the loader hard-fails on until a
 * human resolves it — and the full list is printed. A key the table does not
 * name refuses the migration rather than being quietly lost: silently dropping
 * a policy an operator wrote is the failure §11.2 exists to end, and it is
 * worse here than at load time, because migration is the moment the legacy file
 * stops being the one that runs.
 *
 * The table is data rather than a procedure so the printed report and the
 * rewritten file come from the same rows. A row that mapped a key without
 * reporting it, or reported one it did not map, is not expressible.
 */

/** Legacy files declared `version: 1`; §11.1 starts the new schema at 2. */
export const LEGACY_SCHEMA_VERSION = 1;

/** §11.8's three dispositions, and nothing else a row can be. */
export const MAPPED = "mapped";
export const DROPPED = "dropped";
export const TODO = "todo";

/**
 * One row per §11.8 key. `from` is the legacy path (null for a hole the legacy
 * file has no key for), `to` the v2 path (null for a dropped key), and `take`
 * reads the legacy value — `undefined` means the row does not apply to this
 * file, so it is neither written nor reported.
 */
const DISPOSITION_TABLE = Object.freeze([
	{
		from: "version",
		to: "schemaVersion",
		disposition: MAPPED,
		why: `§11.1 starts the new schema at ${CONFIG_SCHEMA_VERSION}, so no "1" ever denotes two schemas.`,
		take: () => CONFIG_SCHEMA_VERSION,
	},
	{
		from: "tracker",
		to: "tracker",
		disposition: MAPPED,
		why: "Carried whole minus labels; the loader checks its interior.",
		take: (legacy) => omit(legacy.tracker, ["labels"]),
	},
	{
		from: "tracker.labels",
		to: null,
		disposition: DROPPED,
		why: "§3.2's label vocabulary is fixed constants in code; per-install names make the tracker graph un-auditable across repos.",
		take: (legacy) => legacy.tracker?.labels,
	},
	{
		from: "git",
		to: "git",
		disposition: MAPPED,
		why: "Carried whole.",
		take: (legacy) => legacy.git,
	},
]);

/**
 * @param {object} legacy the parsed `version: 1` document
 * @returns {{ document: object, dispositions: ReadonlyArray<{ from: string | null, to: string | null, disposition: string, why: string }> }}
 * @throws {FactoryConfigError} when the document is not a v1 file
 */
export function migrateDocument(legacy) {
	requireLegacyVersion(legacy);

	const document = {};
	const dispositions = [];

	for (const row of DISPOSITION_TABLE) {
		const value = row.take(legacy);
		if (value === undefined) continue;

		if (row.to !== null) setPath(document, row.to, value);
		dispositions.push(report(row));
	}

	return { document, dispositions: Object.freeze(dispositions) };
}

/**
 * Migration is for v1 files and nothing else. A v2 file refuses rather than
 * being rewritten a second time: the second pass would find none of the legacy
 * keys, report an empty disposition list, and overwrite a working config with a
 * skeleton — the silent damage this whole section is written against.
 */
function requireLegacyVersion(legacy) {
	if (legacy?.version === LEGACY_SCHEMA_VERSION) return;

	const found = legacy?.version ?? legacy?.schemaVersion ?? null;
	throw new FactoryConfigError(
		"schema-version",
		`factory migrate reads a legacy version ${LEGACY_SCHEMA_VERSION} config; this one declares ${JSON.stringify(found)}.`,
		{ at: legacy?.schemaVersion === undefined ? "version" : "schemaVersion", found, expected: LEGACY_SCHEMA_VERSION },
	);
}

function report(row) {
	return Object.freeze({ from: row.from, to: row.to, disposition: row.disposition, why: row.why });
}

function setPath(document, path, value) {
	const segments = path.split(".");
	let cursor = document;
	for (const segment of segments.slice(0, -1)) {
		cursor[segment] ??= {};
		cursor = cursor[segment];
	}
	cursor[segments.at(-1)] = value;
}

function omit(value, keys) {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
