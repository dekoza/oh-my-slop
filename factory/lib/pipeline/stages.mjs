import {
	PHASE_IMPLEMENT,
	PHASE_INTEGRATE,
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
 * **The semantic key is `(run, ticket, phase, attempt)`** — §2.1's stage
 * identity plus the attempt it was resolved under. The attempt slot is what
 * keeps §8.5's repair honest: a repaired ticket execution re-enters `implement`
 * with a new attempt, and that second result is a new fact rather than a
 * contradiction of the first. Without it every repair would look like §8.10's
 * conflicting duplicate, and a working pipeline would fail itself.
 *
 * Under one key, §8.10's last two rows apply: **an identical duplicate returns
 * the committed result idempotently, and a conflicting one is a typed
 * conflict.** That is the same discipline §4.5 applies to effects — the key is
 * natural and the payload digest sits beside it — for the same reason: a key
 * that hashed the result would turn a disagreement into a different key, and the
 * conflict nobody wants to find would be the one nobody can.
 */

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
export function resolveStage(store, { hold, run, ticket, phase, attempt, outcome, detail = null, actor, at }) {
	const row = routeOutcome(phase, outcome);
	const committedDigest = resultDigest({ outcome, detail });

	const existing = recordedStage(store, { run, ticket, phase, attempt });
	if (existing !== null) {
		if (existing.payload.result_digest === committedDigest) {
			// §8.10: the duplicate-identical row. The committed result is returned
			// unchanged and nothing is appended — a second record saying the same
			// thing would make the chain report a phase that ran twice.
			return Object.freeze({
				state: "already-resolved",
				outcome: existing.payload.outcome,
				detail: existing.payload.detail,
				row,
			});
		}

		throw new FactoryPipelineError(
			"stage-result-conflict",
			`Stage ${run}/${ticket}/${phase} was already resolved as ${JSON.stringify(existing.payload.outcome)} under ` +
				`attempt ${attempt}, and this result says ${JSON.stringify(outcome)}. Two results disagreeing under one ` +
				"semantic key is §8.10's typed conflict; the controller files it rather than picking a winner.",
			{
				at: "stage",
				run,
				ticket,
				phase,
				attempt,
				committed: existing.payload.outcome,
				found: outcome,
			},
		);
	}

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
 * wired here is §8.1's first four phases, §8.5's two repair tiers, §8.6's
 * budgets and §8.9's dispositions; integration (#113) replaces the one refusal
 * left, and the stages already recorded stay on the chain either way.
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
 *   §8.5's tier seam: given the tier, the budget it consumes and the failure's
 *   own evidence, it mints and launches the next attempt and answers with its
 *   id. It is the caller's because a tier *plans* (`pipeline/repair.mjs`), which
 *   needs the clone, the routing and the run's pinned base — none of which the
 *   walk has. **It does not decide whether the retry is affordable**: the budget
 *   is asked here, before the seam, so §8.6 is answered once for every caller
 *   rather than once per caller
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
			const answer = await answerFor(store, { run, ticket, phase, attempt, phases });
			const resolved = resolveStage(store, {
				hold,
				run,
				ticket,
				phase,
				attempt,
				outcome: answer.outcome,
				detail: answer.detail ?? null,
				actor,
				at: now(),
			});

			if (resolved.row.action === STAGE_ACTIONS.advance) {
				phase = resolved.row.to;
				continue;
			}

			if (resolved.row.action === STAGE_ACTIONS.dispose) {
				return settle(phase, resolved.outcome, {
					store,
					run,
					ticket,
					reasonClass: resolved.detail?.reason_class ?? null,
					question: resolved.detail?.question ?? null,
				});
			}

			if (Object.hasOwn(BUDGET_KEY_FOR_ACTION, resolved.row.action)) {
				// §8.6, **before the seam is asked**: the resolution that routed here
				// is itself the charge, so the count this reads already includes it.
				// Asking after the mint would spend on a chain the budget had already
				// ended, and asking the seam to count would put §8.6 in as many places
				// as there are callers.
				requireBudget(store, { run, ticket, budgets, row: resolved.row });

				attempt = await retried(nextAttempt, {
					attempt,
					phase,
					outcome: resolved.outcome,
					detail: resolved.detail,
					row: resolved.row,
				});

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

			throw error;
		}
	}
}

