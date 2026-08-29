/**
 * Refusals from §6.7's acceptance matrix — the deep proof that a model loads
 * and *follows* a skill body, run by hand per (harness version × model ×
 * package revision).
 *
 * Every one of them means the matrix could not be **asked**: the contract it
 * judges against was unreadable, or the run was told to prove something the
 * package does not ship. None of them is a model failing the proof — that is a
 * cell verdict, recorded rather than thrown, because a failed cell is the
 * result the matrix exists to record.
 */
export const PROOF_ERROR_REASONS = Object.freeze([
	/** The proof skill ships no contract block, or one missing a field. */
	"contract-unreadable",
	/** The body declares a transform no implemented rule answers. */
	"contract-rule-unknown",
	/** The pinned revision does not ship the entry skill the matrix invokes. */
	"proof-skill-missing",
	/**
	 * The harness binary answered no version string, so there is nothing to
	 * record as the harness this matrix was taken against (§11.7). Every axis of
	 * the matrix has to be nameable or the document names a point nobody can
	 * return to.
	 */
	"harness-unidentified",
]);

export class FactoryProofError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of PROOF_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!PROOF_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown proof error reason "${reason}".`);
		}
		this.name = "FactoryProofError";
		this.reason = reason;
		this.details = details;
	}
}
