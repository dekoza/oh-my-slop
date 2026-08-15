import { FactoryConfigError } from "./errors.mjs";
import { resourceClassOf } from "./profiles.mjs";
import { requireExactKeys, requireInteger, requireObject } from "./shape.mjs";

/**
 * Concurrency (§9.3, §11.6). Both keys are required with no default: omitting
 * `maxTicketExecutions` would permit a single-threaded scheduler by absence, and
 * assuming a resource size of 1 is the inferred runtime policy §11.2 exists to
 * end.
 */

/**
 * §9.3's proof gate, **read here and nowhere else**. The scheduler is
 * capacity-parametric and never learns this constant exists, which is what lets
 * the acceptance suite instantiate it at capacity 2 with no override seam, and
 * what makes "raising the ceiling is a one-line change" literally checkable.
 */
export const MAX_SUPPORTED_TICKET_CONCURRENCY = 1;

const CONCURRENCY_KEYS = Object.freeze(["maxTicketExecutions", "resources"]);

/**
 * @param {object} concurrency the `concurrency` block
 * @param {Record<string, object>} profiles the validated profile table
 * @param {{ active: { name: string | null, profiles: Set<string> }, declared: Array<{ name: string | null, profiles: Set<string> }> }} routing
 * @returns {Readonly<{ maxTicketExecutions: number, resources: Readonly<Record<string, number>> }>}
 */
export function validateConcurrency(concurrency, profiles, routing, configPath) {
	requireExactKeys(concurrency, CONCURRENCY_KEYS, "concurrency", configPath);

	const maxTicketExecutions = requireTicketCeiling(concurrency.maxTicketExecutions, configPath);
	const resources = validateResources(concurrency.resources, profiles, routing, configPath);

	return Object.freeze({ maxTicketExecutions, resources });
}

function requireTicketCeiling(declared, configPath) {
	const at = "concurrency.maxTicketExecutions";
	requireInteger(declared, at, configPath, { min: 1 });

	if (declared > MAX_SUPPORTED_TICKET_CONCURRENCY) {
		throw new FactoryConfigError(
			"concurrency-ceiling",
			`${configPath}: ${at} is ${declared}, above MAX_SUPPORTED_TICKET_CONCURRENCY = ${MAX_SUPPORTED_TICKET_CONCURRENCY}. Raising the constant is gated on §15's concurrency acceptance suite plus one documented two-lane run (§18.2); the factory will not run a capacity that has never executed.`,
			{ file: configPath, at, found: declared, expected: MAX_SUPPORTED_TICKET_CONCURRENCY },
		);
	}

	return declared;
}

/**
 * The three reachability rules of §11.6, in the order that answers the operator's
 * question: is a class that will run unsized, and is a size declared for a class
 * nothing will run?
 */
function validateResources(resources, profiles, routing, configPath) {
	requireObject(resources, "concurrency.resources", configPath, "concurrency.resources");

	const sizes = Object.freeze(
		Object.fromEntries(
			Object.entries(resources).map(([name, size]) => [
				name,
				requireInteger(size, `concurrency.resources.${name}`, configPath, {
					because: "A resource class holding no slots can never dispatch an attempt.",
				}),
			]),
		),
	);

	requireActiveClassesSized(sizes, profiles, routing.active, configPath);
	refuseUnreachableClasses(sizes, profiles, routing.declared, configPath);

	return sizes;
}

function requireActiveClassesSized(sizes, profiles, active, configPath) {
	for (const [className, profileNames] of classesReachedBy(profiles, active.profiles)) {
		if (Object.hasOwn(sizes, className)) continue;

		throw new FactoryConfigError(
			"resource-unsized",
			`${configPath}: the active routing${active.name === null ? "" : ` "${active.name}"`} reaches resource class "${className}" through ${[...profileNames].join(", ")}, and concurrency.resources declares no size for it. A missing size is a load error, never an assumed 1.`,
			{
				file: configPath,
				at: `concurrency.resources.${className}`,
				class: className,
				profiles: [...profileNames],
				routingSet: active.name,
			},
		);
	}
}

function refuseUnreachableClasses(sizes, profiles, declared, configPath) {
	const reachable = new Set(
		declared.flatMap((routing) => [...classesReachedBy(profiles, routing.profiles).keys()]),
	);

	for (const className of Object.keys(sizes)) {
		if (reachable.has(className)) continue;

		throw new FactoryConfigError(
			"resource-unreachable",
			`${configPath}: concurrency.resources sizes "${className}", which no declared routing set reaches. Dead config lies about what will run.`,
			{ file: configPath, at: `concurrency.resources.${className}`, class: className, expected: [...reachable].join("|") },
		);
	}
}

/** @returns {Map<string, Set<string>>} class → the profiles that put it in play */
function classesReachedBy(profiles, profileNames) {
	const classes = new Map();
	for (const name of profileNames) {
		const className = resourceClassOf(profiles[name]);
		if (!classes.has(className)) classes.set(className, new Set());
		classes.get(className).add(name);
	}

	return classes;
}
