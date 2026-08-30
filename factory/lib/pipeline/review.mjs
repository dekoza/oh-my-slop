import {
	CHECK_RESULTS,
	FINDING_SEVERITIES,
	PHASE_IMPLEMENT,
	PHASE_REVIEW,
	PHASE_VERIFY,
	REVIEW_VERDICTS,
	STAGE_ACTIONS,
} from "../domain/vocabulary.mjs";
import { createAttemptWorktree } from "../git/attempt.mjs";
import { assessMutation, captureWorktreeState } from "../git/attestation.mjs";
import { allocateAttempt, mintAttempt, mintedDispatch, requireAttemptIdentity } from "../worker/attempt.mjs";
import { routeSummary } from "../worker/dispatch.mjs";
import { postureOf, REVIEW_ROLES } from "../worker/roles.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { refusedProfiles } from "./repair.mjs";
import { FIRST_TRY, recordedStage, resolveStage, stageResults } from "./stages.mjs";
import { routeOutcome } from "./table.mjs";

/**
 * §8.4's review phase: **the controller fans out, not the worker.**
 *
 * Two independent read-only attempts — `review-standards` and `review-spec` —
 * each with its own entry skill, its own outbox, its own attempt identity, and
 * **its own worktree at the reviewed commit**, which preserves §7.3's
 * one-worktree-per-attempt invariant verbatim and is what makes a mutation
 * attributable to a specific attempt rather than to "the review".
 *
 * The fan-out sits here because both alternatives leak. A skill spawning its own
 * sub-agents depends on a tool that may not exist — pi's model-facing subagent
 * tool is a separate opt-in extension — and Herdr fan-out would hand a read-only
 * role the ability to open write-capable panes outside the controller's minted
 * identity, producing orphans invisible to reconcile and unreachable by `cancel`.
 * Nothing a reviewer is given here can start a pane: it gets a worktree, a diff,
 * and a file to write.
 *
 * **Both axes always run to completion.** The loop below runs them one after the
 * other and never short-circuits: neither is cancelled on the other's rejection,
 * because cancelling the survivor would manufacture a late-result-after-
 * cancellation case on a path that is not even an error, and the second axis's
 * findings improve the repair prompt. Running them in sequence is also what makes
 * §15's case 12 — a size-1 resource class, both attempts still completing, taking
 * turns — true by construction rather than by arithmetic: there is never a moment
 * when two review attempts want a model slot at once. §8.4 says simultaneity was
 * never the requirement, so the latency a larger class could have bought is
 * declined rather than paid for with a scheduling rule nobody can test.
 *
 * **The controller unions the blocking sets, and never merges or reranks them.**
 * `decideReview` concatenates in axis order, tags each finding with the axis that
 * wrote it, and drops nothing — which honours the skills' own refusal to rank
 * across axes for free.
 *
 * **The authoritative guard is the attestation, not the permissions.** §6.8 says
 * plainly that on this host worker permissions constrain behavior rather than
 * capability, so plan mode and withheld edit tools are belt and suspenders. What
 * decides is `git/attestation.mjs`: clean worktree and HEAD captured before the
 * review and verified unchanged after, with a mismatch typed `mutation-detected`
 * — §8.10's **only** outcome with no retry at all (§14.19), because a read-only
 * role that wrote has broken its own contract and retrying it buys a second
 * violation.
 */

