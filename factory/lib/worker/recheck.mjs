import { FactoryEffectError } from "../effects/errors.mjs";
import { packageHandshake, recordPackageHandshake } from "../package/handshake.mjs";
import { runStream } from "../state/events.mjs";
import { FactoryWorkerError } from "./errors.mjs";

/**
 * §6.2's layer 3: **a cheap static recheck per attempt, with no fresh probe.**
 *
 * The handshake statics are recomputed and re-recorded under the run's own
 * effect key, which is where §11.7's rule arrives structurally: an identical
 * package is the committed pin coming back (`already-written`), and a changed
 * one is a typed payload conflict — **a failure, never a new pin**. The attempt
 * event cites the pinned digest rather than re-embedding the payload.
 *
 * The same event is where §11.7's model discipline lives: the observed
 * resolved model id is persisted per attempt, and a declared model resolving
 * to two different ids within one run is the split-brain in slow motion —
 * refused here, before the attempt spends anything.
 */

/**
 * @param {object} store an open store
 * @param {object} context
 * @param {object} context.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} context.run
 * @param {number} context.ticket
 * @param {string} context.attempt the §2.1 attempt id; its `attempt.launched`
 *   record must already exist, or the projection refuses the recheck event
 * @param {string} context.phase the phase the attempt runs in
 * @param {string} context.profile the dispatched profile's name
 * @param {string} context.declaredModel the profile's declared model string
 * @param {string | null} [context.observedModel] the runtime's resolved model id,
 *   as captured at launch; null when the launch has not observed one yet
 * @param {string} [context.executable] §11.7's anchor
 * @param {object | null} [context.expect] `package.expect` from config
 * @param {Record<string, string | undefined>} [context.env]
 * @param {string} context.actor
 * @param {number} context.at
 * @returns {Readonly<{ digest: string, outcome: string }>} the cited pin
 * @throws {FactoryWorkerError} `handshake-drift` · `handshake-unpinned` · `model-drift`
 */
export function attemptRecheck(
	store,
	{
		hold,
		run,
		ticket,
		attempt,
		phase,
		profile,
		declaredModel,
		observedModel = null,
		executable,
		expect = null,
		env,
		actor,
		at,
	},
) {
	const handshake = packageHandshake({ executable, expect, env });

	let written;
	try {
		written = recordPackageHandshake(store, handshake, {
			run,
			actor,
			fencingGeneration: hold.fence().generation,
			at,
		});
	} catch (error) {
		if (!(error instanceof FactoryEffectError) || error.reason !== "effect-payload-conflict") throw error;
		throw new FactoryWorkerError(
			"handshake-drift",
			`Attempt ${attempt}'s recheck produced a different handshake than run ${run}'s pin — the package changed ` +
				`under the run, and a recheck producing a different digest is a failure, not a new pin (§6.2, §11.7). ` +
				`Recomputed tree: ${handshake.tree.digest}.`,
			{ run, attempt, tree: handshake.tree.digest, ...error.details },
		);
	}

	if (written.outcome !== "already-written") {
		// The pin now exists — written by this very call, as durable evidence of
		// what the recheck observed — but a recheck is a *comparison*, and a run
		// that never pinned at preflight has nothing to compare against.
		throw new FactoryWorkerError(
			"handshake-unpinned",
			`Run ${run} had no handshake pin for attempt ${attempt}'s recheck to cite — preflight writes the one ` +
				`immutable pin per run, and a recheck before it is an ordering bug (§11.7). The recheck's own observation ` +
				`is recorded as ${written.reference.digest}.`,
			{ run, attempt, digest: written.reference.digest },
		);
	}

	requireStableModel(store, { run, attempt, declaredModel, observedModel });

	hold.append({
		kind: "attempt.rechecked",
		source: "controller",
		run,
		ticket,
		phase,
		attempt,
		occurredAt: at,
		observedAt: at,
		payload: {
			handshake_digest: written.reference.digest,
			profile,
			declared_model: declaredModel,
			resolved_model: observedModel,
		},
	});

	return Object.freeze({ digest: written.reference.digest, outcome: written.outcome });
}

/**
 * §11.7: within one run, one declared model resolves to one observed id. The
 * comparison is per declared string, because different roles legitimately run
 * different models — what may never happen is `opus` meaning one thing to
 * attempt 1 and another to attempt 2.
 */
function requireStableModel(store, { run, attempt, declaredModel, observedModel }) {
	if (observedModel === null) return;

	for (const event of store.readEvents({ stream: runStream(run), kind: "attempt.rechecked" })) {
		const prior = event.payload;
		if (prior.declared_model !== declaredModel) continue;
		if (prior.resolved_model === null || prior.resolved_model === observedModel) continue;

		throw new FactoryWorkerError(
			"model-drift",
			`The declared model "${declaredModel}" resolved to ${observedModel} for attempt ${attempt}, but attempt ` +
				`${event.attempt} in the same run observed ${prior.resolved_model}. The observed id changing between ` +
				`attempts within one run is an automation failure — the split-brain in slow motion (§11.7).`,
			{
				run,
				attempt,
				declared_model: declaredModel,
				observed: observedModel,
				prior_attempt: event.attempt,
				prior_observed: prior.resolved_model,
			},
		);
	}
}
