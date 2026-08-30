import {
	AGENT_BORNE_PHASES,
	BASE_KINDS,
	EVIDENCE_TRUST,
	PHASE_HARVEST,
	PHASE_IMPLEMENT,
	PHASE_REVIEW,
	PHASE_VERIFY,
	RETRY_BASES,
	STAGE_ACTIONS,
} from "../domain/vocabulary.mjs";
import { createAttemptWorktree } from "../git/attempt.mjs";
import { attemptBranch } from "../git/isolation.mjs";
import { runStream } from "../state/events.mjs";
import {
	allocateAttempt,
	dispatchedAttempts,
	mintAttempt,
	ordinalOf,
	requireAttemptIdentity,
	runOf,
	ticketOf,
} from "../worker/attempt.mjs";
import { PIPELINE_ROLES } from "../worker/roles.mjs";
import { FactoryPipelineError } from "./errors.mjs";

/**
 * §8.5's tiers, and the trust framing of the prompt that drives them.
 *
 * **Every resume is a fresh attempt with a fresh worktree**, so nothing in this
 * module continues a session, resumes a transcript, or reuses a worktree. What
 * the tiers differ on is one question — *is the prior attempt's work worth
 * keeping* — and every other difference follows from the answer:
 *
 * | | branches from | work | profile |
 * |---|---|---|---|
 * | **repair** | the prior attempt's tip | preserved | the originating attempt's, pinned |
 * | **fresh-retry** | the pinned base | discarded | routed, and the one place routing is tier-dependent |
 * | **rebase-repair** (#194) | the prior attempt's tip | preserved, and rebased by the worker | the originating attempt's, pinned |
 *
 * A rebase-repair answers the question **before it is asked**: the prior tip
 * conflicts textually with a base that moved, and whether that invalidates the
 * work is what the pipeline measures at the rebased commit. It keeps the work
 * and the profile for the repair's reason, and adds the one fact a repair does
 * not carry — `onto`, the base commit the controller's own rebase could not
 * replay the branch onto, read off the failure and never off the routing or the
 * clone, so a re-entry plans the same rebase the first controller did.
 *
 * **#155's `reroute` is a third planner here and is not a tier** (`planReroute`):
 * it branches from the prior tip and keeps the role, like a repair, and changes
 * the profile, like a fresh-retry — because it is neither question. Nothing was
 * judged; a provider refused to serve the attempt, and the work has to happen
 * somewhere else.
 *
 * They answer different failures. A failing test is usually a small fix on top
 * of good work; a worker that flailed should not have its flailing inherited.
 *
 * **§8.10's automation `retry` is not a tier and lives here anyway**
 * (`planAutomationRetry`, #146): the automation failed rather than the work, so
 * it asks neither question — the prior tip, the pinned profile, the role already
 * running. It shares this module because it shares everything a tier does *after*
 * the question is answered, and it is a separate function because the question is
 * the only thing a tier is. It plans an **agent-borne** phase only: `verify` and
 * `integrate` have no worker (§8.8), so `walkStages` re-enters those under the
 * attempt it is already walking and never asks for a plan at all.
 *
 * **The repair chain reaches the PR unsquashed.** A repair branch starts at the
 * prior tip and nothing here rewrites, amends, squashes, or cherry-picks what a
 * worker committed — stated explicitly, because the alternative is the
 * controller rewriting worker commits, which is a new class of thing for it to
 * get wrong. The history is honest about what happened.
 *
 * **A tier is always planned from a failure**, never from a tier name alone: the
 * tier *is* §8.10's row for that failure, and the brief the next worker is given
 * is built from the same row. One input, so the attempt that runs and the
 * evidence it is given cannot come to describe different failures.
 */

/** §8.5's fresh-retry role, read from the inventory that owns role names (§6.1). */
export const FRESH_RETRY_ROLE = PIPELINE_ROLES.find((role) => role.routingRole === "freshRetry");

/**
 * Whose words a phase's evidence is, where §8.10's row marks it untrusted.
 * `implement` answers with the prior builder's own account of its failure;
 * `review` with the reviewer's findings. Both are worker-authored text, and
 * neither is a fact about the world.
 */