/**
 * Run §8.1's review phase for one builder attempt.
 *
 * The answer is a §8.10 `review` row's outcome, ready for the stage machine to
 * resolve **under the builder attempt** — the two axes resolve their own stages
 * under their own attempt ids as they go, so the chain an operator reads carries
 * every axis result beside the phase's own.
 *
 * @param {object} store an open store
 * @param {object} clone the private clone's handle (`git/clone.mjs`)
 * @param {object} context
 * @param {object} context.hold the controller's hold (`controller/lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt the **builder** attempt whose work is reviewed.
 *   What the diff is measured against is deliberately **not** a parameter: both
 *   ends of it are read off the passing verify record (`verifiedBoundary`), and
 *   the attempt's own base (§7.3) — the prior attempt's tip for a repair — never
 *   reaches this phase at all, which is how the two meanings the one value
 *   conflated are kept apart (#161, #165)
 * @param {(request: { axis: string, index: number, dispatched: ReadonlyArray<string> }) => Promise<object>} context.routeAxis
 *   §11.5's dispatch for **one axis**, read under §9.8's memo (#155). It is a
 *   seam and per-axis for the same reason `runAxis` is either: selecting needs
 *   the capacity pool, which is not this phase's, and §8.4's two axes are
 *   independently routed — one call answering for both is how a single exhausted
 *   class comes to collapse them onto one profile with nothing saying it did
 * @param {object} context.workerConfig §6.8's worker config environment
 * @param {(request: object) => Promise<{ outcome: string, record: object | null }>} context.runAxis
 *   the seam that launches one read-only reviewer into a pane and waits for
 *   §6.6's typed completion. It is the caller's for the same reason `walkStages`'
 *   phase executors are: launching composes §6.8's environment, §11.5's dispatch
 *   and §9.4's model slot, and a fan-out that owned those would be a second lane
 * @param {((request: object) => Promise<unknown>) | null} [context.automationRetry]
 *   §8.6's budget, for the rows §8.10 routes to `retry`. It is asked before an
 *   axis is given another attempt and refuses by throwing (#111)
 * @param {string} context.actor
 * @param {() => number} context.now
 * @returns {Promise<Readonly<{ outcome: string, detail: Readonly<object> }>>}
 * @throws {FactoryPipelineError} `review-unroutable` · `retry-unplannable`
 */
export async function reviewPhase(
	store,
	clone,
	{
		hold,
		run,
		ticket,
		attempt: builderAttempt,
		workerConfig,
		runAxis,
		routeAxis,
		automationRetry = null,
		actor,
		now,
	},
) {
	const { baseCommit, reviewedCommit } = verifiedBoundary(store, { run, ticket, attempt: builderAttempt });
	const trace = builderTrace(store, { run, ticket, attempt: builderAttempt });
	const axes = [];

	for (const [index, axis] of REVIEW_ROLES.entries()) {
		axes.push(
			await walkAxis(store, clone, {
				hold,
				run,
				ticket,
				builderAttempt,
				axis,
				index,
				baseCommit,
				reviewedCommit,
				trace,
				workerConfig,
				runAxis,
				routeAxis: requireAxisDispatch(routeAxis),
				automationRetry,
				actor,
				now,
			}),
		);
	}

	return decideReview(axes);
}

/**
 * §8.4's fan-out cannot dispatch an axis without a dispatch seam, and it refuses
 * rather than reaching for the routing itself.
 *
 * The plausible fallback — resolve §11.5's pair here and run it — is the one
 * this ticket exists to remove: it launches a read-only reviewer into a class a
 * provider has already refused, spends the launch, and ends the axis on a
 * refusal the memo had already recorded (§9.8).
 */
function requireAxisDispatch(routeAxis) {
	if (typeof routeAxis === "function") return routeAxis;

	throw unroutable(
		"seam",
		"§8.4's fan-out dispatches each axis through §11.5's order under §9.8's memo, and this caller wired no seam to " +
			"do it with. Resolving the routing here instead would launch a reviewer into a class a provider has already " +
			"refused, and pay a launch to rediscover it.",
		{ axes: REVIEW_ROLES.map((axis) => axis.name) },
	);
}

/**
 * The boundary a review measures — **both ends read off the passing verify
 * record** (§8.4, §14.13, #165).
 *
 * Neither end is a parameter, and that is the finding each answers. §14.13 says
 * verification never attests a commit other than the one being published, and a
 * `reviewedCommit` the caller supplied is a second opinion about which commit
 * that is — as is the harvest's head, which a moved base makes the *pre-rebase*
 * commit while verify's is the exact post-rebase one being published. And a
 * `baseCommit` the caller supplied is #161's conflation one phase earlier: the
 * walking attempt's own base (§7.3) is the prior attempt's tip for a repair, so
 * a review diffed from it sees only the repair's delta while two approved
 * verdicts gate the publication of the whole chain (§8.5, §8.7).
 *
 * The verify record carries the pair together: `base_commit` is the fresh
 * base-branch tip the branch was left sitting on — the boundary of the
 * publishable diff — and `head` is the commit §8.2's required set passed at.
 * §14.15 makes this phase reachable only through that record, and
 * `integratePublish`'s `attestedByVerify` reads the same durable state for the
 * same reason — so the review and the checks measure one value, and after a
 * §9.5 re-rebase the verdicts keep naming the boundary they were rendered
 * against (§8.7) rather than implying they covered the moved one.
 */
