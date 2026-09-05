import { NO_REPO_ROOT } from "../cli/no-repo-root.mjs";

/**
 * Config load refusals (§11.2). Every one of them stops the run: the loader
 * never warns and continues, so there is no severity axis here — only a reason
 * the operator can act on.
 */
/**
 * The five §11.2 failures plus the refusals §11.1 adds around them: no repo
 * root, no file, and a remote that does not answer for `tracker.repo`. The last
 * group is §11.5's and §11.6's coherence refusals — a config that is
 * well-formed in every key and still describes a run that cannot happen.
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
	"model-unsupported",
	"routing-overlap",
	"unknown-routing-set",
	"concurrency-ceiling",
	"resource-unsized",
	"resource-unreachable",
]);

// One reason is shared with the verb exempt from this load, and `cli/no-repo-root.mjs`
// is what holds the sharing. The set still spells its wire strings out, so this is
// the direction worth checking: a rename here that left the contract behind would
// surface as an unknown-reason throw the first time a repo-less invocation reached
// the loader — an operator's problem rather than a load-time one.
if (!CONFIG_LOAD_REASONS.includes(NO_REPO_ROOT.reason)) {
	throw new Error(`"${NO_REPO_ROOT.reason}" is the shared repo-less refusal but is not one of §11.2's reasons.`);
}

/**
 * An `invalid-value` refusal bound to one field: `refuse(sentence, expected)`.
 *
 * A field with several ways to be wrong — an endpoint URL, a declared variable
 * name — then states each of them in one sentence instead of in its own
 * seven-line throw, and the `file`/`at`/`found` triple is written once per
 * field rather than once per reason.
 *
 * @param {string} configPath
 * @param {string} at where the offending value is written
 * @param {unknown} found the value itself, for the structured details
 * @returns {(sentence: string, expected: string) => never}
 */
export function invalidValueRefusal(configPath, at, found) {
	return (sentence, expected) => {
		throw new FactoryConfigError("invalid-value", `${configPath}: ${at} ${sentence}`, {
			file: configPath,
			at,
			found,
			expected,
		});
	};
}

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
