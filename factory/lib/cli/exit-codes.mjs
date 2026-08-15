/**
 * Exit codes are published contract (§10.3), not configuration.
 *
 * `0` and `2`–`6` belong to the run end-reason table and are minted by the run
 * lifecycle, which this slice does not carry. What lives here is the pair that
 * exists *before* a run does — plus the marker for a verb whose subsystem has
 * not landed, which is deliberately outside the end-reason range so no caller
 * can read an unbuilt verb as a run outcome.
 */

/** A command that answered. */
export const EXIT_OK = 0;

/** Usage **and** config-load failure — §10.3 reserves 1 for these and nothing else. */
export const EXIT_USAGE = 1;

/** A verb whose implementation has not landed yet. Never an end reason. */
export const EXIT_NOT_IMPLEMENTED = 7;
