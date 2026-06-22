# AGENTS.md

This file defines **non-negotiable rules** for AI agents working across all projects.
If any rule conflicts with system or higher-priority instructions, **follow the higher-priority instruction**.
If a project has its own `AGENTS.md`, its rules take precedence for project-specific concerns; these global rules apply everywhere else.

---

## 0) Zero-Tolerance on Hallucination, Lying, and Redundant Work

1. **You SHALL NOT state that a file exists, a function works, or a test passes without running the command to prove it in the current turn.**
2. **You SHALL NOT modify or rewrite code that is outside the explicit boundary of the requested task.** No silent refactoring. If you rewrite untouched code, this is treated as a major defect.
3. **No Sycophancy or Face-Saving Placet-Seeking:** You SHALL NOT tell the user "I fixed X" or "X is verified" if a test suite has not run to completion and outputted `PASSED`. If a tool call fails, begin your response by printing: `PROVEABILITY FAILURE: [Reason]`.
4. **Clean Workspace Before Work.** Before starting any development task, you MUST run the full test suite. All tests MUST be passing before you write a single line of implementation code. If tests are failing at the start, you MUST fix them first — not defer them, not call them "pre-existing," not work around them. "Pre-existing failure" is not an explanation — it is an admission that you failed to prepare your workspace. You cannot build on a broken foundation and claim the result works. Fix first, then implement. Never start work with a dirty test suite.
5. **Verify before referencing.**
   - Before using any API, parameter, file path, library behavior, or configuration in your code or claims, confirm it exists via source code, docs, or a test run.
   - If you can't verify something, say so explicitly and then verify it or ask a clarifying question.
6. **Work from facts and sources.**
   Before claiming "X works like Y", you must rely on at least one of:
   - official library/framework documentation,
   - the library's source code (in the project or installed sources),
   - existing code patterns/usages/types in the repository,
   - running a test, a small script, a REPL session, or a minimal example in the project.
7. **Enforcement rule: if you have no source, don't claim it.**
   - If you cannot point to (or quickly obtain) a source from section 0.2, you must not state behavior as fact.
   - Instead, do one of:
     1) verify (docs / code / tests / REPL),
     2) ask a short clarifying question.
8. **When information is missing, ask rather than guess.**
   - Prefer short clarifying questions over making default assumptions.
   - If you must proceed despite missing data, state 1–2 explicit assumptions and mark them as **"needs confirmation"**.
9. **Think Before Coding.**
   - **State assumptions explicitly.** If you're uncertain about scope, fields, format, or intent — say so before writing code. Don't silently pick an interpretation and run with it.
   - **Present multiple interpretations when ambiguous.** If "make the search faster" could mean latency, throughput, or perceived speed — list the options with tradeoffs and ask which matters.
   - **Push back when a simpler approach exists.** If the request leads to a 200-line abstraction but a 20-line function would work, say so. Propose the simpler path first.
   - **Stop when confused.** Name what's unclear. Ask for clarification before implementing. A short question now prevents a wrong assumption that costs hours.
   - **Surface tradeoffs.** Don't hide confusion behind confident-sounding code. If you see risks or alternatives, present them.

## Hardline Review and Honesty Policy

You must default to adversarial evaluation. You must assume the user's reasoning, proposal, or code contains flaws until those flaws are ruled out. You must not praise, placate, validate, or preserve the user's framing unless the framing survives scrutiny. You must actively search for false assumptions, vague goals, missing requirements, hidden tradeoffs, edge cases, and concrete failure modes, and you must surface them plainly and early. If the user is wrong, you must say the user is wrong. If the request is confused, you must say it is confused. If the plan is weak, naive, brittle, or likely to fail, you must say so and explain why. You must not use politeness strategies that obscure its actual judgment. In code review, you must assume defects are present and enumerate them precisely. You must call out sloppy abstractions, leaky invariants, poor naming, duplication, magical constants, brittle control flow, missing tests, unsafe assumptions, weak error handling, overengineering, premature optimization, and maintainability hazards without euphemism. You must not reward code for merely compiling, running, or looking sophisticated. You may describe code as good only when it is demonstrably correct, clear, robust, and appropriately designed.

**Do not treat disagreement as a tone failure. Treat unearned agreement as a quality failure.**

## Guiding Philosophy

These principles govern all decisions — from architecture to single-line edits. They apply universally to every project, language, and technology.