function verifiedBoundary(store, { run, ticket, attempt }) {
	// The latest passing verify under this attempt: §8.10's automation retry
	// re-enters `verify` under the same attempt at the next try (#146), so an
	// earlier unrunnable pass may sit beside the one that passed.
	const verified = stageResults(store, { run, ticket, phase: PHASE_VERIFY })
		.filter((record) => record.attempt === attempt && record.outcome === CHECK_RESULTS.passed)
		.at(-1);
	const baseCommit = verified?.detail?.base_commit;
	const reviewedCommit = verified?.detail?.head;

	if (typeof baseCommit !== "string" || baseCommit.length === 0 || typeof reviewedCommit !== "string" || reviewedCommit.length === 0) {
		throw unroutable(
			"verified-boundary",
			`Attempt ${attempt} has no passing verify record naming a base and a head, so there is nothing §8.2's checks ` +
				`passed on to review (§14.15). §14.13 measures the commit being published, and taking either end of the ` +
				`diff on a caller's word instead would be a second opinion about what that is.`,
			{ attempt, phase: PHASE_VERIFY },
		);
	}

	return Object.freeze({ baseCommit, reviewedCommit });
}

/**
 * #189's requirement trace — **read off the reviewed attempt's own implement
 * record**, the way the boundary is read off its verify record.
 *
 * The record is the right source for the same reason the verify record is: it
 * is the result the walk resolved under this attempt, so the trace the spec
 * axis checks is the one the controller accepted from *this* builder, and on a
 * repair chain it is the repairing attempt's — the whole ticket restated by the
 * worker whose commit is being published — rather than a prior attempt's claim
 * about work that was set aside. It is not a parameter, for #165's reason: a
 * caller-supplied trace would be a second opinion about what the builder said.
 *
 * **Absence refuses.** A `completed` builder record with no trace is an invalid
 * result one phase earlier (`missingResult`, §8.10's fresh-retry row), so a
 * review reached without one is a state the journal cannot explain — and the
 * plausible fallthrough, briefing the spec axis without it, is exactly the
 * re-derivation of coverage from the diff alone that the trace exists to end,
 * arriving as an approve that looks like every other approve.
 */
function builderTrace(store, { run, ticket, attempt }) {
	const record = stageResults(store, { run, ticket, phase: PHASE_IMPLEMENT })
		.filter((result) => result.attempt === attempt && Array.isArray(result.detail?.trace) && result.detail.trace.length > 0)
		.at(-1);

	if (record === undefined) {
		throw unroutable(
			"builder-trace",
			`Attempt ${attempt} has no implement record carrying a trace, so there is nothing to brief the spec axis ` +
				`with (§8.4, #189). A completed builder record without one is an invalid result at the implement phase; ` +
				`reaching review without it is a journal this controller cannot explain, and briefing the axis without ` +
				`the trace would have it answer the ticket's coverage question from the diff alone.`,
			{ attempt, phase: PHASE_IMPLEMENT },
		);
	}

	return record.detail.trace;
}

/**
 * One axis, to a result — retries included.
 *
 * The loop is a loop because §8.10 routes six reviewer attempt outcomes to
 * `retry` on the **automation** budget: a reviewer that died says nothing about
 * the work, and charging the builder for it would eventually discard good work
 * on an infra flake. Every pass is a fresh attempt with a fresh worktree (§8.5),
 * numbered by the try it is, which is what lets a re-entry find the attempt it
 * already opened instead of allocating another.
 *
 * **The walk resumes from the record.** A pass whose stage is already resolved is
 * not re-run: a controller that died after a reviewer answered and before the
 * resolution committed re-runs the axis, and one that died after reads it back.
 */
