---
name: diagnosing-bugs
description: >
  Use when facing a bug with no obvious cause, a performance regression, or 5+ test
  failures at once. Triggers on: "diagnose", "debug this", "something broken",
  "no idea why", "flaky", "slow since", "fix multiple failing tests".
license: MIT (adapted from mattpocock/skills)
---

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

When exploring the codebase, read the project's domain glossary — `CONTEXT.md` unless the domain doc config points elsewhere — for a mental model of the modules involved, and check the ADRs covering the area you're touching, so a hypothesis doesn't contradict a decision already made.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first** — write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

**The whole skill in one breath:** build a **tight feedback loop** — one command that is *fast (seconds), deterministic, and red-capable* (goes red on this exact bug) — then minimize the repro, test hypotheses against the loop one variable at a time, fix, and convert the repro into a permanent regression test. If 5+ failures exist at once, run Multi-Failure Triage first; otherwise start at Phase 1.

## Multi-Failure Triage (when 5+ failures exist)

When multiple failures exist — broken test suites, migration fallout, dependency upgrades, non-TDD development sessions — **do not fix them one-by-one with full-suite runs between each fix.** That wastes feedback-loop time on tests you already know pass.

**Full suite is a gate, not a feedback loop.**

This procedure is tier-agnostic: it works for unit, integration, E2E, or any mix. Use the reference commands as templates — adapt to your project's tooling.

### Output capture rule

**`| tee [filename]` is the ONLY allowed method for capturing test output** — `tail`, `head`, and bare `>`/`>>` are forbidden (rationale and canonical rule: `testing-workflow` skill). Triage-specific consequence: **after running with `| tee`, read or `grep` the log file — never re-run the same pytest command just to inspect output.** The file already has everything; re-running wastes a full-suite cycle.

### Timeout guidelines

Set **both** timeout layers explicitly on every triage run — outer (harness budget) and inner (`--timeout` per test), outer > inner. The tier-by-tier floors live in the `testing-workflow` skill's timeout doctrine; for triage the floors that matter most are `--timeout 600` for E2E and an outer budget of 1 hour — a run killed by a default 60s timeout reports on the runner, not the tests, and corrupts your failure map.

---

### Step 0 — CALIBRATE (run once, before triage)

**Goal:** Ensure your failure map is trustworthy. Don't triage on corrupted data.

**Skip 0a and 0b if all of the following are true:**
- You just ran the full suite and the failure set matches what you expect.
- No recent changes to fixtures, models, or shared code.
- The failures span multiple unrelated modules (unlikely to be xdist contamination).

Skipping is safe because xdist contamination and flakes both produce **inconsistent** failure sets — if your set is stable across runs, the calibration step adds no value.

**0a. Verify parallel stability (if you suspect xdist issues).**

```
# Serial baseline
pytest tests/<tier>/ -n 1 --timeout 600 --tb=line -q | tee /tmp/serial_failures.log

# Parallel run
pytest tests/<tier>/ -n auto --dist loadgroup --timeout 600 --tb=line -q | tee /tmp/parallel_failures.log
```

Compare failure sets. If they differ → **xdist contamination detected.** Tests that fail under parallelism but pass serially are likely sharing state. Add `xdist_group` markers to force them onto the same worker, then re-calibrate. **Do not proceed to triage until serial and parallel failure sets match.**

**0b. Quarantine flakes.**

```
pytest tests/<tier>/ --timeout 600 --count=3 -q
```

Tests that fail inconsistently are **flakes, not bugs**. Quarantine them (`xfail`, skip, or fix separately). They inflate the failure count and corrupt your cascade map. A 50%-flake test masquerades as a real failure half the time.

**0c. Split by tier (if multiple tiers are failing).**

If failures span unit, integration, and E2E — **fix the fastest tier first.**

- **Unit tests** → run on host, feedback in seconds. Fix these first — fastest ROI.
- **Integration tests** → run in Docker, feedback in tens of seconds. Keep the container warm.
- **E2E tests** → run in Docker with browser, slowest. Fix last.

