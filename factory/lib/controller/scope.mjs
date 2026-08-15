import { FactoryRunError } from "./errors.mjs";

/**
 * §3.1's run scope: **exactly two forms**, and never a third.
 *
 * A scope is a *selector*, not a copy — membership is recomputed at every
 * scheduling decision — so what a run records is the selector itself. That is
 * also why the value is small enough to compare: §10.4 resolves `factory start`
 * against a live run by asking whether the live selector already covers what was
 * typed, and §3.1 refuses to widen a selector a run is already living under.
 *
 * Resolving a *parent* selector to its members is a tracker read (`Part of #N`
 * on candidates found by label) and belongs to the tracker adapter. Everything
 * here is decidable from the two selectors alone, and says so plainly when it is
 * not.
 */

/** §3.1's two forms, closed. */
export const SCOPE_FORMS = Object.freeze({ direct: "direct-ticket", parent: "parent-scoped" });

/** The flag that says the single argument is a parent rather than a member. */
export const PARENT_FLAG = "--parent";

/** `#75` and `75` are the same issue to an operator, so both are read. */
const TICKET_ARGUMENT = /^#?([1-9][0-9]*)$/;

/**
 * The scope an invocation asked for, or `null` when it asked for none.
 *
 * `null` is not an error here: §10.4 re-enters an orphaned run **keeping its
 * `run_id`**, and a re-entry has no scope to restate — the run already has one,
 * and restating it differently would be the widening §3.1 forbids. The caller
 * decides whether a missing scope is a re-entry or a refusal.
 *
 * @param {string[]} args the invocation's positional arguments
 * @param {{ parent?: boolean }} [options] whether `--parent` was on the line
 * @returns {Readonly<object> | null}
 * @throws {FactoryRunError} `scope-invalid`
 */
export function parseScope(args, { parent = false } = {}) {
	if (args.length === 0) {
		if (!parent) return null;
		throw new FactoryRunError(
			"scope-invalid",
			`${PARENT_FLAG} names the parent issue whose members the run covers; no issue was given.`,
			{ at: PARENT_FLAG, found: null },
		);
	}

	const tickets = args.map((argument) => readTicket(argument));

	if (!parent) return Object.freeze({ kind: SCOPE_FORMS.direct, tickets: Object.freeze(sorted(tickets)) });

	if (tickets.length !== 1) {
		throw new FactoryRunError(
			"scope-invalid",
			`A parent-scoped run has exactly one parent; ${tickets.length} issues were given.`,
			{ at: PARENT_FLAG, found: tickets },
		);
	}

	return Object.freeze({ kind: SCOPE_FORMS.parent, parent: tickets[0] });
}

/**
 * The run's own selector, as it comes back out of the `run` projection.
 * Anything else is a store this build cannot reason about, and a scope decision
 * made on a shape nobody recognises is worse than a refusal.
 *
 * @param {unknown} scope
 * @returns {boolean}
 */
export function isScope(scope) {
	if (scope === null || typeof scope !== "object") return false;
	if (scope.kind === SCOPE_FORMS.direct) return Array.isArray(scope.tickets);
	return scope.kind === SCOPE_FORMS.parent && Number.isSafeInteger(scope.parent);
}

/** @param {object} a @param {object} b @returns {boolean} */
export function sameScope(a, b) {
	if (a.kind !== b.kind) return false;
	if (a.kind === SCOPE_FORMS.parent) return a.parent === b.parent;
	return a.tickets.length === b.tickets.length && a.tickets.every((ticket, index) => ticket === b.tickets[index]);
}

/**
 * §10.4's question, asked of the *live* selector: is what the operator typed
 * already covered by the run that holds the lease?
 *
 * `null` means **undecidable here** rather than "no". A ticket offered against a
 * live parent-scoped run is a membership question only the tracker can answer,
 * and answering it optimistically would print "it will be claimed when the
 * frontier reaches it" about a ticket the frontier will never reach.
 *
 * @param {object} live the live run's selector
 * @param {object | null} requested what this invocation asked for, if anything
 * @returns {boolean | null}
 */
export function scopeCovers(live, requested) {
	// Nothing was asked for, so nothing can be outside: the operator typed
	// `factory start` and the answer is simply which run is live.
	if (requested === null) return true;
	if (sameScope(live, requested)) return true;

	if (live.kind === SCOPE_FORMS.direct) {
		return requested.kind === SCOPE_FORMS.direct && requested.tickets.every((t) => live.tickets.includes(t));
	}

	// A live parent, and a direct set offered against it. Membership is `Part
	// of #N` on the tracker, which no durable state here holds.
	return requested.kind === SCOPE_FORMS.direct ? null : false;
}

/** One line an operator reads in a refusal or a report. */
export function describeScope(scope) {
	if (scope === null) return "(none given)";
	return scope.kind === SCOPE_FORMS.parent
		? `parent #${scope.parent}`
		: `#${scope.tickets.join(", #")}`;
}

function readTicket(argument) {
	const matched = TICKET_ARGUMENT.exec(argument);
	if (matched === null) {
		throw new FactoryRunError(
			"scope-invalid",
			`"${argument}" is not a tracker issue number. A run's scope is issue numbers — the tracker is the queue (§3.1).`,
			{ at: "scope", found: argument },
		);
	}
	return Number.parseInt(matched[1], 10);
}

/** Ascending, deduplicated: §3.2 orders claimable tickets by issue number. */
function sorted(tickets) {
	return [...new Set(tickets)].sort((a, b) => a - b);
}