1. **Clarity over cleverness.** Code that reads well is worth more than code that impresses. Clean structure, good names, and obvious flow are non-negotiable.

2. **Explicit over implicit.** State intentions plainly — in code, configuration, documentation, and communication. Hidden behavior is a liability.

3. **Simple over complex, but complex over complicated.** Choose the simplest solution that fully solves the problem. When a problem is inherently complex, structure the complexity cleanly rather than flattening it into clever hacks.

4. **Flat over nested.** Prefer flat structures — in control flow, template hierarchies, class inheritance, and configuration. Deep nesting obscures logic and makes change harder.

5. **Sparse over dense.** Give code room to breathe. Don't pack multiple concerns into single lines, functions, or files. Density is not efficiency — it's obfuscation.

6. **Readability is a feature.** Code is read far more often than it is written. Optimize for the reader, not the writer.

7. **Consistency matters — but practicality beats purity.** Follow established patterns and rules. When rigid adherence produces a worse outcome than a pragmatic exception, choose pragmatism and document why. Dogma that ignores context is not discipline.

8. **Errors must be handled, never swallowed.** Errors should never pass silently. If an error is deliberately suppressed, document the reason. Bare `except: pass` is always a bug.

9. **When uncertain, ask — don't guess.** In the face of ambiguity, refuse the temptation to guess. A short clarifying question costs seconds; a wrong assumption costs hours.

10. **One obvious way.** For any given problem in a project, there should be one clear approach. Establish conventions early, follow them consistently. Competing patterns for the same problem are a maintenance burden.

11. **Act now, but don't build ahead.** Write tests now, commit now, handle errors now. But don't build for requirements that don't exist yet. Premature generalization is as wasteful as procrastination.

12. **If it's hard to explain, reconsider.** An implementation requiring elaborate justification is probably over-engineered. But simplicity of explanation is necessary, not sufficient — simple-sounding ideas still need rigorous validation.

13. **Good boundaries make good systems.** Encapsulation, module boundaries, clear interfaces, and well-defined responsibilities are force multipliers. Invest in them.

## 1) Language (very important)

- **Write code in English**: identifiers, docstrings, comments, technical README content, etc.

### 1.1 Python libraries

- For libraries, all **messages must be in English**:
  exceptions, error messages, logs, CLI help, etc.
- Do not use any language other than English in library messages.

### 1.2 Web applications

- If there are signals that the user's primary language is not English (e.g., non-English commit messages, comments, variable names, or explicit statement), **ask the user** whether user-facing messages should be in English or their native language.
- User-facing messages include: UI/CLI texts, error messages shown to users, TUI text, help/usage.
- Once the language preference is established, apply it consistently across the project.

### 1.3 When English is required regardless

- If documentation/spec/prompt explicitly requires English (e.g., public API/SDK), use English regardless of the user's language preference.

### 1.4 Enforcement

- Web app + user-facing messages in a language not agreed upon with the user = **bug** (must fix).
- Library + non-English messages = **bug** (must fix).

## 2) Tests (mandatory, realistic, high quality)

- Any generated/changed code must be **tested**. Don't stop at "should work".
- Tests must be **realistic**, not "fake":
  - don't tautologically test implementation details; test behavior via the contract,
  - include edge cases and error paths,
  - avoid mocks when real dependencies can be tested (e.g., real parsing/validation).
- Minimum quality bar:
  - **unit tests** for logic,
  - **integration tests** for module boundaries (DB/HTTP/IO),
  - **E2E tests** for key flows.
- If the project includes frontend/UI: UI tests are required (e.g., **Playwright**).
- If you're writing or updating a project specification, include solid test requirements: unit/integration/E2E (+ UI for frontend).
- If you test app using `uv` or `poetry`, use the same tool for running tests (e.g., `uv run pytest` or `poetry run pytest`).
- **TDD is the ONLY allowed test strategy.** (very important)
  - Write tests FIRST, watch them fail, then implement until they pass.
  - Implementation before tests = **bug** (must delete implementation, write tests first, then reimplement).
  - No exceptions. "I'll add tests later" is not acceptable.
- **Playwright is mandatory for webapp E2E testing.** (very important)
  - If the project is a web application with a frontend, Playwright **MUST** be used for E2E tests.
  - Happy path testing is the **bare minimum** — every user-facing flow must have at least one happy path E2E test.
  - Skipping Playwright E2E for a webapp with frontend = **bug** (must add before task is complete).
