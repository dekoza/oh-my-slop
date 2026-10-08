# Grilling evaluation

## Decision handoffs ask through grilling — #265

This is the shared record for #265. It covers the method and every result. The READMEs of
[fix-pr](../../fix-pr/evals/README.md), [implement](../../implement/evals/README.md),
[implement-spec](../../implement-spec/evals/README.md),
[to-spec](../../to-spec/evals/README.md) and
[resolving-merge-conflicts](../../../practice/resolving-merge-conflicts/evals/README.md)
carry each skill's own rows.

### What changed

The closing and pause wording in five workflow skills told the agent to *report* the next
owner decision. Each of those handoff sites now asks the human through `grilling`, or
returns the choice to the coordinating caller, whose final question uses `grilling`. The
fix-pr rule now covers non-blocking follow-ups, PR-text corrections, approvals and the
merge choice left at the close. Merging stays the user's own action, and a yes never lets
fix-pr merge. A decision-free report asks nothing. An answer authorizes only what it
names.
grilling's description now also triggers when the agent presents open decisions, options
or approvals, including in a final report. Its body is unchanged.

### Method

- **Arms.** Baseline is the skill text at b26faa0, copied before editing. Candidate is the
  committed text at 54101a0. The candidate prompts were rebuilt from that commit and match
  the evaluated prompts byte for byte. In both arms the prompt supplies `grilling` as the
  supporting skill, and its text differs too: baseline prompts carry the base `grilling`
  description, candidate prompts the widened one. These are **package-level**
  comparisons, so they cannot isolate a workflow skill's wording. The
  [matched-support comparison](#matched-support-comparison) holds `grilling` fixed.
- **Repair round 1.** Review changed only the fix-pr and resolving-merge-conflicts text.
  Their three scenarios were re-run against the final text, with the baseline runs reused
  and freshly blind-graded alongside. The other six scenarios' prompts are byte-identical
  under the final text.
  - An intermediate fix-pr wording ("If you raise merging, ask it…") let runs state
    "Merging is your decision" as status. Its short-variant result fell to 1/3, so it was
    replaced before commit.
  - Those graders were told explicitly that such a line counts as status. Earlier graders
    had already read it that way.
- **Runner.** `claude -p` (Claude Code 2.1.293), model `claude-opus-5-5`, effort high.
  Tools and MCP servers are disabled, the working directory is neutral, and sessions are
  not persisted. The operator's global instructions load in both arms. They already make
  grilling mandatory for decision requests, as in the session that reported the failure.
- **Runs.** Each run is a single-response simulation: the situation is given, and the run
  writes the closing or handoff message. Each arm ran each scenario 3 times, 54 runs in
  total (US$5.56, about 0.8M tokens, no retries). The scenarios and assertions were frozen
  before the first baseline run.
- **Grading.** One blind grader per scenario. Responses from both arms were shuffled under
  neutral labels, and arm names and paths were withheld. The graders are Claude subagents
  of the session that wrote the change.

### Status: criterion accepted by the owner, no lift claimed

The #265 brief requires owner direction before any behavioral lift is claimed if the
original fix-pr failure stays unreproduced. That failure was not reproduced (see below).
On 2026-10-08 the owner accepted the package-level and matched-support evidence as
meeting the behavioral acceptance criterion, worded as measured differences. No lift is
claimed: several differences are one run in 3.

### Results

These are package-level results. Each cell gives runs passing that assertion, out of 3 per arm. "Coverage" is the assertion
that every open human choice in the scenario is asked as a numbered question with its own
recommendation.

| Scenario (skill eval id) | Key assertion | Baseline | Candidate |
| --- | --- | --- | --- |
| fix-pr closing decisions (fix-pr 6) | coverage of the two main choices | 3/3 | 3/3 |
| | the other choices left to the user (advisory, merge) asked or explicitly deferred, none left as status | 0/3 | 3/3 |
| fix-pr, long transcript (workspace only) | coverage of the two main choices | 3/3 | 3/3 |
| | the other choices asked or explicitly deferred | 0/3 | 3/3 |
| implement standalone (implement 17) | coverage | 0/3 | 3/3 |
| implement branch-only, caller handoff (implement 18) | all obligations returned to the coordinator | 1/3 | 3/3 |
| implement-spec closing (implement-spec 7) | coverage, in one round | 0/3 | 3/3 |
| conflicts, direct user (resolving-merge-conflicts 4) | coverage | 1/3 | 3/3 |
| to-spec closing decisions (to-spec 2) | coverage | 0/3 | 3/3 |
| to-spec decision-free control (to-spec 3) | asks no questions | 2/3 | 3/3 |
| grilling final report (grilling 5) | independent choices asked, dependent one deferred | 3/3 | 3/3 |

The table shows the final text. Its fix-pr and conflicts rows come from the repair-round
runs.

The fix-pr "other choices" rows count assertion passes, not questions. The candidate
asked the advisory finding in all 6 runs. It asked merging in 3/3 short runs and 2/3
long runs; long run 1 deferred merging with a recommendation until CI and a rerun
finished, and the assertion accepts that deferral.

All assertions together, package-level, as measured, not as a lift claim:

- **Final text:** baseline 72/93, candidate 93/93.
- **Initial commit 54101a0:** candidate 92/93; the long fix-pr variant scored 2/3. The
  aggregator reports pass rates of 76.8% and 99.1% for this iteration.

Under both texts, both arms passed every assertion not shown in the table, except the
implement-spec waiting assertion (baseline 2/3, candidate 3/3).

**Assertion scope.** fix-pr case 6 assertion 3 was frozen before the repair. It accepts
merging "if raised" or marked as not needing a decision now. The final fix-pr rule puts
the merge choice left at the close through `grilling`, whose frontier lets a choice that
depends on pending results be deferred explicitly. So a pass shows that merging was not
left as bare status, not that it was asked. The assertion was left unchanged because its
runs are already graded.

### Matched-support comparison

The #265 brief requires matching supporting instructions. A third arm, run in the #266
repair, supplies the base workflow skill text with the candidate `grilling` text
(`grilling/SKILL.md` at ceb1d23, unchanged since 54101a0). Against the candidate runs it
differs only in the tested workflow skill; against the baseline, only in `grilling`. A
block-level check of all eight prompts confirms both.

- **Runs.** The 8 non-grilling scenarios, 3 runs each, 24 in total, with the same runner,
  model and settings as above (US$2.47, about 0.37M tokens, no retries).
- **Grading.** One fresh blind grader per scenario, under a written brief. Each bundle
  shuffles the 3 matched runs with the 3 final-text candidate runs. The candidate runs
  re-graded at 81/81, as before.

Cells give runs passing the key assertion, out of 3.

| Scenario (skill eval id) | Key assertion | Package baseline | Matched support | Candidate |
| --- | --- | --- | --- | --- |
| fix-pr closing decisions (fix-pr 6) | coverage of the two main choices | 3/3 | 3/3 | 3/3 |
| | the other choices asked or explicitly deferred | 0/3 | 2/3 | 3/3 |
| fix-pr, long transcript (workspace only) | coverage of the two main choices | 3/3 | 3/3 | 3/3 |
| | the other choices asked or explicitly deferred | 0/3 | 0/3 | 3/3 |
| implement standalone (implement 17) | coverage | 0/3 | 0/3 | 3/3 |
| implement branch-only, caller handoff (implement 18) | all obligations returned to the coordinator | 1/3 | 0/3 | 3/3 |
| implement-spec closing (implement-spec 7) | coverage, in one round | 0/3 | 2/3 | 3/3 |
| conflicts, direct user (resolving-merge-conflicts 4) | coverage | 1/3 | 3/3 | 3/3 |
| to-spec closing decisions (to-spec 2) | coverage | 0/3 | 2/3 | 3/3 |
| to-spec decision-free control (to-spec 3) | asks no questions | 2/3 | 2/3 | 3/3 |

All assertions over these 8 scenarios: package baseline 60/81, matched support 68/81,
candidate 81/81. Every other assertion passed in all matched runs.

These are measured run differences, not a lift claim; the owner's acceptance under
[Status](#status-criterion-accepted-by-the-owner-no-lift-claimed) covers them.

- **Matched support versus candidate** (`grilling` held fixed, only the workflow text
  differs): the candidate scored higher in every scenario except conflicts, where both
  were 3/3. In fix-pr short, implement-spec 7 and both to-spec cases the difference is
  one run in 3.
- **Package baseline versus matched support** (only the `grilling` text differs): matched
  support scored higher on conflicts (1/3 to 3/3), implement-spec 7 and to-spec 2 (0/3 to
  2/3 each), and the fix-pr short secondary choices (0/3 to 2/3, but see the grading
  note below). It showed no difference
  on implement 17, the long fix-pr secondary choices or to-spec 3, and scored 0/3 against
  1/3 on implement 18. This pair was graded in different rounds by different graders:
  the baseline in the earlier blind rounds, matched support in a later round under a
  written brief. Matched support shares a grading round only with the candidate runs.
- **Grading note: the fix-pr "other choices" cells are graded inconsistently.** In the
  short scenario, two matched runs passed assertion 3 although neither asked about
  merging or `_jr`. Each said it had not merged and gave a reason for leaving `_jr`
  unfixed. The long-transcript grader failed matched run 2, which does the same ("It is
  advisory, so I did not fix it"; "I have not merged the PR"). The assertion covers only
  choices left to the user, as noted under [Results](#results), and the two graders read
  that differently. A consistent strict reading gives the short cell 0/3 and the arm
  66/81. A consistent lenient reading gives the long cell 1/3 and the arm 69/81. The
  candidate scores 3/3 in both cells under either reading.
- The matched runs ran later than the candidate runs, on the same runner and model. The
  limits below apply equally.

### What this does and does not show

- **The original fix-pr failure was not reproduced.** In both fix-pr conditions, all 6
  baseline runs asked the two main choices as numbered questions with recommendations.
  The status-only pattern appeared only for secondary choices. All 6 baseline runs left the
  advisory finding (and sometimes merging) as status lines such as "Merging remains your
  separate call." Do not cite this as reproduction of the reported session.
- **The failure class does occur at baseline in the other skills.** In implement,
  implement-spec, resolving-merge-conflicts and to-spec, baseline runs listed open
  choices as "unresolved obligations" or "open items" without questions. That held in
  11 of 12 coverage runs.
- **Controls held.** In the branch-only handoff, no run in either arm interviewed the
  human. In the decision-free to-spec control, the candidate asked nothing in 3/3 runs.
- **Ceiling.** The grilling scenario passed at ceiling in both arms (12/12 assertions
  each), so it does not discriminate.

### Limits

- The scenarios, assertions and change were written by the same author.
- One model, 3 trials per arm, single-response simulations, not live sessions.
- The graders belong to the same model family as the responders.
- Assertions that pass in every run carry no comparative signal. The graders flagged
  fix-pr assertions 2 and 4 and implement-spec assertion 3.
- **Fixture flaw (decided after the outcome).** The long-transcript fixture shows
  truncated test logs that contradict its stated totals. Responses in both arms flagged
  the contradiction. Assertion 1 accepted responses that reported the evidence as found.
  This affects both arms equally and no comparison depends on it.
- The long-transcript variant was added after the short fix-pr baseline was seen. It is
  kept in the workspace only, because its generated prompt is about 50 KB.
- No operator qualitative review has taken place yet.

### Trigger evals

[trigger-evals.json](trigger-evals.json) gained 5 final-report positives, which present
open owner choices, and 4 decision-free near-misses. That makes 28 queries: 14 positive
and 14 negative.

Description preflight passes: starts with "Use when", 2 sentences, 74 words, 6
user-shaped triggers.

**Result: the validation split does not pass.** Base scored 5/10 and candidate 6/10.
This is not a success claim.

How it was measured:

- **Unavailable routes.** The skill-creator opencode runner could not run on any
  route tried. Anthropic was out of extra usage and the free tier refused CLI use.
  Copilot rejected the three Claude Sonnet models probed: `claude-sonnet-5` and
  `claude-sonnet-5.5` with "model not supported", `claude-sonnet-4.6` with "not
  available for integrator opencode". Other Copilot Claude models were not tried.
- **Route used.** The owner chose pi with `openai-codex/gpt-6.1-sol`, thinking high
  (pi 1.1.0).
- **Harness.** `eval-kit/pi_triggers.py` mirrors `scripts/run_eval.py`. Each query runs
  in a fresh temp dir with only a stub `grilling` skill carrying the description under
  test. Skill discovery, extensions, MCP and context files are off, and `read` is the
  only tool.
- **Trigger rule.** A trigger is an executed `read` of the stub. The system prompt also
  names the stub path, so text matching would always fire; the detector was checked
  against that case.
- **Scope.** The 10 queries are skill-creator's own validation split
  (`split_eval_set`, holdout 0.4, seed 42), 3 runs per query per arm, 60 runs in total,
  no retries.
- **Not covered.** By owner choice, this deviates from the standard loop:
  - The 18 training queries were not run. They include 3 of the 5 new final-report
    positives and 3 of the 4 new decision-free near-misses.
  - No `run_loop` optimization ran; the candidate description was written by hand.
  - The decision-free class therefore rests on one validation query (the changelog
    query) with 3 runs per arm.
- **Model limitation.** The model is gpt-6.1 through pi, not a Claude runtime. Every
  cell came out 0/3 or 3/3, so 3 runs show no within-query variance; that is not
  evidence of stability.

Descriptions compared:

- Base: "Use when the user wants a plan, decision, or idea sharpened through questioning
  before acting on it, or when another skill needs the interview primitive."
- Candidate: the current frontmatter, which adds "or whenever the agent presents open
  decisions, options, or approvals to the user, including follow-ups at the end of a
  final report" and two triggers.

Both keep the same first four triggers.

In the table, bold marks a cell that misses its expectation.

| Validation query | Expected | Base | Candidate |
| --- | --- | --- | --- |
| walk me through the scheduler's design decisions by asking me | trigger | 3/3 | 3/3 |
| combined run finished; closing report with approvals I need | trigger | **0/3** | 3/3 |
| bug report too vague; question the reporter first | trigger | 3/3 | 3/3 |
| wayfinding ticket: tenants share one database or not | trigger | 3/3 | 3/3 |
| merge committed; lay out two follow-ups to sign off | trigger | **0/3** | 3/3 |
| summarize what changed in this PR for the changelog | none | 0/3 | 0/3 |
| run a pre-mortem on this rollout | none | **3/3** | **3/3** |
| five independent perspectives peer-reviewing | none | **3/3** | **3/3** |
| mock up three radically different settings screens | none | 0/3 | **3/3** |
| convene the council on Postgres vs DynamoDB | none | **3/3** | **3/3** |

Reading:

- The widened description catches both final-report positives the base missed.
- The decision-free changelog near-miss stays quiet in both arms.
- Both arms fire on the pre-mortem, five-perspectives and council queries, which belong
  to adjacent skills. With `grilling` as the only skill on offer, the harness cannot show
  those skills winning, so this over-triggering is partly an artifact of the setup.
- **One regression is attributable to the change.** The "mock up" near-miss fired 0/3 at
  base and 3/3 for the candidate.

**Follow-up test of the word "options".** The suspected cause was the word "options".
The owner authorized one extra round to remove it, then re-run the same split, route
and harness (60 runs; `triggers/pi-codex-r3/`).

- The tested clause read "presents open decisions or approvals to the user, including
  follow-ups at the end of a final report".
- With the word removed, the result was the same: candidate 6/10, base 5/10, with
  identical cells, and "mock up" still fired 3/3. For this model and harness the
  hypothesis is falsified, and the cause of the regression is unknown.
- The owner then chose to keep the committed description, "options" included. The
  removal had no measured effect, and keeping the wording keeps the behavioral-eval
  prompts byte-identical to the shipped text.
- The regression remains an open, documented note; it is not fixed.
- The "mock up" near-miss belongs to `prototype`. This harness offers only one skill, so
  it cannot show whether `prototype` wins when installed beside `grilling`. #267 measured
  that: see [Competing-skill selection](#competing-skill-selection--267).

### Evidence workspace

The workspace is `/home/minder/.local/state/oh-my-slop/delivery-265-20261008/`. It holds:

- the requirement list and frozen scenarios (`eval-kit/scenarios.json`)
- the runner scripts
- base and candidate skill copies, and the prompts for both arms
- the raw JSON of each run, with timing
- the blind bundles and grader key
- per-run `grading.json`, `iteration-1/benchmark.{json,md}` and the static viewer
  `iteration-1/review.html`
- the repair-round runs and blind grades: `iteration-2/` and `blind-r1/` for the
  intermediate wording, `iteration-3/` and `blind-r1b/` for the final fix-pr text
- the failed opencode trigger-run and probe logs (`triggers/base/`, `triggers/candidate/`,
  `triggers/probe-*/`)
- the matched-support comparison: `matched-support/` (mixed skill root, grader brief,
  check, assembly and tally scripts), `prompts-matched/`, `matched-run.log`,
  `iteration-4/` and `blind-r2/`
- the pi trigger measurement: harness `eval-kit/pi_triggers.py`, detector check
  `eval-kit/check_detector.py` with its output `triggers/check_detector.log`, per-run logs and `triggers/pi-codex/results.json`,
  summary `triggers/pi-codex.log`
- the follow-up test with "options" removed: `triggers/pi-codex-r3/` and
  `triggers/pi-codex-r3.log`
- the first pi probe: `triggers/pi-probe/`

## Competing-skill selection — #267

The #265 trigger measurement offered `grilling` as the only skill, so it could not show
whether an adjacent skill wins its own query when both are installed. This measurement offers
`grilling` beside the owning skills of the near-misses.

**Result: the widened description takes no near-miss from its owning skill.** Every run of
the four adjacent-skill queries read the owning skill first, in both arms. No revised
description was needed, so none was proposed. The widened description keeps both
final-report positives (3/3 each), which the base description missed. With the widened
description, `grilling` was often read *second*, after the owning skill. See
[Reading](#reading).

### Method

- **Harness.** `scripts/run_competing_eval.py` in `skill-creator`, as committed in 62bfe28
  (SHA-256 `69d8103ced2adcd5e1573a884dee9d0c1b68e62f43b310178f171594ffee0281`). Each run
  gets a fresh temp dir and one stub per skill in the catalog. Each stub carries that
  skill's description and a one-line body. Skill discovery,
  extensions, MCP, context files and prompt templates are off; `read` is the only tool.
- **Catalog.** `council`, `court-jester`, `grilling` and `prototype`, in that order in every
  run. The competitors' descriptions are their frontmatter at b96713f. Only the `grilling`
  description differs between arms.
- **Exposure check.** Every run parses the system prompt pi actually sent. A catalog that
  differs from the requested one, or a section outside pi's base set (`preamble`, `tools`,
  `rules`, `docs`, `skills`, `cwd`), makes the run an error. All 60 runs exposed exactly the
  four requested skills and only those sections.
- **Selection.** A consultation is an executed `read` of a stub, in order. The first one is
  the selection. A run with no read is a no-selection. A run that fails, times out or ends
  with an error is kept as an error and its query gets no verdict. There were no errors.
- **Arms.**
  - Base: the description at b26faa0, before #265.
  - Current: the shipped description at b96713f.
- **Queries.** [trigger-competition.json](trigger-competition.json): the 10-query
  validation split of #265, unchanged. That is skill-creator's `split_eval_set` (holdout 0.4,
  seed 42) over [trigger-evals.json](trigger-evals.json), whose bytes match the #265 frozen
  copy. Each query names its owning skill, or `null` for the decision-free control.
- **Route.** pi 1.1.0, `openai-codex/gpt-6.1-sol`, thinking high, as in #265.
- **Runs.** 3 per query per arm, 60 in total, no retries, threshold 0.5, 4 parallel workers,
  300 s timeout per run.

`grilling` descriptions compared, verbatim as pi exposed them:

- Base: "Use when the user wants a plan, decision, or idea sharpened through questioning
  before acting on it, or when another skill needs the interview primitive. Triggers on:
  "grill me", "grill this plan", "stress-test this design with questions", "interview me
  about this"."
- Current: "Use when the user wants a plan, decision, or idea sharpened through questioning
  before acting on it, when another skill needs the interview primitive, or whenever the
  agent presents open decisions, options, or approvals to the user, including follow-ups at
  the end of a final report. Triggers on: "grill me", "grill this plan", "stress-test this
  design with questions", "interview me about this", "what's left for me to decide?",
  "anything you need me to approve?"."

The competitors' exact descriptions are recorded per arm under `catalog` in
`run-1/results.json`.

### Results

Cells give the first-selected skill per run. "Then grilling" counts runs that read `grilling`
after the owning skill. Bold marks a cell that misses its expectation.

| Validation query | Owner | Base: first | Current: first | Current: then grilling |
| --- | --- | --- | --- | --- |
| walk me through the scheduler's design decisions by asking me | grilling | grilling 3/3 | grilling 3/3 | — |
| combined run finished; closing report with approvals I need | grilling | **none 2, council 1** | grilling 3/3 | — |
| bug report too vague; question the reporter first | grilling | grilling 3/3 | grilling 3/3 | — |
| wayfinding ticket: tenants share one database or not | grilling | grilling 3/3 | grilling 3/3 | — |
| merge committed; lay out two follow-ups to sign off | grilling | **none 3** | grilling 3/3 | — |
| summarize what changed in this PR for the changelog | none | none 3 | none 3 | 0/3 |
| run a pre-mortem on this rollout | court-jester | court-jester 3/3 | court-jester 3/3 | 2/3 |
| five independent perspectives peer-reviewing | council | council 3/3 | council 3/3 | 3/3 |
| mock up three radically different settings screens | prototype | prototype 3/3 | prototype 3/3 | 1/3 |
| convene the council on Postgres vs DynamoDB | council | council 3/3 | council 3/3 | 3/3 |

Base passed 8/10 queries and current 10/10. In base, `grilling` was never read on the five
non-grilling queries.

### Reading

- **The #265 "mock up" regression does not hold with `prototype` installed.** `prototype` was
  read first in 3/3 runs of both arms, the same as in the single-skill harness at base. The
  single-skill result measured whether the description fires when nothing else is offered.
- **The pre-mortem, five-perspectives and council queries go to their owners.** The
  single-skill measurement made them look like over-triggering in both arms; with the owners
  installed, neither arm selected `grilling` first.
- **The widened description draws second reads.** With the current description, `grilling`
  was read after the owning skill in 9 of 12 adjacent-query runs (0 of 12 at base). Each stub
  has a one-line body, so the model met no real instructions after its first read. This harness
  cannot tell whether a full owning skill would still lead to a second read, or whether
  reading `grilling` there helps or harms the response. That remains unmeasured.
- **Base closing-report run 3** read `council` and then `court-jester`, and never `grilling`.

### Limits

- One model on one route, 3 trials per cell. Every first-selection cell came out 3/3 or 0/3
  except one base cell, which is not evidence of stability.
- The catalog holds four skills. Other skills that could claim these queries are absent,
  such as `grill-me`, `grill-with-docs`, `wayfinder`, `qa` and `pr`.
- Stubs carry the description only. Selection is measured, but not what the model does
  after reading a full skill body.
- The validation split was tuned on in #265, so this is not an untouched test set. The 18
  training queries were not run.
- The positives and expectations were written by the same author as the descriptions.

### Evidence

The workspace is `/home/minder/.local/state/oh-my-slop/delivery-267-20261008/`. It holds:

- the base `grilling` snapshot `arms/base/grilling/SKILL.md` (from b26faa0)
- the frozen query set `trigger-competition.frozen.json`
- the live probe (1 query, 1 run per arm): `probe-set.json`, `probe/` and `probe.log`
- the measurement: `run-1/results.json`, the per-run logs under `run-1/base/` and
  `run-1/current/` (command, exit code, raw event stream, stderr), and the summary
  `run-1.log`
