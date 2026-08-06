---
domain: structured-concurrency
category: concurrency
priority: high
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, Trio 0.32+"
last_verified: 2026-03-25
source_basis: official docs
---

# Structured Concurrency

This file covers task lifetime, startup coordination, and multi-task failure handling. Reach for it whenever the user is spawning tasks, running background work, or reviewing shutdown behavior.

## Default Model

- Prefer `anyio.create_task_group()` for portable code.
- For Trio-native code, the matching concept is the nursery.
- For raw `asyncio`, prefer `asyncio.TaskGroup` over ad-hoc `create_task()` sets unless you explicitly need detached work.

```python
import anyio

async def worker(name: str) -> None:
    await anyio.sleep(0.01)

async def main() -> None:
    async with anyio.create_task_group() as tg:
        tg.start_soon(worker, "a")
        tg.start_soon(worker, "b")
    # exiting the block waits for both; a child failure cancels the sibling

anyio.run(main)
```

## Why Task Groups Win

- The parent owns task lifetime.
- Exiting the context waits for child tasks.
- A child failure cancels sibling tasks.
- Multi-error outcomes are surfaced through `ExceptionGroup` or `BaseExceptionGroup`.

This is a real safety boundary. `asyncio.gather()` runs things concurrently, but it is not a lifecycle manager. Python docs explicitly note that `TaskGroup` provides stronger safety guarantees than `gather()` because `gather()` does not cancel the remaining awaitables when one raises.

## Startup Handshakes

Use `TaskGroup.start()` when a child task must finish initialization before the parent continues.

Key AnyIO rule:

- `start()` blocks until the child calls `task_status.started()`.
- If the child never calls `task_status.started()`, AnyIO raises `RuntimeError`.

Use `start_soon()` only when the parent does not need a readiness signal.

```python
from anyio.abc import TaskStatus

async def serve(*, task_status: TaskStatus[int] = anyio.TASK_STATUS_IGNORED) -> None:
    port = 8080  # bind sockets here, then signal readiness
    task_status.started(port)
    await anyio.sleep_forever()

async def main() -> None:
    async with anyio.create_task_group() as tg:
        port = await tg.start(serve)  # blocks until task_status.started(port)
        ...
```

## Asyncio Differences That Matter

AnyIO docs call out real differences with `asyncio.TaskGroup`:

- `asyncio.TaskGroup` has `create_task()` only; there is no `start()` equivalent.
- It does not expose a group-wide cancel scope.
- Tasks can be cancelled individually, but group-wide coordination is thinner.
- If a task is cancelled before its coroutine starts running, raw asyncio may not give it a chance to react to cancellation.

Do not paper over these differences in review comments.

## Lifecycle Ownership Rules

1. The code that starts background work must also define how it stops.
2. Detached work is acceptable only when ownership is explicit and external shutdown exists.
3. A task that touches sockets, DB sessions, or files must have a clear teardown path.
4. A background task that outlives the request, command, or test that spawned it is a design claim and must be justified.
5. Detached work should receive plain data snapshots, not request objects, DB sessions, tracing spans, or other request-bound resources.
6. An app-owned background boundary must define admission and shutdown policy: reject, buffer, drain, or hand off durably. "Best effort" is not a policy.
7. An app-owned background boundary must make failure observation explicit: log/report worker failures, surface them to metrics, or route them to dead-letter handling.

## Fire-And-Forget Smells

- `asyncio.create_task()` with no strong reference
- `create_task()` from library code with no stop signal
- Request handlers that launch work and hope process shutdown cleans it up
- Tests that pass only because spawned tasks never get awaited or cancelled

```python
# Anti-pattern: detached task with no owner — may be garbage-collected
# mid-run, and its exceptions vanish silently
asyncio.create_task(sync_to_remote(order))

# Owned version: lifetime and failures belong to the enclosing group
async with anyio.create_task_group() as tg:
    tg.start_soon(sync_to_remote, order)
```

## Exception Groups

AnyIO and raw `asyncio.TaskGroup` both surface grouped failures through `ExceptionGroup` or `BaseExceptionGroup`. Do not flatten this into a fake single-error model.

For Python 3.11+, prefer `except*` when handling grouped task failures.

```python
try:
    async with anyio.create_task_group() as tg:
        tg.start_soon(flaky_worker)
        tg.start_soon(other_worker)
except* ValueError as eg:
    for exc in eg.exceptions:
        log_failure(exc)  # handle each matching member; others re-propagate
```

## Review Questions

- Who owns each spawned task?
- What proves the child is actually ready?
- What cancels sibling work on failure?
- What happens if cleanup code also raises?
- Is `gather()` being used where a task group is actually required?
