import { FactoryConfigError } from "../config/errors.mjs";
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
 * **N is `budgets.circuitBreaker`, and it is required here with no default.**
 * The value has one home, §11.6's block, and a fallback in this module would be
 * a second — one that answers whenever a caller forgets to thread the config
 * through, which is exactly the call site where the operator's declared
 * tolerance has gone missing and the last thing that should happen quietly.
 *
 * @param {object} store an open store, controller or read-only
 * @param {object} where
 * @param {string} where.run
 * @param {number} where.threshold §8.6's N, from `config.budgets.circuitBreaker`
 * @returns {Readonly<{ tripped: boolean, consecutive: number, threshold: number,
 *   ticket: number | null, unclassifiable: number }>} `consecutive` is the
 *   longest streak reached, `ticket` the execution whose commit completed it —
 *   the one an operator opens first — and `unclassifiable` the terminal commits
 *   written before the fault was recorded, which this cannot read
 * @throws {FactoryConfigError} `invalid-value` — a threshold that is not a
 *   positive integer
 */
export function circuitBreaker(store, { run, threshold }) {
	if (!Number.isInteger(threshold) || threshold < 1) {
		throw new FactoryConfigError(
			"invalid-value",
			`§8.6's circuit breaker trips on N consecutive automation failures, and this caller passed ` +
				`${JSON.stringify(threshold ?? null)} for N. It is \`budgets.circuitBreaker\` (§11.6), which the loader ` +
				"validates — so a bad value here means the config never reached this call rather than that the operator " +
				"declared one.",
			{ at: "budgets.circuitBreaker", found: threshold ?? null },
		);
	}

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
