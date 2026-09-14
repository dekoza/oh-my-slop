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
