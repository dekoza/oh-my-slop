import { FactoryConfigError } from "./errors.mjs";
import { IDENTIFIER_PATTERN, requireDeclared, requireInteger, requireNoUnknownKeys, requireNonEmptyString, requireObject, requireOneOf } from "./shape.mjs";

/**
 * Worker profiles (§11.4) and the resource class each one derives (§9.1).
 *
 * A profile is `kind` + `model`, plus flags whose omission means "don't pass the
 * flag" — safe because non-passing is a recordable observation in the §11.7
 * handshake, not an inference.
 *
 * `permissionMode` is deliberately absent: permissions derive from the role a
 * profile is bound to at dispatch, so a profile setting `dontAsk` and later being
 * used as a reviewer would silently defeat the read-only guarantee §6.8's
 * mutation attestation rests on.
 */

const PROFILE_KINDS = Object.freeze(["pi", "claude"]);

/** Per kind, because a flag the other harness cannot take is dormant config. */
const PROFILE_KEYS = Object.freeze({
	pi: Object.freeze(["kind", "model", "thinking", "startupTimeoutMs"]),
	claude: Object.freeze(["kind", "model", "effort", "startupTimeoutMs"]),
});

const THINKING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CLAUDE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

const PI_MODEL_PATTERN = /^[^/\s]+\/[^\s]+$/;
const NO_PROFILE_DEFAULTS = "A profile's kind and model are declared, never inferred from the other.";

/**
 * Opus and Fable are reachable only through the Claude harness. §11.5 makes
 * naming one on a pi profile a load-time error rather than a coercion, because
 * silently rewriting a declared model is the run behaving differently from what
 * the operator can read on disk.
 */
const CLAUDE_ONLY_MODEL_PATTERN = /(^|[^a-z0-9])(opus|fable)([^a-z0-9]|$)/i;

/** §9.1: the constant class every Claude profile shares — one harness, one pool. */
const CLAUDE_RESOURCE_CLASS = "claude-code";

/**
 * The class that arbitrates a profile's slot. Derived, never declared per
 * profile: two pi profiles naming different presets on one endpoint then
 * correctly share a pool, because they share one GPU.
 *
 * @param {{ kind: string, model: string }} profile
 * @returns {string}
 */
export function resourceClassOf(profile) {
	return profile.kind === "claude" ? CLAUDE_RESOURCE_CLASS : profile.model.split("/")[0];
}

/** @returns {Readonly<Record<string, object>>} */
export function validateProfiles(profiles, configPath) {
	const names = Object.keys(profiles);
	if (names.length === 0) {
		throw new FactoryConfigError(
			"missing-key",
			`${configPath} declares no profiles; routing has nothing to name.`,
			{ file: configPath, at: "profiles" },
		);
	}

	return Object.freeze(
		Object.fromEntries(names.map((name) => [name, validateProfile(name, profiles[name], configPath)])),
	);
}

function validateProfile(name, profile, configPath) {
	const at = `profiles.${name}`;
	requireObject(profile, at, configPath, at);

	if (!IDENTIFIER_PATTERN.test(name)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at} is not a usable profile name; use lower-case letters, digits, "-" or "_", starting with a letter.`,
			{ file: configPath, at, found: name, expected: String(IDENTIFIER_PATTERN) },
		);
	}

	refusePermissionMode(profile, at, configPath);

	const kind = requireOneOf(
		requireDeclared(profile.kind, `${at}.kind`, configPath, NO_PROFILE_DEFAULTS),
		PROFILE_KINDS,
		`${at}.kind`,
		configPath,
	);
	requireNoUnknownKeys(profile, PROFILE_KEYS[kind], at, configPath);

	const model = requireNonEmptyString(
		requireDeclared(profile.model, `${at}.model`, configPath, NO_PROFILE_DEFAULTS),
		`${at}.model`,
		configPath,
	);

	const validated = { kind, model };
	if (kind === "pi") {
		requirePiModel(name, model, at, configPath);
		if (profile.thinking !== undefined) {
			validated.thinking = requireOneOf(profile.thinking, THINKING_LEVELS, `${at}.thinking`, configPath);
		}
	} else if (profile.effort !== undefined) {
		validated.effort = requireOneOf(profile.effort, CLAUDE_EFFORTS, `${at}.effort`, configPath);
	}

	if (profile.startupTimeoutMs !== undefined) {
		validated.startupTimeoutMs = requireInteger(profile.startupTimeoutMs, `${at}.startupTimeoutMs`, configPath);
	}

	return Object.freeze(validated);
}

function requirePiModel(name, model, at, configPath) {
	if (!PI_MODEL_PATTERN.test(model)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at}.model must be an exact provider/model selector, because §9.1 derives the resource class from its provider segment; found "${model}".`,
			{ file: configPath, at: `${at}.model`, found: model, expected: "provider/model" },
		);
	}

	if (CLAUDE_ONLY_MODEL_PATTERN.test(model)) {
		throw new FactoryConfigError(
			"model-unsupported",
			`${configPath}: profile "${name}" names "${model}" on a kind: pi profile. Opus and Fable are reachable only as kind: claude, and the loader refuses rather than coercing the profile to a model the operator did not write.`,
			{ file: configPath, at: `${at}.model`, profile: name, found: model, expected: "kind: claude" },
		);
	}
}

/**
 * A profile carrying `permissionMode` is answered by name rather than by the
 * generic unknown-key sentence: the author is making a permissions decision the
 * dispatch role owns, and needs to be told where that decision moved.
 */
function refusePermissionMode(profile, at, configPath) {
	if (profile.permissionMode === undefined) return;
	throw new FactoryConfigError(
		"unknown-key",
		`${configPath} declares "${at}.permissionMode", which is not author-controllable: permissions derive from the role a profile is bound to at dispatch (§11.4), and altering them requires a declared per-run override that can never cross §6.8's hard floor.`,
		{ file: configPath, at: `${at}.permissionMode` },
	);
}
