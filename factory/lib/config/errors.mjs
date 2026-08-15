/**
 * Config load refusals (§11.2). Every one of them stops the run: the loader
 * never warns and continues, so there is no severity axis here — only a reason
 * the operator can act on.
 */
/**
 * The five §11.2 failures plus the refusals §11.1 adds around them: no repo
 * root, no file, and a remote that does not answer for `tracker.repo`.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const CONFIG_LOAD_REASONS = Object.freeze([
	"no-repo-root",
	"file-missing",
	"unreadable",
	"parse-error",
	"schema-version",
	"unknown-key",
	"missing-key",
	"invalid-value",
	"todo-sentinel",
	"remote-unresolvable",
	"remote-mismatch",
]);

export class FactoryConfigError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of CONFIG_LOAD_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (file, at, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!CONFIG_LOAD_REASONS.includes(reason)) {
			throw new Error(`Unknown config load reason "${reason}".`);
		}
		this.name = "FactoryConfigError";
		this.reason = reason;
		this.details = details;
	}
}
