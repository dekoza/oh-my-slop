import {
	CONTROLLER_PHASES,
	PHASE_IMPLEMENT,
	PHASE_RESULTS,
	PHASE_REVIEW,
	RETRY_TIERS,
	STAGE_ACTIONS,
} from "../domain/vocabulary.mjs";
import { canonicalJson, digest, runStream } from "../state/events.mjs";
import { BUDGET_KEY_FOR_ACTION, requireBudget } from "./budgets.mjs";
import { dispositionOf } from "./dispositions.mjs";
import { FactoryPipelineError } from "./errors.mjs";
import { TABLE_WIDE, routeOutcome } from "./table.mjs";

/**
 * A stage result, as a durable record.
 *
 * **The semantic key is `(run, ticket, phase, attempt, try)`** — §2.1's stage
 * identity, the attempt it was resolved under, and which pass through the phase
 * it was. The last two slots exist for the two ways a phase is legitimately
 * entered twice, and they are two slots because the two ways are different
 * things (§8.5, #146):
 *
 * - The **attempt** slot keeps §8.5's repair honest: a repaired ticket execution
 *   re-enters `implement` with a new attempt, and that second result is a new
 *   fact rather than a contradiction of the first. Without it every repair would
 *   look like §8.10's conflicting duplicate, and a working pipeline would fail
 *   itself.
 * - The **try** slot keeps §8.10's automation retry of a *controller* phase
 *   honest. `verify` and `integrate` have no worker (§8.8), so retrying one
 *   mints no attempt — there is nothing to run again but the controller itself.
 *   The attempt slot therefore cannot vary, and without a slot that can, the
 *   re-entry would read its own recorded result straight back and route to the
 *   same row forever.
 *
 * `try` is `1` for every stage but a controller phase's re-entry, which is why
 * it defaults rather than being threaded through every caller.
 *
 * Under one key, §8.10's last two rows apply: **an identical duplicate returns
 * the committed result idempotently, and a conflicting one is a typed
 * conflict.** That is the same discipline §4.5 applies to effects — the key is
 * natural and the payload digest sits beside it — for the same reason: a key
 * that hashed the result would turn a disagreement into a different key, and the
 * conflict nobody wants to find would be the one nobody can.
 */

/** The pass every stage is on unless a controller-phase retry moved it (§8.10). */
export const FIRST_TRY = 1;

/** The fields a stage result is compared on. Everything else is evidence. */
function resultDigest({ outcome, detail }) {
	return digest(canonicalJson({ outcome, detail: detail ?? null }));
}

/**
 * Resolve one stage, and answer with §8.10's row for it.
 *
 * The row is read **before** the append, so an outcome the table does not map is
 * refused rather than recorded: a journal entry naming an outcome nothing can
 * route is a fact the machine can never act on and never take back (§14.7).
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.phase a §2.2 pipeline phase
 * @param {string} context.attempt the attempt this stage was resolved under
 * @param {number} [context.try] which pass through the phase this is (§8.10,
 *   #146). `1` for everything a worker produced; a controller phase's automation
 *   retry mints no attempt and counts here instead
 * @param {string} context.outcome the attempt outcome or phase result
 * @param {object | null} [context.detail] evidence the row's action will need —
 *   check results by digest, harvest leftovers, a worker's reason class. It is
 *   part of the compared result, because two runs of a phase that disagree about
 *   *why* disagree (§8.10).
 * @param {string} context.actor `controller`, or `operator:<verb>`
 * @param {number} context.at
 * @returns {Readonly<{ state: string, outcome: string, detail: object | null, row: Readonly<object> }>}
 * @throws {FactoryPipelineError} `outcome-unmapped` · `stage-result-conflict`
 */
