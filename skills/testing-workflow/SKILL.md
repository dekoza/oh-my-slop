---
name: testing-workflow
description: >
  TDD workflow, test execution rules, and test environment setup. Triggers on: "TDD", "test-driven",
  "red-green-refactor", "write tests", "run tests", "pytest", "Playwright", "test execution",
  "test environment", "Docker test", "compose.test.yml", "tee", "test output", "test suite",
  "unit tests", "integration tests", "E2E tests", "happy path", or when running any test command.
  Use when: writing tests, running tests, setting up test environments, or making testing decisions.
license: MIT
---

# Testing Workflow

## TDD is Mandatory (No Exceptions)

**Write tests FIRST, watch them fail, then implement.**

- Implementation before tests = **bug** (delete implementation, write tests first, reimplement)
- "I'll add tests later" is not acceptable
- Simple changes break things. The test takes 30 seconds. Write it first.

## Test Execution Rules

### Use `tee`, Never `head`/`tail`/`>`

When running tests, output must remain fully visible:

```bash
# ✅ Correct
uv run pytest tests/unit/ -x 2>&1 | tee /tmp/test-run.log

# ❌ Forbidden (hides failures)
uv run pytest tests/unit/ -x | head -50
uv run pytest tests/unit/ -x > /tmp/output.log
uv run pytest tests/unit/ -x 2>&1 | tail -20
```

**Why**: Truncation hides real failures. An agent that pipes through `tail` then re-runs tests wastes time and compute.

### Goal-Driven Execution

Transform imperative requests into verifiable goals:

| Instead of... | Transform to... |
|--------------|-----------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make them pass" |
| "Refactor X" | "Ensure tests pass before and after" |

## Test Quality Bar

- **Unit tests** for logic
- **Integration tests** for module boundaries (DB/HTTP/IO)
- **E2E tests** for key flows
- **UI tests** (Playwright) required for frontend/UI projects

Tests must be realistic:
- Test behavior via the contract, not implementation details
- Include edge cases and error paths
- Avoid mocks when real dependencies can be tested

## Playwright Rules (Web Apps with Frontend)

### Mandatory for E2E

If the project has a frontend/UI, Playwright **MUST** be used for E2E tests.

### Navigation Reachability

E2E tests for features extending existing UI **MUST navigate via UI, not URLs**:

```python
# ✅ Correct: Click through navigation
await page.click("sidebar-item-dashboard")
await page.click("button-create-task")

# ❌ Forbidden: Hardcoded URL (gives false confidence)
await page.goto("/tasks/create")
```

A feature with no navigation path is a broken feature, regardless of how well the backend works.

### Headless Mode

Always use `headless=True` in agent environments:

```python
browser = await async_playwright().start()
page = await browser.chromium.launch(headless=True)
```

Critical Chromium arguments:
- `--no-sandbox` (required in containers)
- `--disable-dev-shm-usage` (prevents memory exhaustion)
- `--disable-gpu` (reduces resource overhead)

### Installation Constraints

- **NEVER** install Playwright without explicit user request
- **Sudo is forbidden** — use fallback strategies if system Chromium unavailable
- **Timeout**: 5 minutes max for binary downloads, then fall back

## Docker Test Environment (Web Apps)

Integration and E2E tests for web applications **MUST** run in isolated Docker:

### Architecture

- `tests` container: runs pytest + Playwright
- `testdb` container: dedicated PostgreSQL (healthchecked before tests)
- Internal network (`test-net`): no host port mapping

### Test Image: Playwright/Chromium System Dependencies

Chromium in a slim Python image needs these system libraries — install them in `Dockerfile.test` before the browser install:

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

### Non-Negotiable Constraints

- **No public ports** — internal Docker networking only
- **Lifecycle independence** — `docker compose down` (dev) must not affect tests
- **Separate compose file** — `compose.test.yml`, NOT profiles in main compose

### Makefile Targets

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

## Testing Guardrails

- Use `httpx.MockTransport` for HTTP client tests — no `unittest.mock` gymnastics needed
- Use `Sequence` in factory_boy for uniqueness tests (not `django_get_or_create`)
- Check model constraints before writing test fixtures
- Use `update_or_create()` to avoid unique constraint violations

## E2E Debugging Checklist (Playwright)

When E2E tests fail mysteriously, check in order:

1. **Duplicate IDs** — Playwright strict mode fails on `locator("#id")` resolving to 2+ elements. Search rendered HTML for `id="..."`.
2. **CSP violations** — Capture console: `page.on("console", lambda m: msgs.append(...))`; filter for "Content Security Policy". Inline styles/scripts blocked if `'unsafe-inline'` missing or hashes present.
3. **Silent JS failure** — Empty console = script blocked (CSP) or syntax error before execution. Dump `page.content()` and verify `<script>` tags present.
4. **Template vars in static JS** — `{{ var|safe }}` in `.js` files renders as literal `{{ var|safe }}`. Use inline `<script>` config or data attributes.
5. **JSON serialization** — Python lists render as `[\'item\']` (single quotes) in Django templates. Use `json.dumps()` in view context.
6. **CSRF origin check** — `Origin checking failed - null does not match`. Ensure test settings remove CSRF middleware AND add `127.0.0.1` to `CSRF_TRUSTED_ORIGINS`.
7. **Pytest settings module** — `pyproject.toml` `DJANGO_SETTINGS_MODULE` must be `config.settings_test`, not `config.settings`.

Save rendered HTML on failure: `page.content()` to file for offline inspection.