Fixing unit tests often collapses the E2E failure count dramatically. Don't touch E2E until faster tiers are green.

---

### Step 1 — MAP (one full run, serialized)

**Goal:** Build a reliable failure map. One expensive run, done right.

Run the full failing tier with serialized output:

```
# With xdist (recommended)
pytest tests/<tier>/ -n auto --dist loadgroup --timeout 600 --json-report -q | tee /tmp/failures_round_0.log

# Without xdist
pytest tests/<tier>/ --timeout 600 --json-report -q | tee /tmp/failures_round_0.log
```

**Save the output as `failures_round_0.json`.** You'll diff against this file in later rounds.

Read every traceback. Group failures by **root cause**, not by file:

| Grouping signal | Likely root cause |
|----------------|-------------------|
| Same exception type across files | Shared import, fixture, or model change |
| Same module in traceback | Broken signal handler, service, or utility |
| `AttributeError` / `ImportError` cluster | Renamed/moved function or missing migration |
| `AssertionError` with same expected value | Changed behavior or hardcoded expectation |
| Client sees wrong UI but server logs show success | Client-side state not updated, or HTMX/server-swap overwrote injected content |
| Async message ordering (client sends X, server processes Y first) | Race condition in queue/sync logic |
| Test passes serially but fails parallel, or vice versa | Timing dependency masked by execution order |

**Expect 38 failures → ~8-12 actual problems.** One fix cascades through its cluster.

### Quick relevance check (before deep triage)

Before triaging all failures, determine which are **caused by your changes**
vs **pre-existing**. This prevents wasting effort on unrelated bugs.

**Method: `git stash` + targeted re-run.**

```
# Run only the failures most likely related to your changes
# (same module, same consumer, same template family)
git stash
pytest tests/<related_tier>/ -k "test_a or test_b" -n 1 --timeout 300 -q | tee /tmp/before.log
git stash pop
pytest tests/<related_tier>/ -k "test_a or test_b" -n 1 --timeout 300 -q | tee /tmp/after.log
diff /tmp/before.log /tmp/after.log
```

- **Same fail before and after** → pre-existing. Skip for this wave.
- **Passed before, fails after** → regression. High priority.
- **Failed before, passes now** → your fix already worked (maybe from an
  earlier commit in this session).

Do this for the **smallest plausible set** of failures — don't run the full
suite just to check relevance. A 3-test targeted run takes 2 minutes; a full
E2E run takes 5+.

**Why this matters:** In a session with 24 failures, 20 may be pre-existing.
Spending 20 minutes investigating pre-existing bugs instead of fixing the 4
you actually caused is a 5:1 waste ratio.

---

### Step 2 — HYPOTHESIZE (categorize + rank)

**Goal:** Identify which fixes will cascade the furthest. This is hypothesis formation — you're guessing at root causes. The procedure's job is to make each guess cheap to test.

**2a. Group failures.**

Primary grouping: **module** (file/directory). Secondary grouping: **error signature** (same exception type + same root traceback frame).

**2b. Rank groups by failure count descending.**

The group with the most failures has the highest coupling — fixing its root cause resolves the most downstream tests.

**2c. Pick the "offender candidate" per group.**

Within each ranked group, identify the test whose setup/fixture/code path appears in the most other failures' tracebacks. Heuristics, in order:

1. **Shared fixture:** Which fixture is referenced across the most failing tests?
2. **Shared error frame:** Which traceback frame (file:line) appears most often?
3. **Shared module import:** Which module is imported by the most failing tests and could be the source?
4. **Frequency fallback:** If unclear, pick the test with the most common error signature.

**2d. Produce an ordered list.**

```
Wave N offenders: [offender_1 (module A, 12 failures), offender_2 (module B, 8 failures), ...]
```

---

### Step 3 — FIX WAVE

**Goal:** Fix all offender candidates in one batch.

Fix each offender. For each fix:

