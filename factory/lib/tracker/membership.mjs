/**
 * §3.1's parent-scoped membership: **a strict contract, not a heuristic.**
 *
 * > the literal first body line `Part of #N`, matched by one anchored pattern,
 * > on candidates found server-side via the `workflow:implement` label
 *
 * Every clause of that sentence is load-bearing, and each one rules out a
 * cheaper reading that would have quietly worked most of the time:
 *
 * - **literal first line** — not "mentions the parent somewhere", which would
 *   make every ticket that links its parent in prose a member;
 * - **one anchored pattern** — not a family of tolerant variants, because the
 *   set of things a tolerant matcher accepts is not something an operator can
 *   read off a ticket;
 * - **candidates from the label** — the server does the filtering, so the
 *   factory never walks a repository's whole issue list to find a scope.
 *
 * The pattern is exported because it *is* the contract: a test that restated it
 * would be a second pattern, and a ticket that stops being a member would break
 * only one of them.
 */

/**
 * The whole of it. Anchored at both ends, so nothing precedes `Part of` and
 * nothing follows the number but whitespace — a trailing space is invisible in
 * a tracker's editor and cannot be what decides membership, while a trailing
 * *word* is a different sentence.
 */
export const PART_OF_PATTERN = /^Part of #([1-9][0-9]*)[ \t]*$/;

/**
 * The parent this body declares, or `null` when it declares none.
 *
 * The first line is taken **literally**: a leading blank line means the first
 * body line is empty, and an empty line is not `Part of #N`. That is stricter
 * than a reader might expect, and it is the point — membership is a contract the
 * ticket author states, and a scope that quietly tolerated a leading newline
 * would tolerate whatever else drifted in next.
 *
 * @param {string | null | undefined} body the issue body, as the tracker returned it
 * @returns {number | null}
 */
export function declaredParent(body) {
	if (typeof body !== "string") return null;

	// `\r` alone, because a CRLF tracker is still stating the same first line;
	// anything else on the line is a different line.
	const firstLine = body.split("\n", 1)[0].replace(/\r$/, "");
	const matched = PART_OF_PATTERN.exec(firstLine);
	return matched === null ? null : Number.parseInt(matched[1], 10);
}

/**
 * @param {string | null | undefined} body
 * @param {number} parent
 * @returns {boolean}
 */
export function isMemberOf(body, parent) {
	return declaredParent(body) === parent;
}
