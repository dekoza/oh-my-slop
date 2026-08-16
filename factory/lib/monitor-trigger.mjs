/**
 * §10.6's monitor coupling, as the one published contract both extensions
 * read from.
 *
 * The dependency is one-way: the `/factory` extension publishes the typed
 * request on the shared event bus, `factory-monitor` (when present)
 * subscribes and answers. The factory never imports the monitor and never
 * spawns it — the bus is the whole coupling, and it is never fatal: an
 * unanswered request costs the start one bounded wait and one missing line.
 *
 * A run launched from the shell publishes nothing, because a shell has no
 * bus; §10.2's "a run launched from the shell does not host a monitor" is a
 * property of this surface's absence there.
 */

/**
 * The typed request: "a start produced a run in this repository". Published
 * by the `/factory` front **after** the start answered, carrying the run's
 * report — the facts as the operator sees them, never a prediction.
 *
 * Request payload: `{ repo: string, argv: string[], at: number, report: object }`
 */
export const FACTORY_RUN_START = "factory:run-start";

/**
 * The monitor's answer to a request on `FACTORY_RUN_START`.
 *
 * Response payload: `{ url: string }` — the operator's entry point to the
 * monitor's view of the run.
 */
export const FACTORY_RUN_START_RESPONSE = "factory:run-start:response";

/**
 * How long the start output waits for an answer before printing without the
 * monitor line. The bus is in-process and a present monitor answers from
 * memory, so this bounds only a monitor that is too slow to count as
 * listening — and a session with no monitor at all.
 */
export const MONITOR_RESPONSE_DEADLINE_MS = 200;
