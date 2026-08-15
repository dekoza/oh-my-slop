/**
 * The closed vocabularies the factory's records are written in. They are code
 * constants rather than configuration for the same reason §3.2's labels are:
 * a per-install spelling turns an auditable state machine into a naming
 * preference, and every one of these words reaches the operator's screen and
 * the monitor's read contract unchanged.
 */

/**
 * §2.2. The last three are not pipeline phases — they exist because effect keys
 * and event envelopes carry a phase slot and a cleanup deletion or an expiry
 * stream drop is a mutation like any other (§13.C).
 */
export const PHASES = Object.freeze([
	"preflight",
	"implement",
	"harvest",
	"verify",
	"review",
	"integrate",
	"cleanup",
	"expiry",
]);

/** §10.3. */
export const RUN_LIFECYCLES = Object.freeze(["preflight", "running", "draining", "ended"]);

/**
 * The one end reason a subsystem other than the run loop mints: §4.6's lease
 * decides it, so it is named here for that code to reach rather than spelled by
 * hand where it is used.
 */
export const END_REASON_LEASE_LOST = "lease-lost";

/**
 * §10.3's seven, mandatory on every ended run. `controller-lost` is asserted
 * only by a different controller or the monitor, never by the run itself, and
 * is therefore the one member with no exit code.
 */
export const RUN_END_REASONS = Object.freeze([
	"drained",
	"baseline-red",
	"stopped-by-operator",
	"abandoned",
	"circuit-breaker",
	END_REASON_LEASE_LOST,
	"controller-lost",
]);

/** §8.8. */
export const TICKET_DISPOSITIONS = Object.freeze(["published", "paused", "failed", "released"]);

/** §8.8 — worker-writable first, then controller-derived. */
export const ATTEMPT_OUTCOMES = Object.freeze([
	"completed",
	"needs-human",
	"worker-failed",
	"invalid-result",
	"no-result",
	"dead-worker",
	"timeout",
	"wrote-but-hung",
	"cancelled",
	"automation-failure",
]);

/** §2.1: every identity-derived path segment is checked against this charset. */
export const IDENTITY_CHARSET = /^[0-9A-Za-z-]+$/;