async function walkAxis(store, clone, context) {
	const { hold, run, ticket, axis, index, routeAxis, actor, now } = context;
	let tryNumber = 1;

	for (;;) {
		// #155: dispatched per pass, not once per axis, because a pass is entered
		// again exactly when the last profile stopped being spendable — a provider
		// refused it, and the memo has moved since. Selecting once up front would
		// relaunch into the refusal.
		//
		// **The bound is read from the journal, not carried in this loop.** An
		// in-memory list would be lost by a controller that died mid-chain, and the
		// axis would re-dispatch a profile the provider has already refused. It is
		// keyed on **this axis's own role**, which is what keeps §8.4's two axes
		// independent under a reroute: the other axis's refusals are not in it, so
		// an exhausted class walks each down its own declared order.
		const route = await routeAxis({
			axis: axis.name,
			index,
			dispatched: refusedProfiles(store, { run, ticket, role: axis.name }),
		});
		if (typeof route?.profile !== "string") throw axisOutOfRoutes({ axis, route, tryNumber });

		const opened = await openAxisAttempt(store, clone, { ...context, route, tryNumber });
		// An axis's retry is a **fresh axis attempt** (§8.4's `try` rides the mint's
		// purpose, not the stage key), so each pass reads its own attempt's first
		// and only stage result.
		const recorded = recordedStage(store, { run, ticket, phase: PHASE_REVIEW, attempt: opened.attempt, try: FIRST_TRY });
		const answer =
			recorded === null
				? await attemptAxis(clone, { ...context, ...opened, tryNumber })
				: { outcome: recorded.payload.outcome, detail: recorded.payload.detail };

		const resolved = resolveStage(store, {
			hold,
			run,
			ticket,
			phase: PHASE_REVIEW,
			attempt: opened.attempt,
			outcome: answer.outcome,
			detail: answer.detail,
			actor,
			at: now(),
		});

		if (resolved.row.action === STAGE_ACTIONS.retry) {
			tryNumber = await grantedRetry(store, { ...context, attempt: opened.attempt, resolved, tryNumber });
			continue;
		}

		// #155: the provider refused this axis, so the axis moves to the next
		// profile its own order names — **without asking the budget**. A retry is
		// asked for because a reviewer that died says nothing about the work and
		// somebody should pay for the flake; here nobody flaked, and charging the
		// automation budget would let two quota blips fail a ticket whose review
		// never started.
		if (resolved.row.action === STAGE_ACTIONS.reroute) {
			// Nothing is recorded here, and nothing needs to be. The bound is the
			// resolution just committed — `refusedProfiles` reads it on the next
			// pass — and the next pass's attempt id comes from `openAxisAttempt`
			// allocating against the same purpose, which is a derivation and not a
			// reservation. A call here to "take" the ordinal would write nothing and
			// answer a question the next line asks again.
			tryNumber += 1;
			continue;
		}

		if (resolved.row.action === STAGE_ACTIONS.verdict || resolved.row.action === STAGE_ACTIONS.dispose) {
			return Object.freeze({
				axis: context.axis.name,
				attempt: opened.attempt,
				action: resolved.row.action,
				outcome: resolved.outcome,
				detail: resolved.detail,
				routing: opened.route,
			});
		}

		throw unroutable(
			"action",
			`§8.10 routes ${PHASE_REVIEW} × ${resolved.outcome} to ${resolved.row.action}, which is not an answer an axis ` +
				`can end on: an axis ends by producing a verdict, by disposing the ticket execution, or by being retried.`,
			{ axis: context.axis.name, attempt: opened.attempt, outcome: resolved.outcome, action: resolved.row.action },
		);
	}
}

/**
 * §7.3's branch and worktree for one axis attempt, **at the reviewed commit**.
 *
 * The mint comes first for the reason it does everywhere else (§6.5): the
 * projections refuse an attempt-scoped record — and both git mutations are
 * effects — for a tuple nothing minted. The allocation's purpose is the axis, the
 * builder attempt it reviews, and the try, so a re-entry lands on the attempt it
 * already opened rather than taking a second ordinal for the same work.
 */