- Write a regression test (TDD catch-up). This is mandatory — the fix is incomplete without it.
- One commit per offender (or one commit per module if offenders are related).
- **Do not fix scattered non-offenders.** Resist the urge to "knock out easy ones" — they're hardest to cluster and you'll dig rabbit holes.

**After all offenders are fixed:** commit the wave.

**Pattern fixes span multiple files.** If the root cause is a shared pattern
(e.g., the same callback in N templates, the same import in M modules), fix
all instances in one commit. One commit per *pattern*, not per file. The
pattern is the offender; the files are just locations.

**Commit strategy for cross-layer fixes.** When a single logical fix touches
files across multiple layers (backend → message bus → JavaScript → templates),
use **one commit** for the entire fix, not one commit per file.

Reason: splitting across commits creates intermediate states where half the
fix is deployed. The backend sends a message that no template handles. The
template has a handler that no backend produces. These intermediate states
are broken and confusing in git history.

Commit message format:
```
fix(scope): describe the logical fix

Files changed:
- apps/x/consumer.py (add handler)
- static/js/y.js (fix callback ordering)
- templates/z.html (add toast, skip HTMX for temp)
- tests/e2e/test_*.py (fix expectation)

Root cause: one sentence explaining why the fix works.
```

**Exception:** If the fix touches entirely unrelated modules
(e.g., fixing a payment bug AND a warehouse bug in the same session),
use separate commits.

**Feature parity audit.** When you fix a bug or add a feature in one
module/template/consumer, check if similar ones have the same fix.

```
# Find all files that implement the same handler/callback pattern
grep -rl "<handler_name>" templates/ static/ apps/
# Find all files that handle the same message type
grep -rl "<message_type>" apps/ static/
```

For each match:
- Does it have the same handler/callback/method?
- Does it handle the same message types?
- Does it have the same error handling?

If a similar file is **missing** a handler that exists in the fixed file,
it's likely a feature gap — not a bug yet, but it will become one when
someone uses that code path. Fix it in the same commit.

---

### Step 4 — VERIFY WAVE (targeted run)

**Goal:** Confirm each fix in isolation before checking cascades.

Run **only** the fixed offenders' tests:

```
# With xdist
pytest tests/<tier>/ -k "test_a or test_b or test_c" -n auto --dist loadgroup --timeout 600 -x

# Without xdist
pytest tests/<tier>/ -k "test_a or test_b or test_c" --timeout 600 -x
```

**Critical:** always use `--dist loadgroup` with xdist. Without it, grouped tests land on different workers and shared-state tests explode.

- If any offender fails → fix immediately, re-verify. Do not proceed to step 5.
- If all offenders pass → proceed to step 5.

---

### Step 5 — CASCADE CHECK (diff-based)

**Goal:** See what turned green from the wave, detect regressions, and plan the next wave.

Run all previously-failing tests:

```
# --lf uses .pytest_cache to replay last-failing tests
pytest tests/<tier>/ --lf -n auto --dist loadgroup --timeout 600 --json-report -q | tee /tmp/failures_round_N.log
```

**Save as `failures_round_N.json`.** Diff against the previous round:

| Status | Action |
|--------|--------|
| **Newly green** | Log cascade count per fix. This is architectural data — high cascade = high coupling. |
| **Still red** | Keep for next wave. |
| **Newly red** | **REGRESSION.** Fix immediately. Do not proceed to step 6 until regressions are resolved. |

**If regressions found:** fix → re-run step 4 for the affected module → re-run step 5 until clean.

**Operational note:** `.pytest_cache` must persist across Docker runs for `--lf` to work. Mount it as a volume:

```yaml
volumes:
  - ./.pytest_cache:/app/.pytest_cache
```

---

### Step 6 — CONVERGENCE CHECK

**Goal:** Decide whether to continue batching or switch to precision work.

Count remaining failures:

- **≤ 5 remaining:** Switch to the standard single-bug workflow (Phase 1-5 below). Batch overhead isn't worth it for isolated bugs. Use `pytest -x` and fix one at a time.
- **> 5 remaining:** Go back to **Step 2** with the remaining failures. Repeat the wave cycle.

