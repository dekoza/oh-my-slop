/**
 * Durable-state refusals (§4.1, §4.4, §4.7). Like the config loader's, every
 * one of them stops the caller: the store never warns and continues, and a
 * projection is never rendered from a head it could not verify.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const STATE_ERROR_REASONS = Object.freeze([
	/** The database file could not be opened or created (§4.1). */
	"store-unopenable",
	/** A store written by a different schema version (§4.1). */
	"store-schema-version",
	/** A slug collision whose hashed spelling is also somebody else's (§4.1). */
	"repo-path-mismatch",
	/** A projection head that does not match the journal head (§4.4). */
	"projection-head-mismatch",
	/** A projection built by a different projector version (§4.4). */
	"projector-version-change",
	/** An envelope that violates §4.3 — refused before it can be chained. */
	"invalid-event",
	/** A transaction misuse: nesting, or a write outside one (§4.4). */
	"invalid-transaction",
	/** A lease another holder still holds (§4.6, §10.5). */
	"lease-held",
	/** A compare-and-swap that found this holder's token gone (§4.6, §14.6). */
	"lease-lost",
	/** A hold the holder itself gave up — an orderly end, not §14.6's loss. */
	"lease-released",
	/**
	 * A hold asked to stamp an effect before §5.4's startup reconciliation ran
	 * under it. Resume *is* startup, so the gate is shut until the reconcile
	 * that settles what the last controller left behind has happened.
	 */
	"reconcile-required",
	/** A lease name outside §4.6's closed set of objects. */
	"invalid-lease-name",
	/** A deletion that is neither whole-stream nor front-truncation (§4.2, §14.7). */
	"invalid-truncation",
	/** A damaged database, or a stream whose chain does not verify (§4.7). */
	"journal-integrity-failed",
	/** A rebuild whose reason is outside §4.4's closed five. */
	"invalid-rebuild",
	/**
	 * A projection a reader will not render, because the head it would render
	 * from does not match this build's contract (§4.4, §14.9). Distinct from the
	 * two refusals above on purpose: those stop a store from opening, this one
	 * stops one set of values from being shown while the rest still answer.
	 */
	"projection-unreadable",
]);

export class FactoryStateError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of STATE_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields (store, projection, expected, found)
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!STATE_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown state error reason "${reason}".`);
		}
		this.name = "FactoryStateError";
		this.reason = reason;
		this.details = details;
	}
}