async function openAxisAttempt(
	store,
	clone,
	{ hold, run, ticket, builderAttempt, axis, route, reviewedCommit, workerConfig, tryNumber, actor, now },
) {
	const purpose = axisPurpose({ axis, builderAttempt, tryNumber });
	const allocated = allocateAttempt(store, { run, ticket, purpose });
	const identity = requireAttemptIdentity({ run, ticket, phase: PHASE_REVIEW, attempt: allocated.attempt });

	mintAttempt(store, {
		hold,
		identity,
		role: axis.name,
		profile: route.profile,
		routing: route,
		baseCommit: reviewedCommit,
		purpose,
		at: now(),
	});

	// **The mint decides, not the caller.** A record already there is left exactly
	// as it is, so a re-entry after a crash finds the decision the previous
	// controller committed — and §11.5 re-resolved against a memo that has since
	// moved would launch this axis under a profile the record does not name, which
	// is precisely the disagreement between "what ran" and "what the disposition
	// says ran" that #155 exists to close (§6.5, §8.9).
	const minted = mintedDispatch(store, { run, ticket, attempt: identity.attempt }) ?? { routing: route };

	const created = await createAttemptWorktree(store, clone, {
		hold,
		run,
		ticket,
		attempt: identity.attempt,
		phase: PHASE_REVIEW,
		baseCommit: reviewedCommit,
		workerConfig,
		actor,
		at: now(),
	});

	// The two git facts by name, never the whole answer: `createAttemptWorktree`
	// also hands back the `baseCommit` it branched from, which here is the
	// reviewed tip — and spreading that over the caller's `baseCommit` would tell
	// the reviewer to diff the reviewed commit against itself.
	return Object.freeze({
		attempt: identity.attempt,
		identity,
		branch: created.branch,
		worktreePath: created.worktreePath,
		// The mint's answer, so everything downstream — the launch, the axis's
		// stage detail, §8.7's attestation — reads one value.
		route: minted.routing ?? route,
	});
}


/**
 * An axis with nowhere to run: every profile §11.5's order names for it belongs
 * to a class §9.8's memo has locked (#155).
 *
 * **No attempt is minted**, which is the point of asking before opening: an
 * attempt row with no pane behind it would be a launch this run never made, and
 * §8.9's branch evidence would then name a branch nothing ever wrote to.
 *
 * It is **thrown rather than answered**, for the reason §8.6's exhaustion is: the
 * fan-out decides an axis's dispatch *inside* the phase executor, and an
 * executor's only ways out are a phase result and a throw. Answering with one
 * would mean inventing a `review` phase result for "the run is out of providers"
 * — a capacity fact wearing a verdict's clothes — and §8.10's row for it is
 * phase-less precisely because it belongs to no phase's outcome domain.
 */
function axisOutOfRoutes({ axis, route, tryNumber }) {
	return new FactoryPipelineError(
		"routes-exhausted",
		`Every profile §11.5's order names for review axis ${axis.name} belongs to a resource class §9.8's memo has ` +
			`recorded unavailable, so this axis cannot be run and no attempt is minted for it. The ticket goes back to ` +
			`the frontier untouched: no reviewer failed, no budget is owed, and the memo keeps the next claim out until ` +
			`a probe re-admits a class.`,
		{
			at: "route",
			axis: axis.name,
			try: tryNumber,
			declared: route?.declared ?? null,
			considered: route?.considered ?? [],
		},
	);
}

/**
 * §8.4's purpose for one axis attempt: **which axis, whose work, and which try.**
 *
 * It is one function because it is read from two directions — written into the
 * mint, and matched against it by `allocateAttempt` — and two spellings of a key
 * are two ways for a re-entry to miss the attempt it already opened. It is also
 * the journal's answer to *why does this attempt exist*: without it an operator
 * reading two extra attempts beside a builder's would infer the fan-out from the
 * role names and a gap.
 */
function axisPurpose({ axis, builderAttempt, tryNumber }) {
	return { review: { axis: axis.name, of: builderAttempt, try: tryNumber } };
}

