import { CONTROLLER_STREAM } from "../state/events.mjs";

/**
 * #154: **a provider that refuses for quota reasons is a time-boxed
 * unavailability of its resource class, remembered durably.**
 *
 * Before this existed, a provider at its daily cap made the worker start, get
 * refused, and write no outbox — and §6.6's wait then recorded `timeout` or
 * `no-result`, charging the **worker's** budget for the **provider's** refusal
 * and ending with a `factory:failed` label a human had to clear. And the next
 * ticket routed to the same class rediscovered the same refusal, spending a
 * launch and a whole attempt window each time.
 *
 * The memo is §9's capacity model extended with a mid-run, time-boxed state —
 * a class that exists, is reachable, and cannot be spent yet. It is **not** a
 * routing preference: an observed fact belongs in the journal, never in the
 * config file. Two events, both on the `controller` stream with no run in the
 * envelope, because the cap belongs to the provider and outlives any one run:
 *
 * - `capacity.exhausted` — the class is unavailable until `until`, with the
 *   observation that established it in the payload;
 * - `capacity.admitted` — a probe re-admitted the class after an expiry.
 *
 * The latest record per class decides. **An expiry that has passed re-admits
 * nothing by itself** (§5.2): it moves the class to `probe-due`, and only a
 * probe's admission record opens it. Re-admitting on the clock would be an
 * assumption written down as a fact.
 */

/**
 * How long a recorded refusal holds, when the refusal itself names no window.
 *
 * One hour. Daily caps last hours, and every renewal of the memo is an
 * *observed* refusal, so the memo is never staler than its newest evidence;
 * the constant only sets how often an expired memo is re-probed. An hour buys
 * at most one cheap probe per hour per exhausted class while refusing both
 * directions of the error: a much longer window would keep a class locked long
 * after its cap rolled, and a much shorter one would rediscover the refusal —
 * the exact launch this memo exists to prevent — every few minutes.
 */
export const DEFAULT_EXHAUSTION_MEMO_MS = 3_600_000;

/**
 * A probe that could not answer holds the class for a shorter window. It
 * established no refusal, so the full memo would lock a class on nothing
 * observed — but §5.2's re-admission needs a probe that *did* answer, so
 * opening it on the inconclusive read would be the assumption this module
 * exists to refuse. The shorter window is the middle reading: ask again soon.
 */
export const INCONCLUSIVE_EXHAUSTION_MEMO_MS = 300_000;

/**
 * The refusal vocabulary, as the harnesses themselves classify it. The
 * signature set is pi-ai's own **non-retryable provider limit** patterns —
 * `insufficient_quota`, `quota exceeded`, usage-limit and available-balance
 * wording — plus the rate-limit shapes, read off the installed runtime rather
 * than invented. Transient faults are deliberately absent: a 502 pi retries
 * itself is not a fact about the class, and matching it would lock a healthy
 * provider on a network blip.
 *
 * Each signature is a name plus a case-insensitive pattern, so the recorded
 * evidence says *which* wording decided, not merely that something did.
 *
 * **The words are letter-bounded, not substrings.** The pane tail is prose as
 * often as it is an error: file contents the worker is writing, the ticket
 * body, its own commentary. A bare `/quota/` read "quotations" in a README as
 * the provider's refusal and stopped a working worker (run
 * 01M0ZD1G52EC2CD946Y3B1AFQ8); `\b` alone would not do, because
 * `insufficient_quota` and `rate_limit_error` — the wordings that *are*
 * refusals — join the word to its neighbour with an underscore, which is a
 * word character. So the boundary is "no letter on either side", and the
 * `limit` family additionally admits `limited` and `limits` — the harness
 * says "rate limited" — while "rate-limiting middleware" stays prose.
 */
const LETTER_BOUNDED = (source) => new RegExp(`(?<![a-z])${source}(?![a-z])`, "i");

export const REFUSAL_SIGNATURES = Object.freeze([
	Object.freeze({ name: "quota", pattern: LETTER_BOUNDED("quota") }),
	Object.freeze({ name: "rate-limit", pattern: LETTER_BOUNDED("rate.?limit(?:ed|s)?") }),
	Object.freeze({ name: "too-many-requests", pattern: LETTER_BOUNDED("too many requests") }),
	Object.freeze({ name: "daily-limit", pattern: LETTER_BOUNDED("daily.?limit(?:ed|s)?") }),
	Object.freeze({ name: "usage-limit", pattern: LETTER_BOUNDED("usage.?limit(?:ed|s)?") }),
	Object.freeze({ name: "available-balance", pattern: LETTER_BOUNDED("available balance") }),
	Object.freeze({ name: "out-of-budget", pattern: LETTER_BOUNDED("out of budget") }),
]);

/**
 * How many final lines of a pane read a refusal may be matched in.
 *
 * The pane is read tail-first (`pane read --lines`), so the worker's final
 * state is at the end of the text — and a ticket body that happens to say
 * "rate limit" sits at the top. Matching the whole read would let the prompt
 * decide the outcome of an hour of work; matching only the tail makes the
 * signature a fact about how the worker *ended*.
 */
