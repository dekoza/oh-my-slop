import { FactoryConfigError, invalidValueRefusal } from "./errors.mjs";

/**
 * What a config may declare as a worker process's environment, in one place.
 *
 * Two blocks declare one: §6.8's `worker.piExtensions[].env` promotes a
 * capability's variables into every pi session, and §11.4's per-profile
 * `endpoint` binds one variable on the sessions of a single profile (#209).
 * They are the same decision — the operator naming a variable a worker process
 * will carry — so they are judged by one predicate rather than by two spellings
 * that agree until one of them is edited.
 */

/** The variables the launch declares on a worker pane's tab (§6.5's channel). */
const RESERVED_ENV_NAMES = Object.freeze(["PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR", "HOME", "PATH"]);
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SECRET_SHAPED = /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY/;

/**
 * A name a declaration may bind.
 *
 * **A secret-shaped name is refused because it has a channel and this is not
 * it** — §6.8's promoted capability artifacts — not because of where the value
 * would be displayed. Since #157 the set is declared on the pane's tab rather
 * than typed at its shell, so it no longer enters the scrollback; it does still
 * become the worker process's environment, readable by any same-user process,
 * which is the bound §6.8 already records for ambient credentials on this host.
 * A refusal reason that named the scrollback would now be a false explanation
 * of a correct refusal.
 *
 * The isolation and identity variables are refused too — the binding would win
 * anyway (it spreads them last), but a declaration that silently loses is
 * worse than one that is refused with the reason.
 *
 * @param {string} name
 * @param {string} at where the name is written, for the refusal
 * @param {string} configPath
 * @returns {string} the name, once it is one a worker may carry
 * @throws {FactoryConfigError}
 */
export function requireDeclarableEnvName(name, at, configPath) {
	const refuse = invalidValueRefusal(configPath, at, name);

	if (typeof name !== "string" || !ENV_NAME_PATTERN.test(name)) {
		refuse(`is not a portable environment variable name (${ENV_NAME_PATTERN}).`, "an UPPER_SNAKE_CASE name");
	}
	if (RESERVED_ENV_NAMES.includes(name) || name.startsWith("FACTORY_")) {
		refuse(
			`names a variable the controller owns: the isolation and identity channels are not declarable (§6.5, §6.8).`,
			"a name outside the controller-owned set",
		);
	}
	if (SECRET_SHAPED.test(name)) {
		refuse(
			`looks like a credential, and a declared value becomes the worker process's environment, readable by any ` +
				`same-user process. Credentials cross only as §6.8's promoted capability artifacts.`,
			"a non-secret capability value, such as an endpoint URL",
		);
	}

	return name;
}

/**
 * A value a declaration may bind. It is recorded in the run manifest and
 * printed in operator reports, where an empty value declares nothing and a
 * control character is unreadable.
 *
 * @param {unknown} value
 * @param {string} at
 * @param {string} configPath
 * @returns {string}
 * @throws {FactoryConfigError}
 */
export function requireDeclarableEnvValue(value, at, configPath) {
	if (typeof value !== "string" || value === "" || /[\p{Cc}]/u.test(value)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at} must be a non-empty single-line string. It is recorded in the run manifest and ` +
				`printed in operator reports, where an empty value declares nothing and a control character is unreadable.`,
			{ file: configPath, at, found: typeof value, expected: "a non-empty string without control characters" },
		);
	}

	return value;
}
