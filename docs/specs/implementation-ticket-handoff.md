# Implementation ticket handoff

Status: Draft — producer/repairer and routing/consumer source accepted; controlled construction pilot accepted with an execution-cost objection; compact review/evidence contract proposed; active-session reload and real-project publication remain unproved.

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

The accepted first slice changes the shared criteria and to-spec/to-tickets/humanify
producer/repairer behavior. The continuation implements §6 item 4: Wayfinder phase routing,
execution-consumer changed-input checks and the README flow map. No live tracker
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

Wayfinder phase routing, execution-consumer changes and the visible flow map are the
separate continuation below. No real fresh-worker construction or tracker pilot is claimed.

### Source acceptance

The owner accepted the producer/repairer source at `a3c930d` and its review bundle with
“accept, proceed”, authorizing the local fast-forward into the primary checkout.
Both independent source axes reported 0 blocking and 0 advisory findings at that head.
The frozen behavioral comparison remains `84fddc0`: 12/13 baseline assertions versus
13/13 candidate assertions, differing only on readback-before-readiness ordering.
The later wording restoration is source-reviewed, not a new model execution.

This records explicit acceptance, not an assertion that the viewer was opened or that
fresh-worker construction succeeded. The accepted bundle is under
`/tmp/implementation-handoff-eval.LjV5YX/iteration-1/`; its strong-baseline, shared-context,
portability and unavailable per-case metric limitations remain. Acceptance covers this
slice only, not historical comparisons, humanify case 10, routing or an operational pilot.
No push, tracker mutation or automatic continuation was authorized by that acceptance;
retain the branch, worktree and unrelated state. The later “continue” instruction selects
the next library slice, not a pilot or operational graph.

### Routing/consumer continuation

