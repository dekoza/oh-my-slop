import { AGENT_BORNE_PHASES, PHASE_REVIEW } from "../domain/vocabulary.mjs";
import { FactoryConfigError } from "./errors.mjs";
import {
	IDENTIFIER_PATTERN,
	requireArray,
	requireDeclared,
	requireInteger,
	requireNoUnknownKeys,
	requireNonEmptyString,
	requireObject,
	requireOneOf,
} from "./shape.mjs";

/**
 * The mechanical checks (§8.2, §11.6). An ordered list of named commands the
 * controller reruns itself; the config is the only place they are ever declared,
 * because §8.2 rules out inferring them from `pyproject.toml`, `package.json`,
 * a Makefile, or `AGENTS.md` prose.
 *
 * Five fields are required. `feeds` is the one optional field: absence is the
 * empty declaration, while a named phase is checked against the agent-borne
 * pipeline vocabulary. `expectedFailureExitCodes` in particular has no default:
 * it is the sole line between "the worker's code failed this check" and "this
 * check is broken", and pytest's 1/2/5, ruff, tsc, and a shell script do not
 * agree on it.
 */

const REQUIRED_CHECK_KEYS = Object.freeze([
	"name",
	"command",
	"timeout",
	"severity",
	"expectedFailureExitCodes",
]);
const CHECK_KEYS = Object.freeze([...REQUIRED_CHECK_KEYS, "feeds"]);

/**
 * Review remains independent (§8.4): its only inputs are the snapshot and diff.
 * Every other agent-borne phase may consume controller-captured advisory output.
 * Derived from the phase vocabulary so the sibling harden slice makes `harden`
 * legal by adding the phase once, not by updating a second list here.
 */
export const FEEDABLE_PHASES = Object.freeze(AGENT_BORNE_PHASES.filter((phase) => phase !== PHASE_REVIEW));

const CHECK_SEVERITIES = Object.freeze(["required", "advisory"]);
const EVERY_CHECK_FIELD = "Every check declares all five fields, none of them defaulted.";

/**
 * @returns {ReadonlyArray<{ name: string, command: string, timeout: number, severity: string, expectedFailureExitCodes: number[], feeds: ReadonlyArray<string> }>}
 */
export function validateChecks(checks, configPath) {
	if (checks.length === 0) {
		throw new FactoryConfigError(
			"missing-key",
			`${configPath} declares no checks. Verification is declared, never discovered (§8.2), so an empty list is a run that attests nothing.`,
			{ file: configPath, at: "checks" },
		);
	}

	const names = new Map();
	return Object.freeze(
		checks.map((check, index) => {
			const validated = validateCheck(check, `checks[${index}]`, configPath);

			const first = names.get(validated.name);
			if (first !== undefined) {
				throw new FactoryConfigError(
					"invalid-value",
					`${configPath}: checks[${index}].name repeats "${validated.name}", already declared at ${first}. A check is identified by its name in every attestation.`,
					{ file: configPath, at: `checks[${index}].name`, found: validated.name, expected: "a name no other check uses" },
				);
			}
			names.set(validated.name, `checks[${index}]`);

			return validated;
		}),
	);
}

function validateCheck(check, at, configPath) {
	requireObject(check, at, configPath, at);
	requireNoUnknownKeys(check, CHECK_KEYS, at, configPath);
	requireExpectedFailureExitCodes(check, at, configPath);

	for (const key of REQUIRED_CHECK_KEYS) {
		requireDeclared(check[key], `${at}.${key}`, configPath, EVERY_CHECK_FIELD);
	}

	const severity = requireOneOf(check.severity, CHECK_SEVERITIES, `${at}.severity`, configPath);
	const feeds = validateFeeds(check.feeds, severity, at, configPath);

	return Object.freeze({
		name: requireCheckName(check.name, `${at}.name`, configPath),
		command: requireNonEmptyString(check.command, `${at}.command`, configPath),
		// **Seconds.** A check's timeout is read by a human beside a test suite's
		// runtime, and a positive integer is the floor: zero would make the runner
		// give up before the process started.
		timeout: requireInteger(check.timeout, `${at}.timeout`, configPath, {
			because: "A check without a mandatory timeout is a run that can hang forever. It is a whole number of seconds.",
		}),
		severity,
		expectedFailureExitCodes: Object.freeze([...check.expectedFailureExitCodes]),
		feeds,
	});
}

