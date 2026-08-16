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
/**
 * The phase a ticket execution opens in, named because the claim's effects carry
 * it: §2.2's enum has no claim phase, deliberately — the claim is what *opens*
 * the first phase rather than a phase of its own, and widening the enum for it
 * would put a non-phase in the list §13.C widened exactly once.
 */
export const PHASE_IMPLEMENT = "implement";

export const PHASE_HARVEST = "harvest";
export const PHASE_VERIFY = "verify";
export const PHASE_REVIEW = "review";
export const PHASE_INTEGRATE = "integrate";

export const PHASES = Object.freeze([
	"preflight",
	PHASE_IMPLEMENT,
	PHASE_HARVEST,
	PHASE_VERIFY,
	PHASE_REVIEW,
	PHASE_INTEGRATE,
	"cleanup",
	"expiry",
]);

/**
 * §8.1's pipeline, in order: `implement → harvest → verify → review →
 * integrate`. It is the ordered subset of `PHASES`, and deliberately not
 * `PHASES` itself — the last three members of that enum exist because effect
 * keys carry a phase slot (§13.C), and a walk that included `cleanup` would be
 * reading the widening as a pipeline step.
 */
export const PIPELINE_PHASES = Object.freeze([
	PHASE_IMPLEMENT,
	PHASE_HARVEST,
	PHASE_VERIFY,
	PHASE_REVIEW,
	PHASE_INTEGRATE,
]);

/**
 * §8.1: **exactly two phases are agent-borne.** The other three are controller
 * phases with no model in them — putting a model between `pytest` and an exit
 * code adds a failure mode and buys nothing.
 *
 * Declared as the closed pair rather than as a flag on each phase so that
 * `CONTROLLER_PHASES` is its complement by construction: a sixth phase cannot
 * become agent-borne by omission, and a phase cannot be both.
 */
export const AGENT_BORNE_PHASES = Object.freeze([PHASE_IMPLEMENT, PHASE_REVIEW]);

/** §8.1's other three, as the complement — never a second hand-kept list. */
export const CONTROLLER_PHASES = Object.freeze(
	PIPELINE_PHASES.filter((phase) => !AGENT_BORNE_PHASES.includes(phase)),
);

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

/**
 * §8.9's one disposition whose tracker action is **dropping the claim** rather
 * than adding a label, named because two subsystems reach for it: the claim path
 * acts on it, and the abandon path records it.
 */
export const DISPOSITION_RELEASED = "released";

/** §8.8. */
export const TICKET_DISPOSITIONS = Object.freeze(["published", "paused", "failed", DISPOSITION_RELEASED]);

/**
 * §8.8's `verify` phase results, which are also what one mechanical check
 * answers (§8.2) — the phase result is the set's, and it is the strongest of
 * the checks' own.
 *
 * The split between the last two is §8.2's **fault attribution**, and it is the
 * whole reason this is three words rather than a boolean: a required check
 * exiting **inside its declared expected-failure codes** is the worker's failure
 * and routes to repair, while a timeout, a signal, or an exec that is not there
 * is `unrunnable` — an automation failure, never a worker failure. Both legacy
 * systems conflated them, and blamed a worker for a broken host.
 */
export const CHECK_RESULTS = Object.freeze({ passed: "passed", failed: "failed", unrunnable: "unrunnable" });

/**
 * §6.6's closed worker-writable statuses, named so a role's result
 * expectations and the outbox validator read one list. Everything else in
 * `ATTEMPT_OUTCOMES` is controller-derived and never worker-writable.
 */
export const WORKER_WRITABLE_OUTCOMES = Object.freeze(["completed", "needs-human", "worker-failed"]);

/**
 * §6.5's recorded absence, and it is **final**: Herdr drops its reference to a
 * session when the pane goes away and integration deletes the worktree pi keys
 * its own on, so an attempt whose pointer never arrived has no later heuristic
 * that could recover one. It is a code constant rather than a literal because
 * two places write it — the launch that observes the absence and the tier-2
 * digest that keeps it permanently (§12.3).
 */
export const NO_TRANSCRIPT_POINTER = "no-transcript-pointer";

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
 * §6.6, §8.8: the outcomes **only the controller derives**, as the complement of
 * the worker-writable set rather than as a second list beside it.
 *
 * That is what makes "controller-derived outcomes are never worker-writable"
 * structural. A hand-kept second list could name `wrote-but-hung` in both, and
 * the outbox validator and the stage machine would then disagree about who may
 * say it — with every test still green, because each would be reading its own
 * list.
 */
export const CONTROLLER_DERIVED_OUTCOMES = Object.freeze(
	ATTEMPT_OUTCOMES.filter((outcome) => !WORKER_WRITABLE_OUTCOMES.includes(outcome)),
);

/**
 * §8.8's phase results, per phase.
 *
 * **`implement` is absent, and that is the declaration** (§8.1): it has no phase
 * result of its own — its result *is* its attempt's outcome. Giving it an entry
 * spelled `["completed", …]` would duplicate `ATTEMPT_OUTCOMES` under a second
 * name, and the two would drift the first time an outcome was added.
 *
 * `review` is likewise only the three verdict-shaped results: a reviewer attempt
 * that never produced a verdict has an *attempt outcome*, which is a different
 * level (§8.8), and §8.10's review rows route both.
 */
