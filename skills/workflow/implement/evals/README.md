# Implement worker contract evaluation

## Scope

The existing scenarios 1–7 remain controls for one-ticket scope, standalone PR
delivery, requirement tracing, shared language and session-owned infrastructure.
Scenarios 8–10 add committed-candidate review, explicitly authorized branch-only
delivery and stopping at the caller's repair limit. The skill body is the policy;
these scenarios test it rather than define a second worker protocol.

## Baseline and comparison

The pre-edit skill was snapshotted from `cfdfe53` before drafting. The evaluation
workspace is `/tmp/implement-spec-adaptation.xYIF75/implement-workspace/iteration-1`;
the original snapshot is beside it at `implement-baseline/`.

Baseline and candidate use the same prompts/assertions, the same general-purpose
agent configuration without model/thinking overrides, and the same read-only tool
boundary. Each configuration answers three dry-run scenarios in one executor;
these are not independent repeated operational trials. Recovered executor
transcripts verify `openai-codex/gpt-6.1-sol` with high reasoning for both
configurations. Per-scenario costs/timing remain unavailable. Group metadata is
recorded separately rather than inventing an allocation; the harness token figure
counts uncached input plus output, excluding cache reads.

The baseline already proposes safe commit-before-review and stopping at an explicit
repair budget. Its branch-only answer calls delivery an operator-requested exception
rather than fulfillment of the old unconditional PR contract. That is a source
contract gap, not evidence that the baseline destroyed work or published bad code.
Formal comparative grading and human output review are separate from static tests.

Independent grading found **10/11 assertions passed in the original versus 11/11
in the candidate**. Cases 8 and 10 pass both. The sole difference is case 9: the
original asks for an additional blocking-edge release confirmation despite the
prompt already supplying run-local evidence and authorization. The candidate
accepts that evidence while preserving the open tracker blocker. No assertion
regressed. This is one observed proposed decision, not a general causal or safety
improvement claim; ten assertions already pass without the change.

The standard benchmark and review viewer were generated in the recorded workspace.
Human qualitative review is pending. Per-case cost/timing is unavailable; generated
zero-valued cost summaries mean no measurements, not zero cost. Benchmark pass-rate
summaries average cases equally, so the raw assertion counts above are reported
separately. The leading prompts and shared executor limit generalization.

The compared candidate is the immutable pre-source-review snapshot (the worker
contract through `13982fe`). Source review subsequently added a worker-local input
boundary (`11636c9`) and corrected unchanged-prerequisite tracing (`27b2aa4`). New
scenarios 11–12 cover those refinements but have not had paired model runs. Do not
attribute the initial comparison's grades to those later changes.

## Handoff-consumer continuation

Cases 13–14 add changed-prerequisite and unchanged-authorized-input controls for the
shared handoff criteria. Their paired proposed-action comparison starts from `5b1588b`
and uses the immutable consumer body through `2595b9a`, separately from the older
worker-contract comparison above. See the
[routing comparison](../../wayfinder/evals/README.md) for artifacts, source boundaries,
rubric exposure, strong-baseline and shared-context limitations. The owner accepted
this continuation's source and bundle at `c2304db`; the older worker-contract comparison
above is a separate artifact. Real fresh-worker construction remains pending; these
simulations are not execution or publication proof.

## Repository evidence

`tests/test_implement_skill.py` checks the worker boundary, rubric ordering, explicit
delivery mode, preserved worktrees, seam agreement and bounded repairs. Its real Git
fixture confirms that an uncommitted implementation is absent from `base...HEAD`,
then visible after a candidate commit. Each new instruction contract first failed
its targeted regression selection before the corresponding source change.

These checks establish Git behavior and instruction presence, not that an agent
actually commits, tests or publishes correctly. Dry-run answers likewise establish
proposed actions only. No paid external model sessions, forge writes or Cleopatra milestone
execution were performed. Actual worker and combined-run behavior still needs the
bounded pilot described in the coordinator's eval notes.

## Closing decisions through grilling — #265

Case 17 ends a standalone delivery with two open human choices: what to do with two
advisory findings, and a glossary gap. Case 18 is the branch-only control: the same kinds
of obligations go to the coordinator, not the human. Method, limits and the full table are
in the [shared #265 record](../../grilling/evals/README.md#decision-handoffs-ask-through-grilling--265).

Over 3 trials per arm in the package-level comparison, where the supporting `grilling`
text also differs between arms:

- **Case 17.** Baseline asked both choices as numbered questions with recommendations in
  0/3 runs. It listed them as status. The candidate did so in 3/3 runs.
- **Case 18.** Baseline returned every obligation to the coordinator in 1/3 runs; two runs
  mentioned the advisory finding only in the review section. The candidate did so in 3/3
  runs. No run in either arm questioned the human directly or published anything.

With `grilling` held at the candidate text (the shared record's
[matched-support comparison](../../grilling/evals/README.md#matched-support-comparison)),
the base wording scored 0/3 on case 17 and 0/3 on case 18.

These figures are measurements, not a claimed lift; the owner accepted them as meeting
the behavioral criterion. The shared record explains why.
