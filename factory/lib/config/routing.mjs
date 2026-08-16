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

const ROUTING_KEYS = Object.freeze(["roles", "rules", "sets"]);
const RULE_KEYS = Object.freeze(["labelsAny", "role", "profile"]);
const NO_ROUTING_DEFAULTS =
	"A routing declares its roles and its rules; an empty rule list is written out, never assumed.";

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
		...(routing.sets === undefined ? {} : { sets: Object.freeze(Object.fromEntries(sets.map((set) => [set.name, { roles: set.roles, rules: set.rules }]))) }),
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
		requireNoUnknownKeys(set, ["roles", "rules"], at, configPath);
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

	return { name, roles, rules, profiles: profilesReachedBy(roles, rules) };
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
 * one ticket matching two rules for a role — is a claim-time automation failure
 * the scheduler raises before any work.
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
 * Every profile one routing can dispatch — its three roles plus every rule's.
 *
 * Exported because §11.6's reachability rules and §9.1's capacity plan ask the
 * same question of a routing: the loader asks it of all of them to size the
 * classes, the plan asks it of the active one to arbitrate over them.
 *
 * @param {object} roles the validated `roles` block
 * @param {ReadonlyArray<object>} rules the validated `rules` list
 * @returns {Set<string>}
 */
export function profilesReachedBy(roles, rules) {
	const reached = new Set([roles.implement, roles.freshRetry, ...roles.review]);
	for (const rule of rules) {
		for (const profile of Array.isArray(rule.profile) ? rule.profile : [rule.profile]) {
			reached.add(profile);
		}
	}

	return reached;
}