const UNTRUSTED_SOURCES = Object.freeze({
	[PHASE_IMPLEMENT]: "the prior worker",
	[PHASE_REVIEW]: "the reviewer",
});

/**
 * Who produced a phase's evidence, where §8.10's row marks it fact. Both are
 * programs the controller ran itself and read the exit code of: §8.2's check
 * runner in its own verification worktree, and §7.4's git predicates.
 */
const FACT_PRODUCERS = Object.freeze({
	[PHASE_VERIFY]: { producer: "checks", label: "checks" },
	[PHASE_HARVEST]: { producer: "git", label: "predicate" },
});

/**
 * #194: a rebase conflict's evidence is git's, whichever phase met it. §9.5
 * puts a rebase in both `verify` and `integrate`, and neither phase's producer
 * above describes it — no check ran, and no harvest predicate was asked. The
 * detail is the controller's own reading of the repository: the base commit,
 * the previous base, the paths the index could not merge, and the base's own
 * movement as `git diff --stat` printed it.
 */
const REBASE_CONFLICT_FACT = Object.freeze({ producer: "git", label: "rebase" });

/** Which producer a phase's fact detail is attributed to, for the row's outcome. */
function factProducer(phase, outcome) {
	if (outcome === "rebase-conflict") return REBASE_CONFLICT_FACT;
	return FACT_PRODUCERS[phase] ?? { producer: "controller", label: "detail" };
}

/**
 * The fields of a prior attempt's outbox record that are **the worker's own
 * prose** (§6.6). §8.5 names the prior worker's summary as untrusted material,
 * and it reaches a repair from the outbox rather than from the failing stage —
 * a `verify` failure's detail is check output, and the worker's account of what
 * it was doing is somewhere else entirely.
 */
const WORKER_AUTHORED_RESULT_FIELDS = Object.freeze(["summary", "explanation", "question"]);

/**
 * The originating attempt, read from the record that minted it.
 *
 * Repair is pinned to *that attempt's* profile (§11.5), so the profile has to
 * come from somewhere durable — and the only honest somewhere is the
 * `attempt.launched` payload, which is what the controller actually dispatched
 * rather than what today's config would dispatch. A run whose config changed
 * mid-flight would otherwise repair under a profile the prior attempt never ran.
 *
 * The journal rather than the `attempt` projection because the projection holds
 * the tuple and not the payload: it can say an attempt exists, which is what
 * `launchedAttempt` is for, and cannot say what it was dispatched as.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number, attempt: string }} where
 * @returns {Readonly<{ attempt: string, ordinal: number, phase: string, role: string,
 *   profile: string | null, branch: string }> | null} `null` for an attempt
 *   nothing launched — there is nothing to continue from, and inventing it would
 *   be the controller reasoning about an external fact (§14.1)
 */
export function originatingAttempt(store, { run, ticket, attempt }) {
	const launched = store
		.readEvents({ stream: runStream(run), kind: "attempt.launched" })
		.find((record) => record.ticket === ticket && record.attempt === attempt);
	if (launched === undefined) return null;

	return Object.freeze({
		attempt,
		ordinal: ordinalOf(attempt),
		phase: launched.phase,
		role: launched.payload.role,
		profile: launched.payload.profile ?? null,
		// Derived, never read back: §7.3 makes the branch a deterministic function
		// of the tuple, and a repair reaching for a *recorded* branch name would be
		// reading a copy of something it can compute.
		branch: attemptBranch({ ticket, attempt }),
	});
}