export function resolveStage(
	store,
	{ hold, run, ticket, phase, attempt, try: tryNumber = FIRST_TRY, outcome, detail = null, actor, at },
) {
	const routed = routeOutcome(phase, outcome);
	const committedDigest = resultDigest({ outcome, detail });

	const existing = recordedStage(store, { run, ticket, phase, attempt, try: tryNumber });
	if (existing !== null) {
		if (existing.payload.result_digest === committedDigest) {
			// §8.10: the duplicate-identical row. The committed result is returned
			// unchanged and nothing is appended — a second record saying the same
			// thing would make the chain report a phase that ran twice.
			return Object.freeze({
				state: "already-resolved",
				outcome: existing.payload.outcome,
				detail: existing.payload.detail,
				row: recordedRow(routed, existing.payload.action),
			});
		}

		throw new FactoryPipelineError(
			"stage-result-conflict",
			`Stage ${run}/${ticket}/${phase} was already resolved as ${JSON.stringify(existing.payload.outcome)} under ` +
				`attempt ${attempt} try ${tryNumber}, and this result says ${JSON.stringify(outcome)}. Two results ` +
				"disagreeing under one semantic key is §8.10's typed conflict; the controller files it rather than picking " +
				"a winner.",
			{
				at: "stage",
				run,
				ticket,
				phase,
				attempt,
				try: tryNumber,
				committed: existing.payload.outcome,
				found: outcome,
			},
		);
	}

	const row = boundedRow(store, { run, ticket, row: routed });
	hold.append({
		kind: "stage.resolved",
		source: "controller",
		run,
		ticket,
		phase,
		attempt,
		occurredAt: at,
		observedAt: at,
		payload: {
			outcome,
			// The fifth slot of §8.10's semantic key, on the payload rather than in
			// the envelope: the envelope's tuple is §4.3's, shared by every record
			// the factory writes, and a pass counter belongs to the one kind that has
			// passes (#146).
			try: tryNumber,
			// §8.10's fourth column and its action, recorded beside the outcome so an
			// operator reading the journal sees what the controller did about it
			// without re-deriving the table from the outcome alone.
			action: row.action,
			budget: row.budget,
			detail,
			// §8.10: `wrote-but-hung` is not a failure, so the anomaly rides on the
			// record of an ordinary action rather than becoming an outcome of its own.
			anomaly: row.anomaly,
			result_digest: committedDigest,
			actor,
		},
	});

	return Object.freeze({ state: "resolved", outcome, detail, row });
}

/**
 * §8.10's row for a resolution, once the journal has been asked whether the
 * row's own bound is spent (#194).
 *
 * A row carrying `thereafter` is taken **once per ticket execution**, and the
 * once is read exactly as §8.6 reads a budget and §9.9 bounds a reroute: a
 * count of the `stage.resolved` records that already routed to this action,
 * never a counter. It is read **before** the append, so the resolution being
 * written is not its own bound — the first conflict finds none and takes the
 * row, the second finds one and takes `thereafter`. A controller that died
 * between resolving and minting reads the same answer back through
 * `recordedRow`, which is why the two are separate readers: this one asks the
 * journal, that one asks the record.
 */
function boundedRow(store, { run, ticket, row }) {
	if (row.thereafter === null) return row;

	const taken = stageRecords(store, { run, ticket }).some((record) => record.payload.action === row.action);
	return taken ? row.thereafter : row;
}

/**
 * The row a committed record was resolved under, read off the record's own
 * `action` rather than off the journal's current count (#194).
 *
 * A re-entry meets its own record: the resolution that routed to a
 * rebase-repair is now on the chain, so `boundedRow` would answer `thereafter`
 * for a record that says `rebase-repair`, and the walk would mint a fresh-retry
 * for a conflict the journal already answered. The record is the fact; the
 * count is how the fact was arrived at. A record naming neither the routed
 * action nor its `thereafter` — a journal written under an older table — is
 * answered with the routed row, which is the answer every record got before
 * a row carried a bound at all.
 */
function recordedRow(routed, action) {
	if (routed.thereafter !== null && routed.thereafter.action === action) return routed.thereafter;
	return routed;
}

