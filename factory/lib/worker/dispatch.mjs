import { resourceClassOf } from "../config/profiles.mjs";
import { FactoryWorkerError } from "./errors.mjs";
import { profileForRole, REVIEW_ROUTING_ROLE } from "./roles.mjs";

/**
 * #155: **§11.5's dispatch, read under §9.8's memo.**
 *
 * #154 made a provider's refusal a time-boxed unavailability of its *resource
 * class* and taught dispatch to wait on it. Waiting is the right answer when
 * one class is all a role has; it is the wrong one when the operator declared
 * somewhere else to go, and a run that waits an hour for a daily cap to roll
 * has turned one quota blip into an idle afternoon.
 *
 * This module is the other half: the order a role tries, and the first
 * candidate in it whose class the memo has not locked.
 *
 * **The substitution is never silent.** §6.5 and §11.5 re-assert a *declared*
 * model against the observed one precisely so a run cannot quietly behave
 * differently from what was declared, and a reroute is exactly such a
 * difference. So a route is a record and not merely a name: what was declared,
 * what will run, why, and every candidate passed over with the state that
 * passed it over. A green ticket that cannot answer "what wrote this?" is the
 * auditing hole this exists on the right side of.
 *
 * **The memo is class-scoped, and that is load-bearing here.** Two profiles
 * naming different presets on one endpoint share a slot pool because they share
 * one GPU (§9.1), so they also share one refusal: rerouting between them buys
 * nothing, and the selection says so by naming each candidate's class rather
 * than by pretending the second is a different resource.
 */

/**
 * The profiles a role may run on, in the order it tries them: **what §11.5
 * dispatches to, then what §11.5's `fallbacks` declares comes next.**
 *
 * The head is the dispatch — a matching rule's profile, or the role's declared
 * one — so a routing that declares no fallbacks has an order of exactly one and
 * behaves as it did before this existed. The tail is the operator's, read off
 * the config rather than inferred from the profiles block, the class sizes, or
 * anything else the code could have picked while the operator was elsewhere.
 *
 * A fallback that repeats the head is **visited once**. The loader refuses a
 * repeat *within* an order, but the head is a per-ticket answer: a rule routing
 * this ticket to a profile the order also lists is a legitimate config for every
 * other ticket, so the duplicate is deduplicated here rather than refused there.
 *
 * @param {{ roles: object, rules: ReadonlyArray<object>, fallbacks?: object }} activeRouting
 * @param {{ role: string, labels?: ReadonlyArray<string>, axis?: number | null }} where
 *   `axis` is §8.4's axis index, **required for the `review` role and refused
 *   for the others' silence**: `review` dispatches to a pair and an order for
 *   "the review role" would have to pick one half of it
 * @returns {ReadonlyArray<string>}
 * @throws {FactoryWorkerError} `routing-ambiguous`
 */
export function dispatchOrder(activeRouting, { role, labels = [], axis = null }) {
	const dispatched = profileForRole(activeRouting, { role, labels });
	const fallbacks = activeRouting.fallbacks ?? NO_FALLBACKS;

	if (role !== REVIEW_ROUTING_ROLE) {
		return dedupe([dispatched, ...(fallbacks[role] ?? [])]);
	}

	const pair = Array.isArray(dispatched) ? dispatched : [dispatched];
	if (!Number.isInteger(axis) || axis < 0 || axis >= pair.length) {
		throw new FactoryWorkerError(
			"routing-ambiguous",
			`Role "${role}" dispatches to ${pair.length} profiles — one per §8.4 axis — and this caller asked for an ` +
				`order without naming an axis. Answering with the pair's first half would collapse the two axes onto one ` +
				`route, which is the thing §8.4 keeps independent.`,
			{ at: "routing.roles.review", role, found: axis, expected: `0..${pair.length - 1}` },
		);
	}

	return dedupe([pair[axis], ...(fallbacks[role]?.[axis] ?? [])]);
}

