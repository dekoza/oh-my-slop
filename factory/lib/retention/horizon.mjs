/**
 * §12.3's tier-1 horizon, and nothing else.
 *
 * > Horizon = the more generous of **last 20 runs** or **30 days**.
 *
 * "More generous" is a **union, not a choice**: a run inside either half is
 * tier 1. Reading it as a preference — take the count when there are many runs,
 * the age when there are few — would make the retained set depend on how busy
 * the repository happened to be, and the operator investigating last month's
 * failure would find it swept because twenty runs happened this week.
 *
 * The two numbers are §12.10's entire configuration surface. Everything else
 * about retention is a constant, deliberately unreachable from config (§14.32).
 */

/** Epoch milliseconds in a day. The horizon is stated in days; the journal counts millis. */
export const DAY_MS = 86_400_000;

/**
 * Which runs are inside the tier-1 horizon, and the two boundaries that decided
 * it.
 *
 * The input is **every run the permanent digest remembers** (§12.3), not the
 * runs whose detail still exists: "the last 20 runs" is a rank over the
 * repository's history, and ranking over the surviving set instead would let one
 * pinned old run push a newer one out of tier 1 — the pin protecting one run by
 * expiring another.
 *
 * The two halves read **different dates, on purpose**. The count half ranks by
 * `started_at`, because "the last 20 runs" is about the order runs happened in
 * and a run's start is when it entered that order. The day half ages a run from
 * **`ended_at ?? started_at`**, the last moment it produced detail, because a
 * run that started 31 days ago and ended yesterday is a day-old failure an
 * operator is still reading — dating it by its start would sweep it on the
 * morning after it finished. Using one field for both would get one of the two
 * questions wrong.
 *
 * @param {ReadonlyArray<{ run_id: string, started_at: number, ended_at: number | null }>} digests
 *   every run in the permanent tier-2 digest, in any order
 * @param {{ fullDetailRuns: number, fullDetailDays: number }} retention §12.10's two numbers
 * @param {{ at?: number }} [when]
 * @returns {Readonly<{ runs: number, days: number, cutoff_at: number,
 *                      count_boundary: string | null, members: ReadonlySet<string> }>}
 */
export function tierOneHorizon(digests, { fullDetailRuns, fullDetailDays }, { at = Date.now() } = {}) {
	// Newest first, by the projection's own recorded start and never by a clock
	// read here (§14.37). The run id breaks a tie, and it is a ULID — so the tie
	// is broken chronologically rather than arbitrarily.
	const ordered = [...digests].sort(
		(left, right) => right.started_at - left.started_at || (left.run_id < right.run_id ? 1 : -1),
	);

	const cutoffAt = at - fullDetailDays * DAY_MS;
	const byCount = ordered.slice(0, fullDetailRuns);
	const byAge = ordered.filter((digest) => lastDetailAt(digest) >= cutoffAt);

	return Object.freeze({
		runs: fullDetailRuns,
		days: fullDetailDays,
		cutoff_at: cutoffAt,
		// The oldest run the count alone keeps — the operator's answer to "why is
		// this one still here", when it is not the age that is holding it.
		count_boundary: byCount.at(-1)?.run_id ?? null,
		members: Object.freeze(new Set([...byCount, ...byAge].map((digest) => digest.run_id))),
	});
}

/**
 * When a run stopped producing tier-1 detail. An unended run has produced its
 * last detail *so far*, which is now — so it dates from its start and stays
 * inside every horizon it could be inside.
 */
function lastDetailAt(digest) {
	return digest.ended_at ?? digest.started_at;
}
