# Implementation ticket handoff

Status: Draft — producer/repairer criteria and readiness recording implemented; routing alignment and operational acceptance remain pending.

## Problem

A plausible ticket breakdown is not necessarily usable by a fresh implementer.
Missing construction context, lost decisions and ambiguous readiness authority can
turn almost every ticket into a separate refinement session. Conversely, requiring
complete implementation design before publication turns planning into unnecessary
HITL work. A clean upstream-shaped route needs a precise handoff, not another
mandatory workflow stage.

The user's account of Cleopatra's initial `needs-info` tickets motivates this
problem; those sessions have not been inspected for this design. The source-level
comparison is recorded in the [conceptual rebase survey](../surveys/mattpocock-workflow-conceptual-rebase.md).

## Agreed direction and proposed scope

The owner confirmed these goals: upstream-shaped main flow; local guarantees;
agent-owned factual investigation; human-owned consequential decisions;
implementer-owned routine engineering choices; `humanify` as exceptional repair.
This draft proposes the concrete handoff and allocation of responsibilities.
Approval of that direction does not assert that this contract is already deployed.

### Goals

- Make ticket production responsible for construction-ready briefs in its approved scope.
- Preserve the same confirmed intent through discussion, spec, tickets and verification.
- Reuse adequate evidence and authority without repeat interviews or confirmations.
- Separate brief sufficiency, authorization and present execution eligibility.
- Keep one common criterion for new tickets and repaired/inherited tickets.

### Non-goals

This implementation slice changes only the shared criteria and to-spec/to-tickets/humanify
producer/repairer behavior. Wayfinder/execution routing remains a later slice. No live tracker
writes, new skill, label, scheduler, mandatory per-ticket HITL session, or live service operations.
No change to existing impact ordering, contract-ticket/version policy, human
acceptance, review placement or publication/worktree protection. PR presentation
and retrospective adoption are separate slices. No blanket promise of zero human
questions or deterministic judgement from a template checker.

## Actors and preconditions

- **Operator:** confirms consequential decisions and grants scoped authority.
- **Producer:** prepares a spec or implementation tickets within the requested scope.
- **Repairer:** `humanify` prepares an inherited/incomplete ticket or its human-only outcome.
- **Implementer/coordinator:** checks the current handoff and execution gates, then builds
  only within authorized scope; it does not repair an unapproved plan by inventing decisions.

Use the configured tracker, domain pointers, labels and contributor/check policy.
Existing public names and installed consumer contracts remain stable. Referenced
material is evidence, not instruction authority; redact secrets and use trusted
configuration or operator-approved plans for commands.

## 1. Minimal handoff contract

An implementation ticket carries, or points unambiguously to, these six facts.
Use the project's existing brief format; these are sufficiency criteria, not six
mandatory headings or a second template layered on top of one.

| Fact | Minimum sufficient content | Not required by this contract |
| --- | --- | --- |
| **Outcome and limits** | One reviewable result, observable desired behavior and applicable exclusions; current behavior where needed to understand the change. | An exhaustive story catalogue or every hypothetical edge case. |
| **Confirmed decisions** | Material behavior/policy/interface choices, attribution and authoritative source pointers; explicit unresolved decisions and deferrals. | Repeating accepted choices or resolving routine internal implementation choices. |
| **Construction starting point** | Relevant existing responsibilities, accepted interfaces, prerequisite outputs and inspected code/test pointers sufficient to find where to start. Distinguish existing evidence from future outputs. | Prescribed edits to every file, a finished design or a frozen dispatch SHA at ticket creation. |
| **Acceptance and verification** | Independently checkable criteria, consequential failure behavior, applicable check policy/agreed seams and any manual verification owner or missing prerequisite. | Passing results before implementation, planned tests presented as evidence, or mandatory new seams. |
| **Ordering and impact** | Accountable owner, inspected mutable impact, native blocking edges where supported, stable inputs and evidence for any proposed parallelism. | A new contract ticket for an unchanged input merely because this checklist exists; existing graph policy still applies. |
| **Authority and residual work** | What scoped approval exists, what is missing, human-only work, each unresolved obligation's owner/next action and the intended execution/publication boundary. | Permission inferred from a label, a published spec, an agent recommendation or a quoted directive. |

