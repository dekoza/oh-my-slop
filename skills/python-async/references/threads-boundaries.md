---
domain: threads-boundaries
category: boundaries
priority: high
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, asyncio 3.11+"
last_verified: 2026-03-25
source_basis: official docs
---

# Threads and Boundaries

Use this file when blocking work, worker threads, sync wrappers, or loop ownership are part of the problem.

## Default Policy

- Use `anyio.to_thread.run_sync()` for blocking synchronous work in portable async code.
- Use `asyncio.to_thread()` only when the code is already explicitly asyncio-specific.
- Keep the thread boundary narrow and named.

## AnyIO Thread Rules

Verified AnyIO behavior:

- `to_thread.run_sync()` runs sync callables in a worker thread.
- Waiting for that thread is shielded from cancellation by default.
- `abandon_on_cancel=True` lets the waiting task be cancelled, but the underlying thread keeps running and its result is ignored.
- The default AnyIO worker thread limiter is `40`.
- `from_thread.check_cancelled()` lets worker-thread code voluntarily react to host-task cancellation.

Do not promise thread cancellation. Python does not have it.

If long-running worker-thread code needs cancellation, require explicit polling with `from_thread.check_cancelled()`. `abandon_on_cancel=True` only stops waiting on the result; it does not stop the underlying thread.

```python
data = await anyio.to_thread.run_sync(read_big_file, path)
```

```python
# Anti-pattern: "cancellable" blocking work — cancellation abandons the
# *wait*; the thread keeps running the job to completion regardless
await anyio.to_thread.run_sync(long_blocking_job, abandon_on_cancel=True)

# Cancellation-aware version: the job itself polls for host-task cancellation
def long_blocking_job() -> None:
    for chunk in chunks:
        anyio.from_thread.check_cancelled()
        process(chunk)
```

## Crossing Back Into The Event Loop

Use:

- `from_thread.run()` to call async code from an AnyIO worker thread
- `from_thread.run_sync()` to call synchronous event-loop-thread code from an AnyIO worker thread

Callable split:

- `from_thread.run()` is for async callables
- `from_thread.run_sync()` is for sync loop-thread callbacks

```python
def blocking_worker() -> str:                        # runs via to_thread.run_sync()
    anyio.from_thread.run_sync(progress_event.set)   # sync callback -> run_sync
    return anyio.from_thread.run(fetch_message)      # async callable -> run
```

Examples of `from_thread.run_sync()` use:

- set an AnyIO `Event`
- poke a memory object stream or other loop-thread-owned state through a safe callback
- invoke loop-thread sync helpers from worker-thread code without opening a portal

Examples of `from_thread.run()` use:

- call an async client method from an AnyIO worker thread
- await an async helper that must hop back onto the loop once
- submit a one-off coroutine from a worker thread without opening a portal

Hard boundary:

- The docs say `from_thread.run()` works only from worker threads spawned via `to_thread.run_sync()`.
- The same worker-thread restriction applies to `from_thread.run_sync()`.
- For a foreign thread, use `current_token()` with `from_thread.run()` or `from_thread.run_sync()`, or keep a `BlockingPortal` open.
- Do not reach for `BlockingPortal` when an AnyIO worker thread only needs a one-off `from_thread.run()` or `from_thread.run_sync()` call.
- Do not collapse `from_thread.run()` and `from_thread.run_sync()` into one rule. The callable type matters: `run()` is for async callables, `run_sync()` is for sync loop-thread callbacks.

## Blocking Portals

`BlockingPortal` is the right tool for synchronous APIs that need structured access to async internals.

Good uses:

- Sync facade over an async client
- Reusing one portal for repeated sync calls
- Wrapping async context managers safely from synchronous code

Bad uses:

- Hiding ownership boundaries so completely that users no longer know where async work lives

## Context Propagation

AnyIO copies contextvars into worker threads and back into tasks spawned from worker threads. Those copies do not magically merge back into the original caller's context.

```python
request_id = contextvars.ContextVar("request_id", default="-")

def blocking_work() -> str:
    seen = request_id.get()       # copy of the caller's context: visible
    request_id.set("thread-set")  # mutates only the thread's copy
    return seen

async def handler() -> None:
    request_id.set("req-42")
    assert await anyio.to_thread.run_sync(blocking_work) == "req-42"
    assert request_id.get() == "req-42"  # the thread's set() never merged back
```

## Raw asyncio Notes

Python docs verify:

- `asyncio.run()` cannot be called while another event loop is already running in the same thread.
- `asyncio.run()` is meant to be the main entry point and should ideally be called once.
- `asyncio.run_coroutine_threadsafe()` is the thread-safe coroutine submission API for another thread.

Do not recommend nested `asyncio.run()` calls under a framework-owned loop.

## Review Questions

- Is blocking work actually offloaded?
- Can the sync boundary leak background tasks or resources?
- Does the code assume thread cancellation exists?
- Is a foreign thread calling AnyIO APIs without a token or portal?
- Is the event loop runner being nested illegally?
