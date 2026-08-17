import { FactoryConfigError } from "./errors.mjs";
import { IDENTIFIER_PATTERN, requireArray, requireDeclared, requireExactKeys, requireNoUnknownKeys, requireNonEmptyString, requireObject, requireOneOf } from "./shape.mjs";

/**
 * Routing (§11.5): `labelsAny × role → profile`, with every conflict failing
 * closed at load time.
 *
 * Repair is absent on purpose — it is pinned to the originating attempt's
 * profile, because re-routing it would discard the context that makes repair
 * cheaper than a fresh retry while blurring the distinction §8.6's budget split
 * depends on.
 */

/** §11.5's three roles. `review` is a pair; the other two are single. */
const ROUTING_ROLES = Object.freeze(["implement", "freshRetry", "review"]);
const REVIEW_ATTEMPTS = 2;

const ROUTING_KEYS = Object.freeze(["roles", "rules", "fallbacks", "sets"]);
const SET_KEYS = Object.freeze(["roles", "rules", "fallbacks"]);
const RULE_KEYS = Object.freeze(["labelsAny", "role", "profile"]);
const NO_ROUTING_DEFAULTS =
	"A routing declares its roles and its rules; an empty rule list is written out, never assumed.";

/**
 * #155's reroute order for a routing that declares none.
 *
 * **Absent means "no alternate route", and that is a statement rather than a
 * default** — the same shape §6.8's `worker` block has: a block of *additions*
 * whose absent form is the empty addition, spelled once here so no consumer
 * branches on `undefined`. It is not §11.2's silent guessing, because there is
 * exactly one thing an undeclared reroute order can mean and the loader is not
 * choosing between candidates.
 */
const NO_FALLBACKS = Object.freeze({
	implement: Object.freeze([]),
	freshRetry: Object.freeze([]),
	review: Object.freeze([Object.freeze([]), Object.freeze([])]),
});

/**
 * @param {object} routing the `routing` block
 * @param {Record<string, object>} profiles the validated profile table
 * @param {string | null} selected the named set this run selects, or null for the declared default
 * @returns {{ block: object, active: { name: string | null, roles: object, rules: object[] }, declared: object[] }}
 *   `declared` is every routing the config carries — the default plus each named
 *   set — because §11.6's reachability question is asked of all of them.
 */
export function validateRouting(routing, profiles, selected, configPath) {
	requireNoUnknownKeys(routing, ROUTING_KEYS, "routing", configPath);

	const defaultRouting = validateRoutingSet(routing, profiles, "routing", configPath);
	const sets = validateNamedSets(routing.sets, profiles, configPath);

	const block = Object.freeze({
		roles: defaultRouting.roles,
		rules: defaultRouting.rules,
		fallbacks: defaultRouting.fallbacks,
		...(routing.sets === undefined
			? {}
			: {
					sets: Object.freeze(
						Object.fromEntries(
							sets.map((set) => [set.name, { roles: set.roles, rules: set.rules, fallbacks: set.fallbacks }]),
						),
					),
				}),
	});

	return { block, active: selectActive(defaultRouting, sets, selected, configPath), declared: [defaultRouting, ...sets] };
}

/**
 * §11.5 makes a named set first-class rather than the dormant `_postSubscription`
 * key the loader used to ignore, so the selection is a per-run input to the load
 * and an unknown name is a refusal, not a silent fall back to the default.
 */
function selectActive(defaultRouting, sets, selected, configPath) {
	if (selected === null || selected === undefined) return defaultRouting;

	const set = sets.find((candidate) => candidate.name === selected);
	if (set !== undefined) return set;

	const declared = sets.map((candidate) => candidate.name);
	throw new FactoryConfigError(
		"unknown-routing-set",
		`${configPath} declares no routing set "${selected}". Declared sets: ${declared.length === 0 ? "(none)" : declared.join(", ")}.`,
		{ file: configPath, at: "routing.sets", found: selected, expected: declared.join("|") },
	);
}

function validateNamedSets(sets, profiles, configPath) {
	if (sets === undefined) return [];
	requireObject(sets, "routing.sets", configPath, "routing.sets");

	return Object.entries(sets).map(([name, set]) => {
		const at = `routing.sets.${name}`;
		if (!IDENTIFIER_PATTERN.test(name)) {
			throw new FactoryConfigError(
				"invalid-value",
				`${configPath}: ${at} is not a usable routing-set name; use lower-case letters, digits, "-" or "_", starting with a letter.`,
				{ file: configPath, at, found: name, expected: String(IDENTIFIER_PATTERN) },
			);
		}

		requireObject(set, at, configPath, at);
		requireNoUnknownKeys(set, SET_KEYS, at, configPath);
		return validateRoutingSet(set, profiles, at, configPath, name);
	});
}

/**
 * One routing — the default or a named set. A dormant set is validated exactly
 * as strictly as the active one: config the loader waves through today is the
 * drift that surfaces on the day it is switched on.
 */
