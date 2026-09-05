import { requireDeclarableEnvName, requireDeclarableEnvValue } from "./declared-env.mjs";
import { CAPACITY_MODEL_CLASS_PATTERN } from "../state/leases.mjs";
import { FactoryConfigError, invalidValueRefusal } from "./errors.mjs";
import { IDENTIFIER_PATTERN, requireDeclared, requireExactKeys, requireInteger, requireNoUnknownKeys, requireNonEmptyString, requireObject, requireOneOf } from "./shape.mjs";

/**
 * Worker profiles (§11.4) and the resource class each one derives (§9.1).
 *
 * A profile is `kind` + `model`, plus flags whose omission means "don't pass the
 * flag" — safe because non-passing is a recordable observation in the §11.7
 * handshake, not an inference.
 *
 * A `kind: pi` profile may also bind an `endpoint` — the machine its sessions
 * talk to, and therefore the pool it shares (#209). It is the one profile key
 * the class is derived from; the class itself stays underivable from anything
 * declared, because two profiles on one endpoint must not be talkable into
 * separate pools.
 *
 * `permissionMode` is deliberately absent: permissions derive from the role a
 * profile is bound to at dispatch, so a profile setting `dontAsk` and later being
 * used as a reviewer would silently defeat the read-only guarantee §6.8's
 * mutation attestation rests on.
 */

const PROFILE_KINDS = Object.freeze(["pi", "claude"]);

/** Per kind, because a flag the other harness cannot take is dormant config. */
const PROFILE_KEYS = Object.freeze({
	pi: Object.freeze(["kind", "model", "thinking", "endpoint", "startupTimeoutMs", "attemptTimeoutMs", "noProgressTimeoutMs"]),
	claude: Object.freeze(["kind", "model", "effort", "startupTimeoutMs", "attemptTimeoutMs", "noProgressTimeoutMs"]),
});

const THINKING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CLAUDE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

const PI_MODEL_PATTERN = /^[^/\s]+\/[^\s]+$/;
const NO_PROFILE_DEFAULTS = "A profile's kind and model are declared, never inferred from the other.";

/**
 * §11.4's per-profile endpoint binding (#209): the variable a pi session
 * carries, and the address it names.
 *
 * Both halves are required because either alone binds nothing — a variable with
 * no address exports emptiness, and an address no variable carries reaches no
 * process. The variable is declared rather than assumed because the name
 * belongs to the extension that supplies the provider, and a factory that
 * hard-coded one would be config for exactly one extension.
 */
const ENDPOINT_KEYS = Object.freeze(["env", "url"]);

/** The two schemes a model endpoint answers on, and what each implies for the port. */
const DEFAULT_PORTS = Object.freeze({ "http:": "80", "https:": "443" });

/**
 * Opus and Fable are reachable only through the Claude harness. §11.5 makes
 * naming one on a pi profile a load-time error rather than a coercion, because
 * silently rewriting a declared model is the run behaving differently from what
 * the operator can read on disk.
 */
const CLAUDE_ONLY_MODEL_PATTERN = /(^|[^a-z0-9])(opus|fable)([^a-z0-9]|$)/i;

/** §9.1: the constant class every Claude profile shares — one harness, one pool. */
export const CLAUDE_RESOURCE_CLASS = "claude-code";

/**
 * The namespace an endpoint-derived class name lives in, reserved against pi's
 * provider segments so the two kinds of class can never collide into one pool.
 */
const ENDPOINT_CLASS_PREFIX = "endpoint-";

/**
 * The class that arbitrates a profile's slot. Derived, never declared per
 * profile: two pi profiles naming different presets on one endpoint then
 * correctly share a pool, because they share one GPU.
 *
 * **A pool is a machine, so the class is the endpoint a profile talks to**
 * (#209). The provider segment is what that comes to when a profile binds no
 * endpoint of its own: one prefix then fronts exactly one address — pi's own —
 * and prefix and endpoint name the same pool. It stops being true the moment a
 * second box answers to `local`, and a class derived from the prefix would then
 * let two attempts land on one GPU, which is the over-subscription the class
 * exists to prevent.
 *
 * Hosted providers bind no endpoint, and that is not an omission: for Claude
 * and for OpenRouter the pool is an account quota rather than a machine, and
 * `claude-code` and `openrouter` already name it.
 *
 * @param {{ kind: string, model: string, endpoint?: { env: string, url: string } }} profile
 * @returns {string}
 */
