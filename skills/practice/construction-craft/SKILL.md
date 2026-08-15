---
name: construction-craft
description: >
  Use when implementation is blocked by unclear construction prerequisites or tangled routine/data
  shape, or when system knowledge and artifacts are drifting, commitments are expensive to
  reverse, recurring engineering work or quality decay needs containment, concurrency ownership
  is unsafe, or estimates and performance claims lack evidence.
requires:
  - codebase-design
  - diagnosing-bugs
  - production-readiness
  - python-async
  - refactoring-pass
  - tdd
  - testing-workflow
---

# Construction Craft

Build day-to-day code so its meaning, ownership, and operational assumptions remain visible.
This skill combines construction discipline with pragmatic working habits; it does not replace
the specialist workflows listed under Routing boundaries.

## Critical rules

1. **Gate construction.** Before a nontrivial change, verify that requirements, architecture
   fit, risks, conventions, language constraints, error policy, data representation, reuse,
   integration, and testing approach are clear enough. Clarify gaps before committing to a broad
   design; route any code experiment needed to resolve them through [`tdd`](../tdd/SKILL.md).
2. **Encode meaning.** Put purpose, units, ranges, precision, ownership, and valid states in
   names and types. Use enums for closed sets, named constants for domain values, and types that
   make invalid states hard to represent.
3. **Own each fact once.** Give every rule, schema, mapping, calculation, configuration meaning,
   generated artifact, and manual process step one authoritative owner; derive or validate every
   other representation from it.
4. **Preserve reversibility.** Keep volatile vendors, platforms, storage engines, policies, and
   deployment details reversible until evidence justifies commitment; route seam design through
   [`codebase-design`](../codebase-design/SKILL.md).
5. **Trigger concurrency isolation.** When threads, async work, shared mutable state, locks, or
   ordering appear, isolate the policy and load the language/runtime owner before coding.
6. **Automate repetition.** Turn repeated, error-prone, or easy-to-forget engineering rituals
   into versioned, reproducible scripts or checks.
7. **Measure tuning.** Set a target, capture a baseline, change one variable, remeasure, and keep
   the clarity cost only when the measured tradeoff earns it.
8. **Capture command output whole.** Any command whose output you intend to read —
   tests, builds, linters, type-checkers, migrations, container logs — runs as
   `<command> 2>&1 | tee /tmp/<descriptive-name>.log`, and you read the log file
   afterwards. **Never `head`, never `tail`, never a bare `>`.** Truncation hides the
   line that mattered and forces a second run; redirection hides a hang. If the slice
   you read was not enough, **read a bigger slice of the same file — never re-run the
   command to see more.** Test-execution specifics live in
   [`testing-workflow`](../testing-workflow/SKILL.md).

## Construction workflow

### 1. Frame the construction decision

Restate the required behavior, success evidence, constraints, and expensive-to-reverse choices.
Apply the construction gate from Critical rule 1 in proportion to the change: a small local edit
needs a short check; a cross-boundary change needs explicit answers. When uncertainty remains,
name the riskiest assumption and the evidence that would resolve it; when that evidence requires
code, route the experiment through [`tdd`](../tdd/SKILL.md).

**Complete when:** unresolved prerequisites are named with a clarification or experiment, or the
requirements, constraints, integration path, and verification approach are explicit enough to
start safely.

### 2. Shape routines, data, and contracts

Sketch intent or precise pseudocode before writing a complex routine. Keep the sketch at one
abstraction level, then turn it into code.

Read the [construction decision guide](references/construction-decisions.md) when the change
contains complex control flow, ambiguous values, stable category mappings, trust-boundary
validation, internal invariants, or performance work. When concurrency appears, isolate the
policy first and route language/runtime mechanics through the owning skill.

**Complete when:** names, types, units, valid states, expected failures, programmer assumptions,
and any concurrency policy are visible at the interface that protects them.

### 3. Assign knowledge and volatility

Locate every system fact the change reads or repeats. Choose its authoritative owner and make
copies generated, derived, or mechanically checked. Record volatile external choices, their
reversal cost, and the evidence that would justify commitment. Route any required seam design
through [`codebase-design`](../codebase-design/SKILL.md).

Read the [pragmatic practices guide](references/pragmatic-practices.md) when facts appear in
multiple artifacts, configuration or setup is copied, a vendor choice may change, a ritual is
manual, a durable format is being chosen, local decay is visible, or an estimate is requested.

**Complete when:** each repeated fact has one owner, every volatile choice has an explicit
reversal cost, and recurring manual work has a versioned automation path or a recorded reason it
must remain manual.

### 4. Follow the local construction language

Match the repository's naming, formatting, file structure, and idioms. Use its formatters,
linters, generators, and build commands rather than creating a module-specific dialect or
reproducing tool behavior by hand.

**Complete when:** the change follows the same naming, layout, idioms, and automated checks as its
neighbors, and generated or derived artifacts agree with their owner.

### 5. Finish accountably

Contain small decay in the touched area before it becomes normal: repair it when cheap, or record
a bounded follow-up with ownership. Report estimates as ranges with assumptions, major unknowns,
and the next evidence that would narrow them. Report performance claims only with the target,
baseline, changed variable, and remeasurement.

**Complete when:** remaining uncertainty, deferred decay, reversal costs, and measured tradeoffs
are visible to the next maintainer instead of hidden in optimistic prose.

## Routing boundaries

This skill owns construction decisions and pragmatic habits. Route specialist work rather than
restating it:

- Use [`tdd`](../tdd/SKILL.md) for tracer-bullet implementation and the red-green loop, and
  [`testing-workflow`](../testing-workflow/SKILL.md) for test execution and tier strategy.
- Use [`diagnosing-bugs`](../diagnosing-bugs/SKILL.md) for the reproduce-isolate-explain-fix loop.
- Use [`codebase-design`](../codebase-design/SKILL.md) for module depth, interface minimalism,
  seams, adapters, comment discipline, command-query separation, and typed results instead of
  null sentinels.
- Use [`python-async`](../../reference/python-async/SKILL.md) for structured concurrency, task and thread
  ownership, synchronization, cancellation, and shutdown in Python async code; use the relevant
  runtime owner for other ecosystems.
- Use [`refactoring-pass`](../refactoring-pass/SKILL.md) for smell diagnosis and named
  behavior-preserving refactoring moves.
- Use [`production-readiness`](../production-readiness/SKILL.md) for runtime failure taxonomy,
  resilience, resource pressure, observability, and deployment safety.

## Final checklist

- [ ] Construction prerequisites are clear enough for the change's risk.
- [ ] Names and types expose units, valid states, ownership, and mutation.
- [ ] Stable mappings use the clearest representation; tables are validated when chosen.
- [ ] Programmer assumptions use assertions or invariants; expected failures use validation or
      domain errors.
- [ ] Each system fact has one authoritative owner and repeated rituals are automated.
- [ ] Volatile decisions remain reversible in proportion to their uncertainty.
- [ ] Concurrency policy is isolated and language/runtime mechanics went to their owner.
- [ ] Performance claims and estimates carry evidence and uncertainty.
- [ ] Specialist concerns were routed to their owning skill instead of duplicated here.

## Sources

Synthesized from the working-size rule sets in
[`code-complete`](https://github.com/dekoza/agent-rules-books/tree/main/code-complete),
[`the-pragmatic-programmer`](https://github.com/dekoza/agent-rules-books/tree/main/the-pragmatic-programmer),
and the concurrency-isolation residue of
[`clean-code`](https://github.com/dekoza/agent-rules-books/tree/main/clean-code). Command-query
separation and typed-result guidance already live in `codebase-design` and are routed there.
