import { PROBE_SOURCES } from "../effects/catalogue.mjs";
import { FactoryReconcileError } from "./errors.mjs";

/**
 * §5.4's output value: what reconcile concluded about one entity, and the
 * evidence that decided it.
 *
 * Both halves are enforced **at construction**, which is the difference between
 * an invariant and a comment. A conclusion outside the closed four-member set,
 * an empty basis, or `journal-intent` offered as a source cannot be built — so
 * §14.1's "the journal never establishes an external fact" and §14.2's
 * "`journal-intent` is never a member of an evidence basis" hold wherever a
 * conclusion is made, rather than wherever somebody remembered to check.
 */

/**
 * §5.4's four. They describe what happened to the **entity** — a run, or a
 * ticket execution — not to an individual effect: the operator's question at
 * startup is whether their work was picked back up, given up, or lost.
 */
export const RECONCILE_CONCLUSIONS = Object.freeze(["adopted", "released", "declared-dead", "unchanged"]);

/**
 * §5.4's closed evidence set, in the order the specification lists it.
 *
 * It is a superset of §4.5's `PROBE_SOURCES` by exactly one member: `outbox`,
 * which is what the *worker* claimed. §5.2 rules that evidence and never proof,
 * so no probe answers from it — but a later slice weighing a typed completion
 * against a git fact cites both, and the basis has to be able to say so.
 */
export const EVIDENCE_SOURCES = Object.freeze([
	"tracker",
	"git-remote",
	"git-local",
	"harness",
	"outbox",
	"artifact",
]);

/**
 * The one source that is deliberately **not** a member (§5.2, §14.2). Named
 * here, rather than left as a value nobody writes down, so the refusal can cite
 * the thing it refuses instead of reporting an unrecognised string.
 */
export const JOURNAL_INTENT = "journal-intent";

// A probe that could answer from a source no basis may cite would be evidence
// nothing can record. Checked at import, where the two vocabularies meet.
for (const source of PROBE_SOURCES) {
	if (!EVIDENCE_SOURCES.includes(source)) {
		throw new Error(`Probe source "${source}" is not one of §5.4's evidence sources.`);
	}
}

/**
 * One entry in a basis: a probe's answer, in the shape the journal record
 * carries it.
 *
 * The foreign system's own id and its raw timestamp string ride along because
 * §4.3 requires both of a foreign fact and normalising in place destroys the
 * evidence — so the probe that read them is where they are captured, not a
 * later hop that no longer has them.
 *
 * @param {object} entry
 * @param {string} entry.source one of `EVIDENCE_SOURCES`
 * @param {string | null} [entry.call] the read performed (§4.5's probe call)
 * @param {string | null} [entry.effectKey] the effect this answer settles, if any
 * @param {boolean | null} [entry.matched] whether the probe's match held
 * @param {string | null} [entry.foreignSourceId] that system's own stable id
 * @param {string | null} [entry.occurredAtRaw] that system's raw timestamp string
 * @param {object} [entry.detail] JSON-safe extra fields for the operator
 * @returns {Readonly<object>}
 */
export function evidenceEntry({
	source,
	call = null,
	effectKey = null,
	matched = null,
	foreignSourceId = null,
	occurredAtRaw = null,
	detail = {},
}) {
	return Object.freeze({
		source,
		call,
		effect_key: effectKey,
		matched,
		foreign_source_id: foreignSourceId,
		occurred_at_raw: occurredAtRaw,
		detail,
	});
}

/**
 * §5.4's conclusion, with its basis.
 *
 * **Ordered, because the operator's question is which source decided** — so the
 * caller passes the deciding entry first and the order is preserved rather than
 * sorted into a canonical shape that would lose exactly that fact.
 *
 * @param {string} conclusion one of `RECONCILE_CONCLUSIONS`
 * @param {ReadonlyArray<object>} entries the basis, deciding source first
 * @returns {Readonly<{ conclusion: string, evidence: ReadonlyArray<object> }>}
 * @throws {FactoryReconcileError} `conclusion-unknown` · `evidence-empty` ·
 *   `evidence-journal-intent` · `evidence-source-unknown`
 */
export function reconcileConclusion(conclusion, entries) {
	if (!RECONCILE_CONCLUSIONS.includes(conclusion)) {
		throw new FactoryReconcileError(
			"conclusion-unknown",
			`A reconcile conclusion is one of ${RECONCILE_CONCLUSIONS.join(", ")}; found ${JSON.stringify(conclusion ?? null)}.`,
			{ at: "conclusion", found: conclusion ?? null, expected: RECONCILE_CONCLUSIONS.join("|") },
		);
	}

	const basis = [...(entries ?? [])];
	if (basis.length === 0) {
		throw new FactoryReconcileError(
			"evidence-empty",
			`A ${conclusion} conclusion carries a non-empty evidence basis; a conclusion with nothing behind it is the journal establishing an external fact (§14.1, §14.2).`,
			{ at: "evidence", conclusion },
		);
	}

	for (const [index, entry] of basis.entries()) requireSource(entry, index, conclusion);

	return Object.freeze({ conclusion, evidence: Object.freeze(basis) });
}

function requireSource(entry, index, conclusion) {
	const source = entry?.source;

	if (source === JOURNAL_INTENT) {
		throw new FactoryReconcileError(
			"evidence-journal-intent",
			`${JOURNAL_INTENT} is never a member of an evidence basis: the journal records intent and never establishes an external fact (§14.1, §14.2).`,
			{ at: `evidence[${index}].source`, found: source, conclusion },
		);
	}

	if (!EVIDENCE_SOURCES.includes(source)) {
		throw new FactoryReconcileError(
			"evidence-source-unknown",
			`Evidence comes from one of ${EVIDENCE_SOURCES.join(", ")}; found ${JSON.stringify(source ?? null)}.`,
			{
				at: `evidence[${index}].source`,
				found: source ?? null,
				expected: EVIDENCE_SOURCES.join("|"),
				conclusion,
			},
		);
	}
}