/**
 * §8.1's pipeline, walked: `implement → harvest → verify → review → integrate`,
 * one phase at a time, each result resolved into durable state before the table
 * decides what happens next.
 *
 * **The walk resumes from the record, never from memory** (§8.10's re-entry). A
 * phase whose result is already recorded for this attempt is not run again — a
 * controller that died after `pytest` finished and before the resolution
 * committed re-runs it, and one that died after the resolution reads it back.
 * Both directions are safe, and neither needs a rule about which crash happened.
 *
 * **A row this package does not yet wire raises rather than falling through.**
 * The plausible fallthrough is "carry on to the next phase", which is precisely
 * how an unbuilt repair tier turns a failing attempt into a publication. What is
 * wired here is §8.1's pipeline whole, §8.5's two repair tiers, §8.6's budgets
 * and §8.9's dispositions — every action §8.10 declares now has behaviour behind
 * it, so what is left of this refusal is the *phase* case: a caller that wired
 * no executor. The stages already recorded stay on the chain either way.
 *
 * **The walk terminates because every retry is bounded** (§8.6). The three
 * actions that spend charge a declared number that is never reset within a run,
 * and the count is a read over the resolutions already on the chain — so a walk
 * that re-entered after a crash reaches the same bound rather than a fresh one.
 * There is no iteration cap here, and there is deliberately no need for one:
 * a cap would be a second bound, and the first one it disagreed with would be
 * the one that mattered.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt the attempt this walk is running
 * @param {Record<string, (where: object) => Promise<{ outcome: string, detail?: object | null }>>} context.phases
 *   the phase executors: `implement` is agent-borne and the caller's (§8.1),
 *   `harvest` and `verify` are `phases.mjs`'s controller phases, and `review` is
 *   `review.mjs`'s fan-out — which is agent-borne too, but over **its own**
 *   attempts rather than the one the walk is running (§8.4)
 * @param {((request: object) => Promise<{ attempt: string }>) | null} [context.nextAttempt]
 *   the retry seam (`pipeline/retry.mjs`): given the tier, the budget it
 *   consumes and the failure's own evidence, it mints and opens the next attempt
 *   and answers with its id. It is the caller's because a tier *plans*
 *   (`pipeline/repair.mjs`), which needs the clone, the routing and the run's
 *   pinned base — none of which the walk has. **It does not decide whether the
 *   retry is affordable**: the budget is asked here, before the seam, so §8.6 is
 *   answered once for every caller rather than once per caller. **It is not
 *   asked for a controller phase's automation retry at all** — `verify` and
 *   `integrate` have no worker (§8.8), so there is no attempt to mint and the
 *   walk re-enters them under the attempt it is on (#146)
 * @param {Readonly<{ repair: number, freshRetry: number, automation: number }> | null} [context.budgets]
 *   §11.6's validated block. Required the moment the table routes to an action
 *   that spends; a walk that never fails never reads it
 * @param {string} context.actor
 * @param {() => number} context.now
 * @returns {Promise<Readonly<object>>} the ticket execution's disposition
 * @throws {FactoryPipelineError} `not-yet-implemented` · `phase-unwired` ·
 *   `retry-unplannable`. **Not** `stage-result-conflict` or `budget-exhausted`:
 *   both are §8.10 dispositions this walk returns rather than raises
 */
