---
name: python-async
description: >
  Use when designing, debugging, or reviewing async Python — AnyIO, `asyncio`, or Trio
  code, task groups, cancellation, thread offloading, or async tests. Triggers on:
  `async def` code in the prompt, "CancelledError", an async hang or shutdown that never
  finishes, event-loop errors ("attached to a different loop", "asyncio.run() cannot be
  called"), "task group" / "cancel scope", pytest-asyncio or AnyIO test questions, or
  "uvloop". Pair the framework skill when lifecycle rules belong to Django, Litestar,
  or FastAPI.
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, Trio 0.32+, uvloop 0.18+ on supported CPython/POSIX runtimes"
last_verified: 2026-03-25
source_basis: official docs + source code + README
---

# Python Async Reference

Use this skill for async-enabled Python libraries and applications. Default to AnyIO APIs for portable logic, then surface backend-specific behavior only when raw `asyncio`, Trio, or `uvloop` details materially change the answer. Read only the reference files needed for the task.

## Critical Rules

1. **Default to AnyIO for portable logic** - Use AnyIO APIs for task groups, cancellation, streams, threads, and tests unless native backend semantics are required.
2. **`uvloop` is not a third async model** - It is an `asyncio` event loop implementation and should be treated as an asyncio-only runtime option.
3. **Prefer structured concurrency** - Task groups or nurseries beat ad-hoc background task spawning for lifecycle safety.
4. **Re-raise cancellation after cleanup** - Catch cancellation only to clean up or translate context; swallowing it is a bug.
5. **Shield only bounded cleanup** - Do not use shielding as a generic escape hatch from cancellation.
6. **Do not recommend raw `asyncio.shield()` for new portable code** - It is too easy to orphan work or hide failures.
7. **Do not nest runners** - Do not call `asyncio.run()` or similar inside a running or framework-owned loop.
8. **Offload blocking work explicitly** - Async syntax does not make blocking file I/O, logging, DNS, or CPU-heavy code safe.
9. **Treat worker threads as context copies, not extensions** - Contextvars are copied into `to_thread.run_sync()` and never merge back, and threads cannot be cancelled: long-running worker-thread code must poll `from_thread.check_cancelled()`; `abandon_on_cancel=True` only abandons the wait.
10. **Portability claims require backend-aware tests** - Do not claim AnyIO portability if code or tests only run on one backend.
11. **Benchmark before recommending `uvloop`** - Treat it as runtime tuning, not a semantic fix.
12. **Prefer repo-local references before external source spelunking** - When this skill's reference files already cover the question, answer from them first. Do not spelunk site-packages or unrelated local installs during normal runs unless the task explicitly requires source-level verification beyond the bundled references.
13. **Make the thread-bridge callable split explicit** - `from_thread.run()` is for async callables; `from_thread.run_sync()` is for loop-thread sync callbacks such as setting an AnyIO `Event`. Do not collapse them into one interchangeable bucket.

## When Not To Use This Skill

- **Framework-owned lifecycle rules** - Pair the relevant framework skill when startup, shutdown, request lifetimes, or background task ownership belong to Django, Litestar, FastAPI, Starlette, or another framework.
- **Distributed task systems** - Celery, RQ, Dramatiq, brokers, and cross-process workers are out of scope.
- **Low-level event loop internals** - Selector internals, custom loop implementations, and CPython internals are not owned here.
- **Non-Python async models** - gevent, eventlet, greenlets, and non-Python runtimes are out of scope.
- **Kernel or network tuning** - Production socket tuning, kernel backlog changes, and OS-level performance work are out of scope.

## Reference Map

| File | Domain | Use For |
|------|--------|---------|
| `references/REFERENCE.md` | Index | Cross-file routing and reading order |
| `references/decision-matrix.md` | Routing | AnyIO vs native backend vs runtime choice |
| `references/structured-concurrency.md` | Task lifecycle | Task groups, readiness handshakes, exception groups, ownership |
| `references/cancellation-timeouts.md` | Cancellation | Cancel scopes, timeouts, shielding, cleanup, async generator finalization, backend differences |
| `references/streams-synchronization.md` | Coordination | Memory object streams, backpressure, locks, events, capacity limits |
| `references/threads-boundaries.md` | Boundaries | Thread offloading, thread/loop crossings, blocking portals, loop ownership |
| `references/testing.md` | Testing | AnyIO pytest plugin, backend matrices, Trio test tools, uvloop test axis |
| `references/backend-asyncio.md` | Backend specifics | Raw asyncio semantics, task/shield/queue/thread pitfalls |
| `references/backend-trio.md` | Backend specifics | Checkpoints, cancel scopes, Trio thread rules, Trio testing tools |
| `references/backend-uvloop.md` | Runtime tuning | What uvloop changes, where to enable it, when not to recommend it |
| `references/code-review-checklist.md` | Review | Fast checklist for async correctness and portability risks |

## Task Routing

- **Unsure whether to answer in AnyIO or native backend terms** -> `references/decision-matrix.md`
- **Designing or reviewing task spawning / background work** -> `references/structured-concurrency.md`
- **Fixing hangs, shutdown bugs, timeouts, or cleanup issues** -> `references/cancellation-timeouts.md`
- **Choosing queues/channels/locks/semaphores or backpressure behavior** -> `references/streams-synchronization.md`
- **Crossing sync/async or thread/event-loop boundaries** -> `references/threads-boundaries.md`
- **Writing async tests or building backend matrices** -> `references/testing.md`
- **Raw `asyncio` code or APIs in the prompt** -> `references/backend-asyncio.md`
- **Raw Trio code or Trio-native semantics in the prompt** -> `references/backend-trio.md`
- **`uvloop` enablement or performance discussion** -> `references/backend-uvloop.md`
- **Code review of async correctness** -> `references/code-review-checklist.md`

## Output Expectations

- Name the reference files used.
- State whether the answer is `AnyIO-portable`, `asyncio-specific`, `Trio-specific`, or `asyncio-runtime-specific`.
- Explain the main lifecycle or cancellation constraint, not just the API syntax.
- When thread crossings matter, name `from_thread.run()` and `from_thread.run_sync()` separately and state which callable shape each one expects.
- State the minimum verification step: tests, backend matrix, runtime smoke test, or benchmark.
- Call out the highest-risk footgun plainly.
