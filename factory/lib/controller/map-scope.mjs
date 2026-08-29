import { readEach } from "../tracker/gitea.mjs";
import { FACTORY_LABELS } from "../tracker/labels.mjs";
import { FactoryRunError } from "./errors.mjs";
import { SCOPE_FORMS } from "./scope.mjs";

/**
 * #182: **a bare issue number that is a map runs the map's members.**
 *
 * The operator's workflow ends in `factory start <ticket>`, and when the ticket
 * is a `wayfinder:map` the run is meant to implement everything implementable
 * on it. `parseScope` is pure — it has no tracker — so it reads `75` as a
 * direct-ticket set of one, and a run over that set finds the map itself
 * `ineligible` and drains at once. This is the one tracker read that turns the
 * number into what was meant: the parent-scoped selector over the map.
 *
 * §3.1 keeps **exactly two scope forms**, and this adds none. The run records
 * the rewritten selector, so a later `factory start 75` against it compares
 * parent-scoped to parent-scoped (§10.4), and re-entry restores the row's own
 * selector without reading the label again — `null` passes through untouched.
 *
 * A map beside other tickets is refused rather than split: dropping either
 * half would be the guess §11.2 forbids, and folding the tickets into the map's
 * selector would be the widening §3.1 forbids.
 */

/**
 * @param {object} reader a `createGiteaReader` client
 * @param {object | null} requested §3.1's parsed selector, or null on re-entry
 * @returns {Promise<Readonly<{ scope: object | null, resolved_from: object | null }>>}
 *   the selector a run should record, and where it came from when it was rewritten
 * @throws {FactoryRunError} `scope-invalid` for a map beside other tickets
 */
export async function resolveMapScope(reader, requested) {
	if (requested === null || requested.kind !== SCOPE_FORMS.direct) {
		return Object.freeze({ scope: requested, resolved_from: null });
	}

	const issues = await readEach(requested.tickets, (ticket) => reader.readIssue(ticket));
	const maps = issues.filter((issue) => issue.labels.includes(FACTORY_LABELS.map)).map((issue) => issue.number);

	if (maps.length === 0) return Object.freeze({ scope: requested, resolved_from: null });

	if (requested.tickets.length !== 1) {
		throw new FactoryRunError(
			"scope-invalid",
			`#${maps.join(", #")} ${maps.length === 1 ? "is a map" : "are maps"} (${FACTORY_LABELS.map}); a map is ` +
				`run alone, as \`factory start ${maps[0]}\`, and its members are the scope. Beside other tickets it ` +
				"would either be dropped or widen the selector, and §3.1 allows neither.",
			{ at: "scope", found: requested.tickets, maps },
		);
	}

	return Object.freeze({
		scope: Object.freeze({ kind: SCOPE_FORMS.parent, parent: maps[0] }),
		resolved_from: Object.freeze({ ticket: maps[0], label: FACTORY_LABELS.map }),
	});
}
