import { FactoryConfigError } from "./errors.mjs";

/**
 * The shape assertions every block validator shares (§11.2).
 *
 * They exist as one module because "unknown key", "missing key", and "invalid
 * value" are the loader's whole vocabulary of refusal: a block that invents its
 * own phrasing for them is a block whose `--json` reason an operator cannot act
 * on the same way twice.
 */

/** The name shape shared by profiles and routing sets — one identifier rule. */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** Rejects any key outside `allowed`, then any `allowed` key that is absent. */
export function requireExactKeys(block, allowed, blockName, configPath) {
	requireNoUnknownKeys(block, allowed, blockName, configPath);

	for (const key of allowed) {
		requireDeclared(block[key], `${blockName}.${key}`, configPath);
	}
}

/**
 * Absence, answered in one sentence plus whatever the block wants to add about
 * why no default exists. Every "this key has no default" refusal comes through
 * here, so the operator reads the same shape whichever block raised it.
 */
export function requireDeclared(value, path, configPath, because = "") {
	if (value !== undefined) return value;
	throw new FactoryConfigError(
		"missing-key",
		`${configPath} is missing required key "${path}"; it has no default.${because === "" ? "" : ` ${because}`}`,
		{ file: configPath, at: path },
	);
}

export function requireNoUnknownKeys(block, allowed, blockName, configPath) {
	for (const key of Object.keys(block)) {
		if (allowed.includes(key)) continue;
		throw new FactoryConfigError(
			"unknown-key",
			`${configPath} declares unknown key "${blockName}.${key}". The factory never ignores config it does not understand.`,
			{ file: configPath, at: `${blockName}.${key}` },
		);
	}
}

export function requireNonEmptyString(value, path, configPath) {
	if (typeof value === "string" && value.trim() !== "") return value;
	throw new FactoryConfigError("invalid-value", `${configPath}: ${path} must be a non-empty string.`, {
		file: configPath,
		at: path,
		found: value === undefined ? null : typeof value,
		expected: "non-empty string",
	});
}

export function requireObject(value, description, configPath, at) {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
	throw new FactoryConfigError("invalid-value", `${configPath}: ${description} must be a JSON object.`, {
		file: configPath,
		at,
		expected: "object",
		found: describeType(value),
	});
}

export function requireArray(value, description, configPath, at) {
	if (Array.isArray(value)) return value;
	throw new FactoryConfigError("invalid-value", `${configPath}: ${description} must be an array.`, {
		file: configPath,
		at,
		expected: "array",
		found: describeType(value),
	});
}

/** @param {{ min?: number, max?: number, because?: string }} bounds */
export function requireInteger(value, path, configPath, { min = 1, max = Infinity, because = "" } = {}) {
	if (Number.isInteger(value) && value >= min && value <= max) return value;

	const range = max === Infinity ? `an integer of at least ${min}` : `an integer between ${min} and ${max}`;
	throw new FactoryConfigError(
		"invalid-value",
		`${configPath}: ${path} must be ${range}; found ${JSON.stringify(value ?? null)}.${because === "" ? "" : ` ${because}`}`,
		{ file: configPath, at: path, expected: range, found: value ?? null },
	);
}

export function requireOneOf(value, allowed, path, configPath) {
	if (allowed.includes(value)) return value;
	throw new FactoryConfigError(
		"invalid-value",
		`${configPath}: ${path} must be one of ${allowed.join(", ")}; found ${JSON.stringify(value ?? null)}.`,
		{ file: configPath, at: path, expected: allowed.join("|"), found: value ?? null },
	);
}

function describeType(value) {
	if (Array.isArray(value)) return "array";
	if (value === null) return "null";
	return typeof value;
}
