---
domain: code-review-checklist
category: review
priority: high
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, Trio 0.32+, uvloop 0.18+"
last_verified: 2026-03-25
source_basis: official docs
---

# Async Code Review Checklist

Use this file when reviewing async code quickly but without being sloppy. The point is to catch the bugs that compile, pass a happy-path demo, and then break shutdown, throughput, or tests.

## Task Lifetime

- Who owns each spawned task?
- Does detached work have a real shutdown path?
- Is `gather()` being used where task ownership is actually required?
- Are raw asyncio background tasks kept alive with a strong reference?

## Cancellation

- What cancels this work?
- Is cancellation swallowed anywhere?
- Does cleanup re-raise cancellation?
- Is shielding narrow and bounded, or is it hiding a design mistake?

## Blocking Work

- Is blocking sync code running on the event loop?
- Is CPU-heavy work being hand-waved as "async" even though it is not?
- If threads are used, is the boundary explicit and safe?

## Coordination And Backpressure

- Is buffering bounded for a reason?
- Are queue or stream close semantics well-defined?
- Is a queue being used where a stream or limiter would be clearer?
- Does overload behavior exist, or is memory growth the hidden policy?

## Backend Truthfulness

- Is backend lock-in hidden under generic async language?
- Is Trio-specific behavior being described with asyncio mental models?
- Is `uvloop` being sold as a semantic or correctness fix?
- Is `uvloop` being recommended on an unsupported platform or unverified Python/runtime combination?

## Testing

- Are tests proving the claimed backends?
- Do tests force cancellation and shutdown paths, or only happy paths?
- Is there a plugin conflict between AnyIO and `pytest-asyncio`?
- If `uvloop` is recommended, is there a runtime smoke test or benchmark?