export function resourceClassOf(profile) {
	if (profile.kind === "claude") return CLAUDE_RESOURCE_CLASS;
	return profile.endpoint === undefined ? providerOf(profile.model) : endpointClass(profile.endpoint.url);
}

/**
 * The pi provider a model selector names. It is the class only when nothing is
 * bound, so anything asking about the **model catalogue** — the live inventory
 * a probe reads — asks for this and never for the class (#209).
 *
 * @param {string} model
 * @returns {string}
 */
export function providerOf(model) {
	return model.split("/")[0];
}

/**
 * One address, as a class name: host and port, with the port the scheme implies
 * when the URL leaves it out, so `http://rico` and `http://rico:80` are one
 * pool rather than two.
 *
 * The scheme is deliberately not part of the name — `http` and `https` to one
 * host and port are one machine, and one machine is one GPU. The name has to
 * survive §9.4's `capacity:model:<class>:<i>` row grammar being read back, which
 * is why `validateEndpoint` refuses a URL whose host this cannot spell rather
 * than mangling one into it.
 *
 * @param {string} url
 * @returns {string}
 */
function endpointClass(url) {
	const address = new URL(url);
	return `${ENDPOINT_CLASS_PREFIX}${address.hostname}-${address.port || DEFAULT_PORTS[address.protocol]}`;
}

/**
 * Which classes a set of profiles puts in play, and through which profiles.
 *
 * The loader asks it of every declared routing to answer §11.6's reachability
 * rules; §9.1's capacity plan asks it of the active one to size the pools. One
 * implementation, because a class the loader sized and the scheduler did not
 * arbitrate over — or the reverse — is exactly the drift both checks exist to
 * prevent.
 *
 * @param {Record<string, object>} profiles the validated profile table
 * @param {Iterable<string>} profileNames
 * @returns {Map<string, Set<string>>} class → the profiles that put it in play
 */
export function classesReachedBy(profiles, profileNames) {
	const classes = new Map();
	for (const name of profileNames) {
		const className = resourceClassOf(profiles[name]);
		if (!classes.has(className)) classes.set(className, new Set());
		classes.get(className).add(name);
	}

	return classes;
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
		requirePiModel(name, model, at, configPath, profile.endpoint !== undefined);
		if (profile.thinking !== undefined) {
			validated.thinking = requireOneOf(profile.thinking, THINKING_LEVELS, `${at}.thinking`, configPath);
		}
		if (profile.endpoint !== undefined) {
			validated.endpoint = validateEndpoint(profile.endpoint, `${at}.endpoint`, configPath);
		}
	} else if (profile.effort !== undefined) {
		validated.effort = requireOneOf(profile.effort, CLAUDE_EFFORTS, `${at}.effort`, configPath);
	}

	if (profile.startupTimeoutMs !== undefined) {
		validated.startupTimeoutMs = requireInteger(profile.startupTimeoutMs, `${at}.startupTimeoutMs`, configPath);
	}

	// §6.6's two clocks, declared per profile because the honest ceiling and the
	// honest no-progress window both differ by model and role; absent, the
	// lifecycle's code-owned defaults apply — an unset deadline would make the
	// timeout row unreachable (#150).
	if (profile.attemptTimeoutMs !== undefined) {
		validated.attemptTimeoutMs = requireInteger(profile.attemptTimeoutMs, `${at}.attemptTimeoutMs`, configPath);
	}
	if (profile.noProgressTimeoutMs !== undefined) {
		validated.noProgressTimeoutMs = requireInteger(profile.noProgressTimeoutMs, `${at}.noProgressTimeoutMs`, configPath);
	}

	return Object.freeze(validated);
}

