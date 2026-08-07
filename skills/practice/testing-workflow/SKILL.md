---
name: testing-workflow
description: >
  Use when running tests, setting up or debugging a test environment, choosing which tier
  a test belongs in, or deciding when E2E tests must run. Triggers on: "run the tests",
  "pytest", "compose.test.yml", "test environment", "slow test suite",
  "which tier should this test be", "full suite", "CI is red".
license: MIT
---

# Testing Workflow

Owns test **execution and strategy**: tiers and where they run, output capture, timeouts,
Docker test environments, Playwright setup, and when E2E runs during implementation work.
The red-green-refactor discipline itself lives in the `tdd` skill — load it before writing
any implementation code.

## Critical rules

1. **Capture test output with `| tee /tmp/<name>.log` — never `head`, `tail`, or bare `>`.**
   Truncation hides failures and forces re-runs; redirection hides hangs. Read the log file
   afterwards instead of re-running the command.
2. **Set both timeout layers explicitly on every non-unit run** (see Timeout doctrine below).
   A run killed by a default 60s timeout is a wasted run reporting on the runner, not the tests.
3. **Run each tier where it belongs** (see the tier table). Integration and E2E run in Docker
   via `compose.test.yml`, never against the dev environment.
4. **Test proportionately.** Before implementation, run the smallest relevant existing selection
   that can expose a pre-existing failure. Use targeted tests during development, then run every
   affected tier before completion. Leave the full suite to CI unless the project requires it or
   you are diagnosing a CI failure; do not launch all E2E tests for an isolated change.

## Test tiers

| Tier | Scope | Where it runs | Feedback speed |
|------|-------|---------------|----------------|
| Unit | Pure logic, no DB/browser/IO | Host: `uv run pytest tests/unit/ -x` | Seconds |
| Integration | Module boundaries: DB, HTTP, IO | Docker: `compose.test.yml` | Tens of seconds |
| E2E | User flows through the real UI (Playwright) | Docker: `compose.test.yml` | Minutes |

Makefile targets:

```makefile
test-unit:             ## Run unit tests on host (fast TDD)
	uv run pytest tests/unit/ -x

test-integration:      ## Run integration tests in Docker
	docker compose -f compose.test.yml run --rm tests pytest tests/integration/ -x

test-e2e:              ## Run E2E / Playwright tests in Docker
	docker compose -f compose.test.yml run --rm tests pytest tests/e2e/ -x

test:                  ## Run full test suite
	$(MAKE) test-unit
	$(MAKE) test-integration
	$(MAKE) test-e2e
```

## Choosing the tier

Place each **assertion** at the lowest tier that can honestly verify it:

- Needs real browser behavior (JS execution, HTMX swaps, CSP, focus, navigation) → E2E.
- Verifies server-response shape, DB state, or template context → integration.
- Verifies pure logic → unit.

Keep E2E thin: one happy-path test per user flow, plus the assertions that genuinely need a
browser. When a suite has accumulated E2E-only assertions that lower tiers could carry —
typically discovered after a triage session — run the `restore-test-pyramid` skill
(`skills/workflow/restore-test-pyramid/`) to push them down systematically. A bloated E2E tier is why
"small ticket, hour-long test run" happens.

## E2E policy for implementation runs

When implementing ticket-shaped work (e.g. via the `implement` skill), scale E2E cost to the
**change**, not the project:

1. **Per slice**: for each slice with a user-visible flow, write one happy-path E2E test after
   the slice is green at lower tiers, then run **only that file**
   (`pytest tests/e2e/test_<slice>.py`) in Docker. Keep containers warm between slices.
   Slices with no user-visible flow owe no new E2E test — integration suffices.
2. **End gate for the session**: full unit + full integration + **targeted E2E** — the new
   tests plus existing E2E files covering flows the diff touches.
3. **Full E2E suite green is a merge condition, not a session condition.** Push the branch,
   open a PR referencing the ticket (`Closes #N`); CI (e.g. Gitea Actions) runs the full suite
   on the PR, and the ticket closes via the merge, gated on that check.
4. **No CI on the project?** Ask the user before launching a full E2E run expected to exceed
   ~10–15 minutes. Never start one silently.

## Timeout doctrine (two independent layers)

Both layers must be set, and the outer must always be **longer** than the inner — otherwise
the runner kills pytest before pytest can enforce per-test budgets, and all output is lost.

1. **Outer runner timeout** — the budget the harness (CI job, `docker compose run`, `timeout`
   command) gives the whole pytest process.
2. **Inner pytest timeout** — `--timeout` (pytest-timeout), enforced per test. Always pass it
   explicitly; the default (60s or unset) is too short for anything beyond unit tests.

| Tier | Outer minimum | Inner `--timeout` minimum |
|------|---------------|---------------------------|
| Unit | 600s (10 min) | 60s |
| Integration | 1800s (30 min) | 300s |
| E2E | 3600s (1 hour) | 600s |

A Playwright test can legitimately take 60–180s; a 60–120s inner timeout on E2E guarantees
false kills.

## Playwright rules (web apps with frontend)

- **E2E requires Playwright** if the project has a frontend/UI.
- **Navigate via UI, not URLs**, for features extending existing UI:

  ```python
  # ✅ Click through navigation
  await page.click("sidebar-item-dashboard")
  await page.click("button-create-task")

  # ❌ Hardcoded URL — false confidence
  await page.goto("/tasks/create")
  ```

  A feature with no navigation path is a broken feature, regardless of the backend.
- **Headless always** in agent environments (`headless=True`), with `--no-sandbox`,
  `--disable-dev-shm-usage`, `--disable-gpu`.
- **Never install Playwright without explicit user request**; sudo is forbidden; cap binary
  downloads at 5 minutes, then fall back.

## Docker test environment (web apps)

Integration and E2E tests run in isolated Docker:

- `tests` container (pytest + Playwright) + `testdb` container (dedicated PostgreSQL,
  healthchecked) on an internal network — **no host port mapping**.
- **Separate compose file** — `compose.test.yml`, not profiles in the main compose; dev
  `docker compose down` must not affect tests.
- Persist `.pytest_cache` as a volume so `--lf` works across runs.

Chromium in a slim Python image needs system libraries — install in `Dockerfile.test` before
the browser install:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# System deps for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen

# Install Playwright browsers
RUN uv run playwright install chromium

COPY . .
```

## Testing guardrails

- Use `httpx.MockTransport` for HTTP client tests — no `unittest.mock` gymnastics.
- Use `Sequence` in factory_boy for uniqueness tests (not `django_get_or_create`).
- Check model constraints before writing test fixtures; use `update_or_create()` to avoid
  unique-constraint violations.

## Related skills

- `tdd` — the red-green-refactor discipline (mandatory for implementation work).
- `diagnosing-bugs` — mysterious failures, multi-failure triage, E2E debugging checklist.
- `webapp-testing` — ad-hoc Playwright scripts for browser evidence outside the test suite.
- `restore-test-pyramid` — periodic ritual to push E2E-only assertions down the pyramid.