- **E2E tests for features extending existing UI MUST navigate via UI, not URLs.** (very important)
  - If a feature adds screens reachable from existing navigation (sidebar, navbar, dashboard, modals), E2E tests MUST reach those screens by clicking through the UI -- not by entering URLs in the address bar.
  - Direct URL navigation in E2E tests is only acceptable for standalone entry points (e.g., public landing pages, webhook endpoints, API docs).
  - This rule exists because a URL-navigated E2E test gives false confidence: it proves the view works in isolation while hiding that no user can actually reach it. A feature with no navigation path is a broken feature, regardless of how well the backend works.
  - Enforcement: E2E test that reaches a feature screen via hardcoded URL when that screen should be reachable through UI navigation = **bug** (must rewrite to navigate via clicks).
- **Web applications: test execution environment.** (very important)
  - Integration and E2E tests for web applications MUST run in an isolated Docker-based test environment (see section 12).
  - Unit tests (pure logic, no DB, no browser) run on host for fast TDD feedback.
  - This split preserves TDD speed while guaranteeing test environment isolation.

### 2.1 Goal-Driven Execution

Transform imperative requests into verifiable goals. Don't just "do the task" — define success criteria and loop until verified.

| Instead of... | Transform to... |
|--------------|-----------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |
| "Make it faster" | "Benchmark current state, set target, verify improvement" |

For multi-step tasks, state a brief verification plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification. When the user's request is vague, propose specific success criteria and confirm before implementing.

## 3) Imports (Python)

- Python imports must be **at the top of the file** (PEP8: imports before definitions).
- Do not place imports inside functions/methods/blocks.
- Only allowed exception: avoiding a **real** circular import.
  - You must have proof that top-level imports cause a circular import error (e.g., a real traceback from a run/test).
  - In that case, an inline import must include a short English comment: `# Circular import: <reason>`.
  - For `__init__.py` barrel files, prefer PEP 562 lazy `__getattr__` to avoid circular imports at module load time.

## 4) Dependencies and tooling

- Dependency management must use **only**: `poetry` **or** `uv` (match the project).
- Choose automatically based on lockfile:
  - if `poetry.lock` exists → use `poetry`,
  - if `uv.lock` exists → use `uv`.
- If you need to add a package:
  - add it via the correct tool into `pyproject.toml`,
  - do not run ad-hoc `pip install` without explicit justification.
- Dev-only packages (debug toolbar, etc.) must have `try/except ImportError` guards in settings so production never breaks if they're absent.

## 5) Respect user changes (very important)

When you start a new session or encounter code that differs from what you might expect:

1. **Default stance: the user's code is intentional.**
   - Never treat user-written code as "wrong" or revert it without being asked.
   - If you see code you wouldn't have written that way, assume the user had a reason.
   - Your job is to work WITH the current state of the codebase, not against it.

2. **When the user explicitly asks for help fixing their changes.**
   Only when the user says something like *"I think I screwed up"*, *"help me fix my changes"*, *"something broke after my edits"* — then:
   - Analyze what the user changed and pinpoint exactly what went wrong.
   - Explain the issue politely and clearly (no condescension).
   - Ask about the user's intent if it's not obvious from the code.
   - Fix the changes properly — revert and redo if needed, or patch surgically.

3. **Enforcement:**
   - Reverting or overwriting user code without explicit request = **bug** (must fix).
   - Silently "improving" user code that wasn't part of the task = **bug** (must fix).

## 6) Scope control — change only what was asked for

1. **Touch only what the task requires.**
   - If asked to fix function X, do not also "improve" function Y nearby.
   - If asked to add a feature, do not refactor unrelated code you happen to see.
   - Resist the urge to fix style, rename variables, or reorganize imports outside the task scope.
   - **Match existing style** — quotes, spacing, naming conventions, comment density — even if you'd do it differently.

2. **Clean up only your own mess.**
   - When your changes create orphans (unused imports, variables, functions), remove them.
   - Don't remove pre-existing dead code unless asked.
   - If you notice unrelated dead code, report it — don't delete it silently.

3. **If you spot a real problem outside scope, report it — don't fix it.**
   - Say: *"I noticed [issue] in [file:line] — want me to address it separately?"*
   - Never silently bundle unrelated fixes into a task.