function validateRoutingSet(routing, profiles, at, configPath, name = null) {
	requireDeclared(routing.roles, `${at}.roles`, configPath, NO_ROUTING_DEFAULTS);
	requireDeclared(routing.rules, `${at}.rules`, configPath, NO_ROUTING_DEFAULTS);

	const roles = validateRoles(routing.roles, profiles, `${at}.roles`, configPath);
	const rules = validateRules(routing.rules, profiles, `${at}.rules`, configPath);
	const fallbacks = validateFallbacks(routing.fallbacks, profiles, `${at}.fallbacks`, configPath);
	const routed = { name, roles, rules, fallbacks };

	return { ...routed, profiles: profilesReachedBy(routed) };
}

/**
 * #155's reroute order: **which profile a role takes next when the one it
 * resolves to belongs to a class §9.8's memo has recorded unavailable.**
 *
 * It is declared rather than inferred for the reason §11.2 gives about every
 * other policy on disk. The orders an inference could produce — the profiles
 * block's key order, the classes' declared sizes, "any profile the routing
 * reaches" — are all defensible and none of them is the operator's, and the
 * first quota blip is a poor moment to discover which one the code picked.
 *
 * **Review's order is two orders**, one per axis, so §8.4's two axes stay
 * independently routed under a reroute exactly as they are under a first
 * dispatch. One shared order would let a single exhausted class quietly walk
 * both axes onto the same profile with nothing in the config saying it could.
 */
function validateFallbacks(fallbacks, profiles, at, configPath) {
	if (fallbacks === undefined) return NO_FALLBACKS;

	requireObject(fallbacks, at, configPath, at);
	requireNoUnknownKeys(fallbacks, ROUTING_ROLES, at, configPath);

	return Object.freeze({
		implement: fallbackOrder(fallbacks.implement, profiles, `${at}.implement`, configPath),
		freshRetry: fallbackOrder(fallbacks.freshRetry, profiles, `${at}.freshRetry`, configPath),
		review: reviewFallbackOrders(fallbacks.review, profiles, `${at}.review`, configPath),
	});
}

/** §8.4's two axes, each with its own order — never one order read twice. */
function reviewFallbackOrders(value, profiles, at, configPath) {
	if (value === undefined) return NO_FALLBACKS.review;

	if (!Array.isArray(value) || value.length !== REVIEW_ATTEMPTS || value.some((order) => !Array.isArray(order))) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at} must be two reroute orders, one per §8.4 review axis, written out even when they are the same. A single shared order would let one exhausted class walk both axes onto the same profile with nothing here saying it could.`,
			{
				file: configPath,
				at,
				expected: `${REVIEW_ATTEMPTS} orders`,
				found: Array.isArray(value) ? value.length : typeof value,
			},
		);
	}

	return Object.freeze(value.map((order, index) => fallbackOrder(order, profiles, `${at}[${index}]`, configPath)));
}

/**
 * One role's reroute order: declared profile names, each named once.
 *
 * An **unknown name refuses** rather than being dropped: a typo that silently
 * shortened the order would leave the role rerouting somewhere the operator
 * never wrote, which is precisely §11.3's refusal to fall back to the default.
 * A **repeat refuses** because an order visits each candidate once — a name
 * written twice is either a typo or a belief about retries that this order does
 * not implement.
 */
function fallbackOrder(order, profiles, at, configPath) {
	if (order === undefined) return Object.freeze([]);
	requireArray(order, at, configPath, at);

	const names = order.map((name, index) => requireProfileName(name, profiles, `${at}[${index}]`, configPath));
	if (new Set(names).size !== names.length) {
		throw new FactoryConfigError("invalid-value", `${configPath}: ${at} repeats a profile.`, {
			file: configPath,
			at,
			found: names.join(", "),
			expected: "each profile once",
		});
	}

	return Object.freeze(names);
}

function validateRoles(roles, profiles, at, configPath) {
	requireObject(roles, at, configPath, at);
	requireNoUnknownKeys(roles, ROUTING_ROLES, at, configPath);

	for (const role of ROUTING_ROLES) {
		requireDeclared(
			roles[role],
			`${at}.${role}`,
			configPath,
			`All three routing roles are declared with no implicit fallback — an implicit ${role} is exactly the inferred runtime policy §11.5 refuses.`,
		);
	}

	return Object.freeze({
		implement: requireProfileName(roles.implement, profiles, `${at}.implement`, configPath),
		freshRetry: requireProfileName(roles.freshRetry, profiles, `${at}.freshRetry`, configPath),
		review: requireReviewPair(roles.review, profiles, `${at}.review`, configPath),
	});
}

function validateRules(rules, profiles, at, configPath) {
	requireArray(rules, at, configPath, at);

	/** @type {Map<string, Array<{ at: string, labels: Set<string> }>>} */
	const byRole = new Map(ROUTING_ROLES.map((role) => [role, []]));

	const validated = rules.map((rule, index) => {
		const ruleAt = `${at}[${index}]`;
		requireObject(rule, ruleAt, configPath, ruleAt);
		requireExactKeys(rule, RULE_KEYS, ruleAt, configPath);

		const role = requireOneOf(rule.role, ROUTING_ROLES, `${ruleAt}.role`, configPath);
		const labels = validateLabelsAny(rule.labelsAny, ruleAt, configPath);
		const profile =
			role === "review"
				? requireReviewPair(rule.profile, profiles, `${ruleAt}.profile`, configPath)
				: requireProfileName(rule.profile, profiles, `${ruleAt}.profile`, configPath);

		const declared = { at: ruleAt, labels: new Set(labels) };
		refuseOverlap(byRole.get(role), declared, role, configPath);
		byRole.get(role).push(declared);

		return Object.freeze({ labelsAny: Object.freeze(labels), role, profile });
	});

	return Object.freeze(validated);
}

/**
 * The static half of §11.5's two-level conflict rule. Intersecting label sets for
 * one role are answered here, with no ticket in hand; the ticket-scoped half —
 * one ticket matching two rules for a role — needs the ticket's labels and is
 * raised at dispatch by `worker/roles.mjs`'s `profileForRole`, before any work.
 */
function refuseOverlap(earlier, candidate, role, configPath) {
	for (const rule of earlier) {
		const shared = [...candidate.labels].filter((label) => rule.labels.has(label));
		if (shared.length === 0) continue;

		throw new FactoryConfigError(
			"routing-overlap",
			`${configPath}: ${candidate.at} and ${rule.at} both route role "${role}" for ${shared.join(", ")}. Overlapping rules are a load error, never legacy's positional first-match.`,
			{ file: configPath, at: candidate.at, role, labels: shared, conflictsWith: rule.at },
		);
	}
}

