import { BUDGET_KINDS } from "../domain/vocabulary.mjs";
import { runStream } from "../state/events.mjs";

/**
 * §8.6's run-level circuit breaker: **N consecutive automation failures stop new
 * claims**, and the run exits through §3.5's drain report.
 *
 * The failure mode it forecloses is a broken host burning tokens on a verdict it
 * has already reached. Five tickets each dying in preflight is that; five
 * tickets each needing a human is a productive run, which is why **product-level
 * outcomes never trip it** and why the classification is read off one field
 * rather than off a list of reason classes that grows.
 *
 * **"Consecutive" means consecutive in terminal-commit order** — the total,
 * durable order in which ticket executions commit their disposition, which is
 * the journal's own sequence (§14.37). Wall-clock interleaving would make the
 * verdict depend on scheduling accidents: two lanes finishing in one order and
 * being *recorded* in another would give two answers to the same question. At
 * capacity 1 the two orders coincide, and this degrades to exactly the serial
 * semantics §8.6 describes.
 */

/**
 * §8.6's N.
 *
 * **A code constant rather than a knob**, and deliberately: §11.3's block
 * inventory and §11.6's list of defaults are both closed, both locked, and
 * neither names a breaker key — while §14.33 makes an undeclared key a load
 * failure. Widening the config surface is not this slice's to do. It is also the
 * reversible direction: promoting this to a declared number later breaks no
 * config on disk, while retiring a knob breaks every file that set it.
 *
 * It lives here, once, for the same reason the ticket-concurrency ceiling lives
 * in `config/concurrency.mjs` and nowhere else: a policy with two homes has
 * already started to drift.
 */
export const CIRCUIT_BREAKER_THRESHOLD = 2;

/**
 * Whether this run has reached §8.6's threshold, and the longest run of
 * automation failures it got to.
 *
 * **The verdict is monotone**: it answers "has this run *ever* reached N in a
 * row", not "are the last N automation failures". The two agree at the moment a
 * breaker would trip, because a run polled at every scheduling decision meets
 * the trailing streak the instant it forms — and they disagree afterwards, which
 * is the whole point. §3.5 lets the lanes that were already running finish, and
 * one of them settling `published` must not erase the reason the run stopped
 * claiming. The scheduler's `claiming` predicate and the run's `end_reason` read
 * this one function, so they cannot come to different conclusions about why the
 * run ended.
 *
 * @param {object} store an open store, controller or read-only
 * @param {object} where
 * @param {string} where.run
 * @param {number} [where.threshold] §8.6's N
 * @returns {Readonly<{ tripped: boolean, consecutive: number, threshold: number, ticket: number | null }>}
 *   `consecutive` is the longest streak reached, and `ticket` the execution
 *   whose commit completed it — the one an operator opens first
 */
export function circuitBreaker(store, { run, threshold = CIRCUIT_BREAKER_THRESHOLD }) {
	let streak = 0;
	let longest = 0;
	let ticket = null;

	// `readEvents` orders by the journal's global sequence, which **is** §8.6's
	// terminal-commit order: one record per ticket execution's disposition, in
	// the durable order they committed (§4.2, §14.37).
	for (const record of store.readEvents({ stream: runStream(run), kind: "ticket.disposition-changed" })) {
		streak = automationFailure(record.payload) ? streak + 1 : 0;
		if (streak > longest) {
			longest = streak;
			if (streak >= threshold && ticket === null) ticket = record.ticket;
		}
	}

	return Object.freeze({ tripped: longest >= threshold, consecutive: longest, threshold, ticket });
}

/**
 * Whether one terminal commit is the automation's failure.
 *
 * **One field decides it**: the fault the disposition was settled under. A
 * `failed` execution whose fault is the automation is a broken host; one whose
 * fault is the product — a repair budget spent on a worker that could not make
 * the tests pass, a second rebase conflict — is a verdict about the work, and so
 * is every `paused`, `published` and `released`. `review-mutation` carries no
 * fault at all, which is right: a read-only role that wrote broke its own
 * contract, and that says nothing about the host.
 *
 * Reading the fault rather than matching a list of reason classes is what keeps
 * this from becoming a second opinion. A class added to §8.8 later would
 * otherwise be a silent vote on whether runs should stop, cast by whoever
 * happened to add it.
 */
function automationFailure(payload) {
	return payload?.disposition === "failed" && payload?.fault === BUDGET_KINDS.automation;
}
