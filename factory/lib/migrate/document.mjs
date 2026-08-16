import { FactoryConfigError } from "../config/errors.mjs";
import { CONFIG_SCHEMA_VERSION } from "../config/load.mjs";
import { IDENTIFIER_PATTERN } from "../config/shape.mjs";

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
 * Where a hole's text starts. The loader's sentinel scan is anchored (`^TODO`),
 * so every hole this module leaves has to begin here for §11.2's hard failure to
 * fire — which is the entire reason a hole is left instead of a guess.
 */
const TODO_PREFIX = "TODO";

/**
 * Legacy containers whose interior this migration reads key by key. A key
 * inside one of them that no row names is refused: the container is taken
 * apart, so an unnamed key would be dropped by omission rather than by decision.
 *
 * `tracker` and `git` are deliberately absent — they carry over whole, so an
 * unexpected key inside them survives into the v2 file and meets the loader's
 * own `unknown-key` refusal, with the written file to point at.
 */
const LEGACY_INTERIORS = Object.freeze({
	herdr: Object.freeze(["maxWorkers"]),
	workers: Object.freeze(["profiles", "routing"]),
	"workers.routing": Object.freeze(["defaults", "rules"]),
	"workers.routing.defaults": Object.freeze(["implement", "freshRetry", "review", "finalReview"]),
	retry: Object.freeze(["repairAttempts", "freshAgentRetries"]),
});

/**
 * The migration preserves the file it replaces under this name, beside it, and
 * two of the holes point a human at it: the legacy rules and the dormant
 * post-subscription set are exactly what they have to re-author from. It is
 * declared here rather than in the verb because the sentences that cite it are
 * here; the verb imports it to do the writing.
 */
export const PRESERVED_LEGACY_BASENAME = "factory.v1.json";

/** How the holes refer to that copy, spelled once. */
const LEGACY_COPY_HINT = `the preserved copy beside this file, ${PRESERVED_LEGACY_BASENAME}`;

/** §11.4's key, taken away from authors and reported by the profile that wrote it. */
const PERMISSION_MODE = "permissionMode";

/** §11.5's two review attempts, written out rather than expanded by a shorthand. */
const REVIEW_ATTEMPTS = 2;

