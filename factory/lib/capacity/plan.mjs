import { classesReachedBy, resourceClassOf } from "../config/profiles.mjs";
import { profilesReachedBy } from "../config/routing.mjs";
import { FactoryCapacityError } from "./errors.mjs";

/**
 * §9.1's capacity model, as the numbers the scheduler actually arbitrates over.
 *
 * | Dimension | Bound |
 * |---|---|
 * | ticket execution | the declared `maxTicketExecutions` |
 * | resource class | a declared per-class slot pool — **this is what arbitrates** |
 * | worker pane | **derived**: `maxTicketExecutions × MAX_PANES_PER_TICKET` |
 *
 * Nothing here reads the ceiling constant the loader validates against. The plan
 * takes whatever number the config settled on, so the acceptance suite (§15)
 * instantiates a two-lane scheduler by handing it a two, with no override seam
 * to reach for and nothing special-cased at one.
 */

/**
 * §9.1's named code constant, owned by §8.4's review fan-out: an attempt's own
 * pane plus one reviewer's at the widest point of the pipeline.
 *
 * It is **not** configurable, and the second reason is as load-bearing as the
 * first: `maxTicketExecutions: 2, maxWorkerPanes: 2` deadlocks the review phase,
 * and catching that statically would mean encoding this arithmetic into the
 * config loader anyway.
 */
export const MAX_PANES_PER_TICKET = 2;

/**
 * @param {object} inputs
 * @param {{ maxTicketExecutions: number, resources: Record<string, number> }} inputs.concurrency
 * @param {Record<string, object>} inputs.profiles the validated profile table
 * @param {{ roles: object, rules: ReadonlyArray<object> }} inputs.activeRouting the
 *   routing **this run** selected, because a dormant set's classes are sized but
 *   never in play (§11.5)
 * @returns {Readonly<object>} the pool, and the two numbers §9.7 asks `status`
 *   and `doctor` to print beside each other
 */
export function capacityPlan({ concurrency, profiles, activeRouting }) {
	const classes = Object.freeze(
		[...classesReachedBy(profiles, profilesReachedBy(activeRouting.roles, activeRouting.rules))]
			.map(([className, reached]) =>
				Object.freeze({
					class: className,
					size: concurrency.resources[className],
					profiles: Object.freeze([...reached].sort()),
				}),
			)
			.sort((left, right) => left.class.localeCompare(right.class)),
	);

	const resourceSlots = classes.reduce((total, entry) => total + entry.size, 0);
	// §9.4 acquires the **implement** attempt's model slot before the Gitea claim,
	// so those pools alone decide how many ticket executions can ever be started.
	const implementSlots = [
		...classesReachedBy(profiles, rolesReaching(activeRouting, "implement")).keys(),
	].reduce((total, className) => total + concurrency.resources[className], 0);

	return Object.freeze({
		declaredCeiling: concurrency.maxTicketExecutions,
		ticketSlots: concurrency.maxTicketExecutions,
		classes,
		resourceSlots,
		implementSlots,
		/**
		 * §9.2, stated as arithmetic rather than as a branch in the scheduler: a
		 * config saying 4 while routing resolves entirely to `local` is a
		 * comfortable lie, and this is the number that makes it visible.
		 *
		 * It is bounded by the **implement** pools rather than by every pool the
		 * routing reaches, because §9.4 holds an implement model slot before the
		 * claim: a second ticket can never be claimed while the one slot is held,
		 * however many review slots sit idle beside it. Counting those in would
		 * reintroduce the same comfortable lie one level down — a config routing
		 * implement to `local` and review to the cloud would advertise the cloud's
		 * parallelism for work that has to start on the GPU.
		 */
		effectiveConcurrency: Math.min(concurrency.maxTicketExecutions, implementSlots),
		paneBound: concurrency.maxTicketExecutions * MAX_PANES_PER_TICKET,
	});
}

/**
 * The class an implement attempt on this ticket would draw its slot from —
 * §9.4's "acquire the ticket slot and its implement attempt's model-resource
 * slot together, before the Gitea claim".
 *
 * @param {{ profiles: Record<string, object>, activeRouting: object }} routing
 * @param {{ ticket?: number | null, labels?: ReadonlyArray<string> }} member
 * @returns {string}
 * @throws {FactoryCapacityError} `routing-ambiguous`
 */
export function implementResourceClass({ profiles, activeRouting }, member) {
	return resourceClassOf(profiles[resolveRole(activeRouting, { role: "implement", ...member })]);
}

/** Every profile a role can dispatch to, across its declared value and its rules. */
function rolesReaching(activeRouting, role) {
	const reached = new Set([activeRouting.roles[role]].flat());
	for (const rule of activeRouting.rules) {
		if (rule.role === role) for (const profile of [rule.profile].flat()) reached.add(profile);
	}

	return reached;
}

/**
 * §11.5's two-level conflict rule, second level. The loader answers the static
 * half — two rules for one role whose `labelsAny` sets intersect — with no
 * ticket in hand. This is the half that needs one: a ticket carrying labels from
 * two *disjoint* rules matches both, and there is no positional first-match to
 * fall back on.
 *
 * It is raised **before any work**, which is why it is a refusal here rather
 * than a value the caller has to check: the alternative is a lane that has
 * already claimed a ticket discovering that nothing can say which model to run.
 *
 * @param {{ roles: object, rules: ReadonlyArray<object> }} activeRouting
 * @param {{ role: string, ticket?: number | null, labels?: ReadonlyArray<string> }} request
 * @returns {string | ReadonlyArray<string>} the profile name, or `review`'s pair
 * @throws {FactoryCapacityError} `routing-ambiguous`
 */
function resolveRole(activeRouting, { role, ticket = null, labels = [] }) {
	const matched = activeRouting.rules.filter(
		(rule) => rule.role === role && rule.labelsAny.some((label) => labels.includes(label)),
	);

	if (matched.length > 1) {
		const profiles = [...new Set(matched.flatMap((rule) => rule.profile))].sort();
		throw new FactoryCapacityError(
			"routing-ambiguous",
			`Ticket ${ticket ?? "(unnamed)"} matches ${matched.length} routing rules for role "${role}" (${profiles.join(", ")}), and §11.5 has no positional first-match. A human decides which label the ticket keeps.`,
			{
				at: "routing.rules",
				role,
				ticket,
				profiles,
				labels: matched.flatMap((rule) => rule.labelsAny.filter((label) => labels.includes(label))),
			},
		);
	}

	return matched.length === 1 ? matched[0].profile : activeRouting.roles[role];
}
