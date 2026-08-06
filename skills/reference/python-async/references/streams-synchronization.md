---
domain: streams-synchronization
category: coordination
priority: high
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x"
last_verified: 2026-03-25
source_basis: official docs
---

# Streams and Synchronization

Use this file when the task is really about coordination, backpressure, queue replacement, or resource access discipline.

## Default Policy

- Prefer AnyIO memory object streams over raw `asyncio.Queue()` in new portable designs.
- Prefer explicit backpressure over silent buffering.
- Prefer `CapacityLimiter` over `Semaphore` unless a task truly needs to hold multiple tokens at once.

## Memory Object Streams

AnyIO memory object streams are the default producer-consumer primitive.

Verified behaviors from the docs:

- Creating one returns a send stream and a receive stream.
- The default buffer size is `0`, so senders block until a receiver is ready.
- You can use a bounded buffer by passing a size.
- `math.inf` creates an unbounded buffer, but the docs explicitly say this is not recommended.
- Receive streams support async iteration and naturally end when all send-side clones are closed.
- Cloning makes multi-producer and multi-consumer shutdown semantics explicit instead of ad-hoc.

This is a real upgrade over `asyncio.Queue()` for new designs.

## Backpressure Rules

1. If producers can outrun consumers, choose a bound on purpose.
2. Do not default to unbounded buffering just because it is easier.
3. State the overload behavior: block, drop, shed load, or fail fast.
4. Treat queue size as part of the contract, not an implementation detail.

## Events, Locks, And Conditions

Important AnyIO semantics:

- Events are single-use and not reusable.
- Locks and conditions are task-owned, not thread-safe.
- Conditions combine event-style signaling with lock ownership.
- `Semaphore` and `Lock` support `fast_acquire=True`, but docs warn this can reduce fairness if a loop has no other yield points.

## Capacity Limiters

Use `CapacityLimiter` when the goal is to cap concurrency rather than protect a multi-token resource.

Why:

- A borrower can hold only one token at a time.
- The same abstraction is used by AnyIO to limit thread spawning.

## Resource Guards

Use `ResourceGuard` when concurrent access is not merely undesirable but invalid. The docs position this for resources like sockets where re-entrant use should fail loudly.

## Thread Safety Boundary

AnyIO synchronization primitives are not thread-safe. If a worker thread needs to signal an `Event` or send into a stream, route that through `from_thread.run_sync()`.

## Review Questions

- Is backpressure explicit?
- Is buffering bounded for a reason?
- Are close and shutdown semantics well-defined?
- Is a thread touching an async primitive directly?
- Is a queue being used where a stream or limiter would be clearer?