---

### Step 7 — FULL REGRESSION GATE

**Goal:** Confirm nothing broke outside the failing tier.

Run the **entire** test suite (all tiers):

```
pytest tests/ -n auto --dist loadgroup --timeout 600
```

- **All green:** Done. Commit.
- **Any red:** These are new issues, not part of the original triage. Diagnose each as a separate bug using the single-bug workflow.

**After the fires are out:** if the triage revealed E2E-only assertions that lower tiers could carry (the usual reason triage was this slow), schedule the `restore-test-pyramid` skill — see the tier-strategy section of `testing-workflow`.

---

### Anti-patterns

| Anti-pattern | Why it fails |
|-------------|-------------|
| Fix one failure, run full suite, repeat | Wastes time per iteration on known-passing tests |
| "Knock out scattered ones for momentum" | Scattered failures are hardest to cluster — you'll dig rabbit holes when a shared fixture is the real culprit |
| Skip full-suite checks until the very end | Silent regressions accumulate. If cluster A's fix breaks cluster B's passing tests, you won't know until hours later |
| Assume N failures = N fixes | Clusters collapse the count. Diagnose first, count later |
| Start triage without calibrating xdist | Parallelism-induced failures look like real bugs. You'll chase ghosts. |
| Forget `--dist loadgroup` with xdist | Grouped tests land on different workers → nondeterministic failures → debugging the wrong problem |
| Not persisting `.pytest_cache` in Docker | `--lf` resets every run → every "targeted" run becomes a full collection → time savings vanish |
| Using `tail`, `head`, or bare `>`/`>>` on test output | Destroys insight → user cannot kill a bad run early, must wait for it to end just to confirm what they suspected. `| tee` is the ONLY allowed method. |
| Assuming server logs tell the whole story | Client-side bugs (JS errors, DOM mutations, WebSocket frame ordering) are invisible in server logs. If the server says "success" but the UI is wrong, the bug is between the server response and the rendered DOM. |

### When to fall through to single-bug workflow

Once triage reduces failures to ≤5, switch to the standard single-bug workflow (Phase 1-5 below). The multi-failure approach is for the initial blast radius; the single-bug loop is for precision work.

---

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug — one that goes red on _this_ bug — you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one — try them in roughly this order

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) — drives the UI, asserts on DOM/console/network.
4.5. **WebSocket frame capture.** If the bug involves real-time communication
    (WebSockets, SSE, channel layers), capture the actual frames:
    - Playwright: `page.on("websocket", ws => ws.on("framesent", ...))`
    - Chrome DevTools: Network tab → WS → copy as HAR
    This is how you prove the server sent one message type but the client
    received (or ignored) a different one. Without this, you're guessing
    at message ordering.
4.6. **Browser console capture.** Add temporary `console.log` to JavaScript,
    capture via Playwright: `page.on("console", msg => logs.append(msg.text))`.
    This is the JS equivalent of server logging — and just as necessary when
    the bug lives in the browser.
4.7. **DOM state inspection.** Use `page.evaluate(() => document.querySelector(...).innerHTML)`
    or `page.query_selector()` to check what's actually in the DOM at the
    failure point. If an element "should" be visible but isn't, this tells you
    whether it was never rendered, was removed by another script, or is hidden
    via CSS.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **HITL bash script.** Last resort. If a human must click, drive _them_ with `scripts/hitl-loop.template.sh` so the loop is still structured. Captured output feeds back to you.

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight — a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

### Completion criterion — a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command** — a script path, a test invocation, a curl — that you have **already run at least once** (paste the invocation and its output), and that is:

- [ ] **Red-capable** — it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring" — it must be able to _catch this specific bug_.
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — you can run it unattended; a human in the loop only via `scripts/hitl-loop.template.sh`.

If you catch yourself reading code to build a theory before this command exists, **stop — jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

### Client-side async flow bugs (HTMX + WebSockets + JS callbacks)