/**
 * One axis attempt, run under the attestation.
 *
 * The order is the guard: capture, run, capture, compare. An opening capture that
 * is already dirty ends the attempt **before** the seam is asked, because the
 * controller made this worktree out of a commit and the only thing that can have
 * written to it is the role this attempt belongs to — and §14.19 gives that role
 * no second go.
 */
async function attemptAxis(clone, { axis, route, identity, worktreePath, branch, baseCommit, reviewedCommit, trace, runAxis, tryNumber }) {
	const before = await captureWorktreeState(clone, { worktreePath, branch });
	if (!before.clean) {
		return mutationAnswer({
			axis,
			route,
			tryNumber,
			baseCommit,
			reviewedCommit,
			guard: assessMutation({ before, after: before }),
			ran: null,
		});
	}

	const ran = await runAxis({
		axis,
		// §6.8's posture rides the request rather than being left for the launcher
		// to work out: it is derived from the role, and a fan-out that handed over a
		// role without saying what it is would make "read-only" a convention.
		posture: postureOf(axis),
		profile: route.profile,
		identity,
		worktreePath,
		branch,
		baseCommit,
		reviewedCommit,
		// #189: the builder's trace rides every axis request, and **the template
		// decides which axis renders it** (`checksTrace` on the role's own
		// expectations). Handing it to one axis by name here would be a second
		// copy of that role knowledge, and the two would drift.
		trace,
		try: tryNumber,
	});

	const guard = assessMutation({ before, after: await captureWorktreeState(clone, { worktreePath, branch }) });
	if (guard.mutated) return mutationAnswer({ axis, route, tryNumber, baseCommit, reviewedCommit, guard, ran });

	// §8.4's verdict is what a `completed` reviewer owes, and that obligation is
	// **role** knowledge — which is why it is asserted here and not in §6.6's
	// schema judge, which has never known which roles exist. `outbox.mjs` holds a
	// verdict that *is* written to its shape; a verdict-routed attempt that wrote
	// none produced no result for this role at all, which is what `invalid-result`
	// means (§6.6) and routes to §8.10's automation retry.
	if (routeOutcome(PHASE_REVIEW, ran.outcome).action === STAGE_ACTIONS.verdict && !REVIEW_VERDICTS.includes(ran.record?.verdict)) {
		return Object.freeze({
			outcome: "invalid-result",
			detail: axisDetail({
				axis,
				route,
				tryNumber,
				baseCommit,
				reviewedCommit,
				guard,
				ran,
				problem: `the attempt ended ${ran.outcome} and wrote no §8.4 verdict, so this axis produced no result`,
			}),
		});
	}

	return Object.freeze({
		outcome: ran.outcome,
		detail: axisDetail({ axis, route, tryNumber, baseCommit, reviewedCommit, guard, ran }),
	});
}

function mutationAnswer({ axis, route, tryNumber, baseCommit, reviewedCommit, guard, ran }) {
	return Object.freeze({
		outcome: "mutation-detected",
		detail: axisDetail({
			axis,
			route,
			tryNumber,
			baseCommit,
			reviewedCommit,
			guard,
			ran,
			problem: `the reviewer's worktree changed under it (${guard.reasons.join(", ")}); a read-only role that wrote has broken its own contract`,
		}),
	});
}

/**
 * What one axis attempt's stage result carries.
 *
 * The verdict and the findings ride it **as written**: §8.4's union is over the
 * blocking set, and a detail that sorted or deduplicated here would rerank one
 * axis before the union ever saw it. The attestation rides it too, on every
 * outcome and not only on a mutation — §8.7's per-attempt attestation artifact
 * wants the before/after guard result whatever the review concluded. So does
 * the boundary the axis was briefed on: a verdict's scope is part of the
 * verdict, and §8.7's artifact names the base it was rendered against (#165).
 *
 * **What dispatched it rides it too** (#155). §8.4 makes model diversity a
 * per-run configuration rather than a mandate, so two axes on one profile is a
 * legal verdict — but a reroute can arrive there on its own, and a verdict that
 * recorded only the profile would present two independent reviews where two runs
 * of one model happened. The record names what §11.5 declared, what ran, and why
 * they differ, so §8.7's attestation carries the condition rather than leaving an
 * operator to infer it from two profile names that happen to match.
 */
