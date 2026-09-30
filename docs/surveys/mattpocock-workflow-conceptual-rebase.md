# Conceptual rebase of the engineering workflow

## Answer

**Keep upstream's main flow, carry forward a smaller set of local invariants, and add
its whole-spec execution, PR presentation and environment-learning loop. Do not
carry forward our old orchestration assumptions or every stronger local ritual.**

Upstream has made the flow more complete and easier to select. It has not made all
handoffs consistent. Our original adaptations include real integration repairs,
deliberate project policies and additional technical references—not just repairs
that a newer upstream release could make redundant. Our fork also has inconsistencies.

This is a source-level conceptual comparison, not a proposed skill patch, execution
trial or claim that either workflow reliably follows its instructions. External
orchestration projects are outside the comparison.

## Three-way baseline

| Point | Exact revision | Meaning |
| --- | --- | --- |
| Upstream release | `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e` | Peeled v1.2.3 tag |
| Local older set | `9c9176bbdea328d72f7c4800d1dd27b73de5e02a` | Before this session's retirement/worker/coordinator changes |
| Earlier local candidate | `b7bb52a7fd6b4f43c0085b9451087e106576779a` | Last baseline-lineage commit before the recorded September 28 date |
| Upstream current source | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | Fresh GitHub HEAD/main responses agree |
| Local current source inspected | `13542a83f400d919da8b257f1eaef7004623f290` | Includes this session's worker/coordinator adaptations |

“Two days ago” does not uniquely specify a revision. Fortunately, the two older
local candidates differ only in the refine-ticket template's argument-passthrough
wording; their skill bodies are identical. That ambiguity does not change this
conceptual result. The `42a0886` release-sync commit is useful history, not a clean
upstream baseline: local adaptations already preceded it.

Fresh release/tag metadata still identifies **v1.2.3 as the published release**.
Current main contains the v1.3 source rollout but retains v1.2.3 package/plugin
metadata. This report compares the actual tag and main, not an assumed v1.3 package.

## Typical upstream route now

One-time setup precedes these routes. The user selects phases; this is not an
automatically chained state machine. The [router][router] describes:

```text
idea → grill-with-docs → optional research/prototype
     → to-spec → approved to-tickets
     → either fresh implement sessions per ticket
       or one implement-spec session for the graph
     → publication, with pr shaping the body
     → optional retro
```

Small, already-understood work goes straight to `implement`; it need not acquire a
spec and ticket graph. A genuinely multi-session design first uses Wayfinder,
then collapses its decisions into a spec before decomposition. Keep interview,
spec and ticket synthesis together where context permits; workers start from
self-contained tickets. Prototype branches remain evidence, not production code.
These core routing/context ideas already existed at v1.2.3. [router][old-router]

The two execution branches are materially different:

- **Per ticket:** `implement` drives TDD and regular checks, invokes `code-review`,
  then commits. It does **not** open a PR in its body. Publication needs an explicit
  action; `pr` is a presentation reference, not a publisher. The review order is
  defective when implementation is uncommitted. [implement][review][pr]
- **Whole spec:** background workers each drive **TDD, not the standalone implement
  skill**, return branches, and merger workers land them on one integration branch.
  There is one whole-spec `code-review` after all tickets land, followed by one
  repair worker. A conditional draft PR opens after the first landing and becomes
  ready at the end; other trackers use their configured completion convention.
  This reduces manual dispatch and places whole-spec review where unbuilt tickets
  are no longer false omissions. These are intended benefits, not measured savings.
  [implement-spec][implement-spec-guide]

`retro` is a separate environment-learning step: inspect the session and existing
checks, then suggest navigation, tooling, checks and reviewer-standard improvements.
Mechanical mistakes should become deterministic checks; judgement belongs in
standards. It is not product acceptance and does not itself implement its proposals.
[retro]

## Our older route, and what changed this session

The older local set uses substantially the same planning spine, with stronger
construction and authority contracts:

```text
configured project/tracker → bounded grilling + domain recording
  → optional research/prototype → synthesized spec
  → inspected, approved foundation/interface/impact-aware ticket graph
  → authorized, unblocked ticket
  → one worktree-based implement session
  → two-axis-review → commit → one PR
  → required CI / human merge decision → human product acceptance
```

