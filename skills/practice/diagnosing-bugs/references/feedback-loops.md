# Feedback Loops — Construction Strategies

A feedback loop is a repeatable command that goes red on the bug and green once fixed. Build it first, tighten it second, debug third.

## Strategy catalogue

Ordered by preference — try top first, fall down only when blocked.

| # | Strategy | When to use | Example |
|---|---|---|---|
| 1 | Failing test | Bug is reachable through code (unit, integration, e2e) | `pytest tests/test_checkout.py::test_checkout_with_expired_card -xvs` |
| 2 | Curl / HTTP script | Bug is in an HTTP endpoint | `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/orders/` |
| 3 | CLI invocation | Bug is in a CLI tool or management command | `python manage.py my_command --input fixture.json` |
| 4 | Headless browser | Bug is in the UI (DOM, JS, HTMX swaps) | Playwright script asserting on element state |
| 5 | Replay captured trace | Bug depends on a specific request/payload | Save HAR file or request body to disk, replay through code |
| 6 | Throwaway harness | Bug is deep in the stack, hard to reach | Minimal script that calls the suspect function directly |
| 7 | Property / fuzz loop | Bug is "sometimes wrong output" | Run 1000 random inputs, assert invariant, look for failure |
| 8 | Bisection harness | Bug appeared between two known states | `git bisect run bash repro.sh` |
| 9 | Differential loop | Two versions/configs should produce same output | Run both, diff outputs |
| 10 | HITL bash script | Human interaction required | `scripts/hitl-loop.template.sh` — drives user with prompts |

## Tightening a loop

Once you have _a_ loop, make it a _good_ loop:

- **Faster** — cache setup, skip unrelated init, narrow test scope.
- **Sharper** — assert on the specific symptom, not "didn't crash".
- **More deterministic** — pin time, seed RNG, isolate filesystem, freeze network.
- **Smaller** — run only the failing subset, not the full suite. `pytest --lf`, `-k "keyword"`, or explicit file paths. Full suite is a gate, not a feedback loop.

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight.

### Multi-failure feedback loops

When 5+ failures exist, the feedback loop strategy changes:

1. **Run all failures once** and capture output — don't run incrementally.
2. **Cluster by root cause** — same exception type, same traceback module, same fixture.
3. **Run cluster subsets** between fixes — `pytest tests/payments/ tests/campaigns/ -x`.
4. **Keep the environment warm** — stay in a Docker shell, don't restart containers per invocation.
5. **Full suite after each cluster** — not after each fix, not only at the end.

See [Multi-Failure Triage](../SKILL.md#multi-failure-triage-when-5-failures-exist) for the full workflow.

## Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**:

- Loop the trigger 100× in a script.
- Parallelise across processes or threads.
- Add stress (concurrent requests, tight loops).
- Narrow timing windows (inject sleeps at suspected race points).
- Seed RNG to a failing value once found.

A 50%-flake bug is debuggable; 1% is not.

## Human-in-the-loop

When a human must click, use `scripts/hitl-loop.template.sh` to structure the interaction:

```bash
step "Open the app and click Submit"
capture ERRORED "Did it throw? (y/n)"
capture ERROR_MSG "Paste the error message:"
```

The script prints `KEY=VALUE` pairs for the agent to parse. This keeps the loop structured even when a human is in the middle of it.