4. **The surgical test:** Every changed line should trace directly to the user's request. If you can't explain why a line changed in terms of the task, revert it.

5. **Enforcement:**
   - Unasked-for changes outside the task scope = **bug** (must revert).
   - Drive-by refactoring, reformatting, or "improvements" = **bug** (must revert).

## 7) Anti-slop and verbosity

AI-generated code has recognizable bad habits. Avoid them:

1. **No excessive comments.** Don't add comments that restate the code. Comments explain *why*, not *what*.
   - ❌ `user = get_user(id)  # Get the user by ID`
   - ✅ `user = get_user(id)  # Includes soft-deleted users for audit trail`

2. **No over-abstraction.** Don't extract functions/classes/patterns unless there's actual reuse or complexity to manage. Inline is fine for one-off logic.

3. **No generic names.** Avoid `data`, `result`, `item`, `temp`, `info`, `payload` when a specific name is available.

4. **No filler prose in code.** Don't add docstrings that say "This function does X" when the function name already says X. Docstrings explain non-obvious behavior, parameters, exceptions, or contracts.

5. **No premature generalization.** Build for the current requirement. Don't add extension points, plugin systems, or strategy patterns "in case we need them later".

6. **Prefer flat control flow.** Use early returns, guard clauses, and function extraction to avoid deep nesting. If a function has more than 3 levels of indentation, it likely needs restructuring.

7. **Handle errors explicitly.** Bare `except: pass` is a bug. Every exception handler must either handle the error meaningfully, propagate it, or document why suppression is correct. Overly broad catches (`except Exception`) without re-raising should be treated with suspicion.

8. **Enforcement:**
   - Code that reads like it was generated by a chatbot = **must rewrite**.
   - If you catch yourself adding a comment that restates the line above, delete it.

## 8) Commit behavior and git history

Git history is a **source of truth** for how the project evolved. Treat it accordingly.

1. **Commit at least after each phase or logical unit of work.**
   - Don't accumulate a giant diff across many unrelated changes.
   - Each commit should tell a coherent story: what changed and why.

2. **Commit messages must be meaningful.**
   - Use conventional format: `type(scope): description` (e.g., `feat(auth): add JWT refresh token rotation`).
   - The description should explain *what changed*, not *what you did* ("add X" not "I added X").

3. **Git history as context source.**
   - Before making changes to unfamiliar code, check `git log` and `git blame` to understand how it evolved.
   - Previous commit messages explain past decisions — use them before asking the user to re-explain.

4. **Never rewrite shared history** without explicit user permission (no `--force` push, no rebasing published branches).

5. **Commit after every execution wave.** (very important)
   - When executing a plan with parallel waves, the agent **MUST** commit all results after each wave completes — before starting the next wave.
   - Each wave commit captures a coherent, working state of the codebase.
   - Do not accumulate changes across multiple waves into a single commit.
   - Enforcement: starting a new wave without committing the previous wave's results = **bug** (must stop and commit first).

6. **Untracked files are sacred — never treat them as disposable.** (very important)
   - The user may be working with files that haven't been committed yet. This is a legitimate workflow — for example, cleaning files before first commit to avoid leaking sensitive data in git history.
   - Untracked files are the user's property. They may represent hours of work with no other copy.
   - Before ANY operation that could affect untracked files, run `git status` and understand what is untracked and why.
   - Never assume untracked files are garbage, generated artifacts, or safe to delete.
   - If a subagent created rogue files that need removal, delete them **individually by exact path** — never with blanket commands.
   - Enforcement: deleting or overwriting untracked files without explicit user permission = **bug** (catastrophic, possibly unrecoverable).

7. **Destructive git/filesystem commands require explicit user permission.** (very important)
   - The following commands are **FORBIDDEN** without the user explicitly requesting them:
     - `git clean` (any flags) — destroys untracked files irreversibly
     - `git checkout -- .` or `git restore .` — discards all uncommitted changes
     - `git reset --hard` — destroys uncommitted work
     - `rm -rf` / `rm -r` on directories containing user files
     - Any command with glob patterns (`rm *.md`, `git checkout -- *.py`) that could hit user files
   - If you need to remove specific files (e.g., rogue files created by a misbehaving subagent), delete them **one by one by exact path** after listing them to the user.
   - Enforcement: running any of the above without explicit user request = **bug** (catastrophic, possibly unrecoverable).

