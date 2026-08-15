import { operatorRequests, requestLadder, requestReport } from "./stop.mjs";

/**
 * §10.5's signal path, in the shape the spec wants it to be.
 *
 * > **A second `stop`, `SIGTERM`, or a second `Ctrl-C` escalates to abandon.**
 *
 * A signal does not interrupt the scheduler. It records **the same durable
 * request the verb writes** — through the controller's own hold, so the write
 * is token-checked and fenced like any other — and the run loop honours it at
 * the next ticket boundary, exactly as it honours a request some other
 * terminal wrote. That is §10.5's "no signal-handler reentrancy inside an
 * async scheduler": the handler is a writer of one record, never a second
 * path through the drain.
 *
 * What a signal means is the spec's ladder, not the process's mood:
 *
 * - the first `SIGINT` is a **stop** — the run drains at the next boundary;
 * - a second `SIGINT`, or any `SIGTERM`, is the **abandon** — in-flight
 *   executions are marked `released`;
 * - a signal after an abandon is already on the stream appends nothing: a
 *   second `run.abandon-requested` would be a duplicate fact with a later
 *   sequence, noise the monitor would have to ignore.
 *
 * The listener is attached for the run and removed when the run ends, so a
 * signal the run can no longer be asked about cannot reach a released hold.
 */

/** §4.5's actor slot for this path: the operator's key, through the controller's process. */
export const SIGNAL_ACTOR = "operator:signal";

/** The spec's two signals and the request each one makes first. */
const SIGNAL_BASES = Object.freeze({ SIGINT: "stop", SIGTERM: "abandon" });

/**
 * The refusal reasons a signal may meet, each of which means "there is nothing
 * left to ask": the run has already ended (released) or the hold has already
 * conceded (§14.6). These are the only two this handler swallows — anything
 * else propagates, because a signal handler that hides a bug would be worse
 * than the signal it was asked to carry.
 */
const MOOT = new Set(["lease-released", "lease-lost"]);

/**
 * @param {object} wiring
 * @param {object} wiring.signal the event target to listen on — `process` in
 *   the real controller, an object with the same `on`/`removeListener` in a
 *   test, which is what lets one fire a signal at a chosen moment instead of
 *   racing a real delivery against a run that lasts milliseconds
 * @param {object} wiring.store an open store, for the stream the requests land on
 * @param {object} wiring.hold the controller's hold — the token-checked,
 *   fenced write path a request commits through
 * @param {() => number} wiring.now
 * @returns {{ attach: (run: string) => void, remove: () => void }} attach once
 *   `run.started` has committed, remove in the run's `finally`
 */
export function installSignalRequests({ signal, store, hold, now }) {
	let run = null;
	// A request that arrived before the run this controller drives has a
	// record — the §10.1 window before `run.started` commits. There is no
	// stream to write to yet, so the intent rides in memory and lands on
	// attach; a crash in that window loses nothing durable, because nothing
	// durable existed to lose it against.
	let pending = null;

	const latest = (candidateRun) => {
		const requests = operatorRequests(store, candidateRun);
		return requests.length === 0 ? null : requests[requests.length - 1];
	};

	const record = (candidateRun, base) => {
		const decision = requestLadder(latest(candidateRun), base);
		if (decision === null) return;

		hold.append({
			kind: decision.kind,
			source: "operator",
			run: candidateRun,
			occurredAt: now(),
			observedAt: now(),
			payload: decision.supersedes === null
				? { actor: SIGNAL_ACTOR }
				: { actor: SIGNAL_ACTOR, supersedes: decision.supersedes },
		});
	};

	const onSignal = (name) => {
		const base = SIGNAL_BASES[name];
		if (base === undefined) return;

		try {
			if (run === null) {
				pending = pending === null ? base : "abandon";
				return;
			}
			record(run, base);
		} catch (error) {
			if (error?.name === "FactoryStateError" && MOOT.has(error.reason)) return;
			throw error;
		}
	};

	signal.on("SIGINT", onSignal);
	signal.on("SIGTERM", onSignal);

	return {
		/**
		 * The run this controller drives, once its `run.started` has committed —
		 * after which a signal writes to the run's stream directly. A pending
		 * intent resolves against the stream through the same ladder: an
			* adopted run may already hold a request, and the spec's "second stop
			* escalates" counts the sequence, not the invocation.
		 */
		attach(candidateRun) {
			if (run !== null) return;
			run = candidateRun;
			if (pending !== null) {
				record(run, pending);
				pending = null;
			}
		},

		/** The run is over; a signal the run can no longer be asked about goes nowhere. */
		remove() {
			signal.removeListener("SIGINT", onSignal);
			signal.removeListener("SIGTERM", onSignal);
			run = null;
		},

		/** The requests the run's stream holds, for the report. */
		requests: (candidateRun) => operatorRequests(store, candidateRun).map(requestReport),
	};
}
