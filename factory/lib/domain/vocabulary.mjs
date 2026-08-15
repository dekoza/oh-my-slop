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

/**
 * §10.3's four, in the order a run passes through them. `preflight` is first
 * because preflight runs **after the run exists** — that is what lets
 * `baseline-red` be a run end reason naming a specific red check.
 */
export const RUN_LIFECYCLE = Object.freeze({
	preflight: "preflight",
	running: "running",
	draining: "draining",
	ended: "ended",
});

export const RUN_LIFECYCLES = Object.freeze(Object.values(RUN_LIFECYCLE));

/**
 * The run and controller outcomes other modules reach for by name. Preflight
 * decides `baseline-red`, the drain decides `drained`, and `controller-lost` is
 * only ever written *about* another controller. `lease-lost` names the stale
 * controller's exit report and remains in §10.3's published end-reason
 * vocabulary, but the stale process cannot mint `run.ended` after losing its
 * ownership proof. Naming them here keeps call sites from spelling wire members
 * by hand.
 */
export const END_REASON_DRAINED = "drained";
export const END_REASON_BASELINE_RED = "baseline-red";
export const END_REASON_LEASE_LOST = "lease-lost";
export const END_REASON_CONTROLLER_LOST = "controller-lost";

/**
 * §10.3's seven, mandatory on every ended run. `controller-lost` is asserted
 * only by a different controller or the monitor, never by the run itself, and
 * is therefore the one member with no exit code (§14.36).
 */
export const RUN_END_REASONS = Object.freeze([
	END_REASON_DRAINED,
	END_REASON_BASELINE_RED,
	"stopped-by-operator",
	"abandoned",
	"circuit-breaker",
	END_REASON_LEASE_LOST,
	END_REASON_CONTROLLER_LOST,
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

/**
 * §4.6's repo-scoped exclusive lease. Named here rather than in the lease
 * primitive because it is read from two sides: the holder renews it, and an
 * effect resolution compares its generation against the holder's (§14.5). The
 * other lease objects — `integration`, `capacity:*` — are the lease module's.
 */
export const CONTROLLER_LEASE = "controller";

/** §2.1: every identity-derived path segment is checked against this charset. */
export const IDENTITY_CHARSET = /^[0-9A-Za-z-]+$/;