## 9) Documentation lifecycle and living specifications (very important)

- Documentation is part of the implementation contract. Any change that affects behavior, interfaces, architecture, configuration, deployment, or operations is incomplete until the relevant documentation is updated.
- Treat documentation with the same discipline as TDD: write or update the high-level specification first, derive acceptance criteria and tests from it, implement, then reconcile reference and maintenance documentation with the shipped behavior.
- For every non-trivial feature or behavior change, create or update the **canonical feature specification before implementation**. The spec is the normative description of intended behavior.
- Specifications must describe goals, non-goals, assumptions, constraints, main flows, edge cases, acceptance criteria, and operational impact.
- When intended behavior changes during implementation, update the spec immediately. Do not knowingly leave spec/code drift for later.
- Tests are executable checks derived from the specification. Write or update tests from acceptance criteria before implementation.
- Significant design or architecture changes require an ADR or equivalent decision record capturing context, options considered, decision, tradeoffs, consequences, and status.
- Reference documentation must cover exact interfaces: APIs, settings, schemas, CLI flags, contracts, and integration points. Generate it from code where practical.
- Operationally significant changes require maintenance documentation before merge or release: deployment, migration, rollback, observability, failure modes, troubleshooting, and recovery.
- Avoid duplicate truth. Each document type must have one clear job:
  - **spec** = intent and acceptance criteria,
  - **ADR** = rationale and tradeoffs,
  - **tests** = verification,
  - **reference** = exact interface and behavior facts,
  - **runbook/maintenance docs** = operations and recovery.
- Keep documentation in the repository and review it with the code. Behavior-changing work without documentation updates is incomplete.
- Use explicit status markers for authoritative documents: **Draft**, **Active**, **Superseded**, **Deprecated**. Link superseding documents clearly.
- If documentation conflicts with code, tests, or other docs, do not guess. Surface the discrepancy and resolve it explicitly.
- Stale documentation is a bug. If a document cannot be updated immediately, mark it visibly as superseded, deprecated, or inaccurate rather than leaving it to mislead future agents or humans.
- Do not create documentation theater. Prefer updating the nearest canonical spec over creating one-off docs for trivial changes.
- README files are entry points, not dumping grounds. Keep them focused on orientation and links to canonical docs.
- **Enforcement:**
  - Behavior-changing work without aligned specification, reference, and maintenance documentation updates = **bug** (must fix before task is complete).
  - Leaving a known authoritative document stale or contradictory without marking it clearly = **bug** (must fix or flag explicitly).

## 10) Common pitfalls (learned from production projects)

These patterns have caused real bugs across multiple projects. Internalize them.

### 10.1 Testing

- **`httpx.MockTransport`** is sufficient for HTTP client tests — no need for `unittest.mock` patch gymnastics.
- **Navigation reachability checklist (for UI features):**
  - Every new screen/feature extending existing UI MUST have a visible entry point in primary navigation (sidebar, navbar, dashboard, or contextual buttons).
  - Dashboard integration: new features MUST surface relevant quick-actions or status on the user's dashboard.
  - Feature flag consistency: UI entry points MUST use the same feature flag as the backend views.
  - E2E user journey: E2E tests MUST navigate to features by clicking through the interface, not by `page.goto(url)`.
  - No orphan screens: a polished screen that users cannot discover through navigation is a broken feature, not a working one.

### 10.2 Infrastructure / Docker

- **Docker non-root user UID** should match host user to avoid bind-mount permission issues.
- **`USER` directive** must come AFTER all `RUN`/`COPY` commands in Dockerfile.
- **Docker Compose profiles** allow multiple service configs in a single file — use them instead of separate compose files for configuration variants.
- **Exception**: test infrastructure MUST use a separate `compose.test.yml` — profiles do not provide lifecycle independence (see section 12).
- **Docker Compose port arrays merge, they do not replace.** In a `docker-compose.override.yml`, a `ports:` list is appended to the base file's list — not replaced. If both the base and override define a binding for the same container port, both host-port mappings are applied and the first conflicting one will fail to bind. To change a port binding you must either edit the base file directly or create a standalone compose file passed with `-f` instead of relying on the override merge.

### 10.3 Security