/**
 * The first profile in an order this run may actually spend, with the record of
 * how it got there.
 *
 * **A route is chosen once and recorded once.** The class it names is the pool
 * a slot is taken from (§9.4) and the profile it names is what the attempt is
 * minted under (§6.5), so a caller that re-derived either would be a second
 * opinion about what ran — which is how an attestation comes to disagree with
 * the attempt it attests.
 *
 * `profile: null` is the answer when the order is spent, and it is an answer
 * rather than a throw: **exhausting every routable profile for a role is its own
 * typed outcome** (§8.10), distinguishable from a worker that failed, and a
 * caller that has to catch an exception to find that out will eventually file it
 * as one.
 *
 * @param {object} request
 * @param {ReadonlyArray<string>} request.order `dispatchOrder`'s answer
 * @param {Record<string, object>} request.profiles §11.4's validated profile table
 * @param {{ settle: (className: string, options: object) => Promise<{ state: string, until: number | null }> }} request.exhaustion
 *   §9.8's memo facet (`capacity/slots.mjs`). It is the gate rather than the
 *   ledger because an expiry that passed is re-admitted **by probe, never by the
 *   clock** (§5.2), and the probe is the gate's
 * @param {ReadonlyArray<string>} [request.dispatched] the profiles this ticket
 *   execution has already dispatched for this role. **This is the bound**: a
 *   reroute is a free relaunch, and what keeps it finite is that each candidate
 *   is spent at most once rather than a counter nobody declared
 * @param {number} [request.at]
 * @returns {Promise<Readonly<object>>}
 */
export async function selectRoute({ order, profiles, exhaustion, dispatched = [], at = Date.now() }) {
	const declared = order[0] ?? null;
	const considered = [];

	for (const profile of order) {
		const className = resourceClassOf(requireProfile(profiles, profile));

		if (dispatched.includes(profile)) {
			considered.push(entry({ profile, class: className, state: "already-dispatched", until: null }));
			continue;
		}

		const gate = await exhaustion.settle(className, { at });
		if (gate.state !== "available") {
			considered.push(entry({ profile, class: className, state: "blocked", until: gate.until ?? null }));
			continue;
		}

		considered.push(entry({ profile, class: className, state: "available", until: null }));
		return route({ profile, class: className, declared, considered });
	}

	return route({ profile: null, class: null, declared, considered });
}

/**
 * §11.5's reroute order for a routing built before this existed — the same empty
 * addition the loader writes, so a hand-composed routing needs no `fallbacks`
 * key to be dispatched from and no consumer branches on `undefined`.
 */
const NO_FALLBACKS = Object.freeze({
	implement: Object.freeze([]),
	freshRetry: Object.freeze([]),
	review: Object.freeze([Object.freeze([]), Object.freeze([])]),
});

function route({ profile, class: className, declared, considered }) {
	const rerouted = profile !== null && profile !== declared;

	return Object.freeze({
		declared,
		profile,
		class: className,
		rerouted,
		// The reason names the class that moved the dispatch, not the fact that it
		// moved: "this ran on cloud" is half an answer, and the half an operator
		// reading a green ticket a week later is missing is which provider was out.
		reason: rerouted ? `${blockedClasses(considered).join(", ")} exhausted (§9.8)` : null,
		considered: Object.freeze(considered),
	});
}

function blockedClasses(considered) {
	return [...new Set(considered.filter((seen) => seen.state === "blocked").map((seen) => seen.class))];
}

function entry(seen) {
	return Object.freeze(seen);
}

function dedupe(order) {
	return Object.freeze([...new Set(order)]);
}

/**
 * A profile the order names and the table does not. It refuses rather than
 * skipping: the loader validates every name in an order against the profiles
 * block, so reaching here means the two were composed from different configs —
 * and skipping would silently shorten the order the operator wrote.
 */
function requireProfile(profiles, name) {
	const profile = profiles?.[name];
	if (profile !== undefined) return profile;

	throw new FactoryWorkerError(
		"routing-ambiguous",
		`The dispatch order names profile "${name}", which the profiles block does not declare. §11.3 refuses an ` +
			`unknown profile name rather than falling back to the default, and skipping it here would shorten the order ` +
			`the operator wrote without saying so.`,
		{ at: "profiles", profile: name, expected: Object.keys(profiles ?? {}).join("|") },
	);
}
