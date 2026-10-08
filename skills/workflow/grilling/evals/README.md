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
  the evaluated prompts byte for byte. Only the skill text differs between arms. In both
  arms the prompt supplies `grilling` as the supporting skill.
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

### Status: behavioral criterion pending owner direction

The #265 brief requires owner direction before any behavioral lift is claimed if the
original fix-pr failure stays unreproduced. That failure was not reproduced (see below).
The figures that follow are measurements recorded for that decision. Neither they nor
this change claim lift or treat the behavioral acceptance criterion as met. The owner
decides whether this evidence satisfies the criterion.

### Results

Each cell gives runs passing that assertion, out of 3 per arm. "Coverage" is the assertion
that every open human choice in the scenario is asked as a numbered question with its own
recommendation.

| Scenario (skill eval id) | Key assertion | Baseline | Candidate |
| --- | --- | --- | --- |
| fix-pr closing decisions (fix-pr 6) | coverage of the two main choices | 3/3 | 3/3 |
| | the other choices left to the user (advisory, merge) also asked, none left as status | 0/3 | 3/3 |
| fix-pr, long transcript (workspace only) | coverage of the two main choices | 3/3 | 3/3 |
| | the other choices also asked | 0/3 | 3/3 |
| implement standalone (implement 17) | coverage | 0/3 | 3/3 |
| implement branch-only, caller handoff (implement 18) | all obligations returned to the coordinator | 1/3 | 3/3 |
| implement-spec closing (implement-spec 7) | coverage, in one round | 0/3 | 3/3 |
| conflicts, direct user (resolving-merge-conflicts 4) | coverage | 1/3 | 3/3 |
| to-spec closing decisions (to-spec 2) | coverage | 0/3 | 3/3 |
| to-spec decision-free control (to-spec 3) | asks no questions | 2/3 | 3/3 |
| grilling final report (grilling 5) | independent choices asked, dependent one deferred | 3/3 | 3/3 |

The table shows the final text. Its fix-pr and conflicts rows come from the repair-round
runs.

All assertions together, as measured, not as a lift claim:

- **Final text:** baseline 72/93, candidate 93/93.
- **Initial commit 54101a0:** candidate 92/93; the long fix-pr variant scored 2/3. The
  aggregator reports pass rates of 76.8% and 99.1% for this iteration.

Under both texts, both arms passed every assertion not shown in the table, except the
implement-spec waiting assertion (baseline 2/3, candidate 3/3).

**Known eval gap.** fix-pr case 6 assertion 3 was frozen before the repair. It accepts
merging "if raised" or marked as not needing a decision now. The final fix-pr rule is
stricter: it always asks the merge choice. So this assertion does not check that part of
the final rule. The assertion was left unchanged because its runs are already graded.

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
  available route. Anthropic was out of extra usage, the free tier refused CLI use, and
  Copilot rejected every Claude model for opencode.
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
  base and 3/3 for the candidate. The likely cause is the added word "options", which
  overlaps with offering design variations.
- Revising the description needs owner authorization, because the repair budget is
  spent.

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
- the failed trigger-run logs
