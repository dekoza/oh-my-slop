# Fix PR evaluation

## Committed-candidate repair — #250

The current contract commits the inspected repair before committed-diff review, records
fixed review base/head and target identities, and gates publication on current candidate
checks and both axis outcomes. Later repair/integration is additive; changed local head,
uncommitted repair, or remote head/target movement invalidates publication until the
candidate is reconciled and affected checks/reviews are renewed within the repair budget.
Published head/target readback must match the certified candidate; the same PR stays open.

Cases 1–2 remain **proposed-action simulations**, now aligned with candidate identity and
recertification. Cases 3–4 define disposable local Git/bare-remote execution with supplied
simulated PR/reviewer inputs. Simulated axis receipts are not independent production
approval. A collector summary alone is not execution evidence: retain actual model tool
calls, committed ranges, check exit/head stamps, remote refs and unrelated-work sentinels.
Native regression fixtures reject missing check/axis records, nonzero checks, wrong base,
uncommitted repair, additive head changes and target movement; a second real local clone
moves both remote refs and establishes additive preservation and normal publication.
These test oracles validate Git/evidence state, not a new production publisher.

The bounded #250 comparison uses the original complete skill snapshot and the committed
candidate body with identical fixed supporting skills, task/fixture inputs and current
`openai-codex/gpt-6.1-sol` high-thinking resource. Two matched cases, one trial per
configuration, serial, with explicit 300s process and 600s outer deadlines; no retries.
The first baseline executed committed repair and local publication. The second encountered
an incomplete movement fixture: its bare remote lacked the injected future commit objects.
That run is preserved as **incomplete**, not a negative skill grade; no model lift or
remote-movement execution claim follows from it. Candidate comparison and operator quality
review are pending at this construction checkpoint.

Durable workspace:
`/home/minder/.local/state/oh-my-slop/preflight-248-1fO63Nx1/worker-250/`.
It retains original skill/evals, fixed support bodies, frozen prompts/assertions, initial
Git states, raw JSON events and sessions. Run evidence lives under `iteration-1/`;
final grades, standard viewer, candidate check stamps and gaps belong there too, outside
the installed skill. Independent whole-slice standards/spec review and operator qualitative
acceptance remain completion gates. Manual invocation and description are unchanged;
trigger evaluation is inapplicable. No live forge, consumer or run/source branch is published.

## Historical response comparison — not current operational evidence

### Boundary and baseline

`/fixrev` previously contained a raw request to fix a reviewed PR plus a `grilling`
clause. It had no named workflow owner and failed the prompt-template contract.
`implement` owns a new ticket-sized build, and the review skills are read-only;
`resolving-merge-conflicts` owns an already-stopped Git operation, not the surrounding
PR repair. `fix-pr` owns that missing job and delegates those specialist concerns.

The command now explicitly includes both review findings and target-branch conflicts.
This is a command-contract expansion, not evidence that the old prompt could never
resolve a conflict. The existing command name and argument passthrough remain.

### Cases

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

### Paired response comparison — 2026-09-27

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

### Historical repository checks

The new command-owner regression failed on the old raw prompt and passed after routing
through `fix-pr`. The full Python suite has 922 passes and the single pre-existing
`revmerge` decision-routing failure; the former three `fixrev`/README failures are gone.
All 1,967 Node tests pass, and Markdown reference validation passes. These mechanical
checks establish entrypoint/reference integrity, not the correctness of future PR repairs.
