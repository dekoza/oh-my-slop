import { BASE_KINDS, RETRY_TIERS } from "../domain/vocabulary.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { openRetryAttempt, originatingAttempt, planAutomationRetry, planRetry } from "./repair.mjs";

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
 * @param {{ roles: object, rules: ReadonlyArray<object> } | null} [context.routing]
 *   §11.5's active routing. Required for fresh-retry and unread by every other row
 * @param {ReadonlyArray<string>} [context.labels] the ticket's labels, as the
 *   claim-time snapshot has them
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
	{ hold, run, ticket, baseBranch, routing = null, labels = [], workerConfig, readResult = null, actor, now },
) {
	return async function nextAttempt(request) {
		const prior = requirePrior(store, { run, ticket, attempt: request.attempt, request });
		const failure = { phase: request.phase, outcome: request.outcome, detail: request.detail, row: request.row };
		const priorResult = readResult === null ? null : readResult(prior.attempt);

		// Dispatched on §8.10's **row**, which is also what both planners validate.
		// The request carries a `tier` beside it, derived from this same field by
		// the walk — reading that one here instead would make the choice of planner
		// and the planner's own check two facts that agree only by convention.
		const plan = RETRY_TIERS.includes(failure.row?.action)
			? planRetry({ prior, failure, priorResult, routing, labels })
			: planAutomationRetry({ prior, failure, priorResult });

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
