import { setTimeout as delay } from "node:timers/promises";

import { FactoryCapacityError } from "../capacity/errors.mjs";
import { FactoryStateError } from "../state/errors.mjs";

/**
 * §9.6's scheduler loop, whole:
 *
 * > *While a slot is free and the live frontier is non-empty, take the
 * > lowest-numbered claimable ticket; otherwise wait for a ticket execution to
 * > terminate.*
 *
 * **There is no queue object.** The map rules out a private generated task
 * graph and §10 rules out the resident work queue; an in-memory ready-queue is
 * that same object with a shorter lifetime, so the frontier is re-read at every
 * scheduling decision and **no membership is retained between two**. What the
 * loop does remember is what this run itself did — which tickets it is running,
 * has run, and refused — because those are facts about the run rather than a
 * cached copy of the tracker.
 *
 * **Fairness is §3.2's ascending issue number and nothing else.** Starvation is
 * structurally impossible rather than defended against — the frontier is finite,
 * every ticket execution reaches a terminal disposition, and §8.9's dispositions
 * remove tickets from eligibility — which is why **no aging or priority
 * mechanism exists here**.
 *
 * **Backpressure is simply not claiming.** A lane that cannot have its slots is
 * not queued, buffered, or pre-claimed: the tracker holds the backlog, and an
 * unclaimed ticket is the honest representation of unstarted work.
 *
 * The loop is **parametric in capacity**. It reads no ceiling constant and has
 * no branch at one: a pool of one and a pool of four differ only in how often
 * `acquireLane` answers. That is what lets §15's acceptance suite instantiate it
 * at capacity 2 with no override seam.
 */

/**
 * @param {object} loop
 * @param {object} loop.capacity the §9.4 pool (`capacity/slots.mjs`)
 * @param {() => Promise<{ claimable: ReadonlyArray<number>, members?: ReadonlyArray<object> }>} loop.frontier
 *   §3.2's live answer, re-read at every scheduling decision. `claimable` is in
 *   ascending issue order; the member records carry the labels routing reads.
 *
 *   **How expensive that call is belongs to whoever composes it**, not to this
 *   loop: the contract is one read per decision — roughly one per claim plus one
 *   per lane termination — and the loop cannot cache the answer without becoming
 *   the ready-queue §9.6 forbids. `readScope`'s default composition reads
 *   dependencies per member, so the wiring passes the maintained edge map
 *   instead; and that map must be **kept up to date** as `add_dependency`
 *   observations arrive, since one captured at run start would freeze the graph
 *   and claim against stale edges (§5.1)
 * @param {(member: object) => string} loop.resourceClassOf the class this ticket's
 *   implement attempt would draw from (`capacity/plan.mjs`)
 * @param {(lane: object) => Promise<{ disposition: string }> | { disposition: string }} loop.execute
 *   one ticket execution, from the claim to its terminal disposition. It is
 *   handed the slots the loop acquired **before** the claim (§14.21)
 * @param {() => boolean} [loop.claiming] §3.5's drain: false stops new claims and
 *   lets every in-flight execution run to its terminal disposition
 * @param {() => boolean} [loop.abandoning] §9.6's abandon: in-flight executions
 *   are marked `released` and their slots freed, and **worker panes are left
 *   alive for the next reconcile**
 * @param {() => number} [loop.at]
 * @returns {Promise<Readonly<object>>} what the run report says about execution
 */
/** How often a lane wait checks the durable abandon request (§10.5). */
const ABANDON_POLL_MS = 25;

