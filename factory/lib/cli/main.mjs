import { FactoryConfigError } from "../config/errors.mjs";
import { loadFactoryConfig } from "../config/load.mjs";
import { EXIT_NOT_IMPLEMENTED, EXIT_OK, EXIT_USAGE } from "./exit-codes.mjs";
import { VERB_TABLE, VERBS } from "./verbs.mjs";

export { VERBS } from "./verbs.mjs";

/**
 * The operator surface: one deterministic binary, one structured value per
 * invocation, two renderings of it (§10.2). Human output is the default and
 * `--json` is the machine contract; both come from the value `runCli` returns,
 * so a fact can never reach one rendering and miss the other.
 */

/** The `--json` envelope version. Published contract, never configuration (§10.3). */
const OUTPUT_SCHEMA_VERSION = 1;

const SYNOPSIS = "factory <verb> [--json]";
const KNOWN_FLAGS = new Set(["--json", "--help", "-h"]);

/**
 * @param {string[]} argv arguments after the program name
 * @param {{ cwd: string }} context
 * @returns {{ exitCode: number, value: object, json: boolean }}
 */
export function runCli(argv, { cwd }) {
	const parsed = parseArgv(argv);
	// Even a refusal to parse the rest of the line is rendered in the shape the
	// caller asked for, so `--json` is read before anything can reject.
	return { json: parsed.json, ...dispatch(parsed, { cwd }) };
}

function dispatch(parsed, { cwd }) {
	if (parsed.error) return failure(null, parsed.error, EXIT_USAGE, { usage: shortUsage() });

	if (parsed.help) return help();
	if (parsed.verb === null) {
		return failure(
			null,
			{ kind: "usage", message: `No verb given. ${SYNOPSIS}` },
			EXIT_USAGE,
			{ usage: shortUsage() },
		);
	}

	const verb = VERB_TABLE[parsed.verb];
	if (verb === undefined) {
		return failure(
			null,
			{ kind: "usage", message: `Unknown verb "${parsed.verb}".`, verb: parsed.verb },
			EXIT_USAGE,
			{ usage: shortUsage() },
		);
	}

	if (verb.requiresConfig) {
		try {
			loadFactoryConfig({ cwd });
		} catch (error) {
			if (!(error instanceof FactoryConfigError)) throw error;
			return failure(
				parsed.verb,
				{ kind: "config-load", reason: error.reason, message: error.message, ...error.details },
				EXIT_USAGE,
				{ args: parsed.args },
			);
		}
	}

	return failure(
		parsed.verb,
		{
			kind: "not-implemented",
			message: `factory ${parsed.verb} is specified but not built in this package.`,
			missing: verb.missing,
			spec: verb.spec,
		},
		EXIT_NOT_IMPLEMENTED,
		{ args: parsed.args },
	);
}

export function renderJson(value) {
	return JSON.stringify(value, null, 2);
}

export function renderHuman(value) {
	const lines = [];

	if (value.ok) {
		lines.push(value.message);
	} else {
		const scope = value.command === null ? "factory" : `factory ${value.command}`;
		lines.push(`${scope}: ${value.error.message}`);
		for (const [key, detail] of Object.entries(value.error)) {
			if (key === "message" || detail === null || detail === undefined) continue;
			lines.push(`  ${key}: ${formatDetail(detail)}`);
		}
	}

	if (value.args !== undefined && value.args.length > 0) {
		lines.push(`  arguments: ${value.args.join(" ")}`);
	}

	if (value.usage !== undefined) {
		lines.push(`  usage: ${value.usage.synopsis}`);
		if (value.usage.summaries === undefined) {
			lines.push(`  verbs: ${value.usage.verbs.join(" | ")}`);
		} else {
			lines.push("  verbs:");
			const width = Math.max(...value.usage.verbs.map((name) => name.length));
			for (const name of value.usage.verbs) {
				lines.push(`    ${name.padEnd(width)}  ${value.usage.summaries[name]}`);
			}
		}
	}

	return `${lines.join("\n")}\n`;
}

function parseArgv(argv) {
	const args = [];
	const json = argv.includes("--json");
	let verb = null;
	let help = false;

	for (const token of argv) {
		if (token === "--config" || token.startsWith("--config=")) {
			return {
				json,
				error: {
					kind: "usage",
					message:
						"There is no --config override: factory configuration is repo-bound and lives at <repo root>/.pi/factory.json.",
					flag: "--config",
				},
			};
		}

		if (token.startsWith("-")) {
			if (!KNOWN_FLAGS.has(token)) {
				return { json, error: { kind: "usage", message: `Unknown flag "${token}".`, flag: token } };
			}
			if (token === "--help" || token === "-h") help = true;
			continue;
		}

		if (verb === null) verb = token;
		else args.push(token);
	}

	return { json, verb, args, help };
}

function help() {
	return {
		exitCode: EXIT_OK,
		value: {
			schema_version: OUTPUT_SCHEMA_VERSION,
			command: "help",
			ok: true,
			message: "factory — one deterministic binary carrying every Software Factory operator verb.",
			usage: {
				synopsis: SYNOPSIS,
				verbs: VERBS,
				summaries: Object.fromEntries(
					Object.entries(VERB_TABLE).map(([name, verb]) => [name, verb.summary]),
				),
			},
		},
	};
}

function failure(command, error, exitCode, extra = {}) {
	const value = { schema_version: OUTPUT_SCHEMA_VERSION, command, ok: false, error };
	if (extra.args !== undefined && extra.args.length > 0) value.args = extra.args;
	if (extra.usage !== undefined) value.usage = extra.usage;

	return { exitCode, value };
}

function shortUsage() {
	return { synopsis: SYNOPSIS, verbs: VERBS };
}

function formatDetail(detail) {
	return Array.isArray(detail) ? detail.join(", ") : String(detail);
}
