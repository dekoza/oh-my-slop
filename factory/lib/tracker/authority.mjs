import { FactoryTrackerError } from "./errors.mjs";

/**
 * §5.2's authority table — **per fact class, never a global ranking**.
 *
 * > A global ranking always ends up asserting something the winning source does
 * > not know.
 *
 * So the table is the code: every fact this factory can learn names the one
 * source entitled to establish it, and a fact offered from any other source is
 * refused at the point of assertion. That is what keeps §5.2 from being a
 * paragraph somebody remembers — the observer cannot record a fact without
 * coming through here.
 *
 * **Comment text is deliberately authoritative for nothing.** Bodies are
 * silently editable and a deleted comment vanishes from `/comments` *and*
 * `/timeline` without trace, so a missing claim comment means *possibly
 * deleted*, never *no claim was made*. Our own effect record plus the durable
 * assignee corroborate; the comment never does.
 */

/**
 * What an observation from this source is worth.
 *
 * Three values rather than a boolean, because §5.2 draws two different lines:
 * the outbox is real information that is nevertheless **evidence, never proof**
 * of a phase outcome, and the journal is **intent only** — it never establishes
 * an external fact at all (§14.1).
 */
export const FACT_STRENGTHS = Object.freeze({
	proof: "proof",
	evidence: "evidence",
	intent: "intent",
	none: "none",
});

/**
 * What it means when the fact is *not* there.
 *
 * The distinction exists for exactly one reason and is worth the enum: a label
 * that is not on an issue really is not on the issue, while a comment that is
 * not in `/comments` may have been posted and deleted. Collapsing the two is how
 * "no claim comment" gets read as "no claim was made" (§5.2).
 */
export const ABSENCE_MEANINGS = Object.freeze({
	absent: "absent",
	possiblyDeleted: "possibly-deleted",
});

/**
 * §5.2's table, row for row, in its own order.
 *
 * `authoritativeFor` is the whole of what each source may establish. It is a
 * list rather than a predicate so the table can be read — by a person, and by
 * the test that checks every declared fact class is claimed by exactly the
 * source it names.
 */
export const AUTHORITY_TABLE = Object.freeze([
	Object.freeze({
		source: "gitea",
		strength: FACT_STRENGTHS.proof,
		authoritativeFor: Object.freeze([
			// §5.2's row, verbatim: ticket state, labels, assignee, PR existence.
			"ticket.state",
			"ticket.labels",
			"ticket.assignee",
			"pr.existence",
			// Two **extensions** to that row, marked as such rather than left to
			// read as though §5.2 had listed them. Both are facts this factory
			// genuinely observes and must record from somewhere, and for both the
			// tracker is the only system that could establish them: §3.2's blocking
			// edges live in Gitea's dependency graph, and §5.1's body-edit detector
			// is a counter Gitea itself maintains. Ranking them anywhere else would
			// be inventing an authority; leaving them unranked would mean recording
			// them from no authority at all.
			"ticket.dependencies",
			"ticket.content-version",
		]),
		note: "ticket state, labels, assignee, PR existence — never comment text",
	}),
	Object.freeze({
		source: "git-remote",
		strength: FACT_STRENGTHS.proof,
		authoritativeFor: Object.freeze(["branch.sha", "push.landed"]),
		note: "what was actually published, freshly fetched",
	}),
	Object.freeze({
		source: "herdr",
		strength: FACT_STRENGTHS.proof,
		// Exactly one, and §5.2 says so outright: Herdr exposes no exit code
		// anywhere in its API schema, so it can never say *how* something ended.
		authoritativeFor: Object.freeze(["worker.alive"]),
		note: "whether a worker process is alive right now, and nothing else",
	}),
	Object.freeze({
		source: "outbox",
		strength: FACT_STRENGTHS.evidence,
		authoritativeFor: Object.freeze(["phase.outcome"]),
		note: "what the worker claimed — evidence, never proof",
	}),
	Object.freeze({
		source: "journal",
		strength: FACT_STRENGTHS.intent,
		// Empty on purpose, and the emptiness is the rule: the journal never
		// establishes an external fact (§14.1).
		authoritativeFor: Object.freeze([]),
		note: "intent only",
	}),
]);

