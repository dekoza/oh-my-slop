---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs, performance regressions, and multi-failure scenarios. Use when the user says "diagnose", "debug this", reports something broken/throwing/failing/slow, or needs to fix multiple failing tests simultaneously.
license: MIT (adapted from mattpocock/skills)
---

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

## Multi-Failure Triage (when 5+ failures exist)

When multiple failures exist — broken test suites, migration fallout, dependency upgrades — **do not fix them one-by-one with full-suite runs between each fix.** That wastes feedback-loop time on tests you already know pass.

**Full suite is a gate, not a feedback loop.**

### Step 1 — Read all tracebacks before touching code

Run the failing set once and capture output. Read every traceback. Group failures by **root cause**, not by file:

| Grouping signal | Likely root cause |
|----------------|-------------------|
| Same exception type across files | Shared import, fixture, or model change |
| Same module in traceback | Broken signal handler, service, or utility |
| `AttributeError` / `ImportError` cluster | Renamed/moved function or missing migration |
| `AssertionError` with same expected value | Changed behavior or hardcoded expectation |

**Expect 38 failures → ~8-12 actual problems.** One fix cascades through its cluster.

### Step 2 — Quarantine flakes

Before writing a single fix, raise the reproduction rate:

```
pytest tests/failing_set/ --count=3 -q
```

Tests that fail inconsistently are **flakes, not bugs**. Quarantine them (`xfail`, skip, or fix separately). They inflate the failure count and distract from real problems. A 50%-flake test masquerades as a real failure half the time.

### Step 3 — Split test tiers

If the project has tiered test environments (unit on host, integration in Docker), **split the failures by tier**:

- **Unit tests** → run on host, feedback in seconds. Fix these first — fastest ROI.
- **Integration tests** → run in Docker, feedback in tens of seconds. Keep the container warm.
- **E2E tests** → run in Docker with browser, slowest. Fix last.

This alone can cut average feedback from 65s to 3s for half the failures.

### Step 4 — Fix clusters, largest first

Inside a warm test environment (e.g., `docker compose run tests bash` → stay in shell):

```
# Tight loop inside warm container
pytest tests/payments/ tests/campaigns/ -x --tb=short    # cluster run
pytest --lf -k "refund"                                  # last-failed, keyword filter
```

Fix the largest cluster first. One shared root cause resolving 6 failures is worth 6× a scattered fix. **Never run more tests than the minimum needed to prove the fix.**

### Step 5 — Full suite after each cluster, not each fix

- Fix a cluster → run targeted tests for that cluster → commit.
- After each cluster resolves → run **full suite once** as a gate → commit.
- This gives you ~4-6 full runs total, not 38.

### What NOT to do

| Anti-pattern | Why it fails |
|-------------|-------------|
| Fix one failure, run full suite, repeat | Wastes 50-60s per iteration on known-passing tests |
| "Knock out scattered ones for momentum" | Scattered failures are hardest to cluster — you'll dig 19 rabbit holes when a shared fixture is the real culprit |
| Skip full-suite checks until the very end | Silent regressions accumulate. If cluster A's fix breaks cluster B's passing tests, you won't know until hours of work later |
| Assume 38 failures = 38 fixes | Clusters collapse the count. Diagnose first, count later |

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

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red — the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

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

### Completion criterion

Phase 3 is done when you have **one confirmed hypothesis** — an experiment that rules out the most likely alternative. Not "I think it's probably X" — "I changed X and the bug went away; I changed X back and the bug returned."

## Phase 4 — Instrument (optional)

If the hypothesis is about internal state (data flow, timing, caching), add instrumentation to make the invisible visible.

- **Logs** — targeted, not blanket. Log the specific variable or transition you're testing.
- **Asserts** — insert temporary assertions at the suspected boundary.
- **Profilers** — if the bug is performance-related, use the right tool (cProfile, py-spy, Django debug toolbar).
- **Traces** — if the bug crosses service boundaries, use distributed tracing.

Keep instrumentation temporary. Remove it after the hypothesis is confirmed.

### Completion criterion

Phase 4 is done when instrumentation has **confirmed the hypothesis** with concrete data. Not "the logs look suspicious" — "the log shows variable X is None at line Y, which matches the hypothesis."

## Phase 5 — Fix + regression test

Apply the fix. Run the feedback loop — it should go green.

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

## Reference

See [Feedback Loops](references/feedback-loops.md) for the full catalogue of feedback-loop construction strategies.
