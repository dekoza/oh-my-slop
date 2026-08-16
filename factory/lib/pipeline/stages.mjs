import { PHASE_IMPLEMENT, PHASE_INTEGRATE, PHASE_REVIEW, STAGE_ACTIONS } from "../domain/vocabulary.mjs";
import { canonicalJson, digest, runStream } from "../state/events.mjs";
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
 * wired here is §8.1's first three phases and §8.9's dispositions; the repair
 * tiers (#110), the budgets (#111), the review fan-out (#112) and integration
 * (#113) each replace one refusal with behaviour, and the stages already
 * recorded stay on the chain either way.
 *
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt the attempt this walk is running
 * @param {Record<string, (where: object) => Promise<{ outcome: string, detail?: object | null }>>} context.phases
 *   the phase executors: `implement` is agent-borne and the caller's (§8.1),
 *   `harvest` and `verify` are `phases.mjs`'s controller phases
 * @param {string} context.actor
 * @param {() => number} context.now
 * @returns {Promise<Readonly<object>>} the ticket execution's disposition
 * @throws {FactoryPipelineError} `not-yet-implemented` · `stage-result-conflict`
 */
export async function walkStages(store, { hold, run, ticket, attempt, phases, actor, now }) {
	let phase = PHASE_IMPLEMENT;

	for (;;) {
		const answer = await answerFor(store, { run, ticket, phase, attempt, phases });

		let resolved;
		try {
			resolved = resolveStage(store, {
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
		} catch (error) {
			// §8.10's last row, and the reason the conflict is typed rather than
			// merely thrown: **two results disagreeing under one semantic key is a
			// disposition, not a crash.** A walk that let it escape would leave the
			// ticket execution at no disposition at all — the one state §8.9 has no
			// word for, and the state a human cannot act on.
			if (error.reason !== "stage-result-conflict") throw error;
			return settle(TABLE_WIDE, "duplicate-conflicting", {
				store,
				run,
				ticket,
				conflict: Object.freeze({ ...error.details }),
			});
		}

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

		throw unbuilt({ row: resolved.row, phase });
	}
}

/**
 * The ticket execution's terminal answer: §14.18's disposition, and the chain
 * that produced it.
 *
 * The chain rides along because §8.9's pause and failure comments are required
 * to carry it (#109) and the walk is the last place it is cheap to read — the
 * caller would otherwise re-derive from the journal a list this function has
 * just finished writing. **The question rides along for the same reason and off
 * the same detail**: §3.4's pause is the exact question a worker asked, and a
 * disposition that had to go back for it would be reading a record this walk
 * just resolved.
 */
function settle(phase, outcome, { store, run, ticket, reasonClass = null, question = null, conflict = null }) {
	const row = routeOutcome(phase, outcome);

	return Object.freeze({
		...dispositionOf(row, { reasonClass }),
		question,
		phase,
		outcome,
		conflict,
		chain: outcomeChain(store, { run, ticket }),
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
 * What each unbuilt row and phase is waiting for. Named here, once: the same
 * `{missing, spec}` pair every other unbuilt seam in this package carries, so an
 * operator meeting one reads the ticket number rather than a stack trace.
 */
const UNBUILT = Object.freeze({
	[STAGE_ACTIONS.repair]: { missing: "the two repair tiers (#110)", spec: "§8.5" },
	[STAGE_ACTIONS.freshRetry]: { missing: "the two repair tiers (#110)", spec: "§8.5" },
	[STAGE_ACTIONS.retry]: { missing: "the budgets and the circuit breaker (#111)", spec: "§8.6" },
	[STAGE_ACTIONS.verdict]: { missing: "review fan-out and the mutation attestation (#112)", spec: "§8.4" },
	[PHASE_REVIEW]: { missing: "review fan-out and the mutation attestation (#112)", spec: "§8.4" },
	[PHASE_INTEGRATE]: { missing: "integration and publication — the first pull request (#113)", spec: "§7.5" },
});

function unbuilt({ row, phase }) {
	const waiting = UNBUILT[row.action] ?? { missing: null, spec: "§8.10" };
	return new FactoryPipelineError(
		"not-yet-implemented",
		`§8.10 routes ${phase} × ${row.outcome} to ${row.action}, which is not built in this package: ${
			waiting.missing ?? "no slice claims it"
		} (${waiting.spec}).`,
		{ at: "action", phase, outcome: row.outcome, action: row.action, budget: row.budget, ...waiting },
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

/** The result committed under one semantic key, or `null` for a stage nobody resolved. */
function recordedStage(store, { run, ticket, phase, attempt }) {
	return (
		stageRecords(store, { run, ticket }).find(
			(record) => record.phase === phase && record.attempt === attempt,
		) ?? null
	);
}