`humanify` is a conditional preparation route for human-blocked or insufficiently
specified work, not a mandatory second interview for every approved ticket. It
owns factual investigation, a durable brief, readiness preflight and the outstanding
human authorization. Our label policy distinguishes publication, readiness,
dependency eligibility and human acceptance. The producer skills do not yet honor
that distinction consistently. Local sources: older `grilling`, `to-spec`,
`to-tickets`, `humanify`, `implement` and the triage-label contract.

The older worker also reviewed before committing: we inherited the same mismatch,
despite stronger wrappers. **This session**, not the older set, adds committed
candidate review, exact base/head evidence, bounded repairs and explicit branch-only
delivery. It also adds the optional supervised whole-graph route, with one publisher,
verified integration-based eligibility and retained worktrees. Those changes must
not be retroactively counted as older local advantages.

Our current whole-graph route is more conservative than upstream: workers receive
both reviews, integrations receive scoped reviews, and the final result receives
whole-spec review. That has a potential coordination/review cost. The prior dry-run
comparison did not establish an operational advantage.

## Apply the conceptual diff to current upstream

The operation is not “copy every old local edit over new files.” It is:

```text
current upstream flow
+ still-needed local contracts and environment adapters
− redundant mechanisms and obsolete coupling
+ unresolved handoff repairs
```

| Conceptual difference | Outcome on current upstream |
| --- | --- |
| Bounded decisions instead of exhaustive interviewing | **Keep.** Upstream still asks for relentless traversal; scope/fidelity, consequential question admission, settled-answer reuse and a sufficiency stop remain deliberate local value. [grilling] |
| Configured tracker/domain pointers, stable names, harness portability | **Keep the adapter, deduplicate repaired wiring.** Upstream now correctly tells the human to invoke user-only setup. Do not blindly rename consumer glossary files or retain two competing authorities. |
| Two independent review axes | **Already upstream at v1.2.3.** Do not claim this as our invention or run upstream code-review plus our coordinator as two separate reviews. Keep independently callable read-only leaves/fallbacks where they serve actual callers. |
| Standards and requirements gathered before building | **Keep proportionately.** Builders need the applicable constraints; do not load every reference or turn every heuristic smell into a build gate. Retro's reviewer-only philosophy does not justify preventable construction mistakes. |
| Foundation, interface agreement and inspected mutable impact | **Keep the invariant.** Upstream graph text is weaker than our inspected ordering/readback rules. Reconsider universal contract-ticket/version ceremonies for already accepted unchanged private interfaces; agreement and safe ordering are the value. |
| Standalone publication as part of completion | **Make role-dependent.** Preserve an explicit PR/branch outcome for a standalone slice. In whole-spec mode workers hand off branches; the coordinator alone publishes. Porting “every worker opens a PR” would defeat the new route. |
| Human readiness and product acceptance | **Keep distinct, without repeated approvals.** Reuse explicit same-scope grants; do not infer execution authority from permission to publish a spec. A terminal acceptance record is not retro's environment-learning loop. |
| Owned worktrees, scoped teardown and project test policy | **Keep.** Upstream reset/cleanup wording does not supersede work protection. Required skipped acceptance coverage is not success. Keep mandatory TDD and project-appropriate targeted/full/CI ownership, not universal framework-specific setup. |
| Whole-spec coordination | **Add as an alternative, not the default for every task.** Adapt integration-based eligibility, serial merge ownership, changed-candidate verification, resource/impact admission, bounded repair and non-destructive retention. |
| PR presentation | **Add/adapt.** Actual before/after evidence, a compact explanatory visual and honest recovery/blast radius complement our publication owner. Respect existing templates and do not present planned tests as executed evidence. |
| Retrospective | **Add opt-in, proposal-only.** This is a real missing whole-process loop. Inspect existing checks before adding rules; include removing noise, not only accumulating instructions. |
| Extra framework and discipline references | **Keep optional.** Stack/API knowledge is orthogonal to the main flow, not a reason to fork upstream's workflow or make every project run every discipline. |

Some apparent local advantages were already native: two-axis review, vertical
slices, expand–contract exceptions, prototype decision snippets, retained prototype
branches and planning-context continuity all occur in v1.2.3. Preserve them through
the upstream source rather than separately re-porting equivalent prose. [old-review]
[old-tickets][old-prototype][old-router]

## Did upstream tighten the original inconsistencies?

**Partly, not comprehensively.** Historical local commits `04d1e95` and `645fad6`
really did restore interview/domain/Wayfinder composition; the user's recollection
is supported. Later local work deliberately changed policy as well.

Still unresolved in current upstream:

1. **Reviewed object:** byte-identical `implement` reviews before committing, while
   `code-review` reads the committed three-dot diff. The guide acknowledges invisible
   uncommitted work; it does not repair the caller. [implement][review]
2. **Graph progression:** the whole-spec guide explains landed prerequisites versus
   open tracker blockers, but the body does not explicitly define that frontier.
   Worker tip synchronization alone also cannot guarantee fast-forward landing if
   another branch lands afterward. [implement-spec][implement-spec-guide]
3. **Verification and stopping:** TDD workers do not inherit the standalone worker's
   complete check schedule. The whole-spec body lacks a clear combined-candidate
   verification gate and repair budget; its guide describes hours-long review loops
   and skipped acceptance tests, and suggests primary-checkout testing. Documentation
   warnings are not a safe isolated protocol. [implement-spec-guide]

Our remaining problems include producer readiness labels conflicting with our own
human-authorization policy, decision/deferral preservation through an overly broad
spec template, and the same review-before-commit ordering still in `fix-pr`. The
local improvement is therefore **not** “more rules everywhere”; it is a consistent
contract at each handoff. Scope → spec → tickets → checks must preserve the same
confirmed decisions, exclusions and acceptance conditions.

## Recommended outcome

Use one visible main flow with a cheap direct route for small work and a deliberate
choice between per-ticket and whole-feature delivery. Adopt the updated router's
operator-facing map in our documentation before creating another routing skill;
the catalogue alone does not explain the handoffs. Give each handoff one owner,
one durable artifact and an explicit acceptance condition. Keep evidence-aware
review placement: whole-spec review waits for the whole spec; changed integrations
need affected checks/review; an identical fast-forward candidate should not require
ceremonial rediscovery of unchanged evidence. Evidence reuse requires the same
scope, candidate and relevant verification context—it is not waiver authority.

That last point is a **proposal for evaluating our current review layering**, not
what the current skill already permits. Whether to reduce per-worker reviews needs
an explicit risk/assurance choice and operational evidence. No skill was changed
by this investigation, and no workflow was executed.

## Evidence and limitations

The upstream researcher produced a completed primary-source report. The local
researcher timed out; its streamed, incomplete draft was recovered as a lead, not
a completed review. The main investigation independently verified the baseline
identities, history diffs, relevant commit rationales and the primary local
planner/worker/reviewer/authority sources used above. This is a focused workflow
comparison, not a complete audit of every optional skill or behavioural proof.

Temporary evidence: upstream report and pinned source/metadata snapshots; recovered
local draft; independently extracted local baseline. Source acquisition ran no
upstream code, paid external model sessions or forge writes. The ordinary research
agents themselves consumed model resources; no cost or efficiency claim follows.

Validation: the full Python suite reports **927 passed, 2 unchanged prompt failures**
(`refine-ticket` argument passthrough and `revmerge` decision routing). Reference
validation passed. A separate survey check verified the local link, all 12 pinned
upstream source files, historical source paths and baseline identity assertions;
the skill reference validator does not scan surveys. These are source/install
checks, not an execution comparison.

For historical local claims, inspect these paths at `9c9176b` with `git show`:

- `skills/workflow/grilling/SKILL.md`, `skills/workflow/to-spec/SKILL.md`,
  `skills/workflow/to-tickets/SKILL.md`.
- `skills/workflow/implement/SKILL.md`, `skills/workflow/two-axis-review/SKILL.md`,
  `skills/workflow/review-spec/SKILL.md`, `skills/workflow/review-standards/SKILL.md`.
- `skills/workflow/humanify/SKILL.md`, `skills/workflow/wayfinder/SKILL.md`,
  `skills/workflow/fix-pr/SKILL.md`.
- `docs/agents/triage-labels.md`, `docs/agents/domain.md`.

Current-session source changes are separately recorded in the
[earlier survey's follow-up](mattpocock-skills-sync-2026-09-29.md#follow-up-supervised-implementation-authoring).

## Pinned upstream sources

[router]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/ask-matt/SKILL.md
[grilling]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/grilling/SKILL.md
[implement]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement/SKILL.md
[review]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/code-review/SKILL.md
[pr]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/pr/SKILL.md
[retro]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/retro/SKILL.md
[implement-spec]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement-spec/SKILL.md
[implement-spec-guide]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/docs/engineering/implement-spec.md
[old-router]: https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/ask-matt/SKILL.md
[old-review]: https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/code-review/SKILL.md
[old-tickets]: https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/to-tickets/SKILL.md
[old-prototype]: https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/prototype/SKILL.md