When the server says "success" but the UI is wrong, the bug is almost
always in one of these patterns:

**Pattern A: Callback fires before modal/render completes.**
- Symptom: Element should be visible but isn't. Server logs show success.
- Cause: A callback (HTMX `afterSwap`, JS event handler, WebSocket
  `onmessage`) triggers a DOM mutation that overwrites content just
  injected by another callback.
- Fix: Check callback ordering. Does X fire before Y completes? Add a
  guard: "only call the success handler after confirming the modal is
  still visible."

**Pattern B: Missing handler for a message type the server sends.**
- Symptom: Server sends a confirmation message but nothing happens in UI.
  No error. Silent failure.
- Cause: The client's message dispatcher has no handler for this type.
  Check: `handlers[data.type]` returns undefined.
- Fix: Add the missing handler. Often the same handler exists in a
  similar page — copy it.

**Pattern C: HTMX swap overwrites injected content.**
- Symptom: Modal appears, then disappears. Toast appears, then vanishes.
- Cause: An HTMX `afterSwap` or callback triggers `htmx.ajax(...)` which
  replaces the target element's innerHTML, erasing your injected content.
- Fix: Skip the HTMX swap when you've just injected modal/content. Use
  a guard flag like `if (!data.is_temporary_creation)` or similar.

**Pattern D: WebSocket message arrives but client is offline.**
- Symptom: Server sends a success message but UI doesn't update until next
  user action. Or: offline queue replays old state.
- Cause: Client was offline when the message arrived; it's now online but
  the message was consumed by the queue, not the UI handler.
- Fix: Check an `offline` flag in the response. Handle queued messages
  differently from real-time messages.

When debugging a UI bug with server-side success, **check these four
patterns in order**. They account for ~80% of "server says OK but UI is
wrong" bugs in HTMX + WebSocket apps.

### E2E debugging checklist (Playwright)

When E2E tests fail mysteriously, check in order:

1. **Duplicate IDs** — Playwright strict mode fails on `locator("#id")` resolving to 2+ elements. Search rendered HTML for `id="..."`.
2. **CSP violations** — Capture console: `page.on("console", lambda m: msgs.append(...))`; filter for "Content Security Policy". Inline styles/scripts blocked if `'unsafe-inline'` missing or hashes present.
3. **Silent JS failure** — Empty console = script blocked (CSP) or syntax error before execution. Dump `page.content()` and verify `<script>` tags present.
4. **Template vars in static JS** — `{{ var|safe }}` in `.js` files renders as literal `{{ var|safe }}`. Use inline `<script>` config or data attributes.
5. **JSON serialization** — Python lists render as `[\'item\']` (single quotes) in Django templates. Use `json.dumps()` in view context.
6. **CSRF origin check** — `Origin checking failed - null does not match`. Ensure test settings remove CSRF middleware AND add `127.0.0.1` to `CSRF_TRUSTED_ORIGINS`.
7. **Pytest settings module** — `pyproject.toml` `DJANGO_SETTINGS_MODULE` must be `config.settings_test`, not `config.settings`.

Save rendered HTML on failure: `page.content()` to file for offline inspection.

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red — the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.
- [ ] **Test environment is what you think it is.** If the bug involves
  settings, feature flags, or runtime mode, verify them at the point of
  failure. Lazy-loaded settings can cache values before fixtures override
  them. A test that "should" run in one mode but actually runs in another
  will produce wrong navigation items, wrong URLs, and confusing failures.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut — keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing** — removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3 — Hypothesise

With a tight, minimised, red loop — now you can form hypotheses.

For each hypothesis:

1. **State it plainly.** "I think X causes Y because Z."
2. **Design an experiment** that distinguishes this hypothesis from the most likely alternative.
3. **Run the experiment** — modify the loop, add instrumentation, change one variable.
4. **Record the result** — hypothesis confirmed, refuted, or inconclusive.

If the experiment is inconclusive, tighten the loop further (Phase 1) before forming new hypotheses.

