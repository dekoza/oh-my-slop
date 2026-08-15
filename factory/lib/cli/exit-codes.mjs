/**
 * Exit codes are published contract (§10.3), not configuration.
 *
 * `0` and `2`–`6` belong to the run end-reason table. Most are minted by the
 * run lifecycle, which is not built yet; `6` arrives with the lease that mints
 * it. What lives here besides is the pair that exists *before* a run does —
 * plus the marker for a verb whose subsystem has not landed, which is
 * deliberately outside the end-reason range so no caller can read an unbuilt
 * verb as a run outcome.
 */

/** A command that answered. */
export const EXIT_OK = 0;

/** Usage **and** config-load failure — §10.3 reserves 1 for these and nothing else. */
export const EXIT_USAGE = 1;

/**
 * End reason `lease-lost` (§10.3): the controller lost its lease and exited
 * without reacquiring. Non-zero by contract — `factory start && next-thing`
 * must never read it as success.
 */
export const EXIT_LEASE_LOST = 6;

/** A verb whose implementation has not landed yet. Never an end reason. */
export const EXIT_NOT_IMPLEMENTED = 7;
