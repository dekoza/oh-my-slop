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
 * The run end reasons other modules reach for by name. Preflight decides
 * `baseline-red`, the drain decides `drained`, and `controller-lost` is only
 * ever written *about* another controller. Naming them here keeps call sites
 * from spelling wire members by hand.
 */
export const END_REASON_DRAINED = "drained";
export const END_REASON_BASELINE_RED = "baseline-red";
export const END_REASON_STOPPED_BY_OPERATOR = "stopped-by-operator";
export const END_REASON_ABANDONED = "abandoned";
export const END_REASON_CONTROLLER_LOST = "controller-lost";

/**
 * §10.3's six run end reasons, mandatory on every ended run. `controller-lost`
 * is asserted only by a different controller or the monitor, never by the run
 * itself, and is therefore the one member with no exit code (§14.36).
 *
 * This is the whole enum a `run.ended` may draw from. The published exit-code
 * table has a seventh row — `CONTROLLER_EXIT_LEASE_LOST` below — and keeping
 * that row **out** of this list is the point: a collection named "end reasons"
 * that contained a value no run may end for is how the forbidden ending gets
 * reintroduced with every test still green. `exit-codes.mjs` checks the two
 * against its table at import, explicitly and disjointly.
 */
export const RUN_TERMINAL_REASONS = Object.freeze([
	END_REASON_DRAINED,
	END_REASON_BASELINE_RED,
	END_REASON_STOPPED_BY_OPERATOR,
	END_REASON_ABANDONED,
	"circuit-breaker",
	END_REASON_CONTROLLER_LOST,
]);

/**
 * The controller process's own exit outcome, and **not** a run's end reason.
 *
 * It sits in §10.3's published table because it names a real exit code — a
 * script running `factory start` can receive 6 — but no run *ends* for it: the
 * process that lost its lease has no ownership proof left, and a successor may
 * already be driving the same `run_id`, so the terminal event is not its to
 * write. The run projector refuses it on a `run.ended`; the run the stale
 * process leaves behind stays open (§14.6).
 */
export const CONTROLLER_EXIT_LEASE_LOST = "lease-lost";

/** §8.8. */
export const TICKET_DISPOSITIONS = Object.freeze(["published", "paused", "failed", "released"]);

/**
 * §6.6's closed worker-writable statuses, named so a role's result
 * expectations and the outbox validator read one list. Everything else in
 * `ATTEMPT_OUTCOMES` is controller-derived and never worker-writable.
 */
export const WORKER_WRITABLE_OUTCOMES = Object.freeze(["completed", "needs-human", "worker-failed"]);

/** §8.8 — the worker-writable three, then the controller-derived rest. */
export const ATTEMPT_OUTCOMES = Object.freeze([
	...WORKER_WRITABLE_OUTCOMES,
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
