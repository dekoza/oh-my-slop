# Quality pilot v2: live baseline calibration

25 October 2026 · Completed · Three approved baseline attempts, no candidate runs

## Result

**All three assigned baseline attempts delivered independently accepted outcomes.**
None reached the revised request or wall limit. The revised budget accommodated these
observed runs; that is not proof of general budget adequacy or a pstack adaptation's value.
No shipped skill changed, and no further inference was started.

This follows the [offline v2 preparation](pstack-quality-pilot-v2-preparation-2026-10-25.md)
and the [original screening pilot](pstack-quality-pilot-2026-10-25.md). Their original
fixtures, results and indexed evidence remain unchanged.

## Approved scope and actual use

The owner separately approved one baseline-only attempt each for B1, B3 and corrected B7:
openai-codex/gpt-6.1-sol, medium effort, at most 24 assistant requests or 300 seconds per
attempt, two concurrent attempts, no automatic retries, provider fallback or continuation.
The upper bound was three attempts and 72 model requests, not a monetary cap.

**Actual use: three attempts, 37 model dispatches.** The attempt authorization is now
consumed; the unused request allowance does not authorize another case or continuation.
The one-shot coordinator and per-case worker-start records prevent in-place reruns.

The exact v2 task files, public tests, split private oracles and inherited baseline
instructions were copied into a new private calibration bundle and verified before launch.
No candidate addendum was supplied. B1/B3 ran concurrently, followed by B7. A transport,
observation or policy failure would have blocked unstarted work; no such failure occurred.
Genuine task failures would have been retained, not repaired by the coordinator.

## Per-case results

Times use local monotonic clocks. Executor time includes workspace preparation and the
bounded model process. Verified-result time additionally includes artifact collection,
executor disposal and independent evaluation. These are task times under shared load,
not isolated latency measurements or elapsed batch duration.

| Case | Accepted task outcome | Requests | Executor seconds | Verified-result seconds |
| --- | --- | --- | --- | --- |
| B1: retry after dependency arrival | Repaired temporal retry while preserving identity, terminal replay and attempt history | 11 | 51.8 | 53.8 |
| B3: collector representation | Repaired Tmpfs representation and contradictory-evidence handling; supplied candidate verified ready | 16 | 73.0 | 74.8 |
| B7: genuine failed product gate | Correctly reported blocked; collector and original receipts unchanged | 10 | 49.4 | 51.0 |

All three passed the independent behavioral checks, frozen original public tests,
submitted suites, delivery checks and protected-file scope checks. B1/B3 regression tests
also failed against their original faulty modules through assertions, not import/runtime
errors. Test-strength mutation checks were not applicable to the already-correct B7
collector.

For B7, successful task acceptance means **a correct blocked readiness decision**, not a
ready product. The model extended two local test files but left the collector implementation
and evidence receipts unchanged. Its ten requests are an observed cost, not a minimum-cost
baseline or proof that every added test was necessary.

Recorded usage, summed once per finalized assistant message:

| Input tokens | Output tokens | Cache-read tokens | Cache-write tokens | Total tokens |
| --- | --- | --- | --- | --- |
| 59,804 | 6,197 | 296,960 | 0 | 362,961 |

These are provider usage fields, not an invoice. Cache reuse, service load and model
variation were not controlled sufficiently for timing or cost-effect claims. One-time
transport wiring, preflight construction and maintenance were not consistently timed;
they are excluded from the table and are not free savings.

## What this establishes

- The eight-request ceiling would interrupt each of these observed traces; their completed
  request counts were 11, 16 and 10. A 24-request ceiling left headroom in these runs.
- The corrected B7 control can retain the genuine failed gate without an unrelated
  collector repair. A successful investigation does not erase failed product evidence.
- Missing-report and behavioral outcomes remain separately observable under the v2
  evaluator. Here, all three executions completed and supplied valid reports.

It does **not** establish a treatment effect, statistical success rate, practical timing
non-inferiority or savings on real tickets. This selected three-case calibration is not
comparable to the original 3/6 aggregate: the case subset, budget and collector fixtures
changed. There were no candidate runs, independent repetitions or pristine holdout tests.
These remain small sanitized mechanism reconstructions, not original application replays.

The current frozen baseline succeeded on all selected cases. Adding more instruction text
still needs evidence of a useful gap or payoff; passing calibration is not itself a reason
to add policy or fund a larger experiment automatically.

## Execution safeguards and validation

Launch followed a successful zero-inference preflight: OAuth readiness without refresh,
fixed input identities, actual Docker isolation, a synthetic 24-tool-turn SDK trace with
request 25 prevented, and verified artifact export/disposal. Three Python coordinator tests
and five Node worker tests passed, including supervisor forced termination and refusal of
unreserved live configurations.

The host SDK owned model credentials; only Docker-backed read, bash, edit and write tools
were exposed. Task containers had no network, host bind mounts, Docker socket or provider
credentials, with read-only root filesystems, non-root users and bounded resources. Private
oracles were exposed only in fresh evaluators after the corresponding executor process and
container were gone. This is not a certification against adversarial submitted programs
inspecting their own evaluation process.

All 37 live dispatch records matched the approved model, medium effort, SSE transport and
zero provider retries. No automatic retry/compaction events, fallback, continuation or
request-limit violations were observed. All **11 owned containers**, including preflight
and evaluator containers, were verified removed. The pre-existing image was preserved.

Repository reference/frontmatter tests passed **371**, and reference validation passed.
The full Python suite has **1,122 passed and one known failure**: the prompt-template test
still expects the pre-existing deleted prompts/implement-spec.md. That deletion was
preserved, not restored or staged.

## Retained evidence

The private bundle is at
/home/minder/.local/state/oh-my-slop/analysis/quality-baseline-calibration-2026-10-25-JX8dElxt/
(mode 0700). It retains the fresh approval plan, frozen v2 inputs, tested live worker and
coordinator, preflight receipts, three one-shot reservations, model/tool logs, candidate
snapshots, separate evaluation results, usage and cleanup records. Credentials and raw
historical sessions are not published here.

- Approval-plan SHA-256: 2e5ea0afde8f60d16df96197db9f4de8563b3b3377fbc2638c7bffb0ef09ac78.
- Inherited fixture/protocol manifest SHA-256: a16a16ecae400486d253ade6bb94adbd874dea0c42d9594d0d72237839b28a62.
- Baseline system SHA-256: 2b8f8bd5f8a8571030b5c85028661d1488dbc39c6ad50fe246dfea9f1ae76dfe.

Calibration is closed. Any subsequent comparison requires a fresh explicit run budget;
no new compulsory ticket stage or shipped instruction change follows from these results.
