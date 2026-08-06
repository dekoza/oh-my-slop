---
domain: backend-asyncio
category: backend
priority: high
scope: python-async
target_versions: "Python 3.11-3.14"
last_verified: 2026-03-25
source_basis: official docs
---

# asyncio Backend Notes

Use this file when the task is explicitly native `asyncio` rather than portable AnyIO.

## Core Semantics

- `asyncio.run()` is the main entry point for a top-level program.
- Python docs say it cannot be called while another event loop is already running in the same thread.
- `asyncio.Runner` exists when multiple top-level async calls need the same event loop and context.

## Task Creation Footguns

Python docs explicitly warn that the event loop keeps only weak references to tasks created with `asyncio.create_task()`.

That means:

- Save a strong reference for detached tasks.
- A task with no other references may be garbage collected before it finishes.

This is one of the nastiest fake-fire-and-forget failure modes in asyncio code review.

## TaskGroup Reality

`asyncio.TaskGroup` is better than free-floating tasks, but it is not the same as AnyIO's task groups.

Differences that matter in practice:

- no readiness handshake like `TaskGroup.start()`
- no exposed cancel scope
- cancellation and shutdown semantics are still native asyncio semantics

Python docs also note that if a task group is inactive, `create_task()` closes the given coroutine.

## `gather()` Is Not A Lifecycle Manager

Python docs are explicit: if one awaitable in `asyncio.gather()` raises and `return_exceptions=False`, the other awaitables are not cancelled and continue to run.

So:

- use `gather()` for aggregate results
- use `TaskGroup` when sibling lifetime and failure coupling matter

## Cancellation And Timeouts

- `CancelledError` subclasses `BaseException`
- swallowing it can break structured-concurrency helpers like `TaskGroup` and `asyncio.timeout()`
- `asyncio.timeout()` transforms cancellation into `TimeoutError` only outside the context manager
- `wait_for()` cancels the awaited task on timeout

Python docs add an important caveat: if code truly intends to suppress `CancelledError`, it must also clear the task's cancellation state with `uncancel()`. Suppressing cancellation without `uncancel()` leaves the task in a poisoned state and can make `TaskGroup` or `asyncio.timeout()` misbehave.

## Shielding And Eager Start

- `asyncio.shield()` keeps the inner awaitable from being cancelled by the outer awaiter, but the caller still gets cancelled
- docs again warn to keep a strong reference to shielded tasks
- eager task execution exists via eager task factories and `eager_start`; this is a semantic change, not a free speedup

Treat both features as sharp tools, not defaults.

## Threads

- `asyncio.to_thread()` is for blocking I/O or code that releases the GIL
- `run_coroutine_threadsafe()` is the thread-safe way to submit a coroutine to another thread's loop
- most asyncio objects, including `Task`, are not thread-safe

## Review Questions

- Is a task reference being lost?
- Is `gather()` being used where `TaskGroup` is required?
- Is cancellation swallowed?
- Is `shield()` hiding a lifecycle bug?
- Is eager-start behavior changing execution order in a surprising way?
