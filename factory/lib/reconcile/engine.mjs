import { PROBE_SOURCES } from "../effects/catalogue.mjs";
import { resolveEffectIn, unresolvedEffects } from "../effects/records.mjs";
import { EFFECT_REGISTRY } from "../effects/registry.mjs";
import { EVENT_SOURCES, FOREIGN_TIMESTAMP_KEY } from "../state/events.mjs";
import { evidenceEntry, reconcileConclusion } from "./conclusions.mjs";
import { FactoryReconcileError } from "./errors.mjs";
import { PROBES } from "./probes.mjs";

/**
 * §5.4's reconciliation engine.
 *
 * **Reconcile runs always at controller startup, before the lease is used for
 * any effect**, and on the operator's explicit `reconcile`. There is no separate
 * resume mode — resume *is* startup, and a special mode is a mode someone
 * forgets to enter.
 *
 * `doctor` runs **this** code with a read-only flag: it computes the same
 * conclusions and prints them, appending nothing (§14.24). That is why the probe
 * pass and the conclusion rule sit above the mode branch — two code paths would
 * be two answers, and the operator would have no way to know which one the
 * controller acted on.
 *
 * The engine settles nothing by reasoning (§14.1). An effect whose probe is
 * unimplemented, or whose probe failed, is left exactly as it was and reported:
 * that is §12.4's alarm — a run pinned by an effect nothing can settle — and it
 * is a far better outcome than an inferred success.
 */

/** The two ways the same computation is used (§5.4, §10.5). */
export const RECONCILE_MODES = Object.freeze({ settle: "settle", report: "report" });

/**
 * Which §4.5 matches mean the mutation was an **absence**. A confirmed absence
 * is the entity giving something up — an unassignment, a deleted worktree, a
 * stopped agent — so it concludes `released` rather than `adopted`.
 */
const ABSENCE_MATCHES = new Set(["absent", "agent-stopped"]);

/**
 * Which event source a probe's answer is recorded under (§4.3, §5.2). The
 * external systems are foreign facts and carry their own id and raw timestamp;
 * the artifact store is the factory's own disk, so its probe is the controller
 * speaking about something it owns.
 */
const OBSERVATION_SOURCES = Object.freeze({
	tracker: "gitea",
	"git-remote": "git",
	"git-local": "git",
	harness: "herdr",
	artifact: "controller",
});

// A probe source with no event source to record it under would be a `TypeError`
// at reconcile time, in the middle of settling somebody's run. Checked at
// import, where §4.5's vocabulary and §4.3's meet.
for (const source of PROBE_SOURCES) {
	if (OBSERVATION_SOURCES[source] === undefined) {
		throw new Error(`Probe source "${source}" has no event source to record its answer under (§4.3).`);
	}
}

/**
 * Why an effect was left unresolved. Reported, never thrown: a probe that cannot
 * answer is the ordinary state of a factory whose subsystems land one at a time,
 * and the operator's question is which effects nothing could settle.
 */
const UNSETTLED_REASONS = Object.freeze({
	probeUnavailable: "probe-unavailable",
	probeFailed: "probe-failed",
});

/**
 * @param {object} store an open store; a read-only handle for `report` mode
 * @param {object} [options]
 * @param {object} [options.probes] the §5.3 probe registry
 * @param {string} [options.mode] `settle` (default) or `report`
 * @param {number} [options.fencingGeneration] the generation the caller holds (§4.6)
 * @param {object | null} [options.hold] the controller's hold (`controller/lease-guard.mjs`).
 *   A settling pass opens its startup gate, which is how §5.4's "before the lease
 *   is used for any effect" holds without a call the run loop must remember
 * @param {string} [options.actor] `controller`, or `operator:<verb>`
 * @param {number} [options.at] UTC epoch milliseconds
 * @param {string | null} [options.causalCommandId]
 * @returns {Promise<Readonly<object>>} the report both verbs render from
 * @throws {FactoryReconcileError} `reconcile-read-only` · `reconcile-generation-required`
 */