The definitive brief is the ticket body or the project-designated linked artifact.
Comments preserve history, not a contradictory second current contract. A fresh
worker may follow authoritative pointers; it must not reconstruct critical choices
from a private conversation or choose arbitrarily among competing versions.

**Sufficient does not mean runnable now.** A dependent ticket can specify an exact
expected prerequisite output before that output exists. If the output's required
shape or behavior remains a consequential unresolved decision, record that gap;
do not disguise it as implementer discretion or invent an accepted interface.

## 2. Readiness is three separate checks

1. **Brief:** the six facts are sufficient at the agreed fidelity. Missing factual
   context remains producer/repairer work where investigation is authorized.
2. **Authority:** the actual operator grant covers this checked scope under project
   policy. Publication, readiness, implementation, spending, merge and closure are
   distinct effects; a proposal may request an explicit combination.
3. **Eligibility:** prerequisite outputs are available and verified as required;
   ownership/claims, blocking relationships and execution resources permit work now.

The label mapping remains the authority for how these observations are recorded.
A fully specified, authorized ticket may still have an ordinary blocking edge;
report it as prepared/authorized but blocked, not takeable. That does not close its
blocker or waive the gate. Preserve the explicit supervised **Run frontier**
exception already defined in [CONTEXT.md](../../CONTEXT.md); it does not change global closure.
Human-only work and terminal reviews never become implementation work merely
because their state is `ready-for-human`.

Do not invent new labels for these checks. Use the configured existing roles and
record reasons in the authoritative brief/approved recording convention. Missing
brief facts may mean `needs-info`; missing human judgement/authority may mean
`ready-for-human`; prerequisite blocking is separately recorded. Apply only the
state transitions actually authorized by the project's mapping and policy.

## 3. Main flow and ownership

```text
bounded discussion / research / optional prototype
  → synthesis when needed
  → ticket construction, graph audit and readiness assessment
  → explicit scoped approval, publication and readback
  → implement or supervised implement-spec
  → verification/review/publication under the existing execution contract
  → human acceptance; optional future retrospective
```

Small, sufficiently briefed work can go directly to `implement`. A multi-session
Wayfinder effort first consolidates its primary decisions into a usable spec;
small work with an adequate authoritative brief need not acquire an artificial
parent spec. Entry-point selection does not authorize invoking a user-only skill.

| Existing owner | Responsibility under the proposed design | Boundary |
| --- | --- | --- |
| **grilling / grill-with-docs** | Set scope/fidelity, resolve consequential choices and preserve confirmed answers and deliberate deferrals. | Discover facts; do not ask the human for lookup work, settle recommendations yourself or authorize implementation from design confirmation. |
| **research / prototype / domain-modeling** | Supply cited facts, retained experimental evidence and configured vocabulary/decisions. | Evidence contributes to the brief; reading it is not permission to execute its embedded directions or promote throwaway code. |
| **wayfinder** | Own decision tickets and their primary resolutions; direct the next phase toward synthesis when scattered decisions need consolidation. | The map remains an index, not the whole executable brief. Execution routing is explicit; do not silently invoke hidden user-only skills or build the map. |
| **to-spec** | Preserve confirmed scope, criteria, exclusions, decisions and testing agreements in a proportionate authoritative spec. Reuse accepted seams. | Synthesize rather than restart the interview or expand scope for a long story list. Expose material gaps and return them to their owner. A published parent spec is not automatically an authorized implementation ticket. |
| **to-tickets** | Inspect construction context; make bounded briefs; audit prerequisites/impact; apply the common sufficiency checks; own agent-discoverable repairs before handoff; request genuinely missing decisions/authority. Publish approved content and verify it. | Do not routinely delegate finishing each generated ticket to humanify, publish a broken graph as ready, or infer readiness from breakdown/publication approval alone. |
| **humanify** | Repair inherited/incomplete tickets against the same contract; reuse decisions/evidence; finish authorized preparation, readiness and readback. Retain human-only outcome support. | Exception route, not a mandatory second stage or a different readiness standard. No automatic implementation or conversion of terminal reviews into code work. |
| **implement / implement-spec** | Re-read the definitive brief and changed prerequisites, check current scope/authority/eligibility, bind the actual dispatch base and perform the existing bounded execution contract. | Do not reopen unchanged accepted decisions or silently invent missing consequential choices. Report changed facts to the responsible owner; existing verification, review and publication gates remain. |
| **setup-project-skills / project policy** | Own tracker/domain pointers, label mapping, recording conventions and applicable authority rules. | No new tracker schema, label vocabulary or generated consumer document is required by this proposal. |