export async function walkStages(
	store,
	{ hold, run, ticket, attempt, phases, nextAttempt = null, budgets = null, actor, now },
) {
	let phase = PHASE_IMPLEMENT;
	let tryNumber = FIRST_TRY;

	for (;;) {
		try {
			// The executor is inside the try because §8.4's review resolves the
			// stages of its own axis attempts before answering for the phase: a
			// conflict met in there is the same race met here, and it is §8.10's
			// disposition either way rather than an exception in one case and a
			// filing in the other. §8.6's exhaustion arrives the same way and for
			// the same reason — the fan-out spends the automation budget on the
			// axes' behalf, and a budget that ran out in there settles the ticket
			// execution exactly as one that ran out here does.
			const answer = await answerFor(store, { run, ticket, phase, attempt, try: tryNumber, phases });
			const resolved = resolveStage(store, {
				hold,
				run,
				ticket,
				phase,
				attempt,
				try: tryNumber,
				outcome: answer.outcome,
				detail: answer.detail ?? null,
				actor,
				at: now(),
			});

			if (resolved.row.action === STAGE_ACTIONS.advance) {
				phase = resolved.row.to;
				tryNumber = FIRST_TRY;
				continue;
			}

			if (resolved.row.action === STAGE_ACTIONS.dispose) {
				return settle(phase, resolved.outcome, {
					store,
					run,
					ticket,
					reasonClass: resolved.detail?.reason_class ?? null,
					question: resolved.detail?.question ?? null,
					pr: resolved.detail?.pr ?? null,
					summary: resolved.detail?.summary ?? null,
					advisory: resolved.detail?.advisory ?? null,
				});
			}

			// #155: **the same work, on the next routable profile, charged to
			// nothing.** It is placed before the budget branch and deliberately
			// outside it: a reroute spends no declared number, and `requireBudget`
			// is what makes an unbounded retry unconstructible, so a reroute that
			// passed through it would have to be given a budget to be free of one.
			// What bounds it instead is the seam — each routable profile is
			// dispatched at most once per ticket execution, and running out is
			// `routes-exhausted` below rather than another lap.
			//
			// It re-enters the phase it left, like §8.10's automation retry and
			// unlike §8.5's tiers: nothing about the work was judged, so there is
			// nothing to rebuild from the top.
			// Every row below that mints asks the seam the same way: the failure that
			// routed here, whole. One closure, so three branches cannot come to hand
			// the seam three different accounts of one resolution.
			const relaunched = () =>
				retried(nextAttempt, {
					attempt,
					phase,
					outcome: resolved.outcome,
					detail: resolved.detail,
					row: resolved.row,
				});

			if (resolved.row.action === STAGE_ACTIONS.reroute) {
				attempt = await relaunched();
				tryNumber = FIRST_TRY;
				continue;
			}

			// #194: **the same work, rebased by a builder attempt, charged to
			// nothing.** Outside the budget branch for the reroute's reason — a
			// row that passed through `requireBudget` would have to be given a
			// budget to be free of one — and unlike the reroute it re-enters
			// `implement`: it is one of §8.5's tiers, its subject is the work, and
			// the rebased result is harvested, verified and reviewed from the top.
			// What bounds it is the row itself: `resolveStage` answers `thereafter`
			// — today's fresh-retry — once this ticket execution has routed here.
			if (resolved.row.action === STAGE_ACTIONS.rebaseRepair) {
				attempt = await relaunched();
				tryNumber = FIRST_TRY;
				phase = PHASE_IMPLEMENT;
				continue;
			}

			if (Object.hasOwn(BUDGET_KEY_FOR_ACTION, resolved.row.action)) {
				// §8.6, **before the seam is asked**: the resolution that routed here
				// is itself the charge, so the count this reads already includes it.
				// Asking after the mint would spend on a chain the budget had already
				// ended, and asking the seam to count would put §8.6 in as many places
				// as there are callers.
				requireBudget(store, { run, ticket, budgets, row: resolved.row });

				// §8.10's `retry` of a **controller** phase mints nothing (§8.8, #146).
				// `verify` and `integrate` have no worker, so there is no worker run for
				// a fresh attempt to be: an attempt id here would name a row with no
				// pane, no worktree and no manifest behind it. The phase is re-entered
				// under the attempt the walk is already on, at the next try — which is
				// the slot the semantic key grew for exactly this, and the reason the
				// re-entry does not read its own recorded result straight back.
				if (isControllerRetry(phase, resolved.row.action)) {
					tryNumber += 1;
					continue;
				}

				attempt = await relaunched();
				// A fresh attempt is a fresh worker run, and its first pass through any
				// phase is its first: the try counts passes within one attempt.
				tryNumber = FIRST_TRY;

				// §8.5: a **tier** re-enters `implement` under a new attempt, because
				// its subject is the work — a repair for a rejected review still starts
				// by building, and is verified and reviewed again from the top. An
				// **automation retry** re-enters the phase it left: the automation
				// failed, not the work, and rebuilding good work because a pane died
				// is the flake charged to the builder that §8.6 forbids.
				phase = RETRY_TIERS.includes(resolved.row.action) ? PHASE_IMPLEMENT : phase;
				continue;
			}

			throw unbuilt({ row: resolved.row, phase });
		} catch (error) {
			// §8.10's last row, and the reason the conflict is typed rather than
			// merely thrown: **two results disagreeing under one semantic key is a
			// disposition, not a crash.** A walk that let it escape would leave the
			// ticket execution at no disposition at all — the one state §8.9 has no
			// word for, and the state a human cannot act on.
			if (error.reason === "stage-result-conflict") {
				return settle(TABLE_WIDE, "duplicate-conflicting", {
					store,
					run,
					ticket,
					conflict: Object.freeze({ ...error.details }),
				});
			}

			// §8.6's exhaustion, for the same reason: **retries stop, and so does the
			// ticket execution.** The settlement is read off the refusal rather than
			// re-derived, so the class the operator sees and the class the budget
			// refused under are one value.
			if (error.reason === "budget-exhausted") return exhausted(store, { run, ticket, phase, details: error.details });

			// #155's exhaustion, and it arrives the same way and for the same
			// reason: the reroute has nowhere left to send the work, and that is
			// §8.10's own row rather than a crash. The row is **phase-less** — a
			// routed fresh-retry is reachable from `verify` and `integrate`, which
			// have no attempt for an outcome to belong to — so the outcome is read
			// from the table's phase-less rows while the **phase** stays the one
			// the run ran out in, exactly as `exhausted` above pairs them.
			if (error.reason === "routes-exhausted") {
				return disposed({
					store,
					run,
					ticket,
					phase,
					outcome: "routes-exhausted",
					verdict: dispositionOf(routeOutcome(TABLE_WIDE, "routes-exhausted")),
					summary: error.message,
				});
			}

			throw error;
		}
	}
}

