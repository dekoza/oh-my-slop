---
domain: testing
category: testing
priority: high
scope: python-async
target_versions: "Python 3.11-3.14, AnyIO 4.x, Trio 0.32+, uvloop 0.18+ on supported CPython/POSIX runtimes"
last_verified: 2026-03-25
source_basis: official docs
---

# Testing Async Python Code

## Default Test Strategy

- Use the AnyIO pytest plugin for portable async tests.
- Run important tests on both `asyncio` and Trio.
- Add an `asyncio + uvloop` axis only when the runtime or deployment actually supports or claims it.

If the code claims portability and tests only run on one backend, say so plainly.

## AnyIO Pytest Plugin

Verified from the docs:

- The plugin ships with AnyIO itself.
- Async tests can be enabled with `anyio_mode = "auto"`, `pytest.mark.anyio`, or the `anyio_backend` fixture.
- The default `anyio_backend` fixture can run tests on all supported backends.

## Plugin Conflict Rule

The docs explicitly warn that `anyio_mode = "auto"` conflicts with `pytest-asyncio` auto mode.

If `pytest-asyncio` is installed:

- keep `pytest-asyncio` out of auto mode, or
- use `pytest.mark.anyio` instead of relying on global auto mode.

Do not leave both in auto mode and call the failures mysterious.

## Backend Matrix

Minimum serious matrix for portable code:

```python
@pytest.fixture(
    params=[
        pytest.param(("asyncio", {"use_uvloop": False}), id="asyncio"),
        pytest.param(("trio", {}), id="trio"),
    ]
)
def anyio_backend(request):
    return request.param
```

Add this only when justified by deployment or performance claims and only on supported CPython/POSIX runtimes:

```python
pytest.param(("asyncio", {"use_uvloop": True}), id="asyncio+uvloop")
```

## Fixture Rules

- Higher-scope async fixtures need a matching higher-scope `anyio_backend` fixture.
- Use built-in free-port fixtures or listener-discovered ports, not hardcoded ports.
- AnyIO's test runner executes async fixtures and tests in the same task, so contextvars can leak within that runner.

## Trio-Specific Test Tools

For Trio-native code or backend-specific tests, Trio docs provide useful tools:

- `trio.testing.MockClock` for timeout-heavy tests
- `wait_all_tasks_blocked()` for letting concurrent work settle deterministically
- `Sequencer` for explicit inter-task ordering

These are Trio-native tools, not portable AnyIO behavior.

## Verification Rules

- If code claims backend neutrality, run both backends.
- If `uvloop` is recommended, gate it by supported platform/runtime first, then add a runtime smoke test or benchmark.
- If cancellation behavior is the point of the fix, write a test that forces cancellation.
- If a bug involves startup readiness, test the readiness handshake instead of sleeping and hoping.
