# Pstack quality pilot: no demonstrated gain

25 October 2026 · Completed development screening · No shipped skill changes

## Verdict

**Do not adopt the tested instruction additions on this evidence.** Both arms delivered
an acceptable outcome in **3/6 assigned cases**. The other three matched pairs exhausted
the eight-turn budget before producing the required report. This is inconclusive about
quality or delivery improvement, not evidence that the mechanisms cannot help.

The pilot exposed two experimental limitations worth fixing before another authorized
experiment: a turn ceiling that interrupted ordinary incremental TDD, and an imperfect
real-failure control. **No extra attempts, model continuations or provider retries were
used to repair those limitations.**

This follows the [historical analysis and benchmark design](pstack-quality-and-delivery-benchmark-2026-10-25.md).
The [20-case registry](pstack-quality-benchmark-cases-2026-10-25.json) remains a collection
of development blueprints, not a completed historical replay suite.

## What actually ran

The owner approved option A: twelve attempts, one baseline/candidate pair for each of
six cases, openai-codex/gpt-6.1-sol at medium effort, eight assistant requests or five
minutes per attempt, at most two concurrent attempts, no automatic retries or provider
fallback. This was an account-quota budget, **not a monetary cap**.

These were **small, manually reconstructed, sanitized mechanism fixtures**, not original
application snapshots or complete ticket replays. They used Python standard-library
modules and unittest. The six cases were selected before execution; three historical
mechanisms were paired with ordinary-success or genuine-failure controls. Timeout/output,
primary-requirement, settled-decision and cross-runtime cases were not exercised.

The common baseline froze the current user-wide instructions and the full critical-partner,
tdd and testing-workflow skills, with selected supporting references available locally.
Cross-skill reference dependencies were not fully replicated; no attempt consulted an
unavailable reference. It did **not** reproduce the entire installed skill catalog, automatic skill discovery, tracker
coordination, Git delivery or full review workflows. Fixture-specific authority excluded
external actions and additional reviewers. Both arms used identical task files, source,
public tests, tool declarations, model route, effort and limits.

The candidate appended exactly one bounded instruction per case:

| Cases | Addition within existing work |
| --- | --- |
| B1, B6 | For stateful adoption, test the same consumer request before/after exact dependency arrival; retain immutable identity and terminal replay semantics. |
| B3, B7 | Distinguish instrument failure from product failure; support equivalent evidence without guessing missing/contradictory evidence green or dismissing a real failed gate. |
| B16, B18 | Require an accepted-input-to-readback witness for the blocking fallback claim; reject unreachable syntax-based claims without suppressing reachable breaches. |

No new workflow stage was added. Each pair ran together; the first-listed arm alternated
between pairs. There was one attempt per arm/case, no independent replication and no
untouched final holdout. A practical timing margin was **not** agreed, so no speed
non-inferiority or adoption threshold was evaluated.

## Per-case outcomes

Times are observed executor seconds, from workspace preparation through the end of the
bounded model process. They exclude subsequent independent evaluation and one-time harness
construction. A capped duration is **not** time to an accepted result.

| Case | Baseline outcome | Candidate outcome | Requests B/C | Seconds B/C |
| --- | --- | --- | --- | --- |
| B1: retry after dependency arrival | Turn-capped; no report | Turn-capped; no report | 8 / 8 | 40.4 / 44.0 |
| B3: equivalent collector representation | Turn-capped; no report | Turn-capped; no report | 8 / 8 | 34.4 / 36.6 |
| B6: ordinary already-correct change | Accepted; source/tests unchanged | Accepted; source/tests unchanged | 5 / 5 | 21.5 / 28.3 |
| B7: real failed behavior gate | Turn-capped; no report | Turn-capped; no report | 8 / 8 | 40.9 / 42.4 |
| B16: unreachable legacy fallback | Correctly cleared; no source edits | Correctly cleared; no source edits | 6 / 5 | 31.2 / 24.8 |
| B18: reachable legacy acceptance | Correctly blocked with concrete witness | Correctly blocked with concrete witness | 5 / 7 | 23.2 / 35.2 |

“Accepted” measures an acceptable **task outcome**. Correctly identifying the B18 product
candidate as blocked is a successful audit, not permission to publish that candidate.
Both arms preserved the inspected sources in the audit pair and the existing implementation
in the ordinary-success control. No prohibited source/receipt changes were detected.

All twelve assignments remain in the denominator. There were **81 actual model dispatches**:
40 baseline and 41 candidate. Every recorded dispatch used the approved model, medium effort,
SSE transport and zero provider retries. No five-minute deadline was reached. The ninth
request was prevented in each turn-capped attempt.

Observed executor work summed to **191.6 seconds baseline / 211.3 seconds candidate**.
This is neither elapsed batch time nor complete delivery cost. Half the attempts lack an
accepted delivery and repair work was not run, so these sums cannot establish a delivery
speed gain or regression. The three completed pairs likewise do not establish latency
variance or a causal effect.

Recorded usage, summed once per finalized assistant message:

| Arm | Input tokens | Output tokens | Cache-read tokens | Total tokens |
| --- | --- | --- | --- | --- |
| Baseline | 80,988 | 5,459 | 245,888 | 332,335 |
| Candidate | 62,636 | 5,806 | 275,328 | 343,770 |

Cache-write tokens were zero. Different cache reuse and uncontrolled service latency prevent
interpreting the input-token difference as saved work or a billing reduction. These are
provider usage fields, not an invoice or a guaranteed account charge.

## What the interrupted work shows—and does not show

