# Invariant preflight

Use this source-first check during construction and before independent review. It is
not independent review, a third review axis, or permission to expand the work.

## Bound the inspection

For implementation, cover the ticket's critical invariants and changed failure paths.
For PR repair, start with each actionable finding and inspect its **sibling** paths:
other writers, readers, transports or recovery routes sharing the faulty assumption.
Trace their reachable call chains; file proximity alone is not evidence of relevance.
A whole-PR hardening sweep requires explicit operator scope. Keep unrelated defects and
owner-deferred advisories as reported follow-ups, not automatic repairs. Apply the
caller's repair budget; this inspection belongs to the current construction/repair
round, not an extra unbounded review loop.

## Challenge the assumption

Before the first implementation edit, record the invariant and at least one concrete
counterexample for each critical path. Extend the record as construction exposes new
facts; recheck it against the exact candidate before review:

| Invariant | Counterexample | Reachable paths | Verification |
| --- | --- | --- | --- |
| Quote the governing rule | Inputs/state and the forbidden result | Actual producer, authority check, writer and affected consumers | Existing evidence or smallest meaningful regression; remaining gap |

Choose counterexamples from the allowed input/state space, not merely the examples
already covered by tests. Follow the property through its transitions, where applicable:

- **Establish eligibility.** Unknown is not permission, known zero, or absence of a
  restriction. Trace where authority, ownership and classification become established;
  a physical count or missing exclusion record does not itself establish entitlement.
- **Preserve effects.** Trace atomic persistence/publication, exact-identity replay,
  changed-content conflicts, concurrent allocation and downstream consumers. Check that
  an alternate writer cannot bypass the guard and that all responsible close/release
  paths retain unresolved obligations.
- **Survive interruption.** Trace failure before capture, after durable capture, after
  server commitment and before local acknowledgement persistence. Bound waits through
  response-body consumption, release temporary UI/resource state, and preserve original
  pending evidence instead of inventing success or rejection.

These are investigation prompts, not new product requirements or blocking standards.
Verify a suspected defect with a cited requirement or binding standard and a concrete
source-backed counterexample; label static findings separately from reproduced failures.
If eligibility/policy is genuinely unspecified, return that decision to its owner.

## Select meaningful verification

Use the `tdd` and `testing-workflow` skills and the project's supported test entry points.
Map each verified defect to a focused **RED** regression, then repair vertically. Inspect
existing assertions: a test name or happy-path pass is not proof that it exercises the
counterexample. Reuse credible evidence for unchanged paths with its source/head limits.

Choose the lowest tier that can establish the invariant: pure arithmetic/representation
at unit level; actual public persistence/rollback/replay at integration level; genuine
separate-connection PostgreSQL tests for database serialization; a real browser for
browser-dependent abort/body consumption, focus, storage and reload behavior. Mocks do
not establish database or browser guarantees. Run a race only when the requirement or
changed invariant needs one, not for every repair by habit.

Consolidate final affected selections after focused RED/GREEN cycles, plus applicable
lint, syntax, import-boundary and migration checks. Preserve mandatory project gates;
an operator's test limit constrains execution, not the meaning of acceptance. Report a
required omitted check as a gap rather than silently expanding the run or declaring it
passed. A narrow pass is not a whole-tier pass; fresh source changes invalidate affected
old evidence. Record commands, actual results, candidate/head and omitted coverage.

**Ready for independent review when:** every critical invariant or repaired defect has
its counterexample, inspected affected sibling paths, source disposition and credible
verification or explicit unresolved gap recorded. Bind that record to the exact candidate
and give the two review axes their own original requirements/standards and independent
contexts. Self-checks and green selections cannot substitute for either complete report.