function axisDetail({ axis, route, tryNumber, baseCommit, reviewedCommit, guard, ran, problem = null }) {
	const record = ran?.record ?? null;

	return Object.freeze({
		axis: axis.name,
		profile: route.profile,
		routing: route,
		try: tryNumber,
		base_commit: baseCommit,
		reviewed_commit: reviewedCommit,
		attestation: Object.freeze({
			mutated: guard.mutated,
			reasons: guard.reasons,
			before_head: guard.before.head,
			after_head: guard.after.head,
			leftovers: guard.after.leftovers,
		}),
		verdict: record?.verdict ?? null,
		findings: Object.freeze(record?.findings ?? []),
		// §14.18's slots, for the rows §8.10 disposes on: a reviewer may pause a
		// ticket execution exactly as a builder may, and the pause carries the
		// worker's own class and its exact question.
		reason_class: record?.reason_class ?? null,
		question: record?.question ?? null,
		summary: record?.summary ?? null,
		problem,
	});
}

/**
 * §8.6's automation budget, asked before an axis is given another attempt.
 *
 * A retry the record already shows — the next try's mint is there — is a re-entry
 * rather than a new spend, and asking again would charge the budget for a crash.
 * With no budget wired the phase **refuses**: carrying on with one axis unheard,
 * or treating a dead reviewer as an approval, are the two plausible fallthroughs
 * and both end with unreviewed work published.
 */
async function grantedRetry(store, { run, ticket, axis, builderAttempt, attempt, resolved, tryNumber, automationRetry }) {
	const nextTry = tryNumber + 1;
	const already = allocateAttempt(store, {
		run,
		ticket,
		purpose: axisPurpose({ axis, builderAttempt, tryNumber: nextTry }),
	});
	if (already.state === "already-minted") return nextTry;

	if (typeof automationRetry !== "function") {
		throw new FactoryPipelineError(
			"retry-unplannable",
			`§8.10 routes ${PHASE_REVIEW} × ${resolved.outcome} to ${resolved.row.action} on the ${resolved.row.budget} ` +
				`budget, and this caller wired no seam to charge it (§8.6, #111). The review stops here rather than ` +
				`answering for an axis nothing heard from.`,
			{
				at: "seam",
				axis: axis.name,
				attempt,
				outcome: resolved.outcome,
				action: resolved.row.action,
				budget: resolved.row.budget,
			},
		);
	}

	await automationRetry({
		axis: axis.name,
		attempt,
		outcome: resolved.outcome,
		budget: resolved.row.budget,
		try: nextTry,
	});

	return nextTry;
}

/**
 * The phase's own answer, from both axes' (§8.4).
 *
 * The order of the three questions is the order of how much they cost to get
 * wrong. **A mutation outranks everything**: a read-only role that wrote has
 * broken the contract the whole phase rests on, and §14.19 gives it no retry, so
 * no verdict it also wrote is worth taking. **A disposing axis comes next** — a
 * reviewer's `needs-human` is §14.18's pause and its `cancelled` is `released`,
 * and the first axis in declared order settles it, because a ticket execution has
 * one disposition and there is nothing to rank between two honest ones. Only when
 * both axes produced verdicts is there a blocking set to union.
 */