/**
 * The address one profile's sessions talk to, and the variable that carries it.
 *
 * The URL is judged here rather than at launch because §9.1's class name is
 * derived from it: a host the name cannot spell would otherwise be discovered
 * as an unparseable capacity row mid-run, and a class whose row cannot be read
 * back leaks its slots on recovery (§9.4).
 */
function validateEndpoint(endpoint, at, configPath) {
	requireObject(endpoint, at, configPath, at);
	requireExactKeys(endpoint, ENDPOINT_KEYS, at, configPath);

	return Object.freeze({
		env: requireDeclarableEnvName(endpoint.env, `${at}.env`, configPath),
		url: requireEndpointUrl(endpoint.url, `${at}.url`, configPath),
	});
}

function requireEndpointUrl(value, at, configPath) {
	requireDeclarableEnvValue(value, at, configPath);
	const refuse = invalidValueRefusal(configPath, at, value);

	let address;
	try {
		address = new URL(value);
	} catch {
		refuse(`is not an absolute URL; found "${value}".`, "an absolute http or https URL");
	}

	if (!Object.hasOwn(DEFAULT_PORTS, address.protocol)) {
		refuse(`must name an endpoint over http or https; found "${address.protocol}".`, "an http or https URL");
	}
	if (address.username !== "" || address.password !== "") {
		refuse(
			`carries a credential in its userinfo, and the endpoint is recorded in the run manifest as evidence of ` +
				`which machine ran the attempt. Credentials cross only as §6.8's promoted capability artifacts.`,
			"an address with no userinfo",
		);
	}
	if (!CAPACITY_MODEL_CLASS_PATTERN.test(address.hostname)) {
		refuse(
			`names a host §9.1 cannot derive a class name from ("${address.hostname}"): the name becomes a segment of ` +
				`§9.4's "capacity:model:<class>:<i>" row, which is read back on recovery. Name the host the way the row ` +
				`grammar can spell it (${CAPACITY_MODEL_CLASS_PATTERN}) rather than by an address it cannot.`,
			`a host matching ${CAPACITY_MODEL_CLASS_PATTERN}`,
		);
	}

	return value;
}

function requirePiModel(name, model, at, configPath, endpointBound) {
	if (!PI_MODEL_PATTERN.test(model)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at}.model must be an exact provider/model selector, because §9.1 derives the resource class from its provider segment when the profile binds no endpoint of its own; found "${model}".`,
			{ file: configPath, at: `${at}.model`, found: model, expected: "provider/model" },
		);
	}

	const provider = providerOf(model);
	if (!endpointBound && !CAPACITY_MODEL_CLASS_PATTERN.test(provider)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at}.model names provider segment "${provider}", which §9.1 derives as the resource class ` +
				`when the profile binds no endpoint. It cannot be spelled by §9.4's capacity:model:<class>:<i> row ` +
				`grammar (${CAPACITY_MODEL_CLASS_PATTERN}), so recovery could not read its slot back. Rename the provider in ` +
				`pi's model catalogue to use letters, digits, "." and "-", or bind the profile's endpoint so §9.1 derives ` +
				"the class from that endpoint instead.",
			{
				file: configPath,
				at: `${at}.model`,
				found: provider,
				expected: `a provider segment matching ${CAPACITY_MODEL_CLASS_PATTERN}, or a bound endpoint`,
			},
		);
	}

	// The derived-class namespace is reserved: a provider spelled into it would
	// share a pool with whichever machine derives the same name, which is the
	// silent over-subscription endpoint-derived classes exist to end (#209).
	if (model.startsWith(ENDPOINT_CLASS_PREFIX)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at}.model names provider "${providerOf(model)}", and "${ENDPOINT_CLASS_PREFIX}…" is the namespace §9.1 derives an endpoint-bound profile's resource class in. A provider inside it could silently share a pool with a machine; declare the profile's endpoint instead.`,
			{ file: configPath, at: `${at}.model`, found: model, expected: `a provider outside "${ENDPOINT_CLASS_PREFIX}…"` },
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
