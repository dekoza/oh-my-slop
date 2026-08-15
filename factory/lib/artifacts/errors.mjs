/**
 * Artifact refusals (§12.1). Like the store's and the effects', every one of
 * them stops the caller: an artifact the factory cannot address, cannot hash, or
 * cannot tell apart from a different one is never written and never handed back.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const ARTIFACT_ERROR_REASONS = Object.freeze([
	/**
	 * An address outside §12.1's grammar — an algorithm the factory does not
	 * hash with, or a digest that is not one. **This is where a `../` dies**, and
	 * it dies as "that is not a digest" rather than as "that path escapes":
	 * nothing on the artifact surface takes a path to contain (§14.28).
	 */
	"artifact-address-invalid",
	/** Content that is neither bytes nor text, and so cannot be hashed. */
	"artifact-content-invalid",
	/** A producing run, ticket, or attempt outside §2.1's identity charset. */
	"artifact-producer-invalid",
	/** A media type outside the `type/subtype` shape the ledger records. */
	"artifact-media-type-invalid",
	/** The same bytes offered under a second media type; one digest, one row. */
	"artifact-media-type-conflict",
	/** A producing role outside §12.1's closed contents list. */
	"artifact-role-unknown",
	/** A discriminator that is not a short natural name. */
	"artifact-name-invalid",
	/**
	 * A read of an artifact whose blob is gone — expired, deleted, or failing its
	 * own re-hash. Distinct from the next one: §12.5 requires that expired and
	 * never-existed never look alike.
	 */
	"artifact-unavailable",
	/** A digest the ledger has never recorded (§12.5). */
	"artifact-unknown",
]);

export class FactoryArtifactError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of ARTIFACT_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (at, digest, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!ARTIFACT_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown artifact error reason "${reason}".`);
		}
		this.name = "FactoryArtifactError";
		this.reason = reason;
		this.details = details;
	}
}