export const PHASE_RESULTS = Object.freeze({
	[PHASE_HARVEST]: Object.freeze(["passed", "predicate-failed"]),
	[PHASE_VERIFY]: Object.freeze(Object.values(CHECK_RESULTS)),
	[PHASE_REVIEW]: Object.freeze(["approved", "rejected", "mutation-detected"]),
	[PHASE_INTEGRATE]: Object.freeze(["integrated", "rebase-conflict", "predicate-failed", "push-failed"]),
});

/**
 * §8.8's reason classes, split by **who may write one**. The split is the whole
 * content of §14.18: a worker asking a question needs an answer, so its classes
 * pause; the controller giving up needs an investigation, so its classes fail.
 *
 * Letting a worker write `repair-budget-exhausted` would let it lie about a
 * counter it cannot see, which is why the outbox validator holds a worker's
 * `reason_class` to the first list alone.
 */
export const WORKER_WRITABLE_REASON_CLASSES = Object.freeze([
	"product-ambiguity",
	"spec-contradiction",
	"missing-access",
	"risky-action-required",
	"out-of-scope-discovered",
	"dependency-unmet",
]);

export const CONTROLLER_DERIVED_REASON_CLASSES = Object.freeze([
	"repair-budget-exhausted",
	"automation-budget-exhausted",
	"rebase-conflict",
	"review-mutation",
	"check-unrunnable",
]);

export const REASON_CLASSES = Object.freeze([
	...WORKER_WRITABLE_REASON_CLASSES,
	...CONTROLLER_DERIVED_REASON_CLASSES,
]);

/**
 * The outcomes each pipeline phase may be answered over — what "total over
 * (phase × outcome)" means for §8.10's table, spelled once here so the table,
 * its totality test, and the projector that holds a recorded outcome to it all
 * read the same definition rather than agreeing by coincidence.
 *
 * An **agent-borne** phase (§8.1) is answered over its attempt outcomes, because
 * a worker run is what it produces; `review` additionally over its own phase
 * results, since a `completed` reviewer attempt resolves into one and the two are
 * different levels (§8.8). A **controller** phase has no attempt and is answered
 * over its phase results alone.
 */
export const PHASE_OUTCOME_DOMAINS = Object.freeze({
	[PHASE_IMPLEMENT]: ATTEMPT_OUTCOMES,
	[PHASE_HARVEST]: PHASE_RESULTS[PHASE_HARVEST],
	[PHASE_VERIFY]: PHASE_RESULTS[PHASE_VERIFY],
	[PHASE_REVIEW]: Object.freeze([...ATTEMPT_OUTCOMES, ...PHASE_RESULTS[PHASE_REVIEW]]),
	[PHASE_INTEGRATE]: PHASE_RESULTS[PHASE_INTEGRATE],
});

/**
 * §8.10's Action column: what the controller does with a resolved
 * `(phase, outcome)` pair.
 *
 * Here rather than beside the table because every one of these words rides a
 * `stage.resolved` payload and reaches the operator's screen and the monitor's
 * read contract unchanged — which is this file's whole criterion.
 */
export const STAGE_ACTIONS = Object.freeze({
	/** On to the next phase (§8.1's order). */
	advance: "advance",
	/**
	 * An agent-borne phase whose attempt came back `completed`: the phase result
	 * is the verdict the worker wrote, which is a different level from the attempt
	 * outcome that carried it (§8.8).
	 */
	verdict: "verdict",
	/** §8.5 tier 1 — a fresh attempt from the prior attempt's tip. */
	repair: "repair",
	/** §8.5 tier 2 — a fresh attempt from the pinned base, work discarded. */
	freshRetry: "fresh-retry",
	/** The same phase again: the automation failed, not the work. */
	retry: "retry",
	/** The ticket execution settles here (§8.9). */
	dispose: "dispose",
	/** §8.10's duplicate-identical row: return the committed result unchanged. */
	idempotentReturn: "idempotent-return",
});

/**
 * §8.6's two counters, and §8.10's fourth column. They are two rather than one
 * because **an automation failure never consumes the product budget** — the
 * worker did not cause it, and charging the builder would eventually discard
 * good work on an infra flake.
 */
export const BUDGET_KINDS = Object.freeze({ repair: "repair", automation: "automation" });

/**
 * §8.5's repair-prompt trust framing, carried on the rows that produce a repair
 * prompt: controller-produced evidence is presented **as fact**, worker-authored
 * text goes in a clearly delimited **untrusted block**. A reviewer whose findings
 * contain an injected directive must not have it promoted into an instruction to
 * a write-capable builder.
 */
export const EVIDENCE_TRUST = Object.freeze({ fact: "fact", untrusted: "untrusted" });

/**
 * §8.10: **`wrote-but-hung` is not a failure**, which is why it is an anomaly on
 * an ordinary row rather than an action of its own. The outbox is valid, the
 * harvest and the routine agent stop already happened at §6.6's settle, and what
 * is left is to take the *ordinary* action for a worker that answered — while
 * recording that it never ended its turn. An action named for the anomaly would
 * have to say where to go next as well, and would then be the ordinary action
 * under a second name.
 */
export const ANOMALY_WROTE_BUT_HUNG = "wrote-but-hung";

/**
 * §4.6's repo-scoped exclusive lease. Named here rather than in the lease
 * primitive because it is read from two sides: the holder renews it, and an
 * effect resolution compares its generation against the holder's (§14.5). The
 * other lease objects — `integration`, `capacity:*` — are the lease module's.
 */
export const CONTROLLER_LEASE = "controller";

/** §2.1: every identity-derived path segment is checked against this charset. */
export const IDENTITY_CHARSET = /^[0-9A-Za-z-]+$/;