/**
 * Whether §8.10 has routed a **controller** phase to its automation retry —
 * the one retry in the table that mints no attempt (§8.8, #146).
 *
 * It asks the two questions separately, and reads the phase from
 * `CONTROLLER_PHASES` rather than naming `verify` and `integrate`: the phase's
 * kind is §8.1's, declared once, and a hand-kept pair here would be a second
 * vote on which phases have a worker. §8.5's two tiers are never controller
 * retries whatever phase they were routed from — a tier's subject is the work,
 * so it always re-enters `implement` under a builder attempt.
 */
function isControllerRetry(phase, action) {
	return action === STAGE_ACTIONS.retry && CONTROLLER_PHASES.includes(phase);
}

/**
 * Ask the seam for the next attempt, and hold its answer to the rule §8.5 states
 * about worker attempts: **a retry that mints one mints a fresh one.**
 *
 * Every row that reaches here mints: §8.5's two tiers, and §8.10's automation
 * retry of an agent-borne phase. The one retry that does not is a controller
 * phase's, and it never gets this far — the walk re-enters it under its own
 * attempt at the next try, which is a different mechanism and not a seam
 * answering with the attempt it was handed (#146).
 *
 * The guard is not defensive tidiness. A seam answering with the attempt it was
 * handed would send the walk back to a phase whose result is already recorded
 * for that attempt **at that try**, read the same outcome back, and route to the
 * same row forever — a loop that looks from outside like a hung controller and
 * writes nothing to say otherwise.
 */
