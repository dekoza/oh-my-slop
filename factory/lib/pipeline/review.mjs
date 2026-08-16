import { FINDING_SEVERITIES, PHASE_REVIEW, REVIEW_VERDICTS, STAGE_ACTIONS } from "../domain/vocabulary.mjs";
import { createAttemptWorktree } from "../git/attempt.mjs";
import { assessMutation, captureWorktreeState } from "../git/attestation.mjs";
import { attemptBranch, attemptWorktreePath } from "../git/isolation.mjs";
import {
	allocateAttempt,
	attemptOutboxPath,
	launchedAttempt,
	requireAttemptIdentity,
} from "../worker/attempt.mjs";
import { postureOf, profileForRole, REVIEW_ROLES, REVIEW_ROUTING_ROLE } from "../worker/roles.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { recordedStage, resolveStage } from "./stages.mjs";
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
 * @param {string} context.attempt the **builder** attempt whose work is reviewed
 * @param {string} context.baseCommit §7.2's pinned base — what the change is
 *   measured against, which for a repair chain is still the run's pin and never
 *   the repairing attempt's own tip
 * @param {string} context.reviewedCommit the tip §8.2's checks passed on (§14.13)
 * @param {{ roles: object, rules: ReadonlyArray<object> }} context.routing the active routing
 * @param {ReadonlyArray<string>} [context.labels] the ticket's labels, as the
 *   claim-time snapshot has them
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
		baseCommit,
		reviewedCommit,
		routing,
		labels = [],
		workerConfig,
		runAxis,
		automationRetry = null,
		actor,
		now,
	},
) {
	const profiles = reviewProfiles(routing, { labels });
	const axes = [];

	for (const [index, axis] of REVIEW_ROLES.entries()) {
		axes.push(
			await walkAxis(store, clone, {
				hold,
				run,
				ticket,
				builderAttempt,
				axis,
				profile: profiles[index],
				baseCommit,
				reviewedCommit,
				workerConfig,
				runAxis,
				automationRetry,
				actor,
				now,
			}),
		);
	}

	return decideReview(axes);
}

/**
 * §11.5's `review` pair, dispatched — **positionally**.
 *
 * The pair is two profiles written out even when they are the same, and which
 * one an axis runs under is decided here by position: `roles.review[0]` is the
 * first axis in `REVIEW_ROLES`, `[1]` is the second. That positional binding is
 * the whole of "model diversity is available as per-run configuration but is not
 * mandated" (§8.4) — an operator who wants two models writes two, and one who
 * does not writes the same name twice. Independence comes from the attempts being
 * separate and read-only, never from distinct weights.
 */