export const REFUSAL_TAIL_LINES = 60;

/**
 * The provider refusal visible in a pane's output, or null when there is none.
 *
 * @param {string} text the sampled pane output (already the trailing read)
 * @returns {Readonly<{ signatures: ReadonlyArray<string>, excerpt: string }> | null}
 */
export function matchRefusal(text) {
	if (typeof text !== "string" || text === "") return null;

	const lines = text.split("\n");
	const tail = lines.slice(-REFUSAL_TAIL_LINES);

	for (const line of [...tail].reverse()) {
		const signatures = REFUSAL_SIGNATURES.filter((signature) => signature.pattern.test(line)).map(
			(signature) => signature.name,
		);
		if (signatures.length === 0) continue;

		return Object.freeze({
			signatures: Object.freeze(signatures),
			excerpt: line.trim().slice(0, 200),
		});
	}

	return null;
}

/**
 * Record the observed refusal as §9's memo: the class is unavailable until
 * `until`, and the observation that established it rides the payload.
 *
 * The event rides the `controller` stream with no run in the envelope — the
 * memo is consulted by later runs, so it cannot live on the stream of the one
 * that paid for it (§12.2 would delete it with the run). The run, ticket, and
 * attempt it came from are evidence, carried in the payload.
 *
 * @param {object} hold the controller's hold — a memo is a controller
 *   assertion, so a stale holder writes none
 * @param {{ class: string, until: number, at: number, evidence?: object }} memo
 */
export function recordExhaustion(hold, { class: className, until, at, evidence = {} }) {
	hold.append({
		kind: "capacity.exhausted",
		source: "controller",
		occurredAt: at,
		observedAt: at,
		payload: {
			class: className,
			until,
			// The observation the memo is derived from — §5.2: the journal never
			// establishes an external fact, so the external half (the refusal the
			// pane printed) travels as evidence, named by its source.
			evidence: Object.freeze({ source: "herdr", ...evidence }),
		},
	});
}

/**
 * Record a probe's re-admission of an exhausted class (§5.2). The admission is
 * the only thing that opens a class whose expiry passed — the clock moves it
 * to `probe-due` and nothing more.
 *
 * @param {object} hold the controller's hold
 * @param {{ class: string, at: number, evidence?: object }} admission
 */
export function recordAdmission(hold, { class: className, at, evidence = {} }) {
	hold.append({
		kind: "capacity.admitted",
		source: "controller",
		occurredAt: at,
		observedAt: at,
		payload: {
			class: className,
			evidence: Object.freeze({ ...evidence }),
		},
	});
}

/** The memo states a class can be in, as §9's saturation surface reports them. */
export const EXHAUSTION_STATES = Object.freeze({
	available: "available",
	exhausted: "exhausted",
	probeDue: "probe-due",
});

/**
 * The memo ledger: the latest memo record per class, resolved at `at`.
 *
 * One derivation, read off the journal — the same shape as §8.6's budgets and
 * §9.7's waiting lanes: there is no counter and no second tally to keep in
 * step. A class nothing ever refused is simply absent, which is `available`
 * by construction.
 *
 * @param {object} store an open store, controller or read-only
 * @param {{ at?: number }} [options]
 * @returns {ReadonlyArray<Readonly<object>>} one entry per class with a memo,
 *   in class order
 */
export function exhaustionLedger(store, { at = Date.now() } = {}) {
	const records = [
		...store.readEvents({ stream: CONTROLLER_STREAM, kind: "capacity.exhausted" }),
		...store.readEvents({ stream: CONTROLLER_STREAM, kind: "capacity.admitted" }),
	].sort((left, right) => left.seq - right.seq);

	/** @type {Map<string, object>} */
	const latest = new Map();
	for (const record of records) {
		latest.set(record.payload.class, record);
	}

	return Object.freeze(
		[...latest.entries()]
			.map(([className, record]) => {
				const exhausted = record.kind === "capacity.exhausted";
				return Object.freeze({
					class: className,
					status: !exhausted
						? EXHAUSTION_STATES.available
						: record.payload.until > at
							? EXHAUSTION_STATES.exhausted
							: EXHAUSTION_STATES.probeDue,
					since: record.occurred_at,
					until: exhausted ? record.payload.until : null,
					evidence: record.payload.evidence ?? null,
				});
			})
			.sort((left, right) => left.class.localeCompare(right.class)),
	);
}

/**
 * One class's availability from a resolved ledger.
 *
 * @param {ReadonlyArray<object>} ledger `exhaustionLedger`'s answer
 * @param {string} className
 * @returns {"available" | "exhausted" | "probe-due"}
 */
export function classAvailability(ledger, className) {
	return ledger.find((entry) => entry.class === className)?.status ?? EXHAUSTION_STATES.available;
}
