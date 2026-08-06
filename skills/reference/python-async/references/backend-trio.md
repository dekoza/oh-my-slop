---
domain: backend-trio
category: backend
priority: high
scope: python-async
target_versions: "Trio 0.32+"
last_verified: 2026-03-25
source_basis: official docs
---

# Trio Backend Notes

Use this file when the task is explicitly Trio-native or when Trio semantics materially change the answer.

## Core Model

- `trio.run()` is Trio's main entry point.
- Nurseries are the structured-concurrency primitive.
- Cancel scopes are the cancellation primitive.

If code is Trio-native, speak Trio clearly instead of translating everything into asyncio language.

## Checkpoints Matter

Trio docs treat checkpoints as central to code review.

A checkpoint is where Trio:

- checks for cancellation
- decides whether to schedule another task

Important rules from the docs:

- synchronous functions never contain checkpoints
- Trio async functions that complete normally always checkpoint
- `await trio.sleep(0)` is the explicit no-op checkpoint tool

If a loop never reaches a checkpoint, it can starve fairness and cancellation.

## Cancellation Rules

- Trio cancellation is level-triggered through cancel scopes
- `Cancelled` inherits from `BaseException`
- broad exception handling needs scrutiny
- shielded cleanup should use cancel scopes deliberately, not as a reflex

Do not paste asyncio cancellation instincts into Trio code and expect them to fit.

## Thread Safety Boundary

The docs say the vast majority of Trio's API is not thread-safe and should be assumed to require the Trio thread unless specifically documented otherwise.

## Time And Clocks

Trio's clock is not a generic wall-clock assumption.

The docs explicitly say you should not assume Trio's internal clock matches other clocks you have access to. That matters for timeouts, test helpers, and benchmark logic.

## Trio Testing Tools

Useful Trio-native helpers include:

- `trio.testing.MockClock`
- `wait_all_tasks_blocked()`
- `Sequencer`
- in-memory stream helpers for evil protocol tests

These tools are excellent, but they are Trio-specific. Do not pass them off as AnyIO-wide guarantees.

## Review Questions

- Are there enough checkpoints?
- Is cancellation being caught and re-raised correctly?
- Is code assuming wall-clock behavior where Trio uses its own clock?
- Is a thread touching Trio APIs directly?
- Would a Trio-native test helper make the failure deterministic?