/**
 * Ask the seam for the next attempt, and hold its answer to §8.5's one rule:
 * **a retry is a fresh attempt.**
 *
 * The guard is not defensive tidiness. A seam answering with the attempt it was
 * handed would send the walk back to a phase whose result is already recorded
 * for that attempt, read the same outcome back, and route to the same tier
 * forever — a repair loop that looks from outside like a hung controller and
 * writes nothing to say otherwise.
 */
async function retried(nextAttempt, request) {
	if (typeof nextAttempt !== "function") {
		throw new FactoryPipelineError(
			"retry-unplannable",
			`§8.10 routes ${request.phase} × ${request.row.outcome} to ${request.row.action}, and this caller wired no ` +
				"seam to mint the next attempt (§8.5). Carrying on to the next phase instead is how a failing attempt " +
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
 * The `verdict` — §14.18's `{disposition, reason_class, fault}` — is the
 * caller's, because the two ways of settling read it from different places: a
 * `dispose` row derives it from the row, and §8.6's exhaustion carries it on the
 * refusal. Everything else about a terminal answer is the same either way, and
 * is therefore spelled once here.
 */
function disposed({ store, run, ticket, phase, outcome, verdict, question = null, conflict = null }) {
	return Object.freeze({
		...verdict,
		question,
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
function settle(phase, outcome, { store, run, ticket, reasonClass = null, question = null, conflict = null }) {
	return disposed({
		store,
		run,
		ticket,
		phase,
		outcome,
		verdict: dispositionOf(routeOutcome(phase, outcome), { reasonClass }),
		question,
		conflict,
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
async function answerFor(store, { run, ticket, phase, attempt, phases }) {
	const recorded = recordedStage(store, { run, ticket, phase, attempt });
	if (recorded !== null) {
		return { outcome: recorded.payload.outcome, detail: recorded.payload.detail };
	}

	const executor = phases[phase];
	if (executor === undefined) throw unbuiltPhase(phase);

	return executor({ run, ticket, phase, attempt });
}

/**
 * What each unbuilt **phase** is waiting for. Named here, once: the same
 * `{missing, spec}` pair every other unbuilt seam in this package carries, so an
 * operator meeting one reads the ticket number rather than a stack trace.
 *
 * It is keyed by phase alone now that §8.6's budgets are built — every action
 * §8.10 routes to has behaviour behind it, so an action reaching `unbuilt` is a
 * composition defect rather than a slice nobody wrote.
 */
const UNBUILT = Object.freeze({
	[PHASE_INTEGRATE]: { missing: "integration and publication — the first pull request (#113)", spec: "§7.5" },
});

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

	// Every action §8.10 declares now advances, disposes, or spends a budget, so
	// the walk reaching here means the table grew an action nothing routes. It is
	// a refusal rather than a fallthrough for the reason the whole file is: the
	// plausible fallthrough is "carry on to the next phase", which is how a
	// failing attempt becomes a publication.
	return new FactoryPipelineError(
		"not-yet-implemented",
		`§8.10 routes ${phase} × ${row.outcome} to ${row.action}, which no slice claims: the walk advances, disposes, ` +
			"and spends the three budgets, and this is none of them (§8.10).",
		{ at: "action", phase, outcome: row.outcome, action: row.action, budget: row.budget, missing: null, spec: "§8.10" },
	);
}

function unbuiltPhase(phase) {
	const waiting = UNBUILT[phase];
	if (waiting === undefined) {
		return new FactoryPipelineError(
			"phase-unwired",
			`The walk reached ${phase}, and this caller wired no executor for it. §8.1's pipeline is walked whole; a ` +
				"phase the caller left out cannot be inferred, and carrying on past it would skip the phase silently.",
			{ at: "phase", phase },
		);
	}

	return new FactoryPipelineError(
		"not-yet-implemented",
		`The walk reached ${phase}, which is not built in this package: ${waiting.missing} (${waiting.spec}).`,
		{ at: "phase", phase, ...waiting },
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
		stageRecords(store, { run, ticket }).map((record) =>
			Object.freeze({ phase: record.phase, outcome: record.payload.outcome, attempt: record.attempt }),
		),
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
 * The result committed under one semantic key, or `null` for a stage nobody
 * resolved.
 *
 * Exported because §8.4's fan-out resumes the same way the walk does — a review
 * axis whose stage is already resolved is not re-run — and re-deriving it from
 * `outcomeChain` would lose the detail, which is where the verdict and its
 * findings live.
 */
export function recordedStage(store, { run, ticket, phase, attempt }) {
	return (
		stageRecords(store, { run, ticket }).find(
			(record) => record.phase === phase && record.attempt === attempt,
		) ?? null
	);
}
