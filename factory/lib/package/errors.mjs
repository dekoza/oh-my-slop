/**
 * Handshake refusals (§11.7). Every one of them stops the caller before the
 * first claim: a package the factory cannot anchor, cannot read, or cannot
 * prove is one package is never the package a run executes from.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const PACKAGE_ERROR_REASONS = Object.freeze([
	/**
	 * No `package.json` above the executable, so there is no package root to
	 * resolve the other three participants against — nothing to report on rather
	 * than something wrong to report.
	 */
	"package-root-unresolvable",
	/** A manifest that is not readable JSON, or not a JSON object. */
	"package-manifest-unreadable",
	/**
	 * A `package.expect.version` that is neither a version nor a range this
	 * factory can compare against. Refused rather than treated as "matches
	 * nothing", which would read as a mismatch the operator cannot fix.
	 */
	"package-expect-invalid",
	/**
	 * The handshake's own findings, raised as the automation failure §11.7 owes
	 * them. `doctor` reports the same record without raising (§10.5), which is
	 * why the findings are a value first and an error only when someone is about
	 * to claim a ticket against them.
	 */
	"package-handshake-failed",
]);

export class FactoryPackageError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of PACKAGE_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (at, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!PACKAGE_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown package error reason "${reason}".`);
		}
		this.name = "FactoryPackageError";
		this.reason = reason;
		this.details = details;
	}
}