async function retried(nextAttempt, request) {
	if (typeof nextAttempt !== "function") {
		throw new FactoryPipelineError(
			"retry-unplannable",
			`§8.10 routes ${request.phase} × ${request.row.outcome} to ${request.row.action}, and this caller wired no ` +
				"seam to mint the next attempt (§8.5, §9). Carrying on to the next phase instead is how a failing attempt " +
				"becomes a publication, so the walk stops here with the chain it has written.",
			{
				at: "seam",
				phase: request.phase,
				outcome: request.row.outcome,
				action: request.row.action,
				budget: request.row.budget,
			},
		);
	}

	const answer = await nextAttempt({ tier: request.row.action, budget: request.row.budget, ...request });
	if (typeof answer?.attempt !== "string" || answer.attempt === request.attempt) {
		throw new FactoryPipelineError(
			"retry-unplannable",
			`A ${request.row.action} is a fresh attempt with a fresh worktree (§8.5), and this seam answered with ` +
				`${JSON.stringify(answer?.attempt ?? null)} for attempt ${request.attempt}. Re-entering the phase under the ` +
				"same attempt would read its recorded result back and route here again, without end.",
			{ at: "seam", action: request.row.action, attempt: request.attempt, found: answer?.attempt ?? null },
		);
	}

	return answer.attempt;
}

/**
 * The ticket execution's terminal answer: §14.18's verdict, and the chain that
 * produced it.
 *
 * The chain rides along because §8.9's pause and failure comments are required
 * to carry it (#109) and the walk is the last place it is cheap to read — the
 * caller would otherwise re-derive from the journal a list this function has
 * just finished writing. **The question rides along for the same reason and off
 * the same detail**: §3.4's pause is the exact question a worker asked, and a
 * disposition that had to go back for it would be reading a record this walk
 * just resolved.
 *
 * **The pull request, the summary, and the advisory findings ride the same
 * way** (§7.5, §8.7): §8.9 refuses a `published` disposition with no PR link,
 * and §8.7 puts the summary and the advisory findings in the ticket comment as
 * well as in the PR body. All three come off the disposing phase's own detail,
 * so there is one place they are produced and one place they are read.
 *
 * The `verdict` — §14.18's `{disposition, reason_class, fault}` — is the
 * caller's, because the two ways of settling read it from different places: a
 * `dispose` row derives it from the row, and §8.6's exhaustion carries it on the
 * refusal. Everything else about a terminal answer is the same either way, and
 * is therefore spelled once here.
 */
function disposed({
	store,
	run,
	ticket,
	phase,
	outcome,
	verdict,
	question = null,
	conflict = null,
	pr = null,
	summary = null,
	advisory = null,
}) {
	return Object.freeze({
		...verdict,
		question,
		pr,
		reason: summary,
		advisory,
		phase,
		outcome,
		conflict,
		chain: outcomeChain(store, { run, ticket }),
	});
}

/**
 * §8.6's exhaustion, as the disposition it settles into.
 *
 * The verdict comes off the refusal rather than from a row lookup, and that is
 * the whole difference from `settle`: the **outcome** is §8.10's phase-less
 * exhaustion row while the **phase** is the one whose retry was refused, so the
 * `(phase, outcome)` pair `settle` would look up names no row at all. The reason
 * class may also be the failing row's own (§8.10's `check-unrunnable` and
 * `rebase-conflict`), which is a fact about where the budget ran out rather than
 * about the phase-less row.
 */
function exhausted(store, { run, ticket, phase, details }) {
	return disposed({
		store,
		run,
		ticket,
		phase,
		outcome: details.outcome,
		verdict: {
			disposition: details.disposition,
			reason_class: details.reason_class,
			fault: details.fault,
		},
	});
}