export async function reconcile(
	store,
	{
		probes = PROBES,
		mode = RECONCILE_MODES.settle,
		fencingGeneration = null,
		hold = null,
		actor = "controller",
		at = Date.now(),
		causalCommandId = null,
	} = {},
) {
	const settling = requireMode(store, mode, fencingGeneration);

	const unresolved = unresolvedEffects(store);
	const scope = scopeOf(store, unresolved);
	const held = entitiesOf(scope, unresolved);
	const entities = [];
	const unsettled = [];
	let settled = 0;
	let settleable = 0;

	for (const entity of held) {
		// Probing first, whole: a probe is a read of the external system, so it
		// happens identically in both modes and nothing is written until every
		// answer for this entity is in hand.
		const { readings, unprobed } = await probeAll(entity.effects, { probes, store, at });
		unsettled.push(...unprobed);
		if (readings.length === 0) continue;

		const matched = readings.filter((reading) => reading.answer.matched).length;
		const concluded = concludeEntity(readings);
		settleable += matched;
		if (settling) {
			settled += commit(store, entity, readings, concluded, { actor, fencingGeneration, at, causalCommandId });
		}

		entities.push(
			Object.freeze({
				entity: entity.identity,
				...concluded,
				effects: Object.freeze({
					probed: readings.length,
					settleable: matched,
					unsettled: entity.effects.length - readings.length,
				}),
			}),
		);
	}

	// §5.4's precondition, discharged where it was actually met. Reconcile's own
	// resolutions are stamped with the generation the caller passed rather than
	// fenced through the hold, so opening the gate here cannot deadlock the pass
	// that opens it. It opens even when a probe could not answer: that is
	// §12.4's alarm, and refusing to start over it would stop the factory
	// permanently rather than loudly.
	if (settling) hold?.recordStartupReconcile();

	return Object.freeze({
		mode,
		at,
		actor,
		scope,
		entities: Object.freeze(entities),
		unsettled: Object.freeze(unsettled),
		// **`settled` is what was written**, so it is zero in report mode however
		// many probes matched: `doctor` printing "settled 3" while appending
		// nothing would be the one sentence §14.24 cannot afford to get wrong.
		// `settleable` is the half both modes compute identically.
		settled,
		settleable,
		fencing_generation: fencingGeneration,
		causal_command_id: causalCommandId,
		probes: Object.freeze([...probes.calls]),
	});
}

/**
 * `report` mode is `doctor`'s, and its guarantee is structural rather than
 * promised: the handle `doctor` opens carries no `transaction`, so this refusal
 * is what a caller meets if it asks that handle to settle anything (§14.24).
 */
function requireMode(store, mode, fencingGeneration) {
	if (mode === RECONCILE_MODES.report) return false;

	if (typeof store.transaction !== "function") {
		throw new FactoryReconcileError(
			"reconcile-read-only",
			"This store has no write path, so it can only be reconciled in report mode (§14.24).",
			{ mode, expected: RECONCILE_MODES.report },
		);
	}

	if (!Number.isSafeInteger(fencingGeneration)) {
		throw new FactoryReconcileError(
			"reconcile-generation-required",
			`Settling an effect stamps the generation the caller holds; found ${JSON.stringify(fencingGeneration ?? null)} (§4.6).`,
			{ at: "fencingGeneration", found: fencingGeneration ?? null },
		);
	}

	return true;
}

/**
 * §5.4's scope: **every run whose lifecycle is not `ended`, plus any entity
 * holding an unresolved effect** — a ticket execution, a run that has already
 * ended, or the repository itself for a repo-scoped one.
 *
 * The second clause is not a list of places effects happen to live. An
 * unresolved effect **outlives its run's ending** — that is why §12.4 makes it a
 * pin rather than a table-level exception — so an entity is in scope because it
 * holds one, whatever its own lifecycle says. Scoped to ticket executions alone,
 * a ticket-less effect of an ended run and a repo-scoped effect would be pinned
 * by §12.4 and reached by nothing: a permanent pin, with `doctor` shouting about
 * an obligation no verb could discharge.
 *
 * The repository is in scope **only** when it holds one, because there is no
 * other repository-level state for reconcile to settle.
 */
function scopeOf(store, unresolved) {
	const executions = new Map();
	const holding = new Set();
	let repository = false;

	for (const effect of unresolved) {
		if (effect.run_id === null) {
			repository = true;
		} else if (effect.ticket === null) {
			holding.add(effect.run_id);
		} else {
			executions.set(`${effect.run_id}/${effect.ticket}`, { run: effect.run_id, ticket: effect.ticket });
		}
	}

	// Unended runs first, oldest first, then whatever else is held — by sequence,
	// never by clock (§14.37), since `unresolved` comes back in request order.
	const runs = new Set(store.readUnendedRuns().map((row) => row.run_id));
	for (const run of holding) runs.add(run);

	return Object.freeze({
		runs: Object.freeze([...runs]),
		ticket_executions: Object.freeze([...executions.values()]),
		repository,
	});
}

/**
 * The entities a conclusion may be emitted about, each holding the effects that
 * are its own. A run holds the effects that name no ticket; a ticket execution
 * holds its own. The partition matters because the record is per entity: an
 * effect counted twice would be evidence for two conclusions.
 */
