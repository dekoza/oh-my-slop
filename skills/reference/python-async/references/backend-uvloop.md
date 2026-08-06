---
domain: backend-uvloop
category: runtime
priority: high
scope: python-async
target_versions: "uvloop 0.18+ on supported CPython/POSIX runtimes; verify exact Python support before recommending"
last_verified: 2026-03-25
source_basis: official docs + README + wiki
---

# uvloop Runtime Notes

## What uvloop Is

- `uvloop` is a fast drop-in replacement for the built-in `asyncio` event loop.
- It implements the `asyncio.AbstractEventLoop` interface.
- It is an asyncio runtime choice, not a portability layer and not a Trio feature.

This distinction is non-negotiable. Treating uvloop as a third async model is wrong.

## Where It Belongs

- App startup
- Runtime configuration
- Benchmarks
- Runtime-specific test axes

## Where It Does Not Belong

- Portable library API design
- Trio guidance
- Claims about correctness, cancellation safety, or lifecycle safety

## Current Usage Guidance

From the current README:

- `uvloop.run(main())` is the preferred modern entry point
- when explicit runner control is needed, `asyncio.Runner(loop_factory=uvloop.new_event_loop)` is the relevant lower-level pattern

From current Python docs:

- `asyncio.run()` and `asyncio.Runner` prefer loop factories over old policy-based configuration
- the asyncio policy system is deprecated and will be removed in Python 3.16

So when old examples recommend global event-loop policies, treat them as legacy style rather than the default new recommendation.

## Platform And Runtime Scope

Current uvloop packaging metadata advertises CPython plus POSIX/MacOS support. Do not recommend or require uvloop on unsupported platforms such as Windows, and do not claim support for a Python version you have not verified against current uvloop metadata.

## AnyIO Integration

AnyIO docs verify that `anyio.run(..., backend="asyncio", backend_options={"use_uvloop": True})` exists as the portable runtime toggle on the asyncio backend.

This is still an asyncio-only runtime decision.

## Recommendation Rules

1. Recommend `uvloop` only for asyncio-based apps or services.
2. Never recommend it for Trio code.
3. Benchmark before calling it a win.
4. State that it does not fix blocking code, swallowed cancellation, or poor task ownership.
5. Keep it out of library-level public APIs.

## Review Questions

- Is the code actually asyncio-based?
- Is the user asking for runtime tuning or for correctness?
- Is there a benchmark or deployment reason to enable uvloop?
- Is an old event-loop-policy example being mistaken for the modern default?