/** A `dispose` row's own settlement (§8.9), with §14.18 applied to it. */
function settle(
	phase,
	outcome,
	{ store, run, ticket, reasonClass = null, question = null, conflict = null, pr = null, summary = null, advisory = null },
) {
	return disposed({
		store,
		run,
		ticket,
		phase,
		outcome,
		verdict: dispositionOf(routeOutcome(phase, outcome), { reasonClass }),
		question,
		conflict,
		pr,
		summary,
		advisory,
	});
}

/**
 * This phase's result: the one already recorded for this attempt, or a fresh run
 * of its executor.
 *
 * A phase with no executor is the walk arriving somewhere this package cannot
 * go, and it refuses **before** running anything — the refusal names the phase
 * rather than the row, because there is no outcome yet to route.
 */
async function answerFor(store, { run, ticket, phase, attempt, try: tryNumber, phases }) {
	const recorded = recordedStage(store, { run, ticket, phase, attempt, try: tryNumber });
	if (recorded !== null) {
		return { outcome: recorded.payload.outcome, detail: recorded.payload.detail };
	}

	const executor = phases[phase];
	if (executor === undefined) throw unwiredPhase(phase);

	return executor({ run, ticket, phase, attempt, try: tryNumber });
}

/**
 * **Every phase of §8.1's pipeline is built**, so a phase with no executor is a
 * caller that left one out rather than a slice nobody wrote.
 *
 * The `{missing, spec}` pair this used to carry is gone with the last unbuilt
 * seam (#111's budgets, #113's integration). A table of what is waiting on which
 * ticket, with nothing in it, is a table that only says something the day
 * somebody adds a row to it by hand.
 */
function unwiredPhase(phase) {
	return new FactoryPipelineError(
		"phase-unwired",
		`The walk reached ${phase}, and this caller wired no executor for it. §8.1's pipeline is walked whole; a ` +
			"phase the caller left out cannot be inferred, and carrying on past it would skip the phase silently.",
		{ at: "phase", phase },
	);
}

function unbuilt({ row, phase }) {
	// §8.4's `verdict` is not on the list and never will be: it is taken inside
	// the review fan-out, under the axis attempt that produced it, and the walk
	// only ever resolves the phase's own result under the builder attempt. Reaching
	// it here means a review executor answered with an attempt outcome instead of a
	// phase result, which is a composition defect rather than a slice nobody wrote.
	if (row.action === STAGE_ACTIONS.verdict) {
		return new FactoryPipelineError(
			"phase-unwired",
			`§8.10 routes ${phase} × ${row.outcome} to ${row.action}, which pipeline/review.mjs takes under the axis ` +
				`attempt that wrote it. The walk resolves the phase's own result — ${PHASE_RESULTS[PHASE_REVIEW].join(", ")} ` +
				`— so an executor answering with a reviewer's attempt outcome has handed it the wrong level (§8.8).`,
			{ at: "action", phase, outcome: row.outcome, action: row.action },
		);
	}

	// Every action §8.10 declares now advances, disposes, reroutes, rebase-repairs,
	// or spends a budget, so the walk reaching here means the table grew an
	// action nothing routes. It is a refusal rather than a fallthrough for the
	// reason the whole file is: the plausible fallthrough is "carry on to the next
	// phase", which is how a failing attempt becomes a publication.
	return new FactoryPipelineError(
		"not-yet-implemented",
		`§8.10 routes ${phase} × ${row.outcome} to ${row.action}, which no slice claims: the walk advances, disposes, ` +
			"reroutes, rebase-repairs, and spends the three budgets, and this is none of them (§8.10).",
		{ at: "action", phase, outcome: row.outcome, action: row.action, budget: row.budget, missing: null, spec: "§8.10" },
	);
}

/**
 * The chain, read back from durable state (§8.10's re-entry).
 *
 * The operator's next action depends on the **shape** of the chain rather than
 * on its last element, so it is never summarised away: a ticket that failed
 * verify twice and a ticket that failed review once end in the same place and
 * need different things.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number }} where
 * @returns {ReadonlyArray<Readonly<{ phase: string, outcome: string, attempt: string | null }>>}
 */