function reviewProfiles(routing, { labels }) {
	const dispatched = profileForRole(routing, { role: REVIEW_ROUTING_ROLE, labels });
	const pair = Array.isArray(dispatched) ? dispatched : [dispatched];

	if (pair.length !== REVIEW_ROLES.length) {
		throw unroutable(
			"routing",
			`§11.5 routes "${REVIEW_ROUTING_ROLE}" to one profile per axis and this routing names ${pair.length} for ` +
				`${REVIEW_ROLES.length} axes. Reusing one across both, or leaving one axis unrouted, are both decisions ` +
				`§11.5 requires an operator to write down rather than a shape this dispatch may repair.`,
			{ found: pair.length, expected: REVIEW_ROLES.length, axes: REVIEW_ROLES.map((axis) => axis.name) },
		);
	}

	return pair;
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
	const { hold, run, ticket, actor, now } = context;
	let tryNumber = 1;

	for (;;) {
		const opened = await openAxisAttempt(store, clone, { ...context, tryNumber });
		const recorded = recordedStage(store, { run, ticket, phase: PHASE_REVIEW, attempt: opened.attempt });
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

		if (resolved.row.action === STAGE_ACTIONS.verdict || resolved.row.action === STAGE_ACTIONS.dispose) {
			return Object.freeze({
				axis: context.axis.name,
				attempt: opened.attempt,
				action: resolved.row.action,
				outcome: resolved.outcome,
				detail: resolved.detail,
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
	{ hold, run, ticket, builderAttempt, axis, profile, reviewedCommit, workerConfig, tryNumber, actor, now },
) {
	const allocated = allocateAttempt(store, {
		run,
		ticket,
		mintedFor: (payload) => mintsAxis(payload, { axis, builderAttempt, tryNumber }),
	});
	const identity = requireAttemptIdentity({ run, ticket, phase: PHASE_REVIEW, attempt: allocated.attempt });

	mintAxisAttempt(store, { hold, identity, axis, profile, builderAttempt, tryNumber, reviewedCommit, at: now() });

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
	});
}

/** The purpose one axis attempt was minted for, read back off its record. */
function mintsAxis(payload, { axis, builderAttempt, tryNumber }) {
	const review = payload.review;
	return review?.axis === axis.name && review?.of === builderAttempt && review?.try === tryNumber;
}

/**
 * §6.5's mint for an axis attempt.
 *
 * The `review` block is the allocation's key and the journal's answer to *why
 * does this attempt exist* — which axis, whose work, and which try. Without it an
 * operator reading two extra attempts beside a builder's would have to infer the
 * fan-out from the role names and a gap.
 */
function mintAxisAttempt(store, { hold, identity, axis, profile, builderAttempt, tryNumber, reviewedCommit, at }) {
	if (launchedAttempt(store, identity.attempt) !== null) return;

	hold.append({
		kind: "attempt.launched",
		source: "controller",
		run: identity.run,
		ticket: identity.ticket,
		phase: identity.phase,
		attempt: identity.attempt,
		occurredAt: at,
		observedAt: at,
		payload: {
			role: axis.name,
			profile,
			review: { axis: axis.name, of: builderAttempt, try: tryNumber },
			base_commit: reviewedCommit,
			branch: attemptBranch({ ticket: identity.ticket, attempt: identity.attempt }),
			worktree: attemptWorktreePath(store.storeDir, identity.attempt),
			outbox: attemptOutboxPath(store.storeDir, identity.attempt),
		},
	});
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
async function attemptAxis(clone, { axis, profile, identity, worktreePath, branch, baseCommit, reviewedCommit, runAxis, tryNumber }) {
	const before = await captureWorktreeState(clone, { worktreePath, branch });
	if (!before.clean) {
		return mutation({ axis, profile, tryNumber, guard: assessMutation({ before, after: before }), ran: null });
	}

	const ran = await runAxis({
		axis,
		// §6.8's posture rides the request rather than being left for the launcher
		// to work out: it is derived from the role, and a fan-out that handed over a
		// role without saying what it is would make "read-only" a convention.
		posture: postureOf(axis),
		profile,
		identity,
		worktreePath,
		branch,
		baseCommit,
		reviewedCommit,
		try: tryNumber,
	});

	const guard = assessMutation({ before, after: await captureWorktreeState(clone, { worktreePath, branch }) });
	if (guard.mutated) return mutation({ axis, profile, tryNumber, guard, ran });

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
				profile,
				tryNumber,
				guard,
				ran,
				problem: `the attempt ended ${ran.outcome} and wrote no §8.4 verdict, so this axis produced no result`,
			}),
		});
	}

	return Object.freeze({ outcome: ran.outcome, detail: axisDetail({ axis, profile, tryNumber, guard, ran }) });
}

function mutation({ axis, profile, tryNumber, guard, ran }) {
	return Object.freeze({
		outcome: "mutation-detected",
		detail: axisDetail({
			axis,
			profile,
			tryNumber,
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
 * wants the before/after guard result whatever the review concluded.
 */
function axisDetail({ axis, profile, tryNumber, guard, ran, problem = null }) {
	const record = ran?.record ?? null;

	return Object.freeze({
		axis: axis.name,
		profile,
		try: tryNumber,
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
		mintedFor: (payload) => mintsAxis(payload, { axis, builderAttempt, tryNumber: nextTry }),
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
		return phase("mutation-detected", {
			axis: mutated.axis,
			attempt: mutated.attempt,
			attestation: mutated.detail.attestation,
			problem: mutated.detail.problem,
		});
	}

	const disposing = axes.find((axis) => axis.action === STAGE_ACTIONS.dispose);
	if (disposing !== undefined) {
		return phase(disposing.outcome, {
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
		return phase("rejected", { blocking: Object.freeze(blocking), advisory: Object.freeze(advisory) });
	}

	return phase("approved", {
		axes: Object.freeze(
			axes.map((axis) => Object.freeze({ axis: axis.axis, attempt: axis.attempt, verdict: axis.detail.verdict })),
		),
		advisory: Object.freeze(advisory),
	});
}

function phase(outcome, detail) {
	return Object.freeze({ outcome, detail: Object.freeze(detail) });
}

function unroutable(at, sentence, details = {}) {
	return new FactoryPipelineError("review-unroutable", sentence, { at, ...details });
}