function entitiesOf(scope, unresolved) {
	const entities = [];

	for (const run of scope.runs) {
		entities.push({
			identity: Object.freeze({ kind: "run", run, ticket: null }),
			effects: unresolved.filter((effect) => effect.run_id === run && effect.ticket === null),
		});
	}

	for (const { run, ticket } of scope.ticket_executions) {
		entities.push({
			identity: Object.freeze({ kind: "ticket-execution", run, ticket }),
			effects: unresolved.filter((effect) => effect.run_id === run && effect.ticket === ticket),
		});
	}

	// The repository's own: a repo-scoped effect belongs to no run, so its
	// conclusion carries no run either and lands on the `controller` stream.
	if (scope.repository) {
		entities.push({
			identity: Object.freeze({ kind: "repository", run: null, ticket: null }),
			effects: unresolved.filter((effect) => effect.run_id === null),
		});
	}

	return entities;
}

/**
 * Every effect this entity holds, re-probed. The readings come back in the order
 * the effects were requested — §14.37's "ordering is by sequence, never by
 * clock" — because that order is what decides which answer is the deciding one.
 *
 * @returns {Promise<{ readings: object[], unprobed: object[] }>} one reading per
 *   effect the world answered about, and one report per effect it did not
 */
async function probeAll(effects, { probes, store, at }) {
	const readings = [];
	const unprobed = [];

	for (const effect of effects) {
		const probe = EFFECT_REGISTRY.probeFor(effect.operation);
		const implementation = probes.implementationFor(probe.call);

		if (implementation === null) {
			unprobed.push(
				unsettledEffect(
					effect,
					UNSETTLED_REASONS.probeUnavailable,
					`No probe implements the read "${probe.call}" in this package; the effect stays unresolved ` +
						"rather than being settled by reasoning (§14.1).",
				),
			);
			continue;
		}

		try {
			const answer = requireAnswer(await implementation({ effect, probe, store, at }), effect, probe);
			readings.push({ effect, probe, answer, entry: entryFor(effect, probe, answer) });
		} catch (error) {
			unprobed.push(unsettledEffect(effect, UNSETTLED_REASONS.probeFailed, error.message));
		}
	}

	return { readings, unprobed };
}

/**
 * §5.4's conclusion, derived from what the probes answered and nothing else.
 *
 * - a confirmed mutation decides, oldest first: an **absence** is the entity
 *   giving something up (`released`), anything else is its outcome coming back
 *   into the journal (`adopted`);
 * - failing that, a `harness` probe that could not match the attempt's token is
 *   §5.5's adoption test failing on §5.2's one authoritative fact — the worker is
 *   not there, so it is `declared-dead`;
 * - failing that, the probes ran and settled nothing: `unchanged`.
 *
 * The deciding answer leads the basis, because the operator's question is which
 * source decided.
 */
function concludeEntity(readings) {
	const landed = readings.find((reading) => reading.answer.matched);
	if (landed !== undefined) {
		return conclusionWith(ABSENCE_MATCHES.has(landed.probe.match) ? "released" : "adopted", landed, readings);
	}

	const unprovable = readings.find(
		(reading) => reading.probe.source === "harness" && reading.probe.match === "token-matches",
	);
	if (unprovable !== undefined) return conclusionWith("declared-dead", unprovable, readings);

	return conclusionWith("unchanged", readings[0], readings);
}

function conclusionWith(conclusion, deciding, readings) {
	return reconcileConclusion(conclusion, [
		deciding.entry,
		...readings.filter((reading) => reading !== deciding).map((reading) => reading.entry),
	]);
}

/**
 * One entity's conclusion, its probes' observations, and the resolutions they
 * settle — **in one transaction**. A conclusion committed apart from the
 * evidence it rests on would be a record the next reconcile could contradict
 * without either being wrong.
 *
 * @returns {number} how many effects the world settled
 */
function commit(store, entity, readings, concluded, { actor, fencingGeneration, at, causalCommandId }) {
	return store.transaction((tx) => {
		let settled = 0;

		for (const { effect, probe, answer } of readings) {
			const observation = observationOf(effect, probe, answer, { at, causalCommandId });
			// §5.1's unique index makes a foreign fact durable once. An unmatched
			// effect remains unresolved and is therefore re-probed at every startup;
			// if the external fact has not changed, its observation is already the
			// durable evidence and must not be inserted a second time.
			if (!observationRecorded(tx.db, observation.foreignSourceId)) {
				tx.appendEvent(observation);
			}

			// §5.3: only a probe settles a requested record, and only when the
			// declared match actually held. A probe that found the mutation absent
			// leaves the intent standing — re-issuing it is the controller's job,
			// and the key makes that idempotent.
			if (!answer.matched) continue;
			resolveEffectIn(tx, {
				key: effect.effect_key,
				actor,
				fencingGeneration,
				result: answer.result ?? null,
				at,
				causalCommandId,
			});
			settled += 1;
		}

		tx.appendEvent({
			kind: "reconcile.concluded",
			source: actor === "controller" ? "controller" : "operator",
			run: entity.identity.run,
			ticket: entity.identity.ticket,
			occurredAt: at,
			observedAt: at,
			causalCommandId,
			payload: {
				entity: { ...entity.identity },
				conclusion: concluded.conclusion,
				evidence: concluded.evidence.map((entry) => ({ ...entry })),
				effects: {
					probed: readings.length,
					settled,
					unsettled: entity.effects.length - readings.length,
				},
			},
		});

		return settled;
	});
}