/**
 * Plan the next attempt for the tier §8.10's row names. Pure: it reads no clock,
 * no git, and no store, so the same failure plans the same tier, profile and base
 * on a re-entry after a crash — which is what makes calling it twice harmless.
 *
 * **It does not name the attempt.** §2.1's ordinal is per ticket execution and
 * §8.4's review mints into the same space, so "one past the attempt I am
 * answering" is a guess that collides the moment a review has run. The id is
 * allocated against the record in `openRetryAttempt`, which has the store.
 *
 * @param {object} context
 * @param {Readonly<object>} context.prior the originating attempt (`originatingAttempt`)
 * @param {object} context.failure the resolved stage that routed here
 * @param {string} context.failure.phase
 * @param {string} context.failure.outcome
 * @param {object | null} [context.failure.detail]
 * @param {Readonly<object>} context.failure.row §8.10's row, whose action is the tier
 * @param {Readonly<object> | null} [context.priorResult] the prior attempt's
 *   outbox record, where it wrote one (§6.6) — its prose is untrusted material
 * @param {Readonly<object>} [context.route] `worker/dispatch.mjs`'s route record
 *   for the fresh-retry role, already settled against §9.8's memo.
 *   **Required for fresh-retry and unread for repair** — which is what makes
 *   "repair is not routable" a property of this function's shape rather than a
 *   branch somebody could later make read the routing "just for the model"
 * @returns {Readonly<{ tier: string, priorAttempt: string,
 *   role: string, routingRole: string | null, profile: string, routed: boolean,
 *   from: Readonly<{ kind: string, of: string | null }>, inheritsWork: boolean,
 *   brief: Readonly<object> }>} **no attempt id**: §2.1's ordinal is allocated
 *   against the record, which is `openRetryAttempt`'s to do — see `allocateAttempt`
 * @throws {FactoryPipelineError} `retry-unplannable`
 */
export function planRetry({ prior, failure, priorResult = null, route = null }) {
	const tier = failure?.row?.action;
	if (!Object.hasOwn(RETRY_BASES, tier)) {
		// §8.10's `retry` is the near miss worth naming, because it *is* a retry and
		// a caller will reasonably bring one here. It is not a §8.5 tier: the
		// automation failed rather than the work, so it re-enters the phase it left
		// rather than rebuilding — and what that costs differs by phase, which is
		// why it has a planner of its own rather than a third branch in this one
		// (#146).
		const aboutRetry =
			tier === STAGE_ACTIONS.retry
				? " §8.6's automation retry is not a tier: it re-enters the phase it left, and `planAutomationRetry` is" +
					" what plans one (§8.10)."
				: "";
		throw unplannable("tier", `${JSON.stringify(tier ?? null)} is not one of §8.5's tiers.${aboutRetry}`, {
			tier: tier ?? null,
			expected: Object.keys(RETRY_BASES).join("|"),
		});
	}

	requirePriorAttempt(prior);
	const shared = {
		tier,
		priorAttempt: prior.attempt,
		routingRole: null,
		brief: repairBrief({ tier, prior, priorResult, ...failure }),
	};

	// The tiers are built by separate expressions rather than by one with
	// conditionals, because the pinned ones **take no routing at all**: "repair is
	// not routable" is then a property of the code's shape rather than a branch
	// somebody could later make read the routing "just for the model".
	if (tier === STAGE_ACTIONS.repair) {
		// The one way a repair could still be planned here is by asking the routing
		// — which is the re-routing §11.5 forbids, arrived at through the back door
		// of a missing record rather than through a decision.
		return pinnedToPrior({ ...shared, action: tier, prior });
	}

	if (tier === STAGE_ACTIONS.rebaseRepair) {
		// #194: pinned exactly as a repair is — the work is kept, so the profile
		// that wrote it is kept — plus the base to rebase onto, which is the
		// failure's own fact. It is refused rather than filled from a fetch: the
		// commit the controller's rebase could not replay onto is the one the
		// worker is briefed with, and a fresher tip would brief it with a base
		// nobody measured the conflict against.
		const onto = failure.detail?.base_commit;
		if (typeof onto !== "string" || onto.length === 0) {
			throw unplannable(
				"onto",
				`A rebase-repair rebases the prior attempt's tip onto the base commit its rebase conflicted with (§8.5, ` +
					`#194), and the ${failure.phase} × ${failure.outcome} detail names no base_commit. There is nothing to ` +
					"brief the worker with, and reading a fresh tip instead would name a base nobody measured the conflict against.",
				{ tier, phase: failure.phase, outcome: failure.outcome },
			);
		}
		return pinnedToPrior({ ...shared, action: tier, prior, onto });
	}

	if (typeof route?.profile !== "string") {
		throw unplannable(
			"route",
			"A fresh-retry is the one tier-dependent routing point (§11.5), so it is planned with the dispatch decision " +
				"for that role in hand — §11.5's answer, read under §9.8's memo. Planning one without it could only mean " +
				"guessing the profile, and the guess with a plausible defence — the implement role's — is exactly the " +
				"implicit freshRetry §11.5 says does not exist.",
			{ tier, found: route?.profile ?? null },
		);
	}

	return Object.freeze({
		...shared,
		role: FRESH_RETRY_ROLE.name,
		routingRole: FRESH_RETRY_ROLE.routingRole,
		profile: route.profile,
		routed: true,
		routing: route,
		from: Object.freeze({ kind: RETRY_BASES[tier], of: null }),
		inheritsWork: false,
	});
}

