import { BUDGET_KINDS } from "../domain/vocabulary.mjs";
import { EVENT_KINDS, runStream } from "../state/events.mjs";

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
 * @returns {Readonly<{ tripped: boolean, consecutive: number, threshold: number,
 *   ticket: number | null, unclassifiable: number }>} `consecutive` is the
 *   longest streak reached, `ticket` the execution whose commit completed it —
 *   the one an operator opens first — and `unclassifiable` the terminal commits
 *   written before the fault was recorded, which this cannot read
 */
export function circuitBreaker(store, { run, threshold = CIRCUIT_BREAKER_THRESHOLD }) {
	let streak = 0;
	let longest = 0;
	let ticket = null;
	let unclassifiable = 0;

	// `readEvents` orders by the journal's global sequence, which **is** §8.6's
	// terminal-commit order: one record per ticket execution's disposition, in
	// the durable order they committed (§4.2, §14.37).
	for (const record of store.readEvents({ stream: runStream(run), kind: "ticket.disposition-changed" })) {
		if (isPreFaultEra(record)) {
			// A record from before the fault was written down says nothing about
			// whose failure it was, so it breaks the streak rather than joining it —
			// and it is **counted**, because a verdict derived partly from records it
			// could not read is not a verdict anyone should read as complete (§4.4).
			unclassifiable += 1;
			streak = 0;
			continue;
		}

		streak = automationFailure(record.payload) ? streak + 1 : 0;
		if (streak > longest) {
			longest = streak;
			if (streak >= threshold && ticket === null) ticket = record.ticket;
		}
	}

	return Object.freeze({ tripped: longest >= threshold, consecutive: longest, threshold, ticket, unclassifiable });
}

/**
 * Is this record from before the disposition payload carried a fault?
 *
 * v1 `ticket.disposition-changed` recorded the disposition alone, which was the
 * whole contract its version names — so a replay that refused it would classify
 * compatibility as corruption. What it cannot do is answer §8.6's question:
 * reading its missing fault as "not the automation's" would count a broken
 * host's failure as a product verdict, silently, which is exactly the wrong
 * answer per-kind versioning exists to make visible. The branch is what makes it
 * visible rather than the bump alone.
 *
 * The live write path cannot produce one — `buildEnvelope` stamps every kind
 * with the version this binary declares — which is what keeps this history-only.
 */
function isPreFaultEra(record) {
	return record.payload_version < EVENT_KINDS["ticket.disposition-changed"].payloadVersion;
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