function validateLabelsAny(labelsAny, ruleAt, configPath) {
	const at = `${ruleAt}.labelsAny`;
	requireArray(labelsAny, at, configPath, at);
	if (labelsAny.length === 0) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at} is empty, which would match every ticket. A rule that always applies is the role's declared profile.`,
			{ file: configPath, at, expected: "at least one label" },
		);
	}

	const labels = labelsAny.map((label, index) => requireNonEmptyString(label, `${at}[${index}]`, configPath));
	if (new Set(labels).size !== labels.length) {
		throw new FactoryConfigError("invalid-value", `${configPath}: ${at} repeats a label.`, {
			file: configPath,
			at,
			found: labels.join(", "),
			expected: "each label once",
		});
	}

	return labels;
}

/**
 * §11.5: the two attempts may name the same profile, but it must be written
 * twice. No shorthand expands one entry into two, so duplication is always a
 * visible choice.
 */
function requireReviewPair(value, profiles, at, configPath) {
	if (!Array.isArray(value) || value.length !== REVIEW_ATTEMPTS) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at} must name exactly two review profiles, written out even when they are the same — no shorthand expands one entry into two.`,
			{ file: configPath, at, expected: `${REVIEW_ATTEMPTS} profile names`, found: Array.isArray(value) ? value.length : typeof value },
		);
	}

	return Object.freeze(
		value.map((name, index) => requireProfileName(name, profiles, `${at}[${index}]`, configPath)),
	);
}

function requireProfileName(value, profiles, at, configPath) {
	const name = requireNonEmptyString(value, at, configPath);
	if (!Object.hasOwn(profiles, name)) {
		throw new FactoryConfigError(
			"invalid-value",
			`${configPath}: ${at} names profile "${name}", which the profiles block does not declare.`,
			{ file: configPath, at, found: name, expected: Object.keys(profiles).join("|") },
		);
	}

	return name;
}

/**
 * Every profile one routing can dispatch — its three roles, every rule's, and
 * **every fallback order's** (#155).
 *
 * Exported because §11.6's reachability rules and §9.1's capacity plan ask the
 * same question of a routing: the loader asks it of all of them to size the
 * classes, the plan asks it of the active one to arbitrate over them.
 *
 * A fallback profile counts for both rules and it has to. A reroute dispatches
 * into its class and takes a slot from that class's pool, so an unsized fallback
 * class would be discovered at the moment a quota blip made it the only way
 * forward — which is the one moment §11.6's load-time refusal exists to be
 * earlier than.
 *
 * @param {{ roles: object, rules: ReadonlyArray<object>, fallbacks?: object }} routing
 *   one validated routing — the default or a named set
 * @returns {Set<string>}
 */
export function profilesReachedBy({ roles, rules, fallbacks = NO_FALLBACKS }) {
	const reached = new Set([roles.implement, roles.freshRetry, ...roles.review]);
	for (const rule of rules) {
		for (const profile of Array.isArray(rule.profile) ? rule.profile : [rule.profile]) {
			reached.add(profile);
		}
	}
	for (const order of [fallbacks.implement, fallbacks.freshRetry, ...fallbacks.review]) {
		for (const profile of order) reached.add(profile);
	}

	return reached;
}