function decideReview(axes) {
	const mutated = axes.find((axis) => axis.outcome === "mutation-detected");
	if (mutated !== undefined) {
		return phaseAnswer("mutation-detected", {
			axis: mutated.axis,
			attempt: mutated.attempt,
			attestation: mutated.detail.attestation,
			problem: mutated.detail.problem,
		});
	}

	const disposing = axes.find((axis) => axis.action === STAGE_ACTIONS.dispose);
	if (disposing !== undefined) {
		return phaseAnswer(disposing.outcome, {
			axis: disposing.axis,
			attempt: disposing.attempt,
			reason_class: disposing.detail.reason_class,
			question: disposing.detail.question,
		});
	}

	// The union: concatenated in axis order, every finding tagged with the axis
	// that wrote it, nothing merged, nothing reranked, nothing dropped (§8.4).
	const findings = axes.flatMap((axis) =>
		axis.detail.findings.map((finding) => Object.freeze({ axis: axis.axis, ...finding })),
	);
	const blocking = findings.filter((finding) => finding.severity === FINDING_SEVERITIES.blocking);
	const advisory = findings.filter((finding) => finding.severity === FINDING_SEVERITIES.advisory);

	// §8.4: one or more blocking findings **on either axis** ⇒ reject. The rule is
	// over the union rather than over the two verdict words, so an axis whose word
	// and findings disagree never reaches here — `outbox.mjs` reads that record as
	// invalid rather than making the controller pick a winner.
	if (blocking.length > 0) {
		// §8.10 marks this row's evidence untrusted, and the repair prompt renders
		// every field of this detail inside its delimited block. So it carries the
		// reviewers' words and nothing the controller wants read as its own.
		// **No routing summary rides this detail**, though a collapsed fan-out is
		// exactly as worth knowing on a rejection as on an approval. §8.10 marks
		// this row's evidence untrusted and §8.5's prompt quotes every field of it
		// inside the delimited block — so a controller-owned sentence added here
		// would reach the next builder attributed to the reviewers. The same fact
		// is on each axis's own durable result (`axisDetail`), which is what §8.7's
		// attestation reads and what an operator opens.
		return phaseAnswer("rejected", { blocking: Object.freeze(blocking), advisory: Object.freeze(advisory) });
	}

	return phaseAnswer("approved", {
		axes: Object.freeze(
			axes.map((axis) => Object.freeze({ axis: axis.axis, attempt: axis.attempt, verdict: axis.detail.verdict })),
		),
		advisory: Object.freeze(advisory),
		routing: axisRouting(axes),
	});
}

/**
 * **What actually rendered each verdict, and whether the two axes ended up on
 * one profile** (§8.4, #155).
 *
 * §8.4 makes model diversity a per-run configuration rather than a mandate, so
 * two axes on one profile is a legal verdict — but it must be a *stated* one. An
 * exhausted class can walk both axes onto the last profile standing, and a
 * verdict that reported nothing would present two independent reviews where two
 * runs of one model happened. Independence is still real (separate attempts,
 * separate worktrees, read-only, no shared transcript), and the operator can see
 * exactly how much of it survived.
 *
 * `collapsed` is deliberately narrower than "both axes name one profile": an
 * operator who *wrote* the same profile twice already knows, and §11.5 makes
 * them write it twice so they cannot not know. What this reports is the run
 * arriving there on its own.
 */
function axisRouting(axes) {
	const ran = axes.map((axis) => {
		// The candidates a verdict does not carry: what an operator reads here is
		// which model rendered it, and the walk past the exhausted ones is on the
		// axis's own durable result. Dropped rather than set to `undefined`,
		// because §4.3's records are canonicalised and an undefined field has no
		// JSON representation to canonicalise.
		const { considered, ...summary } = routeSummary(axis.routing);
		return Object.freeze({ axis: axis.axis, profile: axis.routing?.profile ?? null, ...summary });
	});

	const profiles = ran.map((axis) => axis.profile);
	const declared = ran.map((axis) => axis.declared);
	const collapsed =
		ran.some((axis) => axis.rerouted) &&
		new Set(profiles).size === 1 &&
		new Set(declared).size > 1;

	return Object.freeze({
		axes: Object.freeze(ran),
		collapsed,
		note: collapsed
			? `both review axes ran on ${profiles[0]}: §11.5 declared ${declared.join(" and ")}, and the reroute left one ` +
				`routable profile between them (§8.4, §9.8). The axes stayed separate read-only attempts; the model did not.`
			: null,
	});
}

function phaseAnswer(outcome, detail) {
	return Object.freeze({ outcome, detail: Object.freeze(detail) });
}

function unroutable(at, sentence, details = {}) {
	return new FactoryPipelineError("review-unroutable", sentence, { at, ...details });
}
