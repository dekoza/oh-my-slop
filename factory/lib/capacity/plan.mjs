import { classesReachedBy } from "../config/profiles.mjs";
import { profilesForRole, profilesReachedBy } from "../config/routing.mjs";
import { dispatchOrder, pooledCandidates, selectRoute } from "../worker/dispatch.mjs";
import { FactoryWorkerError } from "../worker/errors.mjs";
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
 * @param {{ set?: string | null, roles: object, rules: ReadonlyArray<object> }} inputs.activeRouting
 *   the routing **this run** selected, because a dormant set's classes are sized
 *   but never in play (§11.5). `set` is its name, or null for the file-level
 *   routing; a routing composed by hand carries no `set` and is read as that
 * @returns {Readonly<object>} the pool, and the two numbers §9.7 asks `status`
 *   and `doctor` to print beside each other
 */
export function capacityPlan({ concurrency, profiles, activeRouting }) {
	const classes = Object.freeze(
		[...classesReachedBy(profiles, profilesReachedBy(activeRouting))]
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
	// so those pools alone decide how many ticket executions can ever be started —
	// the fallback pools included, since #155 starts a rerouted implement attempt
	// from one of those and leaving them out would understate §9.2 by the reroute.
	const implementSlots = [
		...classesReachedBy(profiles, profilesForRole(activeRouting, "implement")).keys(),
	].reduce((total, className) => total + concurrency.resources[className], 0);

	return Object.freeze({
		/**
		 * Which §11.5 routing these numbers are the plan *for* — a named set, or
		 * null for the file-level routing.
		 *
		 * It rides the plan rather than being fetched beside it because the plan is
		 * what every reader already holds: `status` and `doctor` print the set
		 * against the sizes it produced, so an operator reading a capacity section
		 * can tell a comfortable ceiling under one routing from the same ceiling
		 * under another.
		 *
		 * **The absent form is spelled here and nowhere downstream**, the way
		 * `fallbacksOf` spells its own: a hand-composed routing has no name, and a
		 * second `?? null` at the reader would be a second opinion about that.
		 */
		set: activeRouting.set ?? null,
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
 * The route an implement attempt on this ticket would run — the profile and the
 * class its slot comes from, having stepped past every candidate §9.8's memo has
 * locked (#155).
 *
 * It answers §9.4's "acquire the ticket slot and its implement attempt's
 * model-resource slot together, before the Gitea claim", and it answers it with
 * a *route* rather than a class because the two are one decision: the class
 * names the pool the slot is taken from and the profile names what the attempt
 * is minted under, and deriving them separately is how a lane comes to hold a
 * slot in a pool its worker never touches.
 *
 * `profile: null` means the memo has locked every profile this role can reach —
 * §9.8's blocked candidate, now a stronger statement than one blocked class.
 *
 * @param {{ profiles: Record<string, object>, activeRouting: object }} routing
 * @param {{ ticket?: number | null, labels?: ReadonlyArray<string> }} member
 * @param {{ exhaustion: object, at?: number }} memo §9.8's facet (`slots.mjs`)
 * @returns {Promise<Readonly<object>>} `worker/dispatch.mjs`'s route record
 * @throws {FactoryCapacityError} `routing-ambiguous`
 */
export async function implementDispatch({ profiles, activeRouting }, member, { exhaustion, at, capacity = null }) {
	return selectRoute({
		order: implementOrder(activeRouting, member),
		pooled: pooledCandidates(activeRouting, { role: "implement", labels: member.labels }) !== null,
		capacity,
		profiles,
		exhaustion,
		at,
	});
}

/**
 * §11.5's dispatch order for the implement role, with the **ticket-scoped** half
 * of its two-level conflict rule raised as a capacity refusal.
 *
 * The resolution itself is `worker/dispatch.mjs`'s — one implementation of
 * §11.5, not two that agree by review. What is this package's is *when* the
 * refusal happens and what it is called: the scheduler asks before any claim, so
 * a ticket whose labels match two rules is refused with a ticket in hand and
 * never claimed, rather than a lane discovering mid-flight that nothing can say
 * which model to run.
 */
function implementOrder(activeRouting, { ticket = null, labels = [] }) {
	try {
		return dispatchOrder(activeRouting, { role: "implement", labels });
	} catch (error) {
		if (!(error instanceof FactoryWorkerError)) throw error;

		throw new FactoryCapacityError(
			"routing-ambiguous",
			`Ticket ${ticket ?? "(unnamed)"} cannot be dispatched: ${error.message}`,
			{ ...error.details, ticket },
		);
	}
}
