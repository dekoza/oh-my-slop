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
 * @param {(member: object, options: { at: number }) => Promise<object>} loop.dispatch
 *   §11.5's dispatch for this ticket's implement attempt, read under §9.8's memo
 *   (`capacity/plan.mjs`, `worker/dispatch.mjs`): which profile it would run on
 *   and which class that draws from, having stepped past every candidate the
 *   memo has locked. `profile: null` is "this ticket has no routable profile
 *   right now", which is what the loop walks past and the run reports
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

/**
 * A ticket the tracker calls claimable and this run cannot spend, as §3.5's
 * report and §10.3's end reason read it.
 *
 * It names the **declared** class first, because that is the one an operator
 * looking at the routing expects to be running, and then every class the reroute
 * tried — which under #155 is what "exhausted" actually means. Reporting only
 * the first would say a class is out while the run had in fact run out of
 * classes, and the two need different things doing about them.
 */
function blockedMember(ticket, route) {
	const blocked = route.considered.filter((seen) => seen.state === "blocked");

	return Object.freeze({
		ticket,
		class: blocked[0]?.class ?? null,
		until: blocked[0]?.until ?? null,
		classes: Object.freeze([...new Set(blocked.map((seen) => seen.class))]),
		considered: route.considered,
	});
}

export async function schedule({
	capacity,
	frontier,
	dispatch,
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
	 * The tickets a memo blocked at the loop's last scheduling decision (#154),
	 * and the class that blocked each. Claimable on the tracker and unspendable
	 * by this run — the pair the end reason and the drain report are built from,
	 * so a run stopped by an exhausted class says so plainly instead of draining
	 * as though the work were done.
	 */
	let exhaustedAtDecision = [];
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

		/**
		 * Tickets this pass could not spend because their class is memo-blocked
		 * (#154). Per-pass rather than permanent: a memo expires and a probe
		 * re-admits, so a blocked ticket is merely unclaimable *now* — nothing
		 * like §11.5's routing refusal, which the run remembers for good.
		 */
		const memoBlocked = new Map();
		// §2.1: a run has **one** ticket execution per ticket, so a ticket this
		// run already executed is not a candidate again — whatever the tracker
		// still says about it. §8.9's dispositions are what remove it from the
		// frontier, and this is the identity rule that holds while they land.
		const claimNext = () =>
			nextClaimable(view, {
				running: lanes.keys(),
				executed: [...settled, ...released].map((lane) => lane.ticket),
				refused: refused.map((entry) => entry.ticket),
				blocked: memoBlocked.keys(),
			});
		let candidate = claimNext();

		// Walk past candidates the memo leaves no route for, lowest number first,
		// without re-reading the frontier per step: one view, one pass.
		let route = null;
		while (candidate !== null) {
			try {
				// #154's gate and #155's reroute in one answer: the seam settles the
				// memo for every profile this ticket's implement role can reach, in
				// the declared order, and comes back with the first one this run may
				// spend. An expiry is settled by probe in there, before any claim,
				// which is how a class is re-admitted by probe and never by
				// assumption (§5.2).
				route = await dispatch(candidate, { at: at() });
			} catch (error) {
				if (!(error instanceof FactoryCapacityError)) throw error;
				// §11.5's ticket-scoped conflict, raised **before any work**: the ticket
				// is not claimed, and it is remembered as refused so the loop does not
				// meet it again on the next poll and spin.
				refused.push(
					Object.freeze({ ticket: candidate.ticket, reason: error.reason, message: error.message, ...error.details }),
				);
				candidate = claimNext();
				continue;
			}

			// #155: no route left is what blocks a ticket now, and it is a stronger
			// statement than #154's single blocked class — every profile the role
			// can reach was tried, and the seam's record says which and why.
			if (route.profile === null) {
				memoBlocked.set(candidate.ticket, blockedMember(candidate.ticket, route));
				candidate = claimNext();
				continue;
			}

			break;
		}

		if (candidate === null) {
			// Nothing claimable now. With lanes running, one terminating may change
			// that; with none, the scope is drained as far as this loop can take it.
			exhaustedAtDecision = [...memoBlocked.values()];
			if (lanes.size === 0) break;
			await awaitOne();
			continue;
		}

		// §8.6 and §10.5 both say *stop claiming*, and that is a statement about
		// the claim rather than about the iteration that led to it. The candidate
		// walk above awaits — the memo gate settles, and a probe may spend a whole
		// completion in there — so a lane can reach its terminal disposition while
		// it runs, and a breaker that tripped on that disposition must not be read
		// only at the head of a pass that started before it. Re-read here, where
		// the claim is, exactly as `abandoning()` is re-read after the frontier.
		if (!claiming() || abandoning()) break;

		// §9.4, §14.21: the ticket slot and the implement attempt's model slot,
		// **together, before the claim**. A null answer is the backpressure.
		//
		// The class is the **route's**, never the role's declared one: a rerouted
		// lane runs on a different provider and must take its slot from that
		// provider's pool, or the pool that arbitrates the GPU would be counting
		// a lane that never touches it (§9.1).
		const slots = capacity.acquireLane({ ticket: candidate.ticket, resourceClass: route.class, at: at() });
		if (slots === null) {
			exhaustedAtDecision = [...memoBlocked.values()];
			if (lanes.size === 0) break;
			await awaitOne();
			continue;
		}

		lanes.set(candidate.ticket, {
			slots,
			promise: runLane({ member: candidate, slots, route, execute, capacity, at }),
		});
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
		/**
		 * #154: the claimable tickets the exhaustion memo held at the loop's last
		 * decision — the fact a `capacity-exhausted` end reason and the drain
		 * report are made of. Empty when nothing was blocked.
		 */
		exhausted: Object.freeze(exhaustedAtDecision),
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
 *
 * `blocked` is #154's per-pass set: tickets a memo is holding. They are
 * skipped, never refused — the memo expires and a probe re-admits, so the same
 * ticket is claimable at a later decision.
 */
function nextClaimable(view, { running, executed, refused, blocked = [] }) {
	const skip = new Set([...running, ...executed, ...refused, ...blocked]);
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
function runLane({ member, slots, route, execute, capacity, at }) {
	return (async () => {
		try {
			// The route travels with the lane rather than being recomputed inside it:
			// the slot above was taken from *this* class, and a pipeline resolving
			// §11.5 again could reach a different answer — the memo moves, and the
			// second answer would be a lane running on a pool it never took.
			const outcome = await execute({ ticket: member.ticket, member, slots, route, capacity });
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