/**
 * Plan §8.10's automation `retry` of an **agent-borne** phase: the same work,
 * relaunched (§8.6, #146).
 *
 * It is a planner of its own rather than a third branch in `planRetry` because
 * it answers a different question. A tier asks *is the prior attempt's work
 * worth keeping* and the answer decides everything else; this asks nothing — the
 * automation failed and the work was never judged, so the branch starts at the
 * prior tip, the profile stays pinned, and the role is the one that was already
 * running. **Nothing about it is routed**: §11.5 makes fresh-retry the one
 * tier-dependent routing point, and re-routing a builder because its pane died
 * would be a model change nobody asked for.
 *
 * **A controller phase is refused here, and that refusal is the ticket's answer
 * rather than a gap.** `verify` and `integrate` have no worker (§8.8), so there
 * is no worker run for a fresh attempt to be — `walkStages` re-enters those
 * phases under the attempt it is already walking, at the next try, and never
 * asks a seam. Planning one here would mint an attempt row with no pane, no
 * worktree and no manifest behind it.
 *
 * @param {object} context
 * @param {Readonly<object>} context.prior the originating attempt (`originatingAttempt`)
 * @param {object} context.failure the resolved stage that routed here, as
 *   `planRetry` takes it
 * @param {Readonly<object> | null} [context.priorResult] the prior attempt's
 *   outbox record, where it wrote one — usually absent, since the outcomes that
 *   route here are the ones where nothing readable arrived
 * @returns {Readonly<object>} the same plan shape `planRetry` answers with, so
 *   `openRetryAttempt` opens either without asking which produced it
 * @throws {FactoryPipelineError} `retry-unplannable`
 */
export function planAutomationRetry({ prior, failure, priorResult = null }) {
	const action = failure?.row?.action;
	if (action !== STAGE_ACTIONS.retry) {
		throw unplannable(
			"action",
			`${JSON.stringify(action ?? null)} is not §8.10's automation retry; §8.5's two tiers are \`planRetry\`'s.`,
			{ action: action ?? null, expected: STAGE_ACTIONS.retry },
		);
	}

	// **`implement` exactly**, and not §8.1's agent-borne pair. `review`'s retry
	// rows are its own attempt outcomes, spent inside §8.4's fan-out where an axis
	// is reopened at the reviewed commit under a read-only posture — a relaunch
	// planned from a builder's tip would be the wrong attempt in every slot. A
	// controller phase has no worker at all (§8.8). So this is the one phase whose
	// automation retry is a worker run, and every other phase is refused rather
	// than given a plan that would mint an attempt nothing launches (#146).
	if (failure.phase !== PHASE_IMPLEMENT) {
		throw unplannable("phase", phaseComplaint(failure, action), {
			phase: failure.phase,
			outcome: failure.outcome,
			expected: PHASE_IMPLEMENT,
		});
	}

	requirePriorAttempt(prior);
	return pinnedToPrior({
		action,
		prior,
		tier: action,
		priorAttempt: prior.attempt,
		routingRole: null,
		brief: repairBrief({ tier: action, prior, priorResult, ...failure }),
	});
}

