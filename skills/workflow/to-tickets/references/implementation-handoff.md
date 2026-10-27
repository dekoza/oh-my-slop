# Implementation handoff criteria

Read this reference when producing or repairing an implementation brief. It is
shared reference, not an invocation of the ticket-planning workflow. Use the
project's authoritative brief format; the six facts below are sufficiency criteria,
not mandatory headings or a second template.

## Required facts

- **Outcome and limits:** one bounded, reviewable result; current versus desired
  behavior where relevant, and explicit exclusions.
- **Confirmed decisions:** material behavior, policy and interface choices with
  attribution and authoritative source pointers; preserve relevant rejected alternatives,
  negative requirements, approved amendments and deliberate deferrals. Mark unresolved proposals as such.
- **Construction starting point:** relevant responsibilities, accepted interfaces,
  expected prerequisite outputs and inspected code/test pointers. Distinguish
  verified existing inputs from future outputs. A fresh worker can find its start
  without reconstructing private chat or guessing between contradictory records.
- **Acceptance and verification:** independently checkable criteria, consequential
  failure behavior, agreed seams and applicable project check policy. Manual
  evidence has an owner. Planned checks are not passing results.
- **Ordering and impact:** accountable owner, inspected mutable impact, stable inputs
  and blocking edges; evidence for any proposed parallel set. Preserve graph policy.
- **Authority and residual work:** scoped grants and missing permissions, execution
  and publication boundaries, and each unfinished obligation's durable location,
  owner and next action. Preserve human-only outcomes and separate implementation.

## Concise briefs

Keep ticket-specific outcomes/exclusions, acceptance, mutable impact/edges, scoped authority
and residual owners in the brief. Use precise authoritative pointers (path and section,
contract version or decision/comment link) for shared foundations, verification policy and
workflow rules rather than copying those policies into every ticket. Name the applicable
checks and ticket-specific exceptions; a reference replaces boilerplate, not the six facts.
Pointers must be available to a fresh worker without private chat or temporary local files.
The builder and independent reviewer still gather applicable project standards themselves;
brief pointers do not transfer the builder's legwork to review.

## Sufficiency check

Read the current authoritative brief and governing amendments against the relevant
code, contracts and evidence. Reuse adequate verified evidence for unchanged inputs;
recheck affected facts when the candidate, environment or premise changes. A closed
or superseded blocker alone is not proof that its required output was delivered.

Investigate discoverable facts and repair drafting omissions within confirmed scope.
Ask humans only for consequential unresolved choices or missing authority; reuse
settled answers and explain the changed premise before reopening one. Leave routine
implementation choices to the implementer. Sufficiency is not exhaustive design.

A dependent brief may specify a known expected output before delivery. Retain its
blocking edge and resume condition. An undecided material interface or unknown impact
is a gap, not permission to invent a contract or approve concurrency. Complete
independent preparation while affected work remains provisional.

## Three independent checks

- **Brief:** sufficient facts at the agreed fidelity, or precise missing inputs.
- **Authority:** the actual human grant covers this checked scope and effects under
  project policy. Design confirmation, publication approval, recommendations and
  labels do not supply missing implementation/readiness authority. An explicit grant
  may combine effects; reuse it rather than ask again. For a newly audited graph, recommend
  one combined publication/readiness grant for sufficient slices, naming missing-input
  exceptions and human-only work. A historical parent-only publication grant does not select
  publication-only for the new graph. For that graph-publication decision, respect an
  explicit publication-only choice without another readiness question; never infer
  readiness from the planning invocation. A readiness-repair invocation follows its owning
  workflow's remaining decision sequence: a publication checkpoint is not itself a declined
  or deferred readiness decision.
- **Eligibility:** verified prerequisite outputs, tracker blocking relationships,
  ownership/claims and other execution gates allow work now. Prepared and authorized
  but blocked is not takeable; retain ordinary gates and any explicitly authorized
  supervised run-local exception without claiming tracker closure.

Use the configured existing label roles and recording convention, not a new state
vocabulary. An agent-ready role requires sufficient content and applicable scoped
human authority; it never proves execution eligibility. Human-only work keeps its
own outcome. A missing factual input differs from a missing human decision and from
an undelivered but well-defined prerequisite.

Publish the definitive brief and authority record, read them back, then apply only
the authorized state transition and verify the final content, state and edges.
For local files, record the brief in the configured preparation state first, read it
back, then record and verify the authorized final state. Reconcile uncertain writes
by reading before retrying; unresolved publication is not a successful handoff.