- **HMAC verification**: if signature is embedded in the JSON payload, reconstruct the payload with an empty signature field before verifying.
- **Use `hmac.compare_digest()`** for constant-time token/signature comparison — never use `==`.
- **Signed cookies with unsigned fallback** for backward compatibility during migration.
- **One-time tokens are consumed by any caller — including the agent's own probes.** Before testing any endpoint that issues, validates, or consumes a one-time token (enrollment, password reset, email confirmation, etc.), verify you are working against a disposable state. A curl or Playwright probe that hits such an endpoint will burn the token. If that token was needed by an automated background process (e.g., a daemon container waiting to enroll), it will fail with no obvious cause. Probe read-only or idempotent endpoints only; for write endpoints, use a throwaway resource or regenerate the token after probing.

### 10.4 Architecture

- **Cross-context imports** should use public API (`from apps.context import Symbol`), not internal modules (`from apps.context.models import Symbol`).
- **Circular import prevention**: place deferred imports inside functions with `# Circular import:` comment. For `__init__.py`, use PEP 562 lazy `__getattr__` to avoid circular imports at module load time.

## 11) Playwright and E2E browser testing (agent environments)

Playwright is required for UI testing in projects with frontend/UI.

**For web applications with Docker-based test environments** (section 12): Playwright is pre-installed in the `tests` container. The detection checklist (11.1), fallback strategies (11.4), and related enforcement are superseded — skip to section 12.

**For library projects and environments without Docker**: the rules below apply. Browser binary installation carries real constraints: it times out, may require sudo (forbidden in agents), consumes resources, and fails silently without explicit configuration. These rules prevent silent failures and dangerous workarounds.

### 11.0 Critical constraint

- **NEVER install Playwright without explicit user request.** If `playwright` is not in `pyproject.toml` (or `package.json` for frontend tests), do not run `pip install playwright` or `npx playwright install`. Stop immediately after 60 seconds of detection attempts.
- **Installation timeout**: browser binary downloads often exceed 10 minutes in agent environments. If installation begins, set a hard timeout of 5 minutes. If not complete, kill the process and fall back to strategy 11.4.
- **Sudo is forbidden.** Do not attempt `sudo apt-get install chromium` or similar. If system Playwright binary installation requires sudo, mark it as unavailable and use fallback (11.4).

### 11.1 Detection checklist

Run these checks in order. Stop after each step if condition is false:

1. Check `pyproject.toml` for `playwright` dependency (or `package.json` for `@playwright/test`). If absent, skip to 11.4 (fallback). If present, continue.
2. Attempt a 60-second binary availability check: import `async_playwright`, launch `chromium` with `headless=True` and `--no-sandbox`, close cleanly. If successful, continue. If timeout or import error, skip to 11.4.
3. If steps 1–2 pass, run E2E tests with headless mode (11.2). If tests fail, review known pitfalls (11.3) before retrying.

### 11.2 Headless mode

- **Always set `headless=True`** in all Playwright browser launches. Never run headed mode (`headless=False`) in agent environments.
- **Critical Chromium launch arguments**: include `--no-sandbox` (required in containers), `--disable-dev-shm-usage` (prevents memory exhaustion), and `--disable-gpu` (reduces resource overhead).
- **Environment variable timing**: set `PLAYWRIGHT_BROWSERS_PATH` BEFORE any Playwright import. If this path is unset and browser binaries do not exist in default location, import will fail silently and later launch attempts will hang.

### 11.3 Known pitfalls

- **Browser install timeout**: downloading + extracting binaries often takes 10–15 minutes on slow links. If not configured, default timeout is usually 30 seconds — set explicit timeout or pre-install before running tests.
- **Package installed ≠ browsers available**: `pip install playwright` installs the Python package but NOT the browser binaries. Run `playwright install` (as separate command) or set `PLAYWRIGHT_INSTALL_BROWSERS` environment variable to `true`.

### 11.4 Fallback strategies

If Playwright cannot run in the current environment, use these strategies in priority order:

1. **System Chromium**: if system has Chromium installed (verify with `which chromium` or `which google-chrome`), launch Playwright with `executable_path=/usr/bin/chromium` (or actual path). This avoids binary download.
2. **Mark E2E as unavailable**: if 11.4.1 is not acceptable for the use case, explicitly document why E2E is skipped. DO NOT silently skip without justification.

### 11.5 Enforcement

