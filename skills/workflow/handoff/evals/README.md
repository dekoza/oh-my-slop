# Workflow continuation — evidence and limits

Implements the [conversation progression audit](../../../../docs/surveys/conversation-progression-audit-2026-10-27.md).
This is a cross-workflow change, not a new skill, command or runtime orchestrator.

## Shipped behavior

- `research`: the coordinator inspects findings, delivers the answer/evidence limits and
  makes the known next boundary actionable rather than returning only a saved-report receipt.
- `handoff`, `implement`, `implement-spec`, `fix-pr`, `humanify`: one shared
  [continuation contract](../references/workflow-continuation.md) carries the completed local
  result, remaining goal, next actor/action, actual authority and concrete restart prompt
  when needed. Existing session, publication, repair and human-decision limits remain intact.
- `prototype`: selected behavior, captured source and unverified production acceptance
  belong in one handoff; consequential product choices get actual questions/recommendations.
- `humanify`: publication-only approval is a checkpoint when readiness is still undecided,
  not a reason to wait for a generic continuation prompt. Explicit refusal/deferral still
  stops that branch. Readiness never supplies an implementation grant.
- The [shared brief-authority criteria](../../to-tickets/references/implementation-handoff.md)
  distinguish the new-graph publication-only stop from readiness-repair sequencing. Previously
  their broad no-further-readiness-question rule competed with `humanify`'s completion goal.