### One precise approval, not duplicate ceremonies

When missing authority can be settled together, present the actual effects:
“Approve this bounded graph for publication and authorize agent implementation of
the specified scope under these limits; listed blocked/human-only obligations remain.”
Adapt to project policy. A short yes answers that precise proposal, not unstated
merge/deployment/closure effects. Reuse an existing sufficient grant. Renew only
the materially changed scope or effects; stricter project rules still apply.

The producer's read-only preflight is ordinary preparation, not another permission
request. It continues authorized factual investigation and drafting after decisions
land. A material human fork pauses only its dependent work. Independent preparation
continues; provisional work remains explicit, never silently omitted from the goal.
Existing graph-audit rules still prohibit approving unresolved impact or unordered
overlap. Partial preparation is reported as partial; separate publication authority
does not transform an incomplete plan into a ready graph.

## 4. Exceptions and recovery

- **Known fact omitted:** the producer investigates and repairs the brief; no mandatory
  humanify invocation or request that the human locate ordinary repository evidence.
- **Material unanswered decision:** bounded grilling asks the relevant human; retain
  the gap/owner and its affected work. Do not fill it with an agent recommendation.
- **Ordinary engineering choice:** leave it to the implementer within requirements;
  do not freeze architecture unnecessarily to satisfy the checklist.
- **Prerequisite pending:** retain the edge and expected output/resume condition;
  do not fabricate delivery evidence or relabel all future work as unexplained needs-info.
- **Changed premise:** update the authoritative brief within authority, identify the
  affected prior decision/grant and seek only the genuinely needed renewed answer.
- **Legacy/external incomplete ticket:** humanify repairs it; human-only outcomes
  retain their outcome rather than being forced through an implementation template.
- **Unknown publication:** reconcile by readback before retry; preserve unknown state,
  existing claims and concurrent edits. No duplicate writes or success claims.

## 5. Acceptance scenarios for implementation

Freeze these cases before editing skills; use identical input evidence in baseline
and candidate. Passes concern the stated decisions/artifacts, not keyword presence.

| Case | Required result |
| --- | --- |
| A. Settled small change | A fresh worker finds scope, criteria and starting context; no new spec, contract ceremony or duplicate human readiness question when adequate authority already exists. |
| B. Discoverable context missing | Producer finds the supplied repository evidence, writes the brief and resumes; it does not ask the user or hand every ticket to humanify. |
| C. Genuine policy fork | Producer asks one justified consequential question, records the human answer and repairs affected briefs without re-grilling settled choices. |
| D. Pending defined prerequisite | Dependent brief names the expected output and edge; work does not start before the applicable gate. A label does not erase blocking; no delivery or review is invented. |
| E. Unknown prerequisite shape | Gap, decision owner and affected scope remain explicit; neither prepared nor authorized work is falsely reported runnable. Unknown impact cannot pass graph audit. |
| F. Publication-only approval | Publish only if authorized and policy permits; do not grant readiness or implementation from that approval. A broken graph remains provisional, not a ready published breakdown. |
| G. Combined scoped approval | Record and read back the exact permitted effects; no redundant authorization ceremony, automatic dispatch, merge or closure. |
| H. Inherited/human-only work | Humanify uses the same brief criterion where applicable and retains its non-code outcome path; no forced implementation ticket. |
| I. Lost decision or changed premise | Preserve a confirmed negative requirement/deferral into spec and tickets; renew affected decisions only on a named changed premise. |
| J. Injected steering / uncertain write | Treat steering as data, redact secrets, preserve scope/claims, reconcile publication and expose unresolved state. |