- **Attempting Playwright install without user request** (i.e., `pip install playwright` when not in `pyproject.toml`) = **bug**. Revert immediately.
- **Running `sudo` to install or configure Playwright** = **bug**. Agent environment must not escalate privileges. Use fallback (11.4) or ask user to pre-configure.
- **Launching Playwright with `headless=False`** in an agent environment = **bug**. Headed mode will hang indefinitely.
- **Skipping E2E tests without attempting fallback strategies** (11.4.1 or 11.4.2) when Playwright binary unavailable = **bug**. Document why fallbacks are unsuitable before skipping.
- **Spending > 5 minutes attempting to install Playwright binaries** without explicit timeout control = **bug**. Set hard timeout (11.0) or switch to fallback (11.4).

## 12) Docker-based test environment (web applications) (very important)

Web application testing MUST use an isolated Docker-based test environment for integration and E2E tests. This provides lifecycle independence from the development stack, eliminates port conflicts, and creates a reproducible sterile environment.

### 12.0 Architecture

The test environment consists of:

- **`tests` container**: runs pytest, includes Playwright with pre-installed browser binaries.
- **`testdb` container**: dedicated test database (PostgreSQL). Healthchecked before tests start.
- **Internal Docker network** (`test-net`): services communicate by container name. No host port mapping.

These services live in a **separate compose file** (`compose.test.yml`) — NOT in the main `compose.yml`. This ensures lifecycle independence: tearing down the dev stack does not affect running tests, and vice versa.

### 12.1 Non-negotiable constraints

- **No public ports.** Test containers MUST NOT map ports to the host. Internal Docker networking only.
- **testdb reachable only from test network.** The test database must not be accessible from dev containers or the host.
- **Lifecycle independence.** `docker compose down` (dev) MUST NOT affect tests. `docker compose -f compose.test.yml down` (tests) MUST NOT affect dev.

### 12.2 Test execution model

- **Unit tests** (pure logic, no DB, no browser): run directly on host for TDD speed (`uv run pytest tests/unit/` or `poetry run pytest tests/unit/`).
- **Integration tests** (DB, HTTP, IO): run inside Docker via `compose.test.yml`.
- **E2E tests** (Playwright, browser): run inside Docker via `compose.test.yml`. Playwright and Chromium are pre-installed in the `tests` container image — no ad-hoc browser installation.

### 12.3 Agent responsibilities

- If `compose.test.yml` does not exist, the agent **MUST create it** along with the `Dockerfile.test` for the tests container.
- If a `Makefile` exists or is appropriate, add test-related targets (see 12.5).
- After creating test infrastructure, the agent must verify it works by running a smoke test (`make test-unit` + `make test-integration` or equivalent).

### 12.4 compose.test.yml reference structure

```yaml
services:
  testdb:
    image: postgres:16
    environment:
      POSTGRES_DB: test_db
      POSTGRES_USER: test_user
      POSTGRES_PASSWORD: test_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test_user -d test_db"]
      interval: 2s
      timeout: 5s
      retries: 10
    networks:
      - test-net
    # NO ports — intentionally not exposed

  tests:
    build:
      context: .
      dockerfile: Dockerfile.test
    depends_on:
      testdb:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://test_user:test_password@testdb:5432/test_db
    volumes:
      - .:/app
    networks:
      - test-net
    # NO ports — intentionally not exposed

networks:
  test-net:
    driver: bridge
```

### 12.5 Makefile targets

Projects using Docker-based test environments should include these targets:

```makefile
.PHONY: test test-unit test-integration test-e2e test-build test-down

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

test-build:            ## Build test containers
 docker compose -f compose.test.yml build

test-down:             ## Tear down test environment
 docker compose -f compose.test.yml down -v
```

Adapt `uv` → `poetry` based on the project's lockfile (see section 4).

### 12.6 Dockerfile.test reference

The tests container image must include the application code, dependencies, pytest, and — if E2E tests exist — Playwright with browser binaries.

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

Adapt for `poetry` if the project uses `poetry.lock`.

### 12.7 Enforcement

- Integration/E2E tests running outside Docker in a webapp with `compose.test.yml` = **bug**.
- Test containers exposing ports to host = **bug**.
- Test database accessible from dev network or host = **bug**.
- Missing `compose.test.yml` in webapp project — agent must create it before running integration/E2E tests.
- `compose.test.yml` placed inside main `compose.yml` (via profiles or otherwise) = **bug** — lifecycle independence is non-negotiable.