Both B1 attempts reproduced the temporal defect, implemented a repair and passed the first
new regression, then used turn eight to add another invariant test. Both B3 attempts fixed
the missing Tmpfs evidence shape, then used turn eight to add the next contradictory-evidence
test. An ordinary sequence of discovery, baseline check and incremental red/green cycles
consumed the ceiling before final verification and reporting. That is budget censoring,
not evidence that a model falsely claimed completion.

The frozen acceptance evaluator required the report before checking its remaining assertions.
Consequently, its original failures on these six attempts establish **missing delivery**, not
six demonstrated product defects. Those recorded outcomes were not rescored.

Separate **post-run, non-model diagnostics** inspected the retained partial artifacts using
the already-frozen behavioral assertions and submitted tests:

- B1: both partial implementations passed the behavioral assertions and submitted tests.
- B3: both failed the contradictory-evidence assertion and their newly added test; the
  second red/green cycle was unfinished.
- B7: both passed those behavioral assertions and submitted tests, but neither delivered
  the required readiness report within its assigned budget.

These diagnostics added no model attempts, fabricated reports or implementation repairs.
They describe partial artifacts; they do not turn interrupted work into accepted delivery.

### B7 was not a clean negative control

The purportedly correct collector called receipt.get unconditionally, while its contract
said an absent behavior receipt must block. Both models interpreted None as an absent
receipt, reproduced an exception and added a guard. The frozen preflight oracle had not
covered that input interpretation. Whether treated as a genuine omitted case or an
underspecified input domain, it invalidates B7 as a clean “only the product gate is red”
control. Its repair turns must not be mislabeled as needless model scope expansion.
The assigned outcomes remain visible, but B7 supports no clean treatment comparison.

## Isolation, checks and evidence integrity

Pi SDK 1.4.0 ran on the host solely as the model/credential transport. The only exposed
read, bash, edit and write implementations delegated to a separate Docker container per
attempt. No host built-in tools, extension discovery, MCP, skill discovery, custom model
configuration, automatic compaction or cache warming were enabled.

Containers used the pre-existing image with ID
sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b.
They had no network, host bind mounts, Docker socket or passed provider credentials;
root filesystems were read-only, capabilities dropped, no-new-privileges enabled, host-matched
non-root UID/GID, private process namespaces, 96-process and 1 GiB memory limits, one CPU,
and bounded temporary workspace storage. No application or private session tree was mounted.

The executor view contained only its case and the common instruction snapshot—not this
report, registry answers, other cases, prior solutions, Git objects or evaluators. After
the model process finished, a trusted exporter stopped remaining task processes, copied
regular bounded artifacts, and the original container was removed. Only then did a fresh
isolated evaluator receive the candidate and private assertions. This kept evaluator
sources out of the model executor's filesystem; it is not a certification against an
adversarial submitted program inspecting its own evaluation process.

Preflight used no model inference. It checked actual network/filesystem/credential/tool
boundaries, eight synthetic SDK turns with a prevented ninth, background-writer stoppage,
artifact export, and success/exception cleanup. Known-good controls passed; wrong decisions
were rejected in all six cases. Original B1/B3 faults passed their existing public tests
but failed the independent oracle; repaired and behavior-preserving controls passed.

An initial authentication invocation used the wrong CLI argument order and was corrected.
More importantly, Docker's archive copy returned an empty result for the temporary workspace;
the failed export preflight blocked launch. A trusted in-container exporter replaced that
collector, and the complete preflight passed before inference. Boundaries were not weakened.
The successful preflight took 24.3 seconds; initial investigation, fixture/harness construction
and maintenance were not consistently timed and are **not free savings**.

All owned containers, including diagnostic evaluators, were verified absent afterward.
The borrowed image and pre-existing user/runtime state were preserved. No shipped skill,
extension, manifest or prompt template was changed by this pilot.

## Repository validation

The private harness's three Python and four Node unit tests passed, followed by the
actual boundary/oracle preflight. Repository reference/frontmatter tests passed **371**,
and the markdown reference validator passed. The full Python suite passed **1,122** with
one known failure: the prompt-template test still expects the pre-existing deleted
prompts/implement-spec.md. That deletion was preserved, not repaired or staged here.

## Retained artifacts and next experimental boundary

The private bundle is at
/home/minder/.local/state/oh-my-slop/analysis/quality-pilot-2026-10-25-WWgNppUF/
(owner-only directory, mode 0700). It retains the exact fixtures, instruction snapshot,
frozen manifest and oracles, tested harness, failed/successful preflight receipts, per-attempt
model/tool logs, candidate snapshots, original outcomes, supplemental diagnostics and
container lifecycle receipts. Raw historical sessions and credentials are not published here.

Key frozen identities:

- Baseline repository: 5f1cfb07cc7b9b5f275361a1857663fc3c37ff6f.
- Fixture/protocol manifest SHA-256: 15f385184b7276c5b2827ed5d952ac1c7e01fa309074c687df16f55c8565248e.
- Effective baseline system SHA-256: 2b8f8bd5f8a8571030b5c85028661d1488dbc39c6ad50fe246dfea9f1ae76dfe.

A future experiment needs a repaired, explicit-domain B7 control and enough budget to finish
ordinary baseline TDD before it can discriminate quality or time-to-acceptance. Task and
report overhead should be calibrated without looking at treatment outcomes; behavioral and
delivery checks should report separately. Replication and an agreed practical timing margin
are still needed before any adoption claim. Those are experiment-design corrections, **not
new compulsory ticket stages**, and no further inference is authorized by this report.