**Escalation rule:** after ~3 refuted hypotheses, stop generating new ones. Write up what has been ruled out (each hypothesis + the experiment that killed it) and present it to the user — the ruled-out list is real progress, and the user often holds the missing fact. Continuing to guess past this point is rabbit-holing.

### Completion criterion

Phase 3 is done when you have **one confirmed hypothesis** — an experiment that rules out the most likely alternative. Not "I think it's probably X" — "I changed X and the bug went away; I changed X back and the bug returned."

## Phase 4 — Instrument (skip only if Phase 3 already confirmed with concrete data)

If the hypothesis is about internal state (data flow, timing, caching), add instrumentation to make the invisible visible.

- **Server logs** — targeted, not blanket. Log the specific variable or
  transition you're testing.
- **Asserts** — insert temporary assertions at the suspected boundary.
- **Profilers** — if the bug is performance-related, use the right tool
  (cProfile, py-spy, Django debug toolbar).
- **Traces** — if the bug crosses service boundaries, use distributed tracing.
- **WebSocket frame capture** — for real-time communication bugs, capture
  actual frames sent/received. Playwright: `page.on("websocket")`. Without
  this you can't distinguish "server didn't send" from "client didn't
  receive" from "client received but ignored".
- **Browser console capture** — add `console.log` to JS, capture via
  `page.on("console", ...)`. The JS equivalent of server logging.
- **DOM state snapshots** — `page.evaluate(() => el.innerHTML)` at the
  failure point. Tells you whether an element was never rendered, was
  removed by another script, or is CSS-hidden.

Keep instrumentation temporary. Remove it after the hypothesis is confirmed.

### Completion criterion

Phase 4 is done when instrumentation has **confirmed the hypothesis** with concrete data. Not "the logs look suspicious" — "the log shows variable X is None at line Y, which matches the hypothesis."

## Phase 5 — Fix + regression test

Apply the fix. Run the feedback loop — it should go green.

**Recovery paths when it doesn't go to plan:**

- **Loop stays red** → the hypothesis was wrong or incomplete. Back to Phase 3; the failed fix is itself an experiment result — record what it rules out.
- **Loop goes green but other tests break** → the hypothesis was incomplete: the "fix" changed behavior beyond the bug. Back to Phase 2 with the new failure folded into the repro — do not patch the newly-broken tests to match.

Then:

- [ ] **Regression test.** Convert the minimised repro into a permanent test. This is the most important output of the debugging process.
- [ ] **Run the full suite.** Ensure the fix doesn't break anything else.
- [ ] **Remove temporary instrumentation.** Clean up logs, asserts, and debug code.
- [ ] **Document the root cause.** If the bug was non-obvious, add a comment at the fix site explaining the root cause and the fix. Not "fixed bug" — "X was None because Y; added guard at Z."

### Completion criterion

Phase 5 is done when:

- The feedback loop goes green on the fix.
- A regression test exists and passes.
- The full test suite passes.
- Temporary instrumentation is removed.
- The root cause is documented.

### Before applying the fix, verify the test expectation is correct

A failing test doesn't always mean the code is wrong. Sometimes the test
has incorrect expectations. Check:

1. **Does another test assert the same thing differently?**
   - If `test_page_X` expects a toast in container A and `test_page_Y`
     expects it in container B, one of them has the wrong selector.
     Check which matches the template's actual structure.

2. **Does the element the test checks exist and have the right purpose?**
   - If the test asserts content on an element that is actually an HTMX
     target (not a toast container), the test has the wrong selector.

3. **Did the test pass in a commit before the bug was introduced?**
   - `git log --oneline -p -- tests/e2e/test_xxx.py` — if the test was
     added in the same commit as the feature, its expectations were
     written alongside untested code. Trust the implementation pattern
     from related tests over the new test's assertions.

If the test expectation is wrong, **fix the test, not the code**. A test
with wrong expectations is a bug in the test, not in the application.

## Reference

See [Feedback Loops](references/feedback-loops.md) for the full catalogue of feedback-loop construction strategies.
