import { FactoryConfigError } from "./errors.mjs";
import { requireArray, requireDeclared, requireInteger, requireNoUnknownKeys, requireNonEmptyString, requireObject, requireOneOf } from "./shape.mjs";

/**
 * The mechanical checks (§8.2, §11.6). An ordered list of named commands the
 * controller reruns itself; the config is the only place they are ever declared,
 * because §8.2 rules out inferring them from `pyproject.toml`, `package.json`,
 * a Makefile, or `AGENTS.md` prose.
 *
 * All five fields are required. `expectedFailureExitCodes` in particular has no
 * default: it is the sole line between "the worker's code failed this check" and
 * "this check is broken", and pytest's 1/2/5, ruff, tsc, and a shell script do
 * not agree on it.
 */

const CHECK_KEYS = Object.freeze([
	"name",
	"command",
	"timeout",
	"severity",
	"expectedFailureExitCodes",
]);

const CHECK_SEVERITIES = Object.freeze(["required", "advisory"]);
const EVERY_CHECK_FIELD = "Every check declares all five fields, none of them defaulted.";

/**
 * @returns {ReadonlyArray<{ name: string, command: string, timeout: number, severity: string, expectedFailureExitCodes: number[] }>}
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

	for (const key of CHECK_KEYS) {
		requireDeclared(check[key], `${at}.${key}`, configPath, EVERY_CHECK_FIELD);
	}

	return Object.freeze({
		name: requireNonEmptyString(check.name, `${at}.name`, configPath),
		command: requireNonEmptyString(check.command, `${at}.command`, configPath),
		timeout: requireInteger(check.timeout, `${at}.timeout`, configPath, {
			because: "A check without a mandatory timeout is a run that can hang forever.",
		}),
		severity: requireOneOf(check.severity, CHECK_SEVERITIES, `${at}.severity`, configPath),
		expectedFailureExitCodes: Object.freeze([...check.expectedFailureExitCodes]),
	});
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