/**
 * One row per §11.8 key. `from` is the legacy path (null for a hole the legacy
 * file has no key for), `to` the v2 path (null for a dropped key), and `take`
 * reads the legacy value — `undefined` means the row does not apply to this
 * file, so it is neither written nor reported.
 *
 * `why` may be a function when the sentence has to name what it found: which
 * profiles set a permission mode, how many rules there are to re-author.
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
	{
		from: "herdr.maxWorkers",
		to: null,
		disposition: DROPPED,
		why: "Superseded by §9's capacity model, where concurrency is per resource class rather than a single worker count.",
		take: (legacy) => legacy.herdr?.maxWorkers,
	},
	{
		from: "workers.profiles",
		to: "profiles",
		disposition: MAPPED,
		why: "Renamed to the singular block §11.3 declares, minus permissionMode.",
		take: (legacy) => mapValues(legacy.workers?.profiles, (profile) => omit(profile, [PERMISSION_MODE])),
	},
	{
		from: `workers.profiles.*.${PERMISSION_MODE}`,
		to: null,
		disposition: DROPPED,
		why: (found) =>
			`Not author-controllable (§11.4): permissions derive from the role a profile is bound to at dispatch. Declared by ${found.join(", ")}.`,
		take: (legacy) => nonEmpty(profilesDeclaring(legacy, PERMISSION_MODE)),
	},
	{
		from: "workers.routing.defaults.implement",
		to: "routing.roles.implement",
		disposition: MAPPED,
		why: "§11.5's implement role.",
		take: (legacy) => legacy.workers?.routing?.defaults?.implement,
	},
	{
		from: "workers.routing.defaults.freshRetry",
		to: "routing.roles.freshRetry",
		disposition: MAPPED,
		why: "§11.5's fresh-retry role, the one tier-dependent routing point.",
		take: (legacy) => legacy.workers?.routing?.defaults?.freshRetry,
	},
	{
		from: "workers.routing.defaults.review",
		to: "routing.roles.review",
		disposition: MAPPED,
		why: (attempts) =>
			`§11.5 makes review a pair, so the one legacy reviewer is written twice — "${attempts[0]}" for both attempts. Confirm or change the second before this file loads.`,
		take: (legacy) => reviewPair(legacy.workers?.routing?.defaults?.review),
	},
	{
		from: "workers.routing.defaults.finalReview",
		to: null,
		disposition: DROPPED,
		why: "§8.1's pipeline has no final-review phase; §11.5 removed the role.",
		take: (legacy) => legacy.workers?.routing?.defaults?.finalReview,
	},
	{
		from: "workers.routing.rules",
		to: "routing.rules",
		disposition: TODO,
		why: "Legacy rules used positional first-match over `phases`; §11.5 requires overlap-free `labelsAny × role → profile`, and a machine cannot pick which ticket labels were meant to survive.",
		take: (legacy) =>
			hole(
				`re-author the ${count(legacy.workers?.routing?.rules?.length ?? 0, "legacy rule")} as §11.5 rules — ` +
					"`labelsAny × role → profile`, with no two rules' label sets intersecting for one role. " +
					`The legacy rules are in ${LEGACY_COPY_HINT}.`,
			),
	},
	{
		from: "_postSubscription",
		to: "routing.sets.post-subscription",
		disposition: TODO,
		why: "§11.5 makes it a first-class named routing set, selectable per run, rather than dormant config the loader ignores.",
		take: (legacy) =>
			legacy._postSubscription === undefined
				? undefined
				: hole(
						"author this named routing set as `{ roles, rules }` (§11.5), or delete the key. " +
							`Its legacy form is in ${LEGACY_COPY_HINT}.`,
					),
	},
	{
		from: "retry.repairAttempts",
		to: "budgets.repair",
		disposition: MAPPED,
		why: "§8.6's repair budget.",
		take: (legacy) => legacy.retry?.repairAttempts,
	},
	{
		from: "retry.freshAgentRetries",
		to: "budgets.freshRetry",
		disposition: MAPPED,
		why: "§8.6's fresh-retry budget.",
		take: (legacy) => legacy.retry?.freshAgentRetries,
	},
	{
		from: "completion",
		to: null,
		disposition: DROPPED,
		why: "§11.3 deletes it: all four knobs now have exactly one legal value, three of them behind §6.8's hard floor. A setting that cannot take its other value is a lie about what the system will do.",
		take: (legacy) => legacy.completion,
	},
	{
		from: null,
		to: "budgets.automation",
		disposition: TODO,
		why: "§8.6's automation budget has no legacy key to come from.",
		take: () => hole("choose the automation-failure budget (§8.6; the default is 1, the ceiling 2)."),
	},
	{
		from: null,
		to: "checks",
		disposition: TODO,
		// §11.6: the matrix is read **once, at migration, for human review**.
		// `AGENTS.md` is never parsed at runtime and there is no automated
		// agreement check — the two are kept in step by hand thereafter.
		why: (value, { matrix }) =>
			Array.isArray(value)
				? `Generated from ${matrix.path}'s mandatory-commands matrix once, for human review; thereafter the two are kept in agreement by hand (§11.6). Every field the matrix cannot answer is left open.`
				: "No mandatory-commands matrix to read, so nothing is generated: §8.2 rules out inferring checks from a manifest, a Makefile, or prose.",
		take: (legacy, { matrix }) => generatedChecks(matrix),
	},
	{
		from: null,
		to: "concurrency",
		disposition: TODO,
		why: "§11.6 requires both keys with no default, and a machine cannot pick concurrency sizes.",
		take: () =>
			hole(
				"declare `{ maxTicketExecutions, resources: { <class>: <size> } }` (§11.6). " +
					"Every resource class the active routing reaches needs a size, and none may be assumed.",
			),
	},
]);

/**
 * @param {object} legacy the parsed `version: 1` document
 * @param {{ matrix?: { path: string, commands: Array<{ label: string, command: string }> } | null }} [options]
 *   `matrix` is §11.6's mandatory-commands matrix, already read — this module
 *   does no IO, so the same table is testable without a repository on disk.
 * @returns {{ document: object, dispositions: ReadonlyArray<{ from: string | null, to: string | null, disposition: string, why: string }> }}
 * @throws {FactoryConfigError} when the document is not a v1 file, or carries a
 *   key the table does not name
 */