/**
 * §8.2's `feeds`: the agent-borne phases an advisory check's captured output
 * reaches. Absent means `[]`; a feed on a required check, an unknown phase, or
 * `review` refuses the config rather than becoming inert policy (§11.6).
 *
 * **It also decides when the check is paid for** — `checks/run.mjs` states the
 * partition and why. There is deliberately no second `phase` key here to get out
 * of step with this one (#211).
 */
function validateFeeds(value, severity, at, configPath) {
	if (value === undefined) return Object.freeze([]);
	requireArray(value, `${at}.feeds`, configPath, `${at}.feeds`);

	if (severity !== "advisory") {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at}.feeds is only valid on an advisory check. Required checks already gate every phase; feeding their output would make the prompt declaration misleading.`,
			{ file: configPath, at: `${at}.feeds`, found: severity, expected: "advisory" },
		);
	}

	const seen = new Set();
	for (const [index, phase] of value.entries()) {
		const path = `${at}.feeds[${index}]`;
		if (typeof phase !== "string" || !FEEDABLE_PHASES.includes(phase)) {
			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: ${path} must name a feedable agent phase (${FEEDABLE_PHASES.join(", ") || "none"}); found ${JSON.stringify(phase ?? null)}. Unknown phases refuse at load (§11.2).`,
				{ file: configPath, at: path, found: phase ?? null, expected: FEEDABLE_PHASES.join("|") },
			);
		}
		if (seen.has(phase)) {
			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: ${path} repeats phase "${phase}".`,
				{ file: configPath, at: path, found: phase, expected: "a phase listed once" },
			);
		}
		seen.add(phase);
	}

	return Object.freeze([...value]);
}

/**
 * A check's name is an identifier, held to the same shape profiles and routing
 * sets are — one identifier rule for the file.
 *
 * It is not cosmetic here: the name reaches an **effect key** and an artifact's
 * discriminator when the runner records that check's output (§4.5, §8.7), and it
 * is what an attestation and every `--json` consumer identify the check by. A
 * name the key grammar cannot carry would be a load-time typo discovered
 * mid-run, on the expensive check nobody thought about.
 */
function requireCheckName(name, path, configPath) {
	if (typeof name === "string" && IDENTIFIER_PATTERN.test(name)) return name;

	throw new FactoryConfigError(
		"invalid-value",
		`${configPath}: ${path} must match ${IDENTIFIER_PATTERN}; found ${JSON.stringify(name ?? null)}. ` +
			"A check's name identifies it in every attestation and in the effect key of its recorded output.",
		{ file: configPath, at: path, found: name ?? null, expected: String(IDENTIFIER_PATTERN) },
	);
}

/**
 * Absence is its own message: an operator who left the field out is being told
 * why no default exists, not merely that a key is missing.
 */
function requireExpectedFailureExitCodes(check, at, configPath) {
	const codes = requireDeclared(
		check.expectedFailureExitCodes,
		`${at}.expectedFailureExitCodes`,
		configPath,
		'A default would silently misclassify infrastructure breakage — "this check is broken" — as worker blame.',
	);

	requireArray(codes, `${at}.expectedFailureExitCodes`, configPath, `${at}.expectedFailureExitCodes`);

	const seen = new Set();
	for (const [index, code] of codes.entries()) {
		const path = `${at}.expectedFailureExitCodes[${index}]`;
		requireInteger(code, path, configPath, {
			min: 1,
			max: 255,
			because: "Exit code 0 is success, so it can never be an expected failure.",
		});
		if (seen.has(code)) {
			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: ${path} repeats exit code ${code}.`,
				{ file: configPath, at: path, found: code, expected: "an exit code listed once" },
			);
		}
		seen.add(code);
	}
}
