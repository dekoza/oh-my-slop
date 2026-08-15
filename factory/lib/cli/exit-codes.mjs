import { END_REASON_LEASE_LOST, RUN_END_REASONS } from "../domain/vocabulary.mjs";

/**
 * Exit codes are published contract (§10.3), not configuration.
 *
 * `0` and `2`–`6` belong to the run end-reason table below. What lives here
 * besides is the pair that exists *before* a run does — plus the two markers for
 * a verb that never reached a run at all, deliberately outside the end-reason
 * range so no caller can read one as a run outcome.
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
 * §10.3's table, as one value.
 *
 * It sits **beside the end-reason enum it maps** — the import below, and the
 * completeness check under it — because §10.3 co-locates the two for exactly one
 * reason: an end reason added without an exit-code decision, or an exit code
 * left behind by a renamed reason, is a published contract quietly diverging
 * from the vocabulary it publishes. Here that is an import-time failure instead.
 *
 * `controller-lost` maps to `null` rather than to a number: it is asserted only
 * by a *different* controller or by the monitor, never self-asserted, so the run
 * it describes is not the process exiting and there is no exit code to give
 * (§13.A, §14.36).
 *
 * Every reason is **spelled out** rather than reached through a constant. These
 * are the wire strings a downstream script matches on, so a published table is
 * worth reading straight off the page — and the completeness check below is what
 * makes that safe, because a renamed member cannot quietly leave a stale row
 * behind.
 */
export const END_REASON_EXIT_CODES = Object.freeze({
	drained: EXIT_OK,
	"baseline-red": 2,
	"stopped-by-operator": 3,
	abandoned: 4,
	"circuit-breaker": 5,
	"lease-lost": 6,
	"controller-lost": null,
});

// The co-location made mechanical. A member of §10.3's enum with no row, or a
// row naming something the enum does not, fails at import — long before an
// operator's script reads a code nobody decided.
for (const reason of RUN_END_REASONS) {
	if (!Object.hasOwn(END_REASON_EXIT_CODES, reason)) {
		throw new Error(`End reason "${reason}" has no exit code in §10.3's table.`);
	}
}
for (const reason of Object.keys(END_REASON_EXIT_CODES)) {
	if (!RUN_END_REASONS.includes(reason)) {
		throw new Error(`Exit-code table row "${reason}" is not one of §10.3's seven end reasons.`);
	}
}

/**
 * Controller outcome `lease-lost` (§10.3): the controller lost its lease and
 * exited without reacquiring. The stale process reports this code but does not
 * append an unfenced `run.ended` to a run its successor may own. Non-zero by
 * contract, and read from the published table rather than written twice.
 */
export const EXIT_LEASE_LOST = END_REASON_EXIT_CODES[END_REASON_LEASE_LOST];

/**
 * The code a run leaves with, given the reason it ended.
 *
 * @param {string} endReason one of §10.3's seven
 * @returns {number}
 * @throws {Error} for `controller-lost`, which has no exit code by construction
 */
export function exitCodeForEndReason(endReason) {
	const code = END_REASON_EXIT_CODES[endReason];
	if (code === undefined) throw new Error(`"${endReason}" is not one of §10.3's seven end reasons.`);
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
