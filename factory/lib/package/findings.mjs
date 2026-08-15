/**
 * What the handshake found wrong, as data.
 *
 * A finding is **not** an exception, because §10.5's `doctor` runs the same
 * handshake in report mode: probing is a read, and an operator diagnosing a
 * broken install needs the whole picture rather than the first thing that threw.
 * Preflight is what turns a non-empty finding list into §11.7's automation
 * failure before the first claim (`assertPackageIntact`).
 */

/**
 * The closed set, so `--json` consumers — the monitor, an operator's script —
 * can branch on a reason rather than on a sentence.
 */
export const HANDSHAKE_FINDING_REASONS = Object.freeze([
	/**
	 * A participant the package does not declare, or declares and does not ship.
	 * The monitor extension is the one participant whose absence is legal (§11.7
	 * says "when present"), so its absence is never this.
	 */
	"participant-missing",
	/**
	 * §14.35: the binary, both extensions, and the skills root resolved to
	 * different package roots. This is the audited split-brain — a package
	 * declaring one version while the thing that runs comes from a separate
	 * install — and it is a hard failure rather than an inferred compatibility
	 * pass.
	 */
	"package-root-split",
	/**
	 * The `factory` an operator gets is not the one this package declares. The
	 * same split-brain arriving through `PATH` rather than through a directory
	 * layout, and the reason §11.7 records the resolved `PATH` entry *and* its
	 * realpath rather than either alone.
	 */
	"binary-shadowed",
	/** The optional `package.expect.name` is not the package that resolved. */
	"package-name-mismatch",
	/** The resolved version is outside `package.expect.version`. */
	"package-version-mismatch",
]);

/**
 * @param {string} reason one of HANDSHAKE_FINDING_REASONS
 * @param {string} message operator-facing sentence naming what is wrong
 * @param {Record<string, unknown>} [details] JSON-safe structured fields; the
 *   record is hashed as an artifact, so `undefined` is never one of them
 * @returns {Readonly<object>}
 */
export function finding(reason, message, details = {}) {
	if (!HANDSHAKE_FINDING_REASONS.includes(reason)) {
		throw new Error(`Unknown handshake finding reason "${reason}".`);
	}

	return Object.freeze({ reason, message, ...details });
}
