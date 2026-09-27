# Fix PR evaluation

## Boundary and baseline

`/fixrev` previously contained a raw request to fix a reviewed PR plus a `grilling`
clause. It had no named workflow owner and failed the prompt-template contract.
`implement` owns a new ticket-sized build, and the review skills are read-only;
`resolving-merge-conflicts` owns an already-stopped Git operation, not the surrounding
PR repair. `fix-pr` owns that missing job and delegates those specialist concerns.

The command now explicitly includes both review findings and target-branch conflicts.
This is a command-contract expansion, not evidence that the old prompt could never
resolve a conflict. The existing command name and argument passthrough remain.

## Cases

The [task-only scenarios](evals.json) exercise:

1. An unresolved review finding plus a conflict against a non-default target branch:
   preserve target tenant filtering and PR pagination, verify the integrated candidate,
   update the existing PR and check its published head and fresh mergeability.
2. A conflict-only PR with linear-history policy, no rewrite authority, an occupied dirty
   worktree and an unsettled security-sensitive behavior decision: protect work, ask the
   real decisions through `grilling`, and remain blocked instead of guessing authority.

Baseline and candidate use the same task facts, model and tools. Assertions are withheld
from the executors. One executor per configuration answers both independent cases, so
cross-case influence is possible. These are proposed-action response simulations, not
Git/forge executions, conflict-resolution correctness proofs or multi-turn follow-through
measurements. No live PR was changed. Trigger evaluation is inapplicable to this manual
skill. Human qualitative review remains pending.

The observed baseline already preserves both sides' behavior, avoids an unauthorized
rewrite and asks the consequential blocked-case questions. Its ordinary repair sequence
omits post-push head/target/mergeability readback and explicit assessment of stale review
approvals. The candidate makes those completion obligations explicit.

## Paired response comparison — 2026-09-27

Both executors used `openai-codex/gpt-6-astra`, high reasoning. An independent grader
applied the original five assertions per case to the saved outputs. Each executor
answered both cases in one context; per-case timing/token totals are unavailable.

| Case | Original command | Command with `fix-pr` |
| --- | --- | --- |
| Review finding and non-default-target conflict | 2/5 | 5/5 |
| Linear-history, ownership and semantic blockers | 5/5 | 5/5 |
| Total | 7/10 | 10/10 |

The three differences are narrow: named conflict-skill read evidence, post-publication
head/target/mergeability verification, and repair-record readback. The first is provenance,
not a behavioral safety distinction: both outputs propose the same safe merge strategy.
The grader interprets “verified repair summary” literally as checking the posted record.
All blocked-case assertions tie; both configurations protect work and human authority.
Compound assertions receive no partial credit, so the score gap must not be presented as
a measured improvement in operational safety or real conflict-resolution reliability.

Workspace: `/tmp/fixrev-workspace-lka363mh/`. Immutable prompt/skill snapshots, task-only
inputs, paired response files and comparison artifacts live outside the installed skill.
The standard viewer is `iteration-1/review.html`: Outputs contains the proposed responses
and grades; Benchmark contains the literal scores and limitations. The final skill differs
from its evaluated snapshot only by the added pointer to this evidence document. Human
qualitative review and real Git/forge execution remain unverified.

## Repository checks

The new command-owner regression failed on the old raw prompt and passed after routing
through `fix-pr`. The full Python suite has 922 passes and the single pre-existing
`revmerge` decision-routing failure; the former three `fixrev`/README failures are gone.
All 1,967 Node tests pass, and Markdown reference validation passes. These mechanical
checks establish entrypoint/reference integrity, not the correctness of future PR repairs.