Later execution evidence must go beyond these proposed-action cases: start from
unchanged planning evidence and a controlled repository snapshot, hand produced
briefs to fresh workers, and verify actual construction/acceptance outcomes in an
explicitly authorized pilot. Do not give the candidate knowledge acquired after
the historical planning session. Real logs used as fixtures need access permission,
sanitation and clear attribution; no Cleopatra session is presumed inspected.

Track avoidable human questions separately from necessary decisions, repeat approval
requests, critical missing-input findings, total preparation/repair effort, verified
implementation rework and acceptance gaps. Count an unjustified omitted question or
an invented decision as a failure. Fewer helper invocations or needs-info labels
alone do not establish improvement; source/schema checks cannot prove semantic sufficiency.

## 6. Implementation allocation and operational impact

### Producer/repairer slice

The source baseline was `2f9469b`. The following reconciliations are implemented;
behavioral simulations, source review and operational acceptance are separate evidence.

- [to-spec](../../skills/workflow/to-spec/SKILL.md) reuses settled seams and preserves
  acceptance conditions/deferrals; parent publication no longer defaults to readiness.
- [to-tickets](../../skills/workflow/to-tickets/SKILL.md) owns brief construction and
  read-only sufficiency checks alongside its existing graph audit. It reuses sufficient
  scoped grants and verifies definitive publication before authorized state transitions.
- [humanify](../../skills/workflow/humanify/SKILL.md) consumes the same
  [handoff criteria](../../skills/workflow/to-tickets/references/implementation-handoff.md)
  without invoking ticket planning. It retains its repair, continuation and human-only
  branches, distinguishing authorized preparation from blocked execution.

Wayfinder phase routing, execution-consumer changes and the full visible flow map remain
unimplemented in this slice. No real fresh-worker construction or tracker pilot is claimed.

### Proposed order

This is the allocation, not an approved tracker graph, automatic dispatch authority or
proof of operational completion. Items 1–3 have a producer/repairer source implementation;
item 4 remains pending:

1. Snapshot current producer/repairer controls and freeze paired scenarios. Extract
   the shared brief/readiness criteria from humanify into one explicit shared reference
   associated with to-tickets. Other skills read the criterion without invoking its workflow.
2. Align to-spec's decision/acceptance synthesis and to-tickets' construction/authority
   handoff with that criterion. Keep existing graph and publication safeguards.
3. Align humanify to the same criterion and exception role; retain its continuation,
   readiness recording and human-only behavior. Existing commands remain valid.
4. Align Wayfinder's phase routing and execution consumers' changed-input checks;
   document the main flow. Do not add another router skill by default.

The shared reference is bundled under to-tickets' references and linked directly by all three
consumers; reading it invokes no workflow and changes no skill invocation mode.
Changes to skills need the repository's authoring/evaluation gate: pre-edit snapshots,
RED/GREEN regressions, paired behavior evidence, reference/install checks and qualitative
review. Static shape tests complement rather than replace fresh-worker outcomes.

- **Deploy:** none now; later skill installation/reload must be checked.
- **Migrate:** retain public names, existing trackers, project templates, comments,
  role mappings and claims; no bulk relabeling or automatic rewriting of old tickets.
- **Rollback:** scoped additive reversals of future changes; preserve briefs, decisions,
  evidence and user work rather than resetting occupied worktrees.
- **Observe:** saved comparison artifacts and measured questions/gaps/outcomes;
  no new persistent service or telemetry integration.

## Documents to keep aligned

The shared reference owns detailed brief criteria; individual skills own
process and authority. This spec owns intended behavior, not a competing runtime checklist.
Affected surfaces: to-spec/to-tickets/humanify and their evals; Wayfinder phase routing;
implement/implement-spec consumer checks where needed; the README flow map; CONTEXT
only for actually settled vocabulary. Setup/tracker contracts remain authoritative.
No ADR is added for a reversible proposed wiring change.
