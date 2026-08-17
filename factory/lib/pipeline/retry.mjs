import { BASE_KINDS, RETRY_TIERS, STAGE_ACTIONS } from "../domain/vocabulary.mjs";
import { PIPELINE_ROLES } from "../worker/roles.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import {
	dispatchedProfiles,
	openRetryAttempt,
	originatingAttempt,
	planAutomationRetry,
	planReroute,
	planRetry,
} from "./repair.mjs";

/**
 * §8.5's tier seam, composed — **the `nextAttempt` a lane hands `walkStages`.**
 *
 * The walk cannot build this itself, which is why it is a seam at all: planning
 * needs the private clone, §11.5's routing and §7.2's pinned base, and none of
 * those is the walk's. What it *does* own is the decision to retry — §8.6's
 * budget is asked before this is called, once, so no composition of it can
 * disagree about affordability (`pipeline/budgets.mjs`).
 *
 * **Three of §8.10's four retry rows arrive here, and the fourth never does**
 * (#146). `repair` and `fresh-retry` are §8.5's tiers. §8.10's automation
 * `retry` of an **agent-borne** phase is a relaunch of the same work. Its retry
 * of a **controller** phase — `verify × unrunnable`, `integrate × push-failed` —
 * mints nothing at all: those phases have no worker (§8.8), so `walkStages`
 * re-enters them under the attempt it is already walking at the next try, and
 * this seam is not asked. Reaching here with one is a composition defect, and it
 * is refused rather than given a plan, because a plan would mint an attempt row
 * with no pane, no worktree, and no manifest behind it.
 *
 * **The seam mints and opens; it does not launch.** A retry re-enters
 * `implement` — both tiers by §8.5, and an agent-borne automation retry because
 * that is the phase it left — and the walk calls the `implement` executor with
 * the attempt this answered with. Launching there rather than here is what keeps
 * one launch path for a first attempt and a retried one.
 */

/**
 * @param {object} store an open store
 * @param {object} clone the private clone's handle (`git/clone.mjs`)
 * @param {object} context
 * @param {object} context.hold the controller's hold (`controller/lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.baseBranch the default branch a fresh-retry pins to.
 *   **Fetched when a plan needs it and never before**: §7.2 pins the base by
 *   fetching immediately before the branch is created, so a base captured when
 *   the seam was built would be a commit the run has since moved past
 * @param {((request: { role: string, routingRole: string, dispatched: ReadonlyArray<string> }) => Promise<object>) | null} [context.selectRoute]
 *   §11.5's dispatch for one role, read under §9.8's memo (#155). **Required for
 *   fresh-retry and for a reroute, unread by every other row**: those are the two
 *   places a profile is chosen rather than pinned, and choosing one without the
 *   memo is how a run relaunches into the refusal it just paid to learn about
 * @param {object} context.workerConfig §6.8's worker config environment
 * @param {((attempt: string) => object | null) | null} [context.readResult] the
 *   prior attempt's §6.6 outbox record, where it wrote one. It is injected
 *   rather than read here because §6.6's file is the worker module's to
 *   interpret, and a repair needs only the prose off it (§8.5)
 * @param {string} context.actor
 * @param {() => number} context.now
 * @returns {(request: object) => Promise<Readonly<{ attempt: string, plan: Readonly<object> }>>}
 */
