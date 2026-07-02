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