export function outcomeChain(store, { run, ticket }) {
	return Object.freeze(
		stageRecords(store, { run, ticket }).map((record) => {
			// #189: a step the controller refused carries the controller's own
			// problems — which block was missing or malformed — so §8.9's disposition
			// comment names it. The key is present only where there are any: the
			// chain is digested into the disposition block, and an absent key is one
			// spelling rather than two for "nothing to say".
			const problems = record.payload.detail?.problems;
			return Object.freeze({
				phase: record.phase,
				outcome: record.payload.outcome,
				attempt: record.attempt,
				...(Array.isArray(problems) && problems.length > 0 ? { problems: Object.freeze([...problems]) } : {}),
			});
		}),
	);
}

/**
 * Every `stage.resolved` this ticket execution recorded, in sequence order.
 *
 * Ordering is the journal's own sequence and never a clock (§14.37), which is
 * also why the chain is read rather than accumulated in memory: the walk that
 * built it may have been a previous controller's.
 */
function stageRecords(store, { run, ticket }) {
	return store
		.readEvents({ stream: runStream(run), kind: "stage.resolved" })
		.filter((record) => record.ticket === ticket);
}

/**
 * Every stage this ticket execution resolved, **with its detail** — the chain
 * plus what each step actually found.
 *
 * `outcomeChain` deliberately summarises to `(phase, outcome, attempt)` because
 * that is what a human's next action depends on. §8.7's attestation needs the
 * other half: the checks the verify phase ran, the verdicts and findings each
 * review axis wrote, the before/after guard each one was held to. Re-deriving
 * those from the journal a second way is how two readers of one record start to
 * disagree, so there is one reader and two projections of it.
 *
 * `phase` is required, not a filter a caller may omit: both readers ask about
 * one phase, and a whole-execution dump would be `outcomeChain` with details
 * bolted on — a second answer to a question that already has one.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ run: string, ticket: number, phase: string }} where
 * @returns {ReadonlyArray<Readonly<{ attempt: string | null, outcome: string, detail: object | null }>>}
 *   in the journal's own sequence order
 */
export function stageResults(store, { run, ticket, phase }) {
	return Object.freeze(
		stageRecords(store, { run, ticket })
			.filter((record) => record.phase === phase)
			.map((record) =>
				Object.freeze({ attempt: record.attempt, outcome: record.payload.outcome, detail: record.payload.detail }),
			),
	);
}

/**
 * The result committed under one semantic key, or `null` for a stage nobody
 * resolved.
 *
 * Exported because §8.4's fan-out resumes the same way the walk does — a review
 * axis whose stage is already resolved is not re-run — and re-deriving it from
 * `outcomeChain` would lose the detail, which is where the verdict and its
 * findings live.
 *
 * **`try` is required, not defaulted** (#146). Every caller today wants the
 * first pass, and a default saying so would be right today and silently wrong
 * the day §8.10 gives another phase a `retry` row: the reader would keep
 * answering with pass 1 while the walk had moved on, which is the class of
 * silent wrong answer §15 names. Spelling `FIRST_TRY` at the call site costs a
 * word and puts the assumption where someone adding the row will see it.
 */
export function recordedStage(store, { run, ticket, phase, attempt, try: tryNumber }) {
	return (
		stageRecords(store, { run, ticket }).find(
			(record) => record.phase === phase && record.attempt === attempt && tryOf(record) === tryNumber,
		) ?? null
	);
}

/**
 * Which pass a recorded stage was, read tolerantly.
 *
 * A record written before the slot existed is the first pass by definition:
 * nothing could re-enter a controller phase then, because the walk refused at
 * the seam (#146). Reading it as anything else would make one replayed journal
 * disagree with the one that wrote it.
 */
function tryOf(record) {
	return record.payload.try ?? FIRST_TRY;
}