/**
 * Plan #155's `reroute`: **the same work, on the next profile §11.5's declared
 * order names** (§8.10, §9).
 *
 * A third planner rather than a branch in either of the other two, because it
 * answers a third question. A tier asks *is the prior attempt's work worth
 * keeping*; an automation retry asks nothing and pins everything; this asks
 * *where else may this run?* and takes exactly one answer from the caller — the
 * route — while pinning everything else to the attempt it replaces.
 *
 * **The branch starts at the prior tip.** The refused attempt itself committed
 * nothing (a provider that refuses serves no tokens), but the attempt it is
 * repairing or retrying from may have, and discarding that chain would turn a
 * quota blip into a lost repair — which is the same failure this ticket exists
 * to remove, one tier down.
 *
 * **Nothing about the role changes.** A reroute of a builder is a builder and a
 * reroute of a review axis is that axis: §11.5's order is per role, and a
 * reroute that also changed the role would be answering a question nobody asked
 * about work nobody judged.
 *
 * @param {object} context
 * @param {Readonly<object>} context.prior the originating attempt (`originatingAttempt`)
 * @param {object} context.failure the resolved stage that routed here
 * @param {Readonly<object>} context.route `worker/dispatch.mjs`'s route record,
 *   already settled against the memo. **Required, and required to name a
 *   profile**: a planner that selected one itself would be a second dispatch
 *   decision beside the one the caller has already recorded
 * @param {Readonly<object> | null} [context.priorResult]
 * @returns {Readonly<object>} the plan shape `openRetryAttempt` opens
 * @throws {FactoryPipelineError} `retry-unplannable`
 */
export function planReroute({ prior, failure, route, priorResult = null }) {
	const action = failure?.row?.action;
	if (action !== STAGE_ACTIONS.reroute) {
		throw unplannable(
			"action",
			`${JSON.stringify(action ?? null)} is not §8.10's reroute; §8.5's two tiers are \`planRetry\`'s and the ` +
				"automation retry is `planAutomationRetry`'s.",
			{ action: action ?? null, expected: STAGE_ACTIONS.reroute },
		);
	}

	if (typeof route?.profile !== "string") {
		throw unplannable(
			"route",
			"A reroute runs the profile the dispatch decision selected (§11.5, §9), and this caller passed none. Choosing " +
				"one here would be a second dispatch decision beside the recorded one, and the two would eventually name " +
				"different providers for the one attempt.",
			{ action, found: route?.profile ?? null },
		);
	}

	requirePriorAttempt(prior);

	return Object.freeze({
		tier: action,
		priorAttempt: prior.attempt,
		role: prior.role,
		routingRole: null,
		profile: route.profile,
		routed: true,
		// The whole decision, carried onto the mint: §6.5 re-asserts a *declared*
		// model against the observed one, and a substitution the record does not
		// name is precisely the difference that re-assertion exists to catch.
		routing: route,
		from: Object.freeze({ kind: BASE_KINDS.priorTip, of: prior.branch }),
		inheritsWork: true,
		brief: repairBrief({ tier: action, prior, priorResult, ...failure }),
	});
}

/**
 * The profiles this ticket execution has had **refused** for one role — the
 * attempts whose stage §8.10 routed to a `reroute`.
 *
 * **This is what bounds a reroute** (§9.9): each routable profile is refused at
 * most once, so the chain is at most as long as §11.5's declared order and there
 * is no counter to declare, compare, or forget to increment. It is derived from
 * the journal for the same reason §8.6's budgets are: the bound and the spend
 * are one expression, and a re-entry after a crash reads the same answer back —
 * an in-memory list would let a controller that died mid-chain re-dispatch a
 * profile the provider has already refused.
 *
 * **Refused, not merely dispatched**, and the difference is a whole failure
 * mode. §8.10's automation retry relaunches the same work on the same pinned
 * profile — a pane that died says nothing about its provider — so a profile a
 * retry ran is not spent. Excluding it would turn every infra flake into a
 * silent model change, and on a routing with no fallback into a released ticket.
 * The attempt being rerouted *now* is included by construction: its stage is
 * resolved before the seam is asked.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number, role: string }} where the role is a
 *   §6.1 pipeline role name, which is what the mint records
 * @returns {ReadonlyArray<string>}
 */