/** §5.1's database-enforced foreign-fact deduplication. */
function observationRecorded(db, foreignSourceId) {
	if (foreignSourceId === null) return false;
	return (
		db
			.prepare(
				`SELECT 1 FROM event
				 WHERE kind = 'observation.recorded' AND foreign_source_id = ?`,
			)
			.get(foreignSourceId) !== undefined
	);
}

/** §5.3: the probe is itself written as an observation event carrying its source. */
function observationOf(effect, probe, answer, { at, causalCommandId }) {
	const source = OBSERVATION_SOURCES[probe.source];
	const payload = {
		effect_key: effect.effect_key,
		operation: effect.operation,
		probe: { ...probe },
		matched: answer.matched,
		detail: answer.detail ?? {},
	};
	// A foreign fact keeps that system's raw timestamp string verbatim (§4.3) —
	// unless the system states no time at all. Herdr is the one that does not:
	// nothing in its API dates an answer, so the slot stays empty rather than
	// being filled with our clock under Herdr's name, and `observed_at` is what
	// dates the reading.
	if (EVENT_SOURCES[source].foreign && EVENT_SOURCES[source].statesTime !== false) {
		payload[FOREIGN_TIMESTAMP_KEY] = answer.occurredAtRaw;
	}

	return {
		kind: "observation.recorded",
		source,
		run: effect.run_id,
		ticket: effect.ticket,
		phase: effect.phase,
		attempt: effect.attempt_id,
		foreignSourceId: EVENT_SOURCES[source].foreign ? answer.foreignSourceId : null,
		occurredAt: at,
		observedAt: at,
		causalCommandId,
		payload,
	};
}

function entryFor(effect, probe, answer) {
	return evidenceEntry({
		source: probe.source,
		call: probe.call,
		effectKey: effect.effect_key,
		matched: answer.matched,
		foreignSourceId: answer.foreignSourceId ?? null,
		occurredAtRaw: answer.occurredAtRaw ?? null,
		detail: answer.detail ?? {},
	});
}

/**
 * A probe answer, checked **in both modes** at the seam it arrives through.
 *
 * Checking it here rather than where the event is built is what keeps `doctor`
 * and `reconcile` on identical conclusions: a probe whose answer only the write
 * path refuses would make the read-only run conclude something the settling run
 * never could.
 */
function requireAnswer(answer, effect, probe) {
	if (typeof answer?.matched !== "boolean") {
		throw new FactoryReconcileError(
			"probe-answer-invalid",
			`The probe for ${effect.effect_key} answered ${JSON.stringify(answer?.matched ?? null)}; a probe ` +
				"says whether §4.5's declared match held.",
			{ at: "matched", effect_key: effect.effect_key, call: probe.call, found: answer?.matched ?? null },
		);
	}

	// §4.3: a foreign fact carries that system's own stable id and its raw
	// timestamp string verbatim. The probe is the only place that still has
	// both, so an answer without them is refused here rather than normalised
	// into evidence that no longer proves anything.
	const declaration = EVENT_SOURCES[OBSERVATION_SOURCES[probe.source]];
	if (declaration.foreign) {
		for (const [field, value] of [
			["foreignSourceId", answer.foreignSourceId],
			// A source that states no time has no raw timestamp to hand over, and
			// requiring one would force its probes to invent our clock in its name.
			...(declaration.statesTime === false ? [] : [["occurredAtRaw", answer.occurredAtRaw]]),
		]) {
			if (typeof value !== "string" || value.length === 0) {
				throw new FactoryReconcileError(
					"probe-answer-invalid",
					`A ${probe.source} probe answers with that system's ${field} (§4.3); found ${JSON.stringify(value ?? null)}.`,
					{ at: field, effect_key: effect.effect_key, call: probe.call, found: value ?? null },
				);
			}
		}
	}

	return answer;
}

function unsettledEffect(effect, reason, message) {
	return Object.freeze({ ...describeEffect(effect), reason, message });
}

/** An effect as the operator reads it in a report: never the raw row. */
function describeEffect(effect) {
	return Object.freeze({
		effect_key: effect.effect_key,
		operation: effect.operation,
		operand: effect.operand,
		run: effect.run_id,
		ticket: effect.ticket,
		phase: effect.phase,
		attempt: effect.attempt_id,
		requested_at: effect.requested_at,
		probe: EFFECT_REGISTRY.probeFor(effect.operation),
	});
}