export function createRetrySeam(
	store,
	clone,
	{ hold, run, ticket, baseBranch, selectRoute = null, workerConfig, readResult = null, actor, now },
) {
	return async function nextAttempt(request) {
		const prior = requirePrior(store, { run, ticket, attempt: request.attempt, request });
		const failure = { phase: request.phase, outcome: request.outcome, detail: request.detail, row: request.row };
		const priorResult = readResult === null ? null : readResult(prior.attempt);

		// Dispatched on §8.10's **row**, which is also what every planner validates.
		// The request carries a `tier` beside it, derived from this same field by
		// the walk — reading that one here instead would make the choice of planner
		// and the planner's own check two facts that agree only by convention.
		const plan = await planned({ prior, failure, priorResult });

		const opened = await openRetryAttempt(store, clone, {
			hold,
			plan,
			run,
			ticket,
			// §7.2's pin, fetched here and nowhere earlier. `openRetryAttempt` reads
			// it only for a `pinned-base` plan, and asking for one on a `prior-tip`
			// plan would put a network round trip on the path that branches from a
			// local ref.
			base: plan.from.kind === BASE_KINDS.pinnedBase ? await clone.fetchBase({ baseBranch }) : null,
			workerConfig,
			actor,
			at: now(),
		});

		return Object.freeze({ attempt: opened.attempt, plan: opened });
	};

	/**
	 * The right planner for §8.10's row, and the route for the two rows that need
	 * one.
	 *
	 * The two are asked for separately because they are different questions: a
	 * **fresh-retry** re-dispatches the `freshRetry` role from scratch, so its
	 * order starts fresh too — discarding the work is the point, and refusing the
	 * profile that built it would be a rule §11.5 does not have. A **reroute**
	 * keeps the role it is on and excludes what this ticket execution has already
	 * dispatched for it, which is the bound that makes the chain finite.
	 */
	async function planned({ prior, failure, priorResult }) {
		const action = failure.row?.action;

		if (action === STAGE_ACTIONS.reroute) {
			return planReroute({
				prior,
				failure,
				priorResult,
				route: await routed({
					role: prior.role,
					dispatched: dispatchedProfiles(store, { run, ticket, role: prior.role }),
					action,
					failure,
				}),
			});
		}

		if (!RETRY_TIERS.includes(action)) return planAutomationRetry({ prior, failure, priorResult });

		return planRetry({
			prior,
			failure,
			priorResult,
			route:
				action === STAGE_ACTIONS.freshRetry
					? await routed({ role: FRESH_RETRY_ROLE.name, dispatched: [], action, failure })
					: null,
		});
	}

	/**
	 * §11.5's dispatch for one role, under §9.8's memo.
	 *
	 * **Nowhere left to go is a typed answer, not a plan with a hole in it**: the
	 * walk turns `routes-exhausted` into §8.10's budgetless release, so the
	 * refusal is thrown here rather than returned as a plan naming no profile.
	 */
	async function routed({ role, dispatched, action, failure }) {
		if (typeof selectRoute !== "function") {
			throw new FactoryPipelineError(
				"retry-unplannable",
				`§8.10 routes ${failure.phase} × ${failure.outcome} to ${action}, which chooses a profile rather than ` +
					"pinning one (§11.5), and this caller wired no dispatch seam to choose it with. Reaching for the " +
					"routing without §9.8's memo is how a run relaunches into the refusal it just paid to learn about.",
				{ at: "seam", role, action, phase: failure.phase, outcome: failure.outcome },
			);
		}

		const route = await selectRoute({ role, dispatched });
		if (typeof route?.profile === "string") return route;

		throw new FactoryPipelineError(
			"routes-exhausted",
			`Every profile §11.5's order names for role "${role}" belongs to a resource class §9.8's memo has recorded ` +
				`unavailable (${describeRoutes(route)}). The ticket goes back to the frontier untouched: no worker failed, ` +
				"no budget is owed, and the memo is what keeps the next claim out until a probe re-admits a class.",
			{ at: "route", role, action, phase: failure.phase, considered: route?.considered ?? [] },
		);
	}
}

/** §8.5's fresh-retry role, read from the inventory that owns role names (§6.1). */
const FRESH_RETRY_ROLE = PIPELINE_ROLES.find((role) => role.routingRole === "freshRetry");

/** What the order tried, for the sentence a released ticket is explained by. */
function describeRoutes(route) {
	const considered = route?.considered ?? [];
	if (considered.length === 0) return "no routable profile at all";

	return considered.map((seen) => `${seen.profile} on ${seen.class}: ${seen.state}`).join("; ");
}

/**
 * The attempt being answered, read from the record that minted it.
 *
 * A tier is planned from what the prior attempt **was dispatched as** (§11.5),
 * so an attempt with no launch record has nothing to pin to — and inventing one
 * would be the controller reasoning about a fact it never recorded (§14.1).
 */
function requirePrior(store, { run, ticket, attempt, request }) {
	const prior = originatingAttempt(store, { run, ticket, attempt });
	if (prior !== null) return prior;

	throw new FactoryPipelineError(
		"retry-unplannable",
		`§8.10 routes ${request.phase} × ${request.outcome} to ${request.row?.action ?? null}, and nothing in this store launched ` +
			`attempt ${attempt}. A retry is planned from what the prior attempt was dispatched as (§11.5), and there is ` +
			"no record of that to read.",
		{ at: "prior", run, ticket, attempt, phase: request.phase, outcome: request.outcome },
	);
}
