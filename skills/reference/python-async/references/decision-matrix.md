---
domain: decision-matrix
category: routing
priority: critical
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, Trio 0.32+, uvloop 0.18+ on supported CPython/POSIX runtimes"
last_verified: 2026-03-25
source_basis: official docs
---

# Async Decision Matrix

Start here when it is unclear whether the answer should be written in AnyIO, raw `asyncio`, Trio, or `uvloop` terms.

## First Question: Who Owns The Concurrency Model?

| Scenario | Default answer mode | Why | Escalate when |
|---|---|---|---|
| Reusable library API | `AnyIO-portable` | Avoid backend lock-in | A required dependency is backend-native |
| App business logic with no framework/runtime lock-in | `AnyIO-portable` | Structured concurrency and tests stay portable | Bootstrapping or framework lifecycle matters |
| ASGI or CLI bootstrap | `asyncio-specific` or `Trio-specific` | Startup code owns the runner | `uvloop` or backend-native settings are requested |
| Raw `asyncio` APIs in code (`Future`, transports, `create_task`, `TaskGroup`) | `asyncio-specific` | Semantics materially differ | Portability refactor is explicitly requested |
| Trio-native code, checkpoints, `trio.testing`, cancel scopes | `Trio-specific` | Trio mental model materially differs | Portability refactor is explicitly requested |
| Event loop implementation or perf tuning | `asyncio-runtime-specific` | This is where `uvloop` belongs | Benchmark or deployment details are missing |

## Default Policy

- Prefer AnyIO for task groups, cancellation, streams, thread offloading, file I/O wrappers, and async testing.
- Drop to native backend APIs only when the task is already backend-native or runtime-specific.
- Surface lock-in explicitly instead of hiding it behind generic async language.

## Hard Rules

1. If a required library is native `asyncio`, stop pretending the code is Trio-portable.
2. If the framework owns the loop, do not recommend nested runners.
3. `uvloop` never makes `asyncio` code Trio-compatible.
4. Async syntax alone does not imply backend neutrality.
5. If portability is claimed, tests must cover the claimed backends.

## Native Library Boundaries

AnyIO lets you call native backend libraries, but this is not a free abstraction layer.

- You can only use native libraries for the backend you are actually running.
- AnyIO docs explicitly warn that tasks spawned by native libraries on backends other than Trio are not governed by AnyIO's cancellation rules.
- Threads spawned outside AnyIO cannot safely use `from_thread.run()` without the proper token or portal boundary.

## Typical Failure Modes

- Calling `asyncio.run()` inside a running loop or framework lifecycle
- Using raw `asyncio.Queue()` or `asyncio.shield()` in code claimed to be portable
- Assuming Trio cancellation behaves like asyncio cancellation
- Recommending `uvloop` as a correctness fix instead of a runtime choice
- Shipping a library API that exposes backend-native task or loop objects and then calling it portable

## Output Rule

Always say which of these four modes the answer belongs to:

- `AnyIO-portable`
- `asyncio-specific`
- `Trio-specific`
- `asyncio-runtime-specific`

If that label is unclear, the answer is probably muddled.
