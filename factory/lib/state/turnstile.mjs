/**
 * **One turn at a time, in this process**, for the two things §9.5 and §14.23
 * serialize without a lock: the mechanical checks, and the integration span.
 *
 * It is a promise chain rather than a lease row because there is nothing to
 * probe — the holder is a promise in this process, and §5.3 settles an
 * unresolved fact by re-probing the external system. The controller lease
 * already excludes a second controller (§4.6), so a per-process chain *is* the
 * whole mechanism; there is no cross-process lock to take.
 *
 * **Each caller keeps its own turnstile, and that is the point.** The check
 * runner and the integration span must not queue behind each other — they are
 * two different exclusions, and one chain serving both would make every
 * integration wait on an unrelated suite. This module exists so the mechanism
 * has one spelling, not so the two callers share one instance: a concurrency
 * primitive whose copies can drift is a concurrency primitive that will.
 */

/**
 * @returns {(work: () => Promise<unknown>) => Promise<unknown>} the gate; each
 *   call runs after every earlier one has settled, and returns what its own
 *   `work` returned
 */
export function createTurnstile() {
	let queue = Promise.resolve();

	return (work) => {
		// `.then(work, work)` and not `.finally(work)`: the next turn is owed its
		// go whether the previous one resolved or threw, and a rejection must not
		// travel down the chain into somebody else's call.
		const turn = queue.then(work, work);
		queue = turn.then(
			() => undefined,
			() => undefined,
		);
		return turn;
	};
}