export function refusedProfiles(store, { run, ticket, role }) {
	const profiles = new Map(
		dispatchedAttempts(store, { run, ticket })
			.filter((entry) => entry.role === role && typeof entry.profile === "string")
			.map((entry) => [entry.attempt, entry.profile]),
	);

	return Object.freeze([
		...new Set(
			rerouted(store, { run, ticket })
				.map((attempt) => profiles.get(attempt))
				.filter((profile) => profile !== undefined),
		),
	]);
}

/** The attempts §8.10 routed to a reroute, in the order the journal holds them. */
function rerouted(store, { run, ticket }) {
	return store
		.readEvents({ stream: runStream(run), kind: "stage.resolved" })
		.filter((record) => record.ticket === ticket && record.payload.action === STAGE_ACTIONS.reroute)
		.map((record) => record.attempt);
}

/** Why a phase other than `implement` gets no automation-retry plan (§8.4, §8.8). */
function phaseComplaint({ phase, outcome }, action) {
	const because = AGENT_BORNE_PHASES.includes(phase)
		? "§8.4's fan-out mints and spends its own axis attempts, so a retry of one is never the walk's to plan"
		: `${phase} has no worker (§8.8), so there is no worker run for a fresh attempt to be — the walk re-enters it ` +
			"under the attempt it is already on";

	return (
		`§8.10 routes ${phase} × ${outcome} to ${action}, and ${because}. Planning one here would mint an attempt with ` +
		"no pane, worktree, or manifest behind it (#146)."
	);
}

/**
 * A relaunch **pinned to the prior attempt**: its tip, its role, its profile.
 *
 * Two rows land here — §8.5's `repair` and §8.10's automation `retry` of
 * `implement` — and they share every field because they share every answer once
 * their own question is settled. The question is what differs, and it is settled
 * before this is called; keeping one builder is what stops the two from drifting
 * into disagreeing about what "pinned" means.
 *
 * The profile is the one thing that can be missing, and its absence **refuses**:
 * the only other way to fill it is the routing, which is the re-routing §11.5
 * forbids reached through the back door of a missing record.
 */
function pinnedToPrior({ action, prior, ...plan }) {
	if (typeof prior.profile !== "string") {
		throw unplannable(
			"profile",
			`Attempt ${prior.attempt} has no recorded profile, and a ${action} runs the profile that attempt was ` +
				"dispatched under (§11.5). There is nothing else to pin to, and consulting the routing instead is the " +
				"re-routing neither row has.",
			{ tier: action, attempt: prior.attempt },
		);
	}

	return Object.freeze({
		...plan,
		role: prior.role,
		profile: prior.profile,
		routed: false,
		// No dispatch decision was made, and `null` says exactly that rather than
		// a record whose `declared` and `profile` agree because nobody chose
		// either. §11.5 pins these two rows to the originating attempt, and a
		// routing record on them would read as a routing that happened to land
		// where the pin already was.
		routing: null,
		from: Object.freeze({ kind: BASE_KINDS.priorTip, of: prior.branch }),
		inheritsWork: true,
	});
}

/**
 * Create the planned attempt's branch and worktree at its tier's base (§7.3,
 * §8.5).
 *
 * Both git mutations are `createAttemptWorktree`'s effects, so this is
 * re-enterable for the same reason a first attempt's claim is: a controller that
 * died between the branch and the worktree finishes the pair, and one that died
 * after both performs nothing. The plan being pure is what makes the re-entry
 * arrive at the same attempt id to find them under.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle (`git/clone.mjs`)
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {Readonly<object>} context.plan a `planRetry` plan
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {{ commit: string }} [context.base] §7.2's freshly fetched tip.
 *   **Required for fresh-retry**, unread by repair
 * @param {object} context.workerConfig §6.8's worker config environment
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Promise<Readonly<object>>} the plan with its allocated attempt id and
 *   the git facts on it
 * @throws {FactoryPipelineError} `retry-unplannable`
 */
