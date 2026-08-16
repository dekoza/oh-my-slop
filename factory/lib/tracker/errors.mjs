/**
 * Tracker-read refusals (§3.1, §3.2, §5.1, §5.2).
 *
 * This subsystem reads a foreign system, and every refusal here exists because
 * the alternative would be a guess about what that system said. §5.2 is blunt
 * about why that matters: the journal records intent and never establishes an
 * external fact, so a tracker read that cannot be trusted must stop the caller
 * rather than hand back a plausible shape.
 *
 * The reason reaches the operator's `--json` output, so it is a closed set the
 * constructor enforces rather than a free string each throw site invents.
 */
export const TRACKER_ERROR_REASONS = Object.freeze([
	/**
	 * The tracker could not be reached, or answered with a status that is not
	 * success. Deliberately not split into "network" and "http": either way this
	 * process learned nothing about the tracker, and a caller that branched on
	 * the difference would be acting on the *shape* of an absence.
	 */
	"tracker-unreachable",
	/**
	 * The tracker answered, and the answer is not one this build can read — a
	 * body that is not JSON, or a record missing the fields a decision rests on.
	 * Separate from unreachable because it is a build problem rather than an
	 * operator's: the remedy is a factory that understands this Gitea, not a
	 * retry.
	 */
	"tracker-answer-invalid",
	/**
	 * A read this subsystem does not declare in §4.5's `READ_OPERATIONS`. Reads
	 * are not effects and get no requested/resolved pair, so that list is the
	 * only inventory of what the factory asks the world; a read outside it is a
	 * read nothing declared.
	 */
	"tracker-read-undeclared",
	/**
	 * A tracker mutation this subsystem does not declare. The mirror of the read
	 * refusal above, and the stricter of the two: a write outside §4.5's
	 * catalogue is a mutation with no effect kind, therefore no probe, therefore
	 * nothing that could ever settle it (§14.3, §5.3).
	 */
	"tracker-write-undeclared",
	/**
	 * The tracker answered without stating its own clock. §3.3 arbitrates a claim
	 * contest and measures staleness against **the tracker's** time, so a process
	 * that does not know it cannot decide either — and substituting the host's
	 * would settle both by the skew between two machines rather than by the facts.
	 */
	"tracker-clock-unknown",
	/** A fact class outside §5.2's closed set. */
	"fact-class-unknown",
	/**
	 * A fact asserted from a source §5.2 does not make authoritative for it.
	 * This is the authority table with teeth: a global ranking always ends up
	 * asserting something the winning source does not know, and the refusal is
	 * where that stops being a paragraph.
	 */
	"fact-source-unauthoritative",
	/**
	 * An observation offered without the foreign system's own stable id. §5.1's
	 * idempotency is *by construction* — re-polling is safe because a fact
	 * carries the id that identifies it — so an id-less fact would quietly make
	 * every poll a duplicate.
	 */
	"observation-unidentified",
	/**
	 * A disposition outside §8.9's four. A ticket execution settles as one of
	 * them, and every one has a tracker action; a fifth word would be a state the
	 * frontier cannot read back and a human cannot clear.
	 */
	"disposition-unknown",
	/**
	 * A disposition filed without what its comment block exists to carry — a
	 * pause with no question, a publication with no PR link, a reason class whose
	 * §14.18 disposition is a different one. Fail-closed rather than posting a
	 * block with a hole in it: the block is what a human acts on, and §11.2's "no
	 * silent guessing" is the same rule applied to the tracker.
	 */
	"disposition-incomplete",
	/**
	 * A scope value outside §3.1's two forms. `parseScope` produces only those
	 * two, but the frontier reader is exported and the scheduler calls it — and a
	 * shape nobody recognises would otherwise be read as a direct-ticket set.
	 */
	"scope-unrecognised",
	/**
	 * A pull request asked for from something other than this ticket's own attempt
	 * branch (§7.3, §14.11). §7.5 publishes one branch and one only, and a factory
	 * that opened a PR from a branch it did not build would be publishing work it
	 * never verified.
	 */
	"pull-unpublishable",
]);

export class FactoryTrackerError extends Error {
	/**
	 * @param {string} reason machine-readable cause, one of TRACKER_ERROR_REASONS
	 * @param {string} message operator-facing sentence naming what is wrong
	 * @param {Record<string, unknown>} [details] extra structured fields
	 */
	constructor(reason, message, details = {}) {
		super(message);
		if (!TRACKER_ERROR_REASONS.includes(reason)) {
			throw new Error(`Unknown tracker error reason "${reason}".`);
		}
		this.name = "FactoryTrackerError";
		this.reason = reason;
		this.details = details;
	}
}
