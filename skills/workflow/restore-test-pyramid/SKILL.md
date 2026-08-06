---
name: restore-test-pyramid
description: Analyze the project's E2E suite and push every assertion that doesn't need a real browser down to a faster integration or unit test, proving each migration honest before thinning E2E.
disable-model-invocation: true
license: MIT
---

# Restore Test Pyramid

A ritual for a suite whose E2E tier has accumulated assertions lower tiers could carry — the
usual reason "small ticket, hour-long test run" happens. Typically scheduled after a triage
session (`diagnosing-bugs`) or flagged from the tier-strategy section of `testing-workflow`.
Load `testing-workflow` first: it owns the tier table, run commands, output capture, and
timeout doctrine this ritual runs under.

## Critical rules

1. **Classify assertions, not tests.** One E2E test usually bundles browser-bound checks with
   server-shape and pure-logic checks; the unit of migration is the assertion, and one test
   may split across all three tiers.
2. **The fidelity gate is the only exit from E2E.** Thin or delete an E2E assertion only
   after its lower-tier replacement has gone red under the same mutation the E2E assertion
   would have caught — never before.
3. **Push each assertion to the lowest tier that can honestly verify it — and no lower.** A
   mock-heavy unit test that stays green while the behavior is broken is worse than the slow
   E2E assertion it replaced (the crap-tests trap in `tdd`).

## The ritual

### 1. Inventory

Record the current E2E wall-clock time from the latest full-run log (or one fresh run) — this
is the before number for the final report. Then read every E2E test file and classify each
assertion by what it actually needs:

| The assertion verifies | Destination |
|---|---|
| Real browser behavior: JS execution, HTMX swaps, CSP, focus, navigation | stays E2E |
| Server-response shape, DB state, template context | integration |
| Pure logic | unit |

Capture the result as a working table — flow → test → assertion → destination — in a scratch
file. Show it to the user before changing any files: it is the migration's scope, and the
user may veto rows.

### 2. Rewrite, flow by flow

Work one user flow at a time, keeping the full suite green between flows. Rewrite each
pushed-down assertion natively at its destination tier — a test-client request or ORM check
for integration, a plain function call for unit. Never port the Playwright choreography down
with it; the lower tier reaches the same state by its own means or the assertion doesn't
belong there.

### 3. Fidelity gate

For each migrated assertion:

1. Introduce the defect the original E2E assertion guarded against — break the behavior
   deliberately in the application code.
2. Run the new lower-tier test: it must go **red**.
3. Revert the defect: it must go **green** again.

A replacement that stays green under the mutation is a lying test — rewrite it with fewer
mocks, or concede the assertion is browser-bound and leave it at E2E.

### 4. Thin E2E

With replacements gated, cut each E2E file down to **one happy-path smoke per user flow**
plus the assertions classified browser-bound in step 1. Delete the migrated assertions and
any E2E tests left empty by the migration.

### 5. xdist pass

Make what remains parallel-safe: check state isolation across the surviving E2E tests and
the new lower-tier tests, add `xdist_group` markers where shared state is load-bearing, and
run with `--dist loadgroup` (calibration procedure in `diagnosing-bugs`). Serial and parallel
runs must produce identical results before the ritual ends.

## Done when

- Every E2E file holds one happy-path smoke per flow plus genuinely browser-bound assertions.
- Every migrated assertion has passed the fidelity gate.
- Full suite green; parallel failure set matches serial.
- Report delivered to the user: assertions migrated per tier, assertions kept at E2E and why,
  E2E wall-clock before → after.

## Related skills

- `testing-workflow` — tier table, run commands, timeout doctrine, E2E policy.
- `tdd` — what an honest test looks like; the crap-tests trap this ritual must not recreate.
- `diagnosing-bugs` — xdist calibration and the triage session that usually motivates this ritual.
