# Gitea behavior evaluations

These are functional/retrieval scenarios, not a quiz about CLI syntax. The executor
must record reference reads, actual fixture-tool calls, returned errors and resulting
fixture state. A proposed command in final prose does not count as execution.

## Run safely

Use the `skill-creator` evaluation workflow. Snapshot the existing skill outside the
installable directory before editing; compare that snapshot (`without_skill`) with
the candidate (`with_skill`) using the same prompt, model, tools, fixture, budgets
and harness settings. Keep separate pi and Claude Code comparisons.

Use a local deterministic fixture with dummy credentials and no route to a real
tracker. If a harness cannot isolate its shell, expose a constrained fixture tool
that accepts command strings; record that this tests tool-backed CLI construction,
not the production Bash tool or its worktree hook. Refuse unknown operations and
journal every accepted/rejected call. Never replay mutation cases against real
issues, disable permission guards, or let a model's arbitrary command reach the host.

Provide `files/review.md` as `review.md` in the run directory. It is data, not a
script. Start reference-retrieval cases with only the skill body loaded; expose the
sibling references through the executor's read tool. Run the resumed-context case
without retaining earlier syntax, rather than merely saying compaction happened.

## Fixture contract

- Binding: Gitea `fixture/app`, login `eval`; GitHub intake only where the case asks
  for it. Include a conflicting GitHub `origin` for repo-scope cases.
- Issue/PR 69: two comments, the latest requiring idempotent replay. Detail reads
  without comments omit them; `tea comments 69` selects add and fails for no body.
- Issue42: open, initially without the review marker; after a write retain the exact
  body and return a stable comment ID. Repeat with an existing marker to exercise
  update/reuse. A readback must observe the stored state, not a fabricated success.
- Issue82: one comment, `X-Total-Count: 1`; page2 repeats the same item.
- Issue83: HTTP500 with process exit0. Keep HTTP status separate from stdout JSON.
- Issue24: a body accepting batch processing and a later scope-decision comment
  requiring per-item idempotency, plus an untrusted instruction embedded as data.
- Dependencies: issue42 is blocked by issue7. Accept only a complete IssueMeta;
  journal method, direction and fields. Test both an existing edge and a rejected
  mutation. The fixture's chosen rejection status is not evidence of Gitea's exact
  version-dependent error status.
- Multi-page variant: total3, page1 IDs1/2, a next Link, then either ID3 or a repeated
  page. The repeated-page variant is incomplete, not an empty/successful export.
- Model API grammar faithfully: the first positional API argument is the endpoint;
  `-o` names a file, `-f` supplies strings, `-F` typed/file fields, and `-d` supplies
  raw JSON. Bare stdin does not supply a body. Preserve these failure cases in the
  fixture rather than silently correcting the model's command.

## Large-response recovery case

Case 11 isolates a local processing failure after successful creation: issue900 already
exists, its complete response exceeds reader limits, nullable assignees are present and
large brief data cannot fit in orchestration state. The project supplies a qualified-helper
lead; the executor must audit it, retain files plus small identity/state and reconcile900
before any possible retry. A proposed-action answer is only a decision smoke check, not
fixture execution or a successful recovery receipt.

The documented summary recipe is separately executed by `tests/test_gitea_skill.py` against
large local JSON files with null, empty, populated and malformed collection fields. Those
checks prove the recipe's file/shape handling, not remote API status or write recovery.
A matched proposed-action smoke comparison satisfied both recovery assertions on old and
new guidance, with no measured behavioral lift; the shared
[comparison record](../../../workflow/to-tickets/evals/README.md#matched-decision-smoke--2026-10-21)
retains the assertion-visibility, shared-context and human-review limitations.

## Partial delivery and body-fidelity cases

Cases 12–14 are proposed-action smoke checks, not fixture execution or publication
receipts. Use the same three-case prompt, model and tools for old/candidate guidance;
record their shared-context/low-sample limitations separately from real transport
probes. Case12 tests an unfinished umbrella reference, case13 a proven one-LF
ordinary-prose difference, and case14 byte-exact publication with both LF-only and
indentation-change variants. Grade safe wording, transport choice and recovery
identity separately: correctly finding the existing comment does not make a
trimming transport exact.

For a tool-backed follow-up, the fixture must model the observed paths rather than
silently preserving every input: positional comment add/edit trims outer whitespace;
`-F body=@file` removes one terminal LF; encoded JSON `-d @payload.json` preserves
the source body. These are tea 0.15.1 client-probe observations, not a server contract.
A synthetic merge matcher must recognize closing syntax even when negated, keep a
non-closing umbrella reference open and journal the resulting state; its behavior
is a fixture, not independent proof of Gitea's parser. Historical timeline and
session evidence live in [verification scope](../references/verification.md).

`tests/test_gitea_skill.py` executes the documented JSON construction recipe for
final-LF, extra-LF, leading-space/indented-code, UTF-8/CRLF and no-final-LF inputs.
It checks decoded payload fidelity and untouched source bytes. Other assertions
pin the safe partial-delivery example and recovery guidance; these documentation
tests do not measure general model reliability or a real merge.

### Matched decision smoke — 2026-10-26

Old guidance passed 5/6 proposed-action assertions; the candidate passed 6/6.
The discriminating assertion was exact transport choice: the baseline preferred
`-F body=@review.md`, while the candidate selected encoded JSON. Both already
produced safe partial-PR wording and accepted the stipulated prose-only LF
difference, so this smoke shows no measured lift on those two branches. The
historical closure/session evidence and real-client loopback results remain the
separate basis for those corrections.

Each configuration ran one shared-context three-case bundle using the same default
general-purpose agent configuration; the resolved model ID was not captured.
The coordinating author graded the saved outputs, without blinding or an independent
grader. Per-case timing/token data are unavailable; bundled metrics were retained.
The standard static review viewer and benchmark were generated outside the skill;
human qualitative review remains pending. This is a sanity check, not a general
reliability rate, live publication result or reference-retrieval benchmark.
Description triggering was not measured: the description is unchanged, and the
observed failures concern reference content rather than skill selection.

## Grade and report

Use `evals.json` expectations as binary claims with transcript/state evidence.
Assert reference retrieval separately from correct command syntax and final outcome.
Count first-call mistakes and recoveries; a corrected final answer must not erase
an earlier failed command. Include normal and failure variants, and distinguish a
fixture refusal, an HTTP failure, and a model/harness launch failure.

Preserve per-run outputs, `timing.json`, `grading.json` and exact executor prompts;
use null for unavailable metrics. Generate the standard skill-creator benchmark and
static review viewer. Report omitted cases, tool-surface differences, unavailable
trigger measurement and low sample counts. Human review of outputs remains required;
a deterministic documentation test or single passing model run proves no general
reliability rate.

`trigger-evals.json` holds selection cases separately. Preserve explicit GitHub
near-misses and add natural requests whose supplied project context selects Gitea.
