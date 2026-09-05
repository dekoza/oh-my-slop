import { registerArtifactProbes } from "../artifacts/probes.mjs";
import { FactoryConfigError } from "../config/errors.mjs";
import { loadFactoryConfig, ROUTING_SET_FLAG } from "../config/load.mjs";
import { registerGitProbes } from "../git/probes.mjs";
import { PROBES } from "../reconcile/probes.mjs";
import { EXIT_NOT_IMPLEMENTED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from "./exit-codes.mjs";
import { JSON_FLAG } from "./flags.mjs";
import { renderReport } from "./render.mjs";
import { VERB_TABLE, VERBS } from "./verbs.mjs";

export { VERBS } from "./verbs.mjs";

// §5.3: each subsystem's probes join the shipped registry as the subsystem
// lands, and the binary's composition root is where they meet — once per
// process, however many invocations a test drives through `runCli`. This is
// deliberately the **only** place `PROBES` is populated: an entry point that
// reaches `start`, `reconcile`, or `doctor` without passing through this
// module gets an empty default registry and must register (or inject) its own,
// which the engine surfaces as `probe-unavailable` rather than hiding.
registerGitProbes(PROBES);
registerArtifactProbes(PROBES);

/**
 * The operator surface: one deterministic binary, one structured value per
 * invocation, two renderings of it (§10.2). Human output is the default and
 * `--json` is the machine contract; both come from the value `runCli` returns,
 * so a fact can never reach one rendering and miss the other.
 */

/**
 * The `--json` envelope version. **Published contract, never configuration**
 * (§10.3), and a module constant for that reason: nothing the config file can
 * say reaches it, so no policy file can quietly re-version the output every
 * downstream script parses.
 */
const OUTPUT_SCHEMA_VERSION = 1;

const SYNOPSIS = `factory <verb> [args] [${JSON_FLAG}]`;
const KNOWN_FLAGS = new Set([JSON_FLAG, "--help", "-h"]);

/**
 * @param {string[]} argv arguments after the program name
 * @param {object} context the invocation's process facts, injectable so a test
 *   drives a real repository, a real agent directory, and a real package without
 *   inheriting the ones the test runner happens to be standing in
 * @param {string} context.cwd
 * @param {string | null} [context.agentDir] §4.1's state root; the pi SDK's by default
 * @param {string} [context.executable] the running binary — §11.7's anchor
 * @param {Record<string, string | undefined>} [context.env]
 * @param {object} [context.probes] the §5.3 probe registry
 * @param {(options: object) => Promise<object>} [context.herdr] §10.3's Herdr
 *   availability probe, injectable for the same reason `probes` is: a test drives
 *   both answers without a terminal multiplexer on the machine
 * @param {{ pi?: object, claude?: object }} [context.workerTransports] the §6.2
 *   runtime probes' IO, injectable for the same reason `herdr` is
 * @param {object} [context.signal] the event target §10.5's signals listen on —
 *   `process` by default, injectable so a test fires a signal at a chosen moment
 *   instead of racing a real delivery against a run that lasts milliseconds
 * @returns {Promise<{ exitCode: number, value: object, json: boolean }>}
 */
export async function runCli(argv, context) {
	const parsed = parseArgv(argv);
	// Even a refusal to parse the rest of the line is rendered in the shape the
	// caller asked for, so `--json` is read before anything can reject.
	return { json: parsed.json, ...(await dispatch(parsed, context)) };
}

async function dispatch(parsed, context) {
	if (parsed.error) return failure(null, parsed.error, EXIT_USAGE, { usage: shortUsage() });

	if (parsed.help) return help();

	const verb = parsed.verb === null ? null : VERB_TABLE[parsed.verb];

	// Flags are judged before the verb is: a line that gets both wrong should
	// still name the flag it could not read, rather than reporting only that a
	// verb was missing.
	const unknownFlag = parsed.flags.find((flag) => !KNOWN_FLAGS.has(flag) && verb?.flags?.[flag] === undefined);
	if (unknownFlag !== undefined) {
		return failure(
			parsed.verb,
			{ kind: "usage", message: `Unknown flag "${unknownFlag}".`, flag: unknownFlag },
			EXIT_USAGE,
			{ usage: shortUsage() },
		);
	}

	// A flag's *shape* is judged with the flag, and before the verb runs: a
	// `--run` typed without its value would otherwise reach a handler as "no run
	// was named", which is a different invocation — the whole repository instead
	// of one run — and the operator would read the answer to a question they did
	// not ask.
	const misshapen = parsed.flags
		.map((flag) => [flag, verb?.flags?.[flag]])
		.find(([flag, declared]) => {
			if (declared === undefined) return false;
			// The two mistakes are one rule read in both directions: a flag that
			// declares a value must carry one, and a flag that declares none must not.
			return (declared.value !== undefined) !== parsed.values.has(flag);
		});
	if (misshapen !== undefined) {
		const [flag, declared] = misshapen;
		return failure(
			parsed.verb,
			{
				kind: "usage",
				message:
					declared.value === undefined
						? `"${flag}" takes no value.`
						: `"${flag}" takes its value as ${flag}=<${declared.value}>.`,
				flag,
			},
			EXIT_USAGE,
			{ usage: shortUsage() },
		);
	}

	if (parsed.verb === null) {
		return failure(
			null,
			{ kind: "usage", message: `No verb given. ${SYNOPSIS}` },
			EXIT_USAGE,
			{ usage: shortUsage() },
		);
	}

	if (verb === undefined) {
		return failure(
			null,
			{ kind: "usage", message: `Unknown verb "${parsed.verb}".`, verb: parsed.verb },
			EXIT_USAGE,
			{ usage: shortUsage() },
		);
	}

	let loaded = null;
	if (verb.requiresConfig) {
		try {
			// §11.5's per-run selector, read here because the load is what it
			// changes: a verb handler could not apply it without loading the config
			// a second time. A verb that does not declare the flag never reaches
			// this line with one — an undeclared flag refused as unknown above — so
			// the value is read without asking which verb is running.
			loaded = loadFactoryConfig({
				cwd: context.cwd,
				routingSet: parsed.values.get(ROUTING_SET_FLAG) ?? null,
			});
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

	// A flag whose subsystem has not landed refuses **before** the verb runs, so
	// nobody reads a report that silently left out what they asked for.
	const unbuilt = parsed.flags.map((flag) => [flag, verb.flags?.[flag]]).find(([, declared]) => declared?.missing);
	if (unbuilt !== undefined) {
		return notImplemented(parsed, `factory ${parsed.verb} ${unbuilt[0]}`, unbuilt[1]);
	}

	if (verb.handler !== undefined) return run(parsed, verb, loaded, context);

	return notImplemented(parsed, `factory ${parsed.verb}`, verb);
}

/**
 * Every handler is handed the same invocation — the process facts plus what the
 * config settled — and destructures what it needs. One shape means a new verb
 * is a table row rather than a row and a branch, and a handler that grows a
 * dependency does not change its caller.
 *
 * A handler may name its own `exitCode`, because `start` answers with a run's
 * end reason and §10.3 publishes what each of those exits with. **`ok` tracks
 * that exit code rather than "a report was produced"**: §10.3's whole warning is
 * that `factory start && next-thing` must not read a circuit-breaker exit as
 * success, and an envelope saying `ok: true` beside exit 5 is that same
 * misreading handed to every `--json` consumer instead of to the shell. A run
 * that ended `baseline-red` still prints its report — it is a report about a
 * failure, and `error` stays absent because nothing refused.
 */
async function run(parsed, verb, loaded, context) {
	const answered = await verb.handler({
		// `loaded` is null for the one verb §11.8 exempts from the load, and every
		// config-derived field is null with it — `migrate` reads the file this
		// binary could not load, from `cwd`, which is why the invocation directory
		// is handed over beside the settled config rather than instead of it.
		cwd: context.cwd,
		repoRoot: loaded?.repoRoot ?? null,
		configPath: loaded?.configPath ?? null,
		config: loaded?.config ?? null,
		activeRouting: loaded?.activeRouting ?? null,
		declared: loaded?.declared ?? null,
		agentDir: context.agentDir ?? null,
		executable: context.executable,
		env: context.env,
		probes: context.probes,
		herdr: context.herdr,
		workerTransports: context.workerTransports,
		signal: context.signal,
		runHerdr: context.runHerdr,
		// §5.1's read client, injectable for the same reason `probes` and `herdr`
		// are: a suite drives real tracker answer shapes without a Gitea, and the
		// default is built from the config the verb was handed.
		tracker: context.tracker,
		trackerWriter: context.trackerWriter,
		// Focused controller tests may override or explicitly disable the ticket
		// pipeline; ordinary CLI contexts omit these and select #147's production
		// composition in `runStart`.
		pipeline: context.pipeline,
		frontier: context.frontier,
		execute: context.execute,
		expect: loaded?.config.package?.expect ?? null,
		args: parsed.args,
		flags: new Set(parsed.flags),
		// The values beside the flags rather than folded into them, so a handler
		// asking "was this flag given" and one asking "what did it say" read two
		// different structures and cannot confuse an absent flag with an empty one.
		flagValues: parsed.values,
	});

	if (answered.error !== undefined) {
		return failure(parsed.verb, answered.error, answered.exitCode ?? EXIT_REFUSED, { args: parsed.args });
	}

	const exitCode = answered.exitCode ?? EXIT_OK;
	return {
		exitCode,
		value: {
			schema_version: OUTPUT_SCHEMA_VERSION,
			command: parsed.verb,
			ok: exitCode === EXIT_OK,
			exit_code: exitCode,
			message: answered.message,
			report: answered.report,
		},
	};
}

function notImplemented(parsed, what, declared) {
	return failure(
		parsed.verb,
		{
			kind: "not-implemented",
			message: `${what} is specified but not built in this package.`,
			missing: declared.missing,
			spec: declared.spec,
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

	// The branch is on **whether something refused**, not on `ok`. A run that
	// ended `baseline-red` is `ok: false` and still has a whole report to print;
	// switching on `ok` would replace it with an error section that does not
	// exist.
	if (value.error === undefined) {
		lines.push(value.message);
		if (value.report !== undefined) lines.push(...renderReport(value.report));
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
				const flags = value.usage.flags?.[name];
				const takes = flags === undefined ? "" : ` [${flags.join(" ")}]`;
				lines.push(`    ${name.padEnd(width)}  ${value.usage.summaries[name]}${takes}`);
			}
		}
	}

	return `${lines.join("\n")}\n`;
}

/**
 * The token sort every invocation goes through: verb, positionals, flags, and
 * the values riding them.
 *
 * Exported for one reason — #213's relaunched line has to be read back by the
 * same reader the pane's controller will read it with. A suite that re-derived
 * "a token starting with `-` is a flag" would agree with itself while the two
 * processes disagreed, which is the failure that ticket is about.
 *
 * @param {string[]} argv arguments after the program name
 */
export function parseArgv(argv) {
	const args = [];
	const flags = [];
	const values = new Map();
	const json = argv.includes(JSON_FLAG);
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
			// Which flags are legal depends on the verb, and the verb may follow
			// them on the line — so they are collected here and judged once the
			// verb is known.
			//
			// A value rides the flag as `--name=value` rather than as the next
			// token, because the verb is not known yet and a flag that consumed
			// whatever followed it would have to guess whether that word was its
			// value or the verb's argument — and `cleanup-execute <digest> --run=…`
			// is exactly a line where both are present.
			const split = token.indexOf("=");
			const name = split === -1 ? token : token.slice(0, split);
			flags.push(name);
			if (split !== -1) values.set(name, token.slice(split + 1));
			if (token === "--help" || token === "-h") help = true;
			continue;
		}

		if (verb === null) verb = token;
		else args.push(token);
	}

	return { json, verb, args, flags, values, help };
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
				// A flag an operator can type is a flag `--help` names. Only the
				// verbs that take one appear here.
				// Rendered as an operator would type them, values included: a help
				// listing that printed a bare `--run` for a flag that refuses the bare
				// form is a help listing that teaches the refusal.
				flags: Object.fromEntries(
					Object.entries(VERB_TABLE)
						.filter(([, verb]) => verb.flags !== undefined)
						.map(([name, verb]) => [
							name,
							Object.entries(verb.flags).map(([flag, declared]) =>
								declared.value === undefined ? flag : `${flag}=<${declared.value}>`,
							),
						]),
				),
			},
		},
	};
}

function failure(command, error, exitCode, extra = {}) {
	// `exit_code` rides the envelope on both paths, so a `--json` consumer reads
	// the same verdict the shell does without having to have been the shell.
	const value = { schema_version: OUTPUT_SCHEMA_VERSION, command, ok: false, exit_code: exitCode, error };
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
