---
domain: reference-index
category: documentation
priority: high
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, Trio 0.32+, uvloop 0.18+ on supported CPython/POSIX runtimes"
last_verified: 2026-03-25
source_basis: official docs + README
---

# Python Async Reference Index

Use this index to pick the smallest reference file that matches the task. Start with one file. Add a second only when backend-specific semantics or runtime concerns materially change the answer.

## Route Elsewhere

- Framework-owned lifecycle rules -> pair the relevant framework skill
- Celery, RQ, Dramatiq, brokers, or distributed workers -> use queue/job-system docs
- Low-level selector/event-loop internals -> use stdlib or backend internals docs
- gevent, eventlet, greenlets, or non-Python runtimes -> use separate docs

## Reference Guides

| Domain | File | Use For |
|---|---|---|
| Routing | `references/decision-matrix.md` | AnyIO vs native backend vs runtime choice |
| Task lifecycle | `references/structured-concurrency.md` | Task groups, startup signaling, exception groups, ownership |
| Cancellation | `references/cancellation-timeouts.md` | Cancel scopes, timeouts, shielding, cleanup |
| Coordination | `references/streams-synchronization.md` | Streams, backpressure, locks, events, limiters |
| Boundaries | `references/threads-boundaries.md` | Blocking work, thread crossings, portals, nested-loop traps |
| Testing | `references/testing.md` | AnyIO pytest plugin, backend matrix, Trio utilities |
| Asyncio | `references/backend-asyncio.md` | Raw asyncio semantics and footguns |
| Trio | `references/backend-trio.md` | Trio semantics, checkpoints, Trio test tools |
| uvloop | `references/backend-uvloop.md` | Runtime tuning and enablement |
| Review | `references/code-review-checklist.md` | Fast async review checklist |

## Common Task Routing

1. Decide whether the task is portable logic, backend-native code, or runtime bootstrapping.
2. If unclear, open `references/decision-matrix.md`.
3. Open one primary file.
4. Add one secondary file only if native behavior changes the answer.

- Portability decision -> `decision-matrix.md`
- Background task lifecycle -> `structured-concurrency.md`
- Cancellation or timeout bugs -> `cancellation-timeouts.md`
- Streams, queues, backpressure -> `streams-synchronization.md`
- Threads, portals, sync wrappers -> `threads-boundaries.md`
- Async tests or plugin conflicts -> `testing.md`
- Raw `asyncio` code -> `backend-asyncio.md`
- Raw Trio code -> `backend-trio.md`
- `uvloop` runtime questions -> `backend-uvloop.md`
- Async code review -> `code-review-checklist.md`

## Suggested Reading Order

1. `references/decision-matrix.md`
2. `references/structured-concurrency.md`
3. `references/cancellation-timeouts.md`
4. One domain-specific file as needed
