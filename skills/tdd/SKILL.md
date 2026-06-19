---
name: tdd
description: Test-driven development with red-green-refactor. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants to write integration tests.
license: MIT (adapted from mattpocock/skills)
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behaviour through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behaviour hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behaviour.

See [Tests](references/tests.md) for examples and [Mocking](references/mocking.md) for mocking guidelines.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behaviour, not _actual_ behaviour.
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behaviour.
- Tests become insensitive to real changes — they pass when behaviour breaks, fail when behaviour is fine.
- You outrun your headlights, committing to test structure before understanding the implementation.

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behaviour matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code:

- [ ] Read the project's AGENTS.md for test strategy (TDD mandate, Docker test env, Playwright for E2E).
- [ ] Check `compose.test.yml` for Docker test environment setup.
- [ ] Check if Playwright is available for E2E tests (web apps).
- [ ] Confirm with user what interface changes are needed.
- [ ] Confirm with user which behaviours to test (prioritize).
- [ ] Identify opportunities for deep modules (small interface, deep implementation) — use the `codebase-design` skill for the vocabulary and testability checks.
- [ ] List the behaviours to test (not implementation steps).
- [ ] Get user approval on the plan.

Ask: "What should the public interface look like? Which behaviours are most important to test?"

**You can't test everything.** Confirm with the user exactly which behaviours matter most. Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet — proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behaviour:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

**After each red-green cycle:**

- [ ] Commit the passing test + implementation (AGENTS.md §8).
- [ ] Use real dependencies where possible — not mocks (AGENTS.md §2).
- [ ] Prefer `httpx.MockTransport` for HTTP client tests over `unittest.mock.patch` gymnastics (AGENTS.md §9.3).

### 4. Refactor

Once all behaviours are covered, look for refactor candidates. See [Refactoring](references/refactoring.md).

**Harvest shortcuts.** When you took a shortcut to get a test green — skipped validation, stubbed a dependency, hardcoded a value — tag it before refactoring:

```python
# SHORTCUT: <what's skipped>. Upgrade: <what to do when this matters>.
```

These markers are harvestable. Run `grep -rnE '(#|//) ?SHORTCUT:' .` across the repo to find accumulated shortcuts before they compound. A shortcut without an `Upgrade:` path is a ticking bomb — either add the path or fix it now.

## Test execution environment

Follow the project's AGENTS.md §2 and §11:

- **Unit tests** (pure logic, no DB, no browser): run on host for TDD speed (`uv run pytest tests/unit/`).
- **Integration tests** (DB, HTTP, IO): run inside Docker via `compose.test.yml`.
- **E2E tests** (Playwright, browser): run inside Docker via `compose.test.yml`.
- **Web apps**: E2E tests MUST navigate through the UI, not via direct URLs (AGENTS.md §2).

## Reference

| File | Use When |
|---|---|
| [Tests](references/tests.md) | Good vs bad test examples, integration-style testing |
| [Mocking](references/mocking.md) | When to mock, designing for mockability |
| [Refactoring](references/refactoring.md) | Refactor candidates after TDD cycle |
