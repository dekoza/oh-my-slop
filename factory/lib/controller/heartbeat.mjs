/**
 * §4.8's liveness, the half that costs journal growth.
 *
 * The **lease row** is the liveness fact and is renewed every 10s by the hold
 * itself (`lease-guard.mjs`); a renewal writes one row and no record. This is the
 * other half: a `controller.heartbeat` event **every 60s**, carrying the lease
 * token, the fencing generation, and a one-line activity summary, classed
 * `diagnostic`.
 *
 * Two properties come from where the record lands rather than from what it says:
 *
 * - it carries **no `run` slot**, so it lands on `controller.heartbeat` — the one
 *   stream §4.2 front-truncates. Heartbeats are the single event class safe to
 *   compact, and a stream of their own is what makes compacting them possible
 *   without breaking any chain. The run is named in the payload instead;
 * - the monitor derives `controller-lost` from three missed beats or an expired
 *   lease row, **whichever it sees first** — the controller never self-asserts
 *   it (§14.36), so nothing here writes that reason.
 *
 * **`watching` is why the record has a payload at all beyond the token.** §5.1
 * emits an event per observed pane transition and nothing at all when a pane is
 * quiet, so "no events for ten minutes" is ambiguous between a quiet worker and
 * an observer that stopped watching. The count disambiguates it.
 */

/** §4.8. Not configuration: the monitor's 3-missed-beats rule is derived from it. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * @param {object} options
 * @param {object} options.store the open store
 * @param {object} options.hold the controller's hold (`lease-guard.mjs`)
 * @param {string} options.run the run this controller is driving
 * @param {() => string} options.activity the one-line summary, asked for at each
 *   beat rather than handed over once — a summary fixed at startup would say
 *   "preflight" for the whole run
 * @param {() => number} [options.watching] how many panes the observer is watching
 * @param {() => number} [options.now]
 * @param {{ setInterval: Function, clearInterval: Function }} [options.timers]
 *   injectable so a test drives the beat instead of waiting a minute for it
 * @returns {Readonly<object>} the beating heart; `stop()` when the run ends
 */
export function startHeartbeat({
	store,
	hold,
	run,
	activity,
	watching = () => 0,
	now = Date.now,
	timers = { setInterval, clearInterval },
}) {
	let emitted = 0;
	let stopped = false;

	// The first beat is immediate. A monitor watching a run that starts and ends
	// inside one interval would otherwise see a run with no evidence its
	// controller was ever alive, which is the exact question heartbeats answer.
	beat();

	const timer = timers.setInterval(() => beat(), HEARTBEAT_INTERVAL_MS);
	timer.unref?.();

	/**
	 * One beat. A controller that has lost its lease stops beating rather than
	 * reporting a token that is no longer its own: §14.6 says stop, and a
	 * heartbeat is a claim to be the live controller.
	 *
	 * @returns {boolean} whether a record was written
	 */
	function beat() {
		if (stopped || hold.lost) return false;

		const at = now();
		store.append({
			kind: "controller.heartbeat",
			source: "controller",
			occurredAt: at,
			observedAt: at,
			payload: {
				run,
				lease_token: hold.token,
				fencing_generation: hold.fencingGeneration,
				watching: watching(),
				activity: activity(),
			},
		});
		emitted += 1;
		return true;
	}

	return Object.freeze({
		beat,
		get emitted() {
			return emitted;
		},
		stop() {
			stopped = true;
			timers.clearInterval(timer);
		},
	});
}