export async function openRetryAttempt(
	store,
	clone,
	{ hold, plan, run, ticket, base = null, workerConfig, actor, at },
) {
	// §2.1's ordinal, allocated against the record: a re-entry after a crash finds
	// the record it already wrote and comes back with the same id, and a first pass
	// takes the next free ordinal — which is one past whatever a review fan-out has
	// already minted.
	const purpose = retryPurpose(plan);
	const allocated = allocateAttempt(store, { run, ticket, purpose });
	// A retry always re-enters `implement`: both tiers produce a builder attempt,
	// and the phase the failure came from is evidence rather than a destination.
	const identity = requireAttemptIdentity({ run, ticket, phase: PHASE_IMPLEMENT, attempt: allocated.attempt });
	const baseCommit = await retryBaseCommit(clone, { plan, base });

	mintAttempt(store, {
		hold,
		identity,
		role: plan.role,
		profile: plan.profile,
		routing: plan.routing ?? null,
		baseCommit,
		purpose,
		at,
	});

	const created = await createAttemptWorktree(store, clone, {
		hold,
		run,
		ticket,
		attempt: identity.attempt,
		phase: identity.phase,
		baseCommit,
		workerConfig,
		actor,
		at,
	});

	return Object.freeze({ ...plan, attempt: identity.attempt, ordinal: allocated.ordinal, ...created });
}

/**
 * §8.5's purpose for a retry attempt: **which tier produced it, which attempt it
 * answers, and what its branch starts from.**
 *
 * It is one function because it is read from two directions — written into the
 * mint by `mintAttempt`, and matched against it by `allocateAttempt` — and two
 * spellings of a key are two ways for a re-entry to allocate a second attempt for
 * work that is already open. It is also the journal's answer to *why does this
 * attempt exist*, rather than leaving an operator to infer a repair from two
 * attempts and a gap. Every field is a pure function of the plan, which is what
 * makes matching on all three deterministic.
 *
 * A rebase-repair's purpose carries `onto` as well (#194): the base it was told
 * to rebase onto is part of *why it exists*, and it is what §7.4's harvest reads
 * the commits-ahead boundary from afterwards — off the mint, so a re-entry and
 * the harvest phase read the one value the plan was made with.
 */
function retryPurpose(plan) {
	return {
		tier: plan.tier,
		prior_attempt: plan.priorAttempt,
		base_kind: plan.from.kind,
		...(plan.onto === undefined ? {} : { onto: plan.onto }),
	};
}

/**
 * The commit the tier's branch starts at.
 *
 * Repair resolves the prior branch **now** rather than carrying a tip captured
 * when the plan was made: the tip is the prior attempt's last commit, and
 * reading it at the moment the branch is created is what makes "branches from
 * the prior attempt's tip" true of the branch rather than of a stale value.
 */
async function retryBaseCommit(clone, { plan, base }) {
	if (plan.from.kind === BASE_KINDS.priorTip) {
		return clone.git(["rev-parse", "--verify", `refs/heads/${plan.from.of}^{commit}`]);
	}

	if (base === null || typeof base?.commit !== "string") {
		throw unplannable(
			"base",
			"A fresh-retry branches from the pinned base (§8.5), and §7.2 pins it by fetching immediately before the " +
				"branch is created. Without that fetch there is no base to pin, and the prior attempt's own base is a " +
				"commit the run has since moved past.",
			{ tier: plan.tier },
		);
	}

	return base.commit;
}

/**
 * The prior attempt, held to §2.1's shape while the plan is still pure.
 *
 * The plan no longer derives an id from it, but it still *names* it — as the
 * allocation's purpose, as the repair base's branch, and in the brief the next
 * worker reads — so a malformed id is refused here rather than at the moment a
 * store lookup silently matches nothing.
 */
function requirePriorAttempt(prior) {
	const parts = [runOf(prior?.attempt), ticketOf(prior?.attempt), ordinalOf(prior?.attempt)];
	if (parts.some((part) => part === null)) {
		throw unplannable("prior", `${JSON.stringify(prior?.attempt ?? null)} is not a §2.1 attempt id.`, {
			found: prior?.attempt ?? null,
		});
	}
}