- [Bundled global guidance](../../../../agent/AGENTS.md#outcome-ownership) covers ordinary
  conversations; repository `AGENTS.md` points to it. Project setup remains configuration
  binding, not a new policy injector.

No skill names, descriptions, invocation modes, prompt templates or package entrypoints changed.
The existing `feature-milestones` work was not duplicated or modified. No retry mechanism,
provider switching, merge/deployment authority or user-global configuration was installed.

## Controlled comparisons

Temporary evidence: `/tmp/oh-my-slop-continuation-evals-mbNU3w7i/`.

Executors used **`openai-codex/gpt-6.1-sol`, high thinking**, isolated built-in tools, equal
per-case inputs and immutable package snapshots. Assertions were hidden from executors.
Actual local reads/writes/readbacks and final files were independently graded; promises
alone did not earn action credit. No live forge, host, implementation or provider-repair
operation was exercised. Actual model routes and original action-record hashes are retained.

The multi-turn driver supplied only publication approval and, after a direct readiness
question, explicit readiness approval. It never supplied “what next?”, “continue” or a
simulated answer inside an executor. An executor that stopped at status received no rescue.

### Original skill package versus initial changes

Original package: `f81d4b8`. First candidate: `95faf80`.

| Local-tool case | Original | Initial candidate | What discriminated |
|---|---:|---:|---|
| Research transition | 2/4 | 4/4 | Concrete bounded next invocation and its authority envelope. |
| Fresh-session restart | 3/4 | 4/4 | One copyable invocation rather than only numbered next steps. |
| Selected prototype | 3/4 | 4/4 | Recommendation accompanying the consequential persistence choice. |
| Multi-turn readiness | 3/5 | 3/5 | Neither asked readiness after publication-only approval. |

The initial candidate did not solve the multi-turn stop. That failure motivated a targeted
checkpoint distinction rather than another broad “continue autonomously” rule.

### Narrowed readiness fix and safety controls

Narrowed candidate: `dde2fe4`. The original readiness baseline was reused, not rerun.

| Case | Original | Narrowed candidate | Interpretation |
|---|---:|---:|---|
| Multi-turn readiness | 3/5 | 5/5 | Actual readiness question, actual answer, durable record/readback, then transition. |
| Successful recovery | 3/3 | 3/3 | Both resumed authorized report work; supplied recovery evidence, not a runtime repair. |
| Explicit readiness deferral | 3/3 | 3/3 | Both recorded the deferral and stopped without asking again. |

**Five passing assertions were insufficient:** the narrowed run's final and durable handoffs
still directed implementation while the human had granted readiness only. That was an additional
supported defect, not an actual unauthorized code edit. It led to a separate authority regression
and a final fix; the archived five-assertion score is not full handoff certification.

### Final authority fix

Final operative candidate: `a2b466d`. These incremental comparisons use `dde2fe4`'s snapshot
as baseline, **not** the original package. The complete-flow baseline is the retained narrowed
execution; it is not another independent observation. The new authority assertion was fixed
before the final candidate executed.

| Case | Previous narrowed candidate | Final candidate | Interpretation |
|---|---:|---:|---|
| Explicit no-implementation-grant terminal closeout | 3/3 | 3/3 | Non-discriminating safety control under a clearer prompt. |
| Complete multi-turn readiness plus authority | 5/6 | 6/6 | Final flow completes readiness and stops without an unapproved implementation directive. |

The final complete run published/read back the brief under publication-only approval, asked
the named-ticket readiness question, received the actual readiness-only answer, recorded/read
back that authorization before changing the state label, and verified the final open state,
labels, ownership and dependency. Its durable and user-facing closeouts keep implementation
separately authorized. No rescue nudge or extra approval ceremony occurred.

These are **assertion counts in single local examples**, not real-world success rates.
Correlated assertions, reused baselines and different exercised branch lengths must not be
combined into a headline efficacy or efficiency claim. Controls that already pass justify
coverage, not extra prose or claimed improvement. No qualitative human acceptance is inferred.

## Review outputs and provenance

Standard static skill-creator viewers:

- `/tmp/oh-my-slop-continuation-evals-mbNU3w7i/iteration-1/review.html`
- `/tmp/oh-my-slop-continuation-evals-mbNU3w7i/iteration-2/review.html`
- `/tmp/oh-my-slop-continuation-evals-mbNU3w7i/iteration-3/review.html`

**Outputs** contains artifacts, public action transcripts and formal grades. **Benchmark**
contains aggregate assertion metrics and analyst caveats. Human qualitative review remains
pending; the generated viewer is not evidence that someone reviewed or accepted the outputs.

The workspace retains baseline/candidate package snapshots, `snapshot-manifest.json`, original
JSONL source hashes in `retained-trace-manifest.json`, exact prompts/rubrics, actual fixture
states, ordered tool-call indexes, grades, timing and independent grading/review notes.

The live agent registry evicted finished handles. Initial transcript fetches therefore returned
“Agent not found.” The original `.output` JSONL files still held full actions: transcripts were
recovered symmetrically from those records, omitting private thinking/opaque signatures, then
independently regraded. Incomplete early grades are archived and superseded, not counted.
Optional null metadata containers were archived and normalized to objects for the standard
aggregator; assertions, grades and trace contents were not changed. This was artifact recovery,
not an executor rerun or a product-code fix.

Durations are rounded active harness times; multi-turn totals omit coordinator/human gaps.
Comparable aggregate token/cost data are unavailable. A fresh-session candidate made a bounded
local lookup of a referenced but absent report and added an evidence-acquisition gate whose
necessity the fixture does not establish. Keep that qualitative caveat visible.

## Validation and remaining limits

- Existing affected baseline selection: **456 passed**.
- New contract guards started RED; final full implementation-worktree suite:
  **1,177 passed** (`uv run pytest`). This excludes unrelated user working-tree additions.
- `uv run python scripts/validate_refs.py` and Git whitespace checks: passed.
- Independent spec and standards axes for the original range and affected final deltas:
  **0 outstanding blocking / 0 outstanding advisory each** at `a2b466d`.
- Authored evals cover successful continuation, meaningful handoffs, exhausted budgets,
  research-only completion, interrupted/aborted work, explicit deferral and authority boundaries.
  Not every authored scenario was model-executed; the tables above are the executed coverage.
- Descriptions/invocation flags were unchanged: this work did not require or claim new trigger
  measurements. No paid live probes were added to the repository test suites.
- Live forge behavior, concurrent claims/writes, changed premises, missing prerequisites,
  provider reliability and future authorized implementation remain outside these local runs.
  No generalization, statistical reliability or zero-nudge guarantee follows.

## Activation

Reload the package's skills in pi (`/reload`) after using the updated checkout. Commands and
skill names remain unchanged.

For ordinary conversations across other projects, merge only the **Outcome ownership** block
from the bundled global template into the existing global `AGENTS.md` through the user's normal
configuration process. Do not replace that file or weaken its current rules. This implementation
updates the portable template and this repository's pointer; it does not overwrite an installed
user-global configuration or silently reconfigure consumer repositories.
