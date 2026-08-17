import { CONTROLLER_EXIT_LEASE_LOST, RUN_TERMINAL_REASONS } from "../domain/vocabulary.mjs";

/**
 * Exit codes are published contract (§10.3), not configuration.
 *
 * `0` and `2`–`6` and `9` belong to the run end-reason table below; `9` is
 * #154's `capacity-exhausted`, and it sits after `7` and `8` because those
 * two are verb-level markers that exist before any run does, deliberately
 * outside the end-reason range. What lives here besides is the pair that
 * exists *before* a run does — plus the two markers for a verb that never
 * reached a run at all, deliberately outside the end-reason range so no
 * caller can read one as a run outcome.
 *
 * **There is no knob for any of this.** Callers' error handling depends on the
 * table, so a config key would let a config file silently break every downstream
 * script: `factory start && next-thing` must never read a circuit-breaker exit
 * as success.
 */

/** A command that answered. */
export const EXIT_OK = 0;

/** Usage **and** config-load failure — §10.3 reserves 1 for these and nothing else. */
export const EXIT_USAGE = 1;

/**
 * §10.3's table, as one value: the seven run end reasons **plus the one
 * controller exit outcome**, `lease-lost` — a code a `factory start` caller can
 * really receive, from a process whose run it does not end.
 *
 * It sits **beside the vocabulary it maps** — the import above, and the
 * completeness checks under it — because §10.3 co-locates the two for exactly
 * one reason: a reason added without an exit-code decision, or an exit code
 * left behind by a renamed reason, is a published contract quietly diverging
 * from the vocabulary it publishes. Here that is an import-time failure instead.
 *
 * `controller-lost` maps to `null` rather than to a number: it is asserted only
 * by a *different* controller or by the monitor, never self-asserted, so the run
 * it describes is not the process exiting and there is no exit code to give
 * (§13.A, §14.36).
 *
 * Every member is **spelled out** rather than reached through a constant. These
 * are the wire strings a downstream script matches on, so a published table is
 * worth reading straight off the page — and the checks below are what make that
 * safe, because a renamed member cannot quietly leave a stale row behind.
 */
export const OUTCOME_EXIT_CODES = Object.freeze({
	drained: EXIT_OK,
	"baseline-red": 2,
	"stopped-by-operator": 3,
	abandoned: 4,
	"circuit-breaker": 5,
	"lease-lost": 6,
	/**
	 * #154: every routable class locked by §9's exhaustion memo — the run
	 * stopped claiming because nothing can be spent, not because the scope
	 * drained. Non-zero so `factory start && next-thing` cannot read it as a
	 * finished scope; 7 and 8 are the verb-level markers below.
	 */
	"capacity-exhausted": 9,
	"controller-lost": null,
});

// The co-location made mechanical, member by member rather than through a
// union collection that would blur the two domains back together: every run
// end reason has a row, the controller exit outcome has a row, no row belongs
// to neither, and the outcome is not quietly also an end reason.
for (const reason of RUN_TERMINAL_REASONS) {
	if (!Object.hasOwn(OUTCOME_EXIT_CODES, reason)) {
		throw new Error(`End reason "${reason}" has no exit code in §10.3's table.`);
	}
}
if (!Object.hasOwn(OUTCOME_EXIT_CODES, CONTROLLER_EXIT_LEASE_LOST)) {
	throw new Error(`Controller exit outcome "${CONTROLLER_EXIT_LEASE_LOST}" has no exit code in §10.3's table.`);
}
for (const outcome of Object.keys(OUTCOME_EXIT_CODES)) {
	if (!RUN_TERMINAL_REASONS.includes(outcome) && outcome !== CONTROLLER_EXIT_LEASE_LOST) {
		throw new Error(
			`Exit-code table row "${outcome}" is neither one of §10.3's seven run end reasons ` +
				"nor the controller exit outcome.",
		);
	}
}
if (RUN_TERMINAL_REASONS.includes(CONTROLLER_EXIT_LEASE_LOST)) {
	throw new Error(
		`"${CONTROLLER_EXIT_LEASE_LOST}" names a controller process's exit and must not be a run end reason (§14.6).`,
	);
}

/**
 * Controller exit outcome `lease-lost` (§10.3): the controller lost its lease
 * and exited without reacquiring. The stale process reports this code but does
 * not append an unfenced `run.ended` to a run its successor may own. Non-zero
 * by contract, and read from the published table rather than written twice.
 */
export const EXIT_LEASE_LOST = OUTCOME_EXIT_CODES[CONTROLLER_EXIT_LEASE_LOST];

/**
 * The code a run leaves with, given the reason it ended.
 *
 * @param {string} endReason one of §10.3's seven run end reasons
 * @returns {number}
 * @throws {Error} for `controller-lost`, which has no exit code by construction,
 *   and for `lease-lost`, which is a controller exit outcome rather than a
 *   reason any run ends — its code is `EXIT_LEASE_LOST`, never a run's
 */
export function exitCodeForEndReason(endReason) {
	if (endReason === CONTROLLER_EXIT_LEASE_LOST) {
		throw new Error(
			`"${endReason}" is the controller process's exit outcome, not a reason a run ends (§14.6); ` +
				"the run it leaves behind is open and has no code to read off this table.",
		);
	}
	const code = OUTCOME_EXIT_CODES[endReason];
	if (code === undefined) throw new Error(`"${endReason}" is not one of §10.3's seven run end reasons.`);
	if (code === null) {
		throw new Error(
			`"${endReason}" is never self-asserted, so no process ever exits with it (§14.36); ` +
				"it is written about a controller by a different one.",
		);
	}
	return code;
}

/** A verb whose implementation has not landed yet. Never an end reason. */
export const EXIT_NOT_IMPLEMENTED = 7;

/**
 * A verb that refused because the state it would have acted on belongs to
 * somebody else — §10.5's `reconcile` against a live lease-holder, and §10.4's
 * `start` against a live run whose scope does not contain the one asked for.
 *
 * It is outside the end-reason range deliberately: no run started, so no run
 * ended, and a caller must not read this as a run outcome. §10.4 and §10.5
 * require only "non-zero"; the specific code is published here beside the rest
 * so the whole table is readable in one place.
 */
export const EXIT_REFUSED = 8;
