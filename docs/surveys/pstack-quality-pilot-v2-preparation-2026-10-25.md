# Quality pilot v2: offline corrections prepared

25 October 2026 · Offline validation complete · Live calibration not run

## Scope and authorization

The owner authorized correcting the experiment after the
[first screening pilot](pstack-quality-pilot-2026-10-25.md), with **zero model replay
calls and no shipped skill changes**. This preparation used deterministic controls and
scripted SDK responses only. The original fixtures, oracles, outcomes and evidence bundle
were preserved; none of its accepted/incomplete results were rescored.

This is a new development-fixture version, not an untouched holdout or evidence of better
model performance. The inherited baseline instruction snapshot remains unchanged.

## Corrections

### A clean real-failure control

B7 now explicitly allows a receipt to be None or a JSON object. None, an empty object,
a missing behavior key, or any value other than the exact string pass must return
behavior_failed without an exception. Storage evidence cannot override a failed receipt.
The inspected storage input domain is also explicit, including null Tmpfs information.

The initial B7 collector now implements that contract. Its public tests cover absent
receipts, equivalent storage representations and conflicting evidence, so the supplied
failed product receipt—not an undisclosed collector defect—is the intended blocker.
Reintroducing the missing None guard is caught by both the independent behavioral checks
and the public tests, despite an otherwise plausible blocked report.

The same receipt-domain clarification and guard were applied to B3 to avoid preserving
that accidental extra bug in the representation experiment. B3 still starts with its
intended representation defect. B1, B6, B16 and B18 task/source/test fixtures remain
byte-identical to v1.

### Independent behavior and delivery results

The evaluator now records separate outcomes for:

- behavioral conformance, including failures and runtime errors;
- original frozen public tests and the submitted test suite;
- applicable regression-test sensitivity to the original defect;
- report presence, validity and task-specific decision correctness;
- execution completion and protected-file scope.

A missing or malformed report cannot skip the behavioral or test-strength checks.
It still prevents accepted delivery. Likewise, a convincing report cannot override a
failed behavioral requirement, red submitted suite or interrupted execution. Regression
sensitivity is assessed only after the submitted suite is green; an always-red or
insensitive suite is not rewarded.

Acceptance remains task-aware: B7's correct outcome is a blocked readiness report with a
conforming collector. B18 deliberately contains a product contract breach; detecting that
breach and delivering the required blocking witness is a successful read-only audit.
Neither result grants permission to publish the product candidate.

### A proposed—not authorized—execution budget

| Limit | Proposed value |
| --- | --- |
| Model / effort | openai-codex/gpt-6.1-sol / medium |
| Primary wall limit | 300 seconds per attempt |
| Assistant-request safety ceiling | 24, replacing 8 |
| Concurrent attempts | At most 2 |
| Automatic retries / provider fallback | None |
| Currently authorized replay attempts / requests | **0 / 0** |

A request means one assistant provider dispatch, including a tool-use response. The
larger ceiling is headroom for normal incremental work, not an extra workflow stage or
permission to consume more quota. Future attempt count and practical timing margin remain
unset. This preparation does **not** renew the previous twelve-attempt authorization.

## Offline validation

- **10 Python unit tests** and **6 Node unit tests** passed.
- **22 real-container controls** checked known-good outcomes, wrong decisions, missing and
  invalid reports, original behavioral faults, behavior-preserving changes, the B7
  absent-receipt mutation and insensitive regression tests.
- A scripted two-cycle TDD trace used real sandbox tools and verified the actual red/green
  receipts. The eight-request ceiling interrupted it before reporting. Under the proposed
  ceiling, it completed in **14 synthetic requests**, passed independent checks and delivered
  its report. This is a mechanical trace, **not real-model calibration**.
- Request 25 was prevented by the 24-request gate. Expired deadlines, route changes,
  retry changes and invalid limits failed closed.
- An intentionally stalled synthetic SDK process that ignored termination was forcibly
  killed by the outer supervisor in approximately **1.2 seconds** using a shortened test
  deadline. This checks cancellation mechanics, not real five-minute provider behavior.
- All **26 owned containers** were verified removed; the pre-existing image was preserved.

The SDK runner requires an explicit synthetic delegate. Native generation and the runtime's
getAuth/checkAuth paths are disabled; the SDK's local authentication preflight is simulated,
not satisfied with real credentials. Its logs distinguish synthetic dispatches from model
requests. There is **no live replay launcher**, and the old approval flag cannot enable one.
No model inference, real-provider authentication validation or live calibration ran.

The existing isolation boundary remains: container-only tools, no task network or host
bind mounts, no provider credentials in the workspace, separate private oracles and
fresh evaluator containers. This does not certify resistance to adversarial submitted
code inspecting its own evaluation process.

## Repository validation

The reference validator and **371** targeted reference/frontmatter tests passed. The full
Python suite has **1,122 passed, one known failure**: a prompt-template test expects the
pre-existing deleted prompts/implement-spec.md. That deletion was left untouched.
No extension, package manifest or shipped skill changed.

## Artifacts and remaining boundary

The new private bundle is at
/home/minder/.local/state/oh-my-slop/analysis/quality-pilot-v2-offline-2026-10-25-QpDJehw4/
(mode 0700). It contains the versioned fixtures, split oracles, inherited instructions,
proposed protocol, offline-only harness, controls, test logs, synthetic traces and cleanup
receipts. The frozen fixture/protocol manifest SHA-256 is
a16a16ecae400486d253ade6bb94adbd874dea0c42d9594d0d72237839b28a62.

The original indexed v1 artifacts were checked against their integrity record before
preparation. They remain the source of truth for the first pilot, not inputs to a
retrospectively improved score.

The corrections are ready for review, **not for unattended live execution**. A subsequent
calibration needs a fresh explicit model/run budget, live transport wiring and preflight.
Only actual calibration can establish whether the proposed ceiling and wall budget fit
ordinary baseline work. Replication and an agreed timing margin remain necessary before
an adoption claim. No new compulsory ticket stage or shipped instruction change follows
from these offline checks.