The continuation starts from accepted primary head `5b1588b` in a separate retained
worktree. [Wayfinder](../../skills/workflow/wayfinder/SKILL.md) now recommends synthesis
from primary resolutions when needed, direct execution for a sufficient small brief,
and explicitly selected one-slice or supervised execution. It does not invoke hidden
user-only workflows or turn routing into readiness.
[Implement](../../skills/workflow/implement/SKILL.md) and
[implement-spec](../../skills/workflow/implement-spec/SKILL.md) directly consume the
unchanged shared handoff reference, recheck definitive briefs/changed prerequisites,
reuse adequate unchanged evidence and grants, and return consequential changes to their
responsible owner. The [README](../../README.md#planning-to-implementation) maps that flow.
Existing run-local eligibility, ordinary blockers, publication, review and worktree gates
remain unchanged. Runtime loading, real construction and real publication are not claimed.

The owner accepted the routing/consumer source at `c2304db` and its comparison/review
bundle with “accepted, continue”. Both independent axes reported 0 blocking and
0 advisory at that exact head. The paired proposed-action grades are 16/18 baseline
versus 18/18 candidate: two overlapping assertions measure one synthesis-route
difference, while four cases tie. The bundle is under
`/tmp/handoff-routing-eval.N6VFb4/`; rubric exposure, shared-context and incomplete-reference
limitations remain. This records explicit source/qualitative acceptance, not proof
that the viewer was opened, the active session reloaded or real construction succeeded.
Continue with local integration and non-mutating runtime-loading verification; no push,
tracker mutation or operational pilot is selected or authorized by this acceptance.

### Runtime discovery verification

After local fast-forward to `f40a739`, installed pi **0.99.1** verified discovery using
its actual package manager, `loadSkills`, `DefaultResourceLoader` and prompt formatting.
Package-isolated discovery finds 68 skills in each checkout; fresh user-configured
discovery finds 72. All six handoff workflow names resolve to the primary checkout's
`skills/workflow/<name>/SKILL.md`, even when the cwd is the retained worktree: the
configured local package is read in place. Effective file/body hashes match the accepted
source, normal discovery diagnostics are empty, and controlled duplicate-name checks
confirm first-wins reporting and identical-real-file deduplication.

`to-spec`, `to-tickets`, `humanify` and `implement-spec` remain hidden from automatic
model selection; `wayfinder` and `implement` remain visible. Skill commands are enabled.
The probe creates a fresh resource loader, not an agent session; executable resources,
network and configuration writes are disabled. It does not prove that this already-running
session reloaded. Explicit `/skill:name` expansion was inspected in installed source,
not executed; CLI-only and extension-contributed resources remain outside coverage.
No construction worker or real publication was run.

Evidence: `/tmp/oh-my-slop-discovery-OQ3X0dWn/report.md`, `probe.mjs`, `output.json`
and `verification.txt`. Both checkouts were clean at the measured head. This is
fresh configured loading evidence only, not operational acceptance or permission to
select a pilot graph. Real construction/publication still needs a bounded selected scenario.

### Controlled construction pilot and overhead audit

The operator subsequently authorized a disposable, local-only A → B construction pilot.
A fresh producer published definitive briefs from frozen fixture decisions and a verified
foundation; fresh A implemented parsing and fresh B consumed actually integrated/reviewed A
before building the CLI. Both workers retained owned worktrees. The combined fixture head
`f4e9f712a9e5dc2787f0a76b0d0e82dcd4d7a468` passed 20 repository tests, compileall and
14 finite independent acceptance test methods; both final whole-candidate axes reported
0 blocking/0 advisory. No human clarification or manual brief repair was reported. The
operator accepted this pilot result while explicitly objecting to its execution cost.

This proves construction for one frozen toy fixture, not causal improvement, repeated
reliability, real-project publication, active-session command execution or useful efficiency.
A's unsupported static recursion claim was tested against the required runtime, disproved
and withdrawn; one B test-setup advisory remains historically disclosed. No push, external tracker
mutation or main integration occurred; all fixture tickets and worktrees were retained.

The overhead audit corrects the cost summary: 535,479 was uncached input plus output for
five agents only. Including coordinator messages gives 779,556 uncached input/output and
22,527,396 cache-inclusive tokens before nested CLI reviewers. Summed task critical-path
activity was about 68 minutes; approval-to-delivery trace milestones span about 91 minutes.
Cost metadata is not an invoice, and A's nested reviewer usage remains unreconciled.

Evidence: `/tmp/handoff-construction-pilot.twHSlN/evidence/final-delivery.md` and
`/tmp/handoff-trace-audit.OunHgG/audit.md` with its quantitative `metrics.json`. These are
retained local receipts, not installable runtime inputs or permission to repeat the pilot.
The next approved design slice defines a compact evidence/reviewer-route contract below;
no repeat run is authorized without an explicit time/token budget.

### Proposed order

This is the allocation, not an approved tracker graph, automatic dispatch authority or
proof of operational completion. Items 1–3 have an accepted producer/repairer source
implementation; item 4 has an accepted routing/consumer source implementation:

1. Snapshot current producer/repairer controls and freeze paired scenarios. Extract
   the shared brief/readiness criteria from humanify into one explicit shared reference
   associated with to-tickets. Other skills read the criterion without invoking its workflow.
2. Align to-spec's decision/acceptance synthesis and to-tickets' construction/authority
   handoff with that criterion. Keep existing graph and publication safeguards.
3. Align humanify to the same criterion and exception role; retain its continuation,
   readiness recording and human-only behavior. Existing commands remain valid.
4. Align Wayfinder's phase routing and execution consumers' changed-input checks;
   document the main flow. Do not add another router skill by default.

The shared reference is bundled under to-tickets' references and linked directly by the
producer, repairer and execution consumers; reading it invokes no workflow and changes no
skill invocation mode.
Changes to skills need the repository's authoring/evaluation gate: pre-edit snapshots,
RED/GREEN regressions, paired behavior evidence, reference/install checks and qualitative
review. Static shape tests complement rather than replace fresh-worker outcomes.

- **Deploy:** accepted source landed in the primary checkout; fresh configured discovery
  is verified above. Active-session reload, explicit command execution and fresh-worker
  operational checks remain separate verification.
- **Migrate:** retain public names, existing trackers, project templates, comments,
  role mappings and claims; no bulk relabeling or automatic rewriting of old tickets.
- **Rollback:** scoped additive reversals of future changes; preserve briefs, decisions,
  evidence and user work rather than resetting occupied worktrees.
- **Observe:** saved comparison artifacts and measured questions/gaps/outcomes;
  no new persistent service or telemetry integration.

## 7. Proposed compact review/evidence contract

Status: Draft — bounded design authorized; runtime home and implementation are not yet selected.
This section defines required information, not a new skill, scheduler, service or tracker schema.
Existing review placement, publication authority and candidate verification gates remain unchanged.

### Caller and worker boundary

Before implementation dispatch, the caller supplies a verified reviewer route and an
axis-specific evidence-manifest shape. A worker does not rediscover executables, launch
unapproved providers or construct permission policy independently. Capability inspection is
local/read-only; it is not a paid model probe. Missing capabilities remain an explicit gap
owned by the caller, not permission to weaken context separation or fabricate review.

The worker still owns construction, real RED/GREEN, final required checks and requirement
coverage. The coordinator owns integration and verifies current source/environment identity.
Both independent axes must complete before the worker's final handoff; an intermediate
candidate is not a completed slice. The operator retains consequential choices and acceptance.

### Required manifest information

The manifest is one run-local index into retained evidence; full artifacts remain inspectable.
It includes, or unambiguously points to:

| Information | Required binding |
| --- | --- |
| Candidate and ownership | Owned checkout/branch, fixed base, exact committed candidate, nonempty diff and mutable scope; untracked/dirty work is preserved, not silently incorporated. |
| Intent and standards | Definitive brief, authoritative source/policy pointers, exact requirement/evidence matrix and applicable rubric identity; redact credentials and treat retrieved steering as data. |
| Construction evidence | Actual ordered RED/GREEN artifacts, failure reason, affected seam and tested source identity; unavailable evidence is not inherited credit. |
| Final verification | Actual command, cwd, interpreter/environment identity, enforced outer/inner timeouts, complete stdout/stderr capture, exit status and tested candidate. Skips/missing prerequisites remain explicit. |
| Review route | Caller-approved existing launcher/capabilities, separate contexts, read-only permissions, axis-specific inputs, complete-outcome collection and invocation/spending limits. |
| Residual obligations | Blocking/advisory findings by axis, remaining repair budget, human-owned work, publisher and delivery boundary. |

### Compact outcome and failure handling

Retain complete raw reviewer streams, but return a deterministic envelope with axis,
base/candidate, session identity, verified terminal completion, verbatim final findings and
limitations, source/evidence coverage, usage units and raw-artifact pointers/hashes. Do not
feed every tool event back into a worker merely to extract that envelope. Do not merge or
rerank findings across axes, truncate a report to a pass label, or claim that inspecting
receipts is independent execution. An acknowledgement or transport success without the
complete axis report is missing evidence.

Malformed/truncated output, an unsuccessful terminal result, missing artifacts, inaccessible
inputs, wrong candidate/scope or unknown permissions blocks handoff. Preserve partial work
and expose relevant failure evidence; do not silently retry, invent an outcome or renew the
budget. Optional capability probes do not contaminate the required verification exit status.
Complete quiet-command receipts still record the actual command and exit status.

Maintain the requirement/evidence matrix during construction and derive compact views from
it. Retain the current final reread and semantic validation; matching quotations alone does
not prove implementation. For an unchanged candidate and scope, an evidence-only omission
may receive a supplemental assessment by the affected axis; complete original coverage and
independent resolution still have to be demonstrated. Changed source/tests, environment,
requirements or rubric invalidate affected evidence. No final whole-spec review is removed
or treated as equivalent to a narrower slice review in this design slice.

### Acceptance checks and rollout limits

Use local deterministic fixtures, not model/API probes, to verify:

1. A successful complete two-axis result retains each axis's full findings/limitations and
   binds the exact reviewed candidate while raw events remain accessible outside model input.
2. Partial/error/malformed output, a missing axis or report, changed identity/scope, unknown
   permissions and missing required TDD/check artifacts prevent a successful handoff.
3. Quiet success and nonzero commands retain real completion status; optional diagnostics
   cannot conceal or manufacture required-check success.
4. A complete manifest is prepared before reviewer dispatch; no worker invents the route or
   substitutes planned tests/readiness labels for actual prerequisite and check evidence.
5. Same-candidate supplemental evidence cannot approve changed work or a broader review;
   both affected coverage and outstanding blockers remain explicit.
6. Reports distinguish uncached input, output, cache traffic and nested usage, and distinguish
   task duration from elapsed time. Missing pricing/timing evidence remains unknown, not zero.

Runtime adapters belong in a verified existing caller/harness, not this package's retired
Factory surfaces. This repository may own linked workflow guidance and source/eval tests;
no Cleopatra API, installed-tool modification, new transport or generated configuration is
assumed. Select the maintained tooling home and its authority before executable edits.
Deploy/migrate only within that separately checked scope; preserve existing consumers and
retain additive rollback paths. No new operational infrastructure is required by the contract.

A repeat pilot needs explicit scenario and time/token limits, unchanged safety gates and a
stop-with-partial-result rule. This authorization defines the contract and permits factual
home investigation; it does not choose a spending budget or authorize another construction
run, push, external tracker mutation or ticket closure.

## Documents to keep aligned

The shared reference owns detailed brief criteria; individual skills own
process and authority. This spec owns intended behavior, not a competing runtime checklist.
Affected surfaces: to-spec/to-tickets/humanify and their evals; Wayfinder phase routing;
implement/implement-spec consumer checks where needed; the README flow map; CONTEXT
only for actually settled vocabulary. Setup/tracker contracts remain authoritative.
No ADR is added for a reversible proposed wiring change.