/**
 * The fact classes that have **no** authoritative source, and what their absence
 * therefore means.
 *
 * They live outside the table because the table is a list of what each source
 * may establish, and these are precisely the facts no source establishes. A row
 * saying "gitea, for comment text, but only sort of" would be the global ranking
 * §5.2 rejects, re-entered through the back door.
 */
const UNOWNED_FACTS = Object.freeze({
	"comment.text": Object.freeze({
		absence: ABSENCE_MEANINGS.possiblyDeleted,
		why:
			"Comment bodies are silently editable and a deleted comment vanishes from /comments and /timeline " +
			"without trace, so comment text establishes nothing (§5.2).",
	}),
});

/**
 * Facts a tracker record establishes but §5.2's table does not rank, because
 * they are the tracker restating its own history: a comment's existence and a
 * timeline entry. Gitea may assert them — it is where they live — but only as
 * evidence, and their absence is `possibly-deleted`, for the one reason §5.2
 * gives: the record can be removed without trace.
 *
 * **One map, not a list beside a lookup.** `FACT_CLASSES` derives from this and
 * `authorityFor` dispatches on it, so a class added here cannot end up reachable
 * from one and invisible to the other.
 */
const OBSERVED_TRACKER_RECORDS = Object.freeze({
	"comment.observed": "gitea",
	"timeline.entry": "gitea",
});

/**
 * Fact classes this build knows, derived from the declarations above rather than
 * restated beside them. A second list would be a second vocabulary, and it would
 * disagree with the first the week someone adds a row.
 */
export const FACT_CLASSES = Object.freeze([
	...AUTHORITY_TABLE.flatMap((row) => row.authoritativeFor),
	...Object.keys(OBSERVED_TRACKER_RECORDS),
	...Object.keys(UNOWNED_FACTS),
]);

/**
 * Who may establish this fact, how strongly, and what its absence means.
 *
 * @param {string} fact one of `FACT_CLASSES`
 * @returns {Readonly<{ fact: string, source: string | null, strength: string, absence: string, note: string }>}
 * @throws {FactoryTrackerError} `fact-class-unknown`
 */
export function authorityFor(fact) {
	const unowned = UNOWNED_FACTS[fact];
	if (unowned !== undefined) {
		return Object.freeze({
			fact,
			source: null,
			strength: FACT_STRENGTHS.none,
			absence: unowned.absence,
			note: unowned.why,
		});
	}

	const observed = OBSERVED_TRACKER_RECORDS[fact];
	if (observed !== undefined) {
		return Object.freeze({
			fact,
			source: observed,
			strength: FACT_STRENGTHS.evidence,
			absence: ABSENCE_MEANINGS.possiblyDeleted,
			note: "the tracker's own record of itself; removable without trace, so its absence proves nothing",
		});
	}

	const row = AUTHORITY_TABLE.find((entry) => entry.authoritativeFor.includes(fact));
	if (row === undefined) {
		throw new FactoryTrackerError(
			"fact-class-unknown",
			`"${fact}" is not one of §5.2's fact classes; authority is declared per fact, and an undeclared fact has no source to establish it.`,
			{ at: "fact", found: fact ?? null, expected: FACT_CLASSES.join("|") },
		);
	}

	return Object.freeze({
		fact,
		source: row.source,
		strength: row.strength,
		absence: ABSENCE_MEANINGS.absent,
		note: row.note,
	});
}

/**
 * The gate every recorded observation passes: **is this source entitled to
 * establish this fact?**
 *
 * @param {string} fact one of `FACT_CLASSES`
 * @param {string} source the system the observation came from
 * @returns {string} the source, so a caller can inline the check
 * @throws {FactoryTrackerError} `fact-class-unknown` · `fact-source-unauthoritative`
 */
export function requireAuthority(fact, source) {
	const authority = authorityFor(fact);

	if (authority.source === null) {
		throw new FactoryTrackerError(
			"fact-source-unauthoritative",
			`Nothing is authoritative for "${fact}". ${authority.note}`,
			{ at: "fact", fact, found: source ?? null, expected: null },
		);
	}

	if (authority.source !== source) {
		throw new FactoryTrackerError(
			"fact-source-unauthoritative",
			`"${fact}" is established by ${authority.source} (${authority.note}); ${source ?? "nothing"} may not assert it (§5.2).`,
			{ at: "fact", fact, found: source ?? null, expected: authority.source },
		);
	}

	return source;
}