export function migrateDocument(legacy, { matrix = null } = {}) {
	requireLegacyVersion(legacy);
	requireNamedKeys(legacy);

	const options = { matrix };
	const document = {};
	const dispositions = [];

	for (const row of DISPOSITION_TABLE) {
		const value = row.take(legacy, options);
		if (value === undefined) continue;

		if (row.to !== null) setPath(document, row.to, value);
		dispositions.push(
			Object.freeze({
				from: row.from,
				to: row.to,
				disposition: row.disposition,
				why: typeof row.why === "function" ? row.why(value, options) : row.why,
			}),
		);
	}

	return { document, dispositions: Object.freeze(dispositions) };
}

/**
 * Every legacy key the table names, at the top level and inside each container
 * the migration takes apart. A key outside that set refuses (§11.2): it is
 * policy an operator wrote, and dropping it by omission is exactly the silent
 * guess this section forbids. The operator's remedy is to delete it themselves —
 * which is a decision, and therefore not this program's to make.
 */
function requireNamedKeys(legacy) {
	const named = new Set(DISPOSITION_TABLE.map((row) => row.from).filter((from) => from !== null));

	refuseUnnamed(legacy, "", [...named].map((from) => from.split(".")[0]));
	for (const [path, allowed] of Object.entries(LEGACY_INTERIORS)) {
		const container = readPath(legacy, path);
		if (container !== undefined) refuseUnnamed(container, `${path}.`, allowed);
	}
}

function refuseUnnamed(container, prefix, allowed) {
	for (const key of Object.keys(container)) {
		if (allowed.includes(key)) continue;
		throw new FactoryConfigError(
			"unknown-key",
			`factory migrate has no disposition for "${prefix}${key}" — §11.8's table does not name it. ` +
				"Migration never drops a key by omission: delete it deliberately, then migrate.",
			{ at: `${prefix}${key}` },
		);
	}
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

/**
 * §11.6's checks block, generated **once, for human review**. Name and command
 * come from the matrix; the other three fields are left as holes because no
 * matrix can answer them — and `expectedFailureExitCodes` in particular is the
 * sole line between "the worker's code failed this check" and "this check is
 * broken", which a default would silently erase.
 */
function generatedChecks(matrix) {
	if (matrix === null || matrix.commands.length === 0) {
		return hole(
			`declare the mechanical checks (§11.6), each with all five fields. ` +
				"Verification is declared, never discovered (§8.2).",
		);
	}

	const names = new Set();
	return matrix.commands.map((entry, index) => ({
		name: uniqueCheckName(entry.label, index, names),
		command: entry.command,
		timeout: hole("seconds this check may take before the runner gives up (§11.6)."),
		severity: hole('"required" or "advisory" (§11.6).'),
		expectedFailureExitCodes: hole(
			"the exit codes that mean the worker's code failed rather than that the check itself is broken (§11.6). " +
				"pytest, ruff, tsc, and a shell script do not agree, so there is no default.",
		),
	}));
}

/**
 * A check's name reaches an effect key and an artifact discriminator (§4.5,
 * §8.7), so it is held to the config's identifier shape. A label that will not
 * slug into one becomes a positional name rather than a load-time typo
 * discovered mid-run.
 */
function uniqueCheckName(label, index, taken) {
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32)
		.replace(/-+$/, "");

	const candidate = IDENTIFIER_PATTERN.test(slug) && !taken.has(slug) ? slug : `check-${index + 1}`;
	taken.add(candidate);
	return candidate;
}

/** The profiles that declared `key`, in file order — the report names them. */
function profilesDeclaring(legacy, key) {
	return Object.entries(legacy.workers?.profiles ?? {})
		.filter(([, profile]) => profile?.[key] !== undefined)
		.map(([name]) => name);
}

/** §11.5's pair, written out: one legacy reviewer cannot say who the second is. */
function reviewPair(review) {
	return review === undefined ? undefined : Array.from({ length: REVIEW_ATTEMPTS }, () => review);
}

/**
 * A hole, in the one shape the loader's anchored scan recognises. The sentence
 * after the marker is what the human has to decide, because a `TODO` that does
 * not say what is missing is a puzzle rather than an instruction.
 */
function hole(what) {
	return `${TODO_PREFIX}: ${what}`;
}

function count(n, noun) {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function nonEmpty(list) {
	return list.length === 0 ? undefined : list;
}

function readPath(document, path) {
	return path.split(".").reduce((cursor, segment) => cursor?.[segment], document);
}

function mapValues(record, transform) {
	if (record === undefined) return undefined;
	return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, transform(value)]));
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