/**
 * §8.5's repair brief: **what the next worker is told about the failure, split
 * by who wrote it.**
 *
 * The split is not editorial. Controller-produced evidence — check exit codes,
 * digest-referenced output, git predicates — is presented **as fact**, because
 * the controller ran those programs itself and read their exit codes.
 * Worker-authored text — the prior worker's account of its own failure, the
 * reviewer's findings — is quoted in a delimited untrusted block, because a
 * reviewer whose findings contain an injected directive must not have it
 * promoted into an instruction to a write-capable builder.
 *
 * **Which side a phase's evidence falls on is §8.10's own `evidence` column**
 * (`EVIDENCE_TRUST`), read off the row rather than decided here. A row's trust
 * marking and the action it routes to were declared together, and a second
 * opinion in this module is a second place for them to disagree. The prior
 * worker's own outbox prose is the one thing not on a row, and it is untrusted
 * unconditionally — there is no reading of §8.5 under which a worker's summary
 * is a fact.
 *
 * @param {object} context
 * @param {string} context.tier the plan's tier
 * @param {Readonly<object>} context.prior the originating attempt
 * @param {string} context.phase the phase whose result routed here
 * @param {string} context.outcome that phase's outcome
 * @param {object | null} [context.detail] the resolved stage's detail
 * @param {Readonly<object>} context.row §8.10's row for `(phase, outcome)`
 * @param {Readonly<object> | null} [context.priorResult] the prior attempt's outbox record
 * @returns {Readonly<{ tier: string, prior: object, phase: string, outcome: string,
 *   facts: ReadonlyArray<Readonly<{ producer: string, label: string, value: unknown }>>,
 *   untrusted: ReadonlyArray<Readonly<{ source: string, label: string, text: string }>> }>}
 */
export function repairBrief({ tier, prior, phase, outcome, detail = null, row, priorResult = null }) {
	// The frame is fact on every row, evidence or not: the controller minted the
	// prior attempt, walked it to this phase, and derived this outcome. A tier
	// with no evidence at all — a worker that wrote nothing readable — still owes
	// the next one the sentence explaining why it exists.
	const facts = [
		{ producer: "controller", label: "tier", value: tier },
		{ producer: "controller", label: "prior_attempt", value: prior.attempt },
		{ producer: "controller", label: "phase", value: phase },
		{ producer: "controller", label: "outcome", value: outcome },
	];
	const untrusted = [];

	if (detail !== null && row.evidence === EVIDENCE_TRUST.fact) {
		const { producer, label } = factProducer(phase, outcome);
		facts.push({ producer, label, value: factDetail(phase, detail) });
	}

	if (detail !== null && row.evidence === EVIDENCE_TRUST.untrusted) {
		const source = UNTRUSTED_SOURCES[phase] ?? "a worker";
		for (const [label, value] of Object.entries(detail)) {
			untrusted.push({ source, label, text: quoted(value) });
		}
	}

	for (const field of WORKER_AUTHORED_RESULT_FIELDS) {
		const value = priorResult?.[field];
		// A field the routing phase's own detail already carried is not repeated:
		// one voice saying one thing once.
		if (value === undefined || value === null || untrusted.some((entry) => entry.label === field)) continue;
		untrusted.push({ source: UNTRUSTED_SOURCES[PHASE_IMPLEMENT], label: field, text: quoted(value) });
	}

	return Object.freeze({
		tier,
		prior: Object.freeze({ attempt: prior.attempt, profile: prior.profile ?? null }),
		phase,
		outcome,
		facts: Object.freeze(facts.map((fact) => Object.freeze(fact))),
		untrusted: Object.freeze(untrusted.map((entry) => Object.freeze(entry))),
	});
}

/**
 * A verify repair always needs the required failure that routed it. Advisory
 * check records reach a prompt only through their explicit `feeds` declaration,
 * resolved by `pipeline/feeds.mjs`; leaving them in this generic fact would make
 * an unfed check appear anyway and turn the declaration into decoration.
 */
function factDetail(phase, detail) {
	if (phase !== PHASE_VERIFY || !Array.isArray(detail?.checks)) return detail;
	return { ...detail, checks: detail.checks.filter((check) => check.severity === "required") };
}

/** Untrusted material reaches the prompt as text, whatever shape it arrived in. */
function quoted(value) {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function unplannable(at, sentence, details = {}) {
	return new FactoryPipelineError("retry-unplannable", sentence, { at, ...details });
}
