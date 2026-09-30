# Routing and execution-consumer comparison

## Source scope

This continuation implements §6 item 4 of the
[handoff spec](../../../../docs/specs/implementation-ticket-handoff.md): Wayfinder
phase routing, `implement`/`implement-spec` changed-input checks and the README flow
map. It starts from the accepted producer/repairer primary head `5b1588b` and preserves
public names, invocation modes, configuration, labels and existing execution gates.
It is a local source candidate, not acceptance of a deployed workflow.

Wayfinder cases 1–2 now distinguish a usable spec and sufficient scoped authority
from mere decision/publication approval. They recommend explicitly selected workflows
rather than automatically invoking them, and keep readiness separate from routing.
Those revised controls and unchanged cases 3–4 have not had new paired model runs.

## Frozen comparison

The pre-edit snapshots and five paired scenarios are in
`/tmp/handoff-routing-eval.N6VFb4/`. The snapshot comes from `5b1588b`; the immutable
candidate skill bodies match the source through `2595b9a` (later commits add docs only).
The standard benchmark and viewer were generated in its `iteration-1/` directory.
Human qualitative review remains pending; no improvement is inferred merely from
generating that viewer.

Independent grading reports **16/18 baseline assertions versus 18/18 candidate**.
Both baseline failures occur in Wayfinder 5 and count the same synthesis-before-tickets
routing difference twice. Four cases tie completely; 16 paired assertions already pass
at the base and no assertion regresses. The benchmark averages cases equally (90%
baseline versus 100% candidate), rather than weighting all assertions equally. This is
one proposed routing difference, not two independent improvements or operational proof.

- Wayfinder 5: scattered primary decisions require usable spec synthesis before
  ticket construction; preserve the deferred export and missing publication/execution
  authority. The baseline recommends `to-tickets` as the next phase, although it does
  gather primary resolutions and preserve exclusions. The candidate recommends
  `to-spec` before `to-tickets`.
- Wayfinder 6: a sufficient small brief needs direct one-slice execution, no artificial
  spec or routine humanify; routing labels do not authorize human-only work.
- Implement 13–14: inspect changed prerequisites rather than accept closed blockers
  as delivered interfaces; pause consequential changes for their owner, reuse unchanged
  verified evidence and grants, and leave ordinary choices to the implementer.
- Implement-spec 4: recheck the definitive brief before dispatch against the actual
  integration candidate and approved scope; preserve the explicit run-local exception
  when inputs are unchanged rather than demand global blocker closure.

Both configurations use the same frozen prompts, provided facts, proposed-action tool
boundary and default general-purpose agent configuration without model/thinking overrides.
Captured transcripts verify `openai-codex/gpt-6.1-sol` with high reasoning for both.
Each executor answers all five cases in shared context; these are not independent
trials or fresh construction workers. Supporting project/tracker/discipline references
are incomplete. The baseline reads sibling worker/coordinator guidance; the candidate
also follows its new direct pointers to the unchanged shared criteria. That is package
routing behavior, not a comparison isolating one sentence.

**Rubric exposure:** both executors read `cases.json`, which contains expected outputs
and assertions despite instructions not to treat them as task instructions. This limits
causal interpretation. The prompts are leading and the baseline already proposes safe
behavior on changed inputs and existing authority. No broad safety, effort or general
behavioral improvement is established by this sample.

`group-metadata.json` records executor provenance and source checksums. Per-case costs
and timing are unavailable; null metrics or viewer defaults are not measured zero
cost. Formal grades cite proposed actions only. No real workers,
tracker writes, publication, primary integration, services or paid external CLI sessions
were run. Fresh-worker construction, runtime loading and operational publication remain
separate, explicitly authorized acceptance work.

## Static regression evidence

Targeted regressions first failed with the consumer criterion links, Wayfinder phase
route and README flow absent, then passed with those source changes. A case-sensitive
human-only assertion was corrected without changing the requirement. The relevant tests
are `tests/test_implementation_handoff.py`,
`tests/test_wayfinder_implementation_routing.py` and `tests/test_readme.py`.
Reference, frontmatter and package-install checks pass. These are instruction and
installation-contract checks, not proof that a model executes the workflow correctly.

The full Python suite reports 933 passed and two failures in unchanged
`refine-ticket`/`revmerge` prompt contracts; their tests/templates are identical to the
base and contain the same missing strings. The affected selection passes 395 tests,
the reference validator exits successfully, and all 36 Node tests pass. The unrelated
prompt defects are preserved, not silently bundled into this continuation.