export async function schedule({
	capacity,
	frontier,
	resourceClassOf,
	execute,
	claiming = () => true,
	abandoning = () => false,
	at = Date.now,
}) {
	/** @type {Map<number, { promise: Promise<object>, slots: object }>} the lanes actually running */
	const lanes = new Map();
	const settled = [];
	const refused = [];
	const released = [];
	/**
	 * The frontier as of the last scheduling decision this loop made. §3.5's drain
	 * report is a statement about *that* instant, and re-reading the tracker after
	 * the loop to build it would report a different one.
	 *
	 * It is deliberately **not** "the frontier at the moment nothing was
	 * claimable": the loop also stops with work still on it — a stop or abandon
	 * request at the `while` head, and capacity exhausted with no lane left to wait
	 * on. Whether the scope is drained is `drain.mjs`'s to decide from this answer,
	 * and it decides differently in those cases.
	 *
	 * `null` when no decision was ever made, which is the truthful answer for a run
	 * stopped before it looked — and the one `drain.mjs` refuses to read as drained.
	 */
	let frontierAtDecision = null;

	/**
	 * Wait for **a** ticket execution to terminate — §9.6's `otherwise` — while
	 * still honoring an abandon that arrives after the wait began. A stop drains
	 * and therefore keeps waiting; abandon is the only request that wakes this
	 * boundary without a lane result.
	 */
	async function awaitOne() {
		for (;;) {
			const lane = await Promise.race([
				...[...lanes.values()].map((live) => live.promise),
				delay(ABANDON_POLL_MS).then(() => null),
			]);
			if (lane === null) {
				if (abandoning()) return false;
				continue;
			}
			lanes.delete(lane.ticket);
			settled.push(lane);
			return true;
		}
	}

	/**
	 * §9.6's abandon. The lanes are **not** awaited: the point of abandoning is
	 * that the run stops waiting. Their slots go back here rather than in the
	 * lane's own `finally`, because that `finally` runs whenever the worker
	 * eventually answers — which for an abandoned lane may be never, and a slot
	 * nothing will ever free is the double-booking §9.4 exists to prevent. Their
	 * panes are left exactly as they are: a wedged pane is evidence (§13.B,
	 * §14.27).
	 */
	function abandon() {
		for (const [ticket, lane] of lanes) {
			lane.promise.catch(() => {});
			lane.slots.model.release({ reason: "abandoned", at: at() });
			lane.slots.ticket.release({ reason: "abandoned", at: at() });
			released.push(Object.freeze({ ticket, disposition: "released", abandoned: true }));
		}
		lanes.clear();
	}

	while (claiming() && !abandoning()) {
		// Re-read, every time. §3.1: membership is recomputed at every scheduling
		// decision, and direct-ticket sets are pinned by definition but their
		// states are still read live.
		const view = await frontier();
		frontierAtDecision = view;
		// A signal may land while the live frontier read is in flight. Re-check
		// before either claiming another ticket or waiting on a lane: abandon is a
		// request to stop waiting, and the boundary settlement records `released`.
		if (abandoning()) break;
		const candidate = nextClaimable(view, {
			running: lanes.keys(),
			// §2.1: a run has **one** ticket execution per ticket, so a ticket this
			// run already executed is not a candidate again — whatever the tracker
			// still says about it. §8.9's dispositions are what remove it from the
			// frontier, and this is the identity rule that holds while they land.
			executed: [...settled, ...released].map((lane) => lane.ticket),
			refused: refused.map((entry) => entry.ticket),
		});

		if (candidate === null) {
			// Nothing claimable now. With lanes running, one terminating may change
			// that; with none, the scope is drained as far as this loop can take it.
			if (lanes.size === 0) break;
			await awaitOne();
			continue;
		}

		let resourceClass;
		try {
			resourceClass = resourceClassOf(candidate);
		} catch (error) {
			if (!(error instanceof FactoryCapacityError)) throw error;
			// §11.5's ticket-scoped conflict, raised **before any work**: the ticket
			// is not claimed, and it is remembered as refused so the loop does not
			// meet it again on the next poll and spin.
			refused.push(
				Object.freeze({ ticket: candidate.ticket, reason: error.reason, message: error.message, ...error.details }),
			);
			continue;
		}

		// §9.4, §14.21: the ticket slot and the implement attempt's model slot,
		// **together, before the claim**. A null answer is the backpressure.
		const slots = capacity.acquireLane({ ticket: candidate.ticket, resourceClass, at: at() });
		if (slots === null) {
			if (lanes.size === 0) break;
			await awaitOne();
			continue;
		}

		lanes.set(candidate.ticket, { slots, promise: runLane({ member: candidate, slots, execute, capacity, at }) });
	}

	if (abandoning()) abandon();
	while (lanes.size > 0) {
		if (abandoning()) {
			abandon();
			break;
		}
		await awaitOne();
	}

	// §14.6 is absolute and outranks a lane's own outcome: a controller that lost
	// its lease stops, emits, and exits — it does not report a run it no longer
	// owns as having executed.
	const lost = settled.find((lane) => lane.error?.reason === "lease-lost");
	if (lost !== undefined) throw lost.error;

	const lanesRun = [...settled, ...released].sort((left, right) => left.ticket - right.ticket);

	return Object.freeze({
		/**
		 * Lanes this loop **ran** — not tickets claimed. The distinction is not
		 * pedantry: whether a ticket was claimed is decided inside `execute`, where
		 * §3.3 can find a human's assignee or a lower claim-comment id and decline,
		 * and a loop that counted those as claims would report work it did not do
		 * (§9.7). §3.5's report derives the claim count from what the lanes answered.
		 */
		lanes_run: settled.length + released.length,
		lanes: Object.freeze(lanesRun),
		refused: Object.freeze(refused),
		released: released.length,
		/** Slots a previous controller left held; §9.4 settles them by probe. */
		blocked: capacity.blocked(),
		/** §3.5's drain report is built from this, not from a fresh read. */
		frontier: frontierAtDecision,
	});
}

/**
 * The lowest-numbered claimable ticket this run has not already taken. §3.2's
 * order is the frontier's own, so this is a scan rather than a sort: re-ordering
 * it here would be the priority mechanism §9.6 refuses.
 */
function nextClaimable(view, { running, executed, refused }) {
	const skip = new Set([...running, ...executed, ...refused]);
	const ticket = view.claimable.find((candidate) => !skip.has(candidate));
	if (ticket === undefined) return null;

	return view.members?.find((member) => member.ticket === ticket) ?? { ticket, labels: [] };
}

/**
 * One ticket execution, from the slots it was given to its terminal
 * disposition.
 *
 * The `finally` is what makes §9.4's "releasing exactly once at terminal
 * disposition" hold however the execution ended. The releases are idempotent, so
 * an execution that already gave back its own attempt's model slot — which every
 * real one does, since the slot is per attempt — is not double-released here;
 * what this catches is the execution that ended without giving anything back,
 * which would otherwise leave a row held for a lane that no longer exists.
 */
function runLane({ member, slots, execute, capacity, at }) {
	return (async () => {
		try {
			const outcome = await execute({ ticket: member.ticket, member, slots, capacity });
			return Object.freeze({ ticket: member.ticket, disposition: outcome?.disposition ?? null, outcome });
		} catch (error) {
			return Object.freeze({
				ticket: member.ticket,
				disposition: null,
				error:
					error instanceof FactoryStateError || error instanceof FactoryCapacityError
						? error
						: Object.assign(error, { reason: error.reason ?? null }),
			});
		} finally {
			slots.model.release({ reason: "attempt-ended", at: at() });
			slots.ticket.release({ reason: "terminal-disposition", at: at() });
		}
	})();
}
