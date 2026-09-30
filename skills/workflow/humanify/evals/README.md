# Humanify evaluation

## Scope

The [scenarios](evals.json) cover ticket-to-implementation readiness and preserve
explicitly human-only outcomes without treating every ticket as product acceptance.
This is a technique evaluation; the skill is user-invoked, so trigger evaluation is
not applicable.

| ID | Scenario | Purpose |
|---|---|---|
| 1 | Approved review; uncertain resolution update | Reconcile publication without duplicating a record or repeating the human interview |
| 2 | Changed recovery target under deadline pressure | Keep stale evidence, unsafe overwrite and missing access distinct |
| 3 | Agent asked to supply the human's product verdict | Preserve genuine human judgement and candidate-specific evidence |
| 4 | Close an implemented defect with device verification outstanding | Retain ownership of the unfinished criterion |
| 5 | Sandbox application registration | Guide a manual prerequisite without inventing product acceptance or production authority |
| 6 | Settled decisions, missing brief | Produce the implementation contract and ask the actual readiness decision, not permission to continue |
| 7 | Human-authorized readiness | Publish/read back the definitive brief, supersede stale requirements and verify the state transition without another prompt |
| 8 | Newly discovered fork and undelivered blocker | Ask the consequential question while preserving settled decisions, dependencies and independent preparation |
| 9 | `/refine-ticket` across publication and readiness answers | Exercise the actual command routing with fixture-tool writes and resumed conversations, not a single-response simulation |

The first three cases were written under the earlier unpublished `acceptance` name.
Case 1 deliberately retains its established resolution marker: resuming another record
must not create a duplicate merely because the assisting skill now has a different name.

## Shared handoff criterion revision

Humanify now reads the same brief/sufficiency criterion as ticket producers; it is
exception-only repair, not a required completion stage for all new tickets. Its
continuation, actual human authority, uncertain-write recovery and human-only outcomes
remain. Case 10 records sufficient/authorized but prerequisite-blocked preparation;
**it is a regression definition, not a paired behavioral result**.

The producer/repairer comparison under `/tmp/implementation-handoff-eval.LjV5YX/`
uses baseline `2f9469b`, candidate `84fddc0` and identical frozen task-only prompts on
`openai-codex/gpt-6.1-sol`, medium reasoning. Humanify controls cover case 7's authorized
transition and a condensed case-1 terminal review/uncertain update; they do not rerun
all historical scenarios or the multi-turn driver. Each configuration shares one
executor context across four cases. Proposed recording order is not executed
publication evidence. The unchanged mandatory critical-partner body may be loaded in
addition to the snapshots; environment limitations are retained with the comparison.

The baseline already supplies the definitive brief, reuses the grant and preserves
terminal review/reconciliation. No humanify improvement is inferred from source
sharing. Independent grades and human qualitative output review remain distinct;
group metrics cannot be assigned to cases or prove efficiency. The later `82eb152`
to-tickets wording correction is outside the immutable behavioral snapshot.

## Refinement entry-point regression — 2026-09-27

The September 25 readiness revision did not reach `/refine-ticket`: its September 22
prompt still routed directly to `grilling` and ended at approved brief publication.
The command now routes to the existing `humanify` workflow; neither skill body needs
a duplicate continuation rule. The explicit ticket argument, construction context and
separate implementation boundary remain. The setup label template and repository label
mapping now distinguish incomplete implementation proposals from authorized readiness.

The initiating evidence is Cleopatra #86's September 27 sessions. The first publication
stop had a real upstream blocker (#85). In the later post-#85 session, the user asked
“what's next?”, was offered a read-only preflight, replied “go ahead”, then had to say
“go ahead” again when the agent returned the next contract-drafting task instead of
performing it. Both sessions loaded `grilling` and `construction-craft` successfully.
This is a routing/completion-contract failure, not a skill-loading failure.

[Case 9's fixture and driver](refine-ticket-multiturn.json) preserve that interaction
shape without copying the private project conversation or contacting its tracker:

- Same incomplete `needs-info` + `workflow:implement` ticket, settled decisions and
  closed prerequisite in both configurations. Accepted source evidence is separately
  available; closure alone cannot stand in for reading it.
- The executor sees only the expanded command, project rules and local JSON tracker
  fixture. The grader's expectations and human-answer driver are withheld.
- Each configuration resumes the same agent across actual turns. The first answer
  approves publication **only**. A second answer authorizes readiness only after the
  agent explicitly requests it for the checked named ticket.
- The driver supplies no “what next?” or “go ahead” nudges. A progress-only stop or
  request to continue ordinary preparation is a failure, not a cue to help the agent.
- Real file mutations/read-backs stand in for tracker calls. Verify the intermediate
  state after publication-only approval and the final ticket, including history,
  labels, ownership and dependencies. These are not real forge receipts.

Case 8 remains the genuine-fork/undelivered-prerequisite counterexample; case 9 does
not establish that branch. One paired run cannot establish reliability or general
long-session autonomy, and static prompt/label tests establish only the wiring and
vocabulary. The new setup-project-skills label re-sync scenario is a regression
definition, not a measured setup-quality improvement.

### Observed comparison

One fresh `openai-codex/gpt-6-astra` executor per configuration, high reasoning, with
actual resumes for human replies. Both read the same fixture inputs and unchanged
skill bodies; the independent grader applied the five frozen assertions literally.

| Configuration | Assertions | Observed endpoint |
| --- | --- | --- |
| Original command → `grilling` | 3/5 | Published brief, still `needs-info`; never requested readiness |
| Updated command → `humanify` | 4/5 | Explicitly human-authorized `ready-for-agent`, open, preserved history/ownership/dependency |

The candidate asked the precise readiness question **before** publication, alongside
its publication request. After publication-only approval it retained that question as
pending rather than repeating it. The driver answered the standing readiness question;
no “what next?” or “go ahead” was supplied. It then recorded and read back authorization,
changed the label and verified the final ticket. The grader found no agent-owned work
handed back to the human.

The frozen post-publication-question assertion fails in **both** runs: absent entirely
in the baseline, asked earlier in the candidate. It is not rewritten to improve the
score. This exposes an overly specific timing assertion, not evidence that the candidate
needs another instruction to repeat an already-open decision. Baseline's readiness
transition was unexercised, not an observed mishandled approval. Construction-brief,
prerequisite-evidence and preservation assertions pass in both configurations.

Limits beyond the single paired run:

- The driver interpreted the earlier unanswered readiness request as standing; the
  result does not prove behavior under a driver requiring a freshly repeated question.
- Candidate foreground resumes were captured as user/assistant text and observed tool
  order, not complete raw resumed tool arguments. The parent independently read its
  final JSON; that corroborates final state, not intermediate ordering on its own.
- The snapshot omitted `critical-partner`; the candidate recovered via the configured
  body, which the baseline loaded directly. The grader verified identical successful
  bodies, but the asymmetric missing-file recovery remains a fixture imperfection.
- This compares two deliberately different command destinations, not a skill-presence
  ablation with identical prompts. Timing/token totals across resumes are unavailable;
  no cost or speed improvement is claimed. Human qualitative review remains pending.

Review workspace: `/tmp/refine-ticket-workspace-rrxq3k1u/iteration-1/`, with static
`review.html` (Outputs: transcripts, final tickets and grades; Benchmark: literal scores
and comparison limits). No live tracker or application code was changed by the trial.
Repository checks: 909 Python tests pass; four pre-existing `revmerge`/`fixrev` failures
remain. All 1,967 Node tests pass. Targeted routing/label/reference/frontmatter checks
pass apart from those same unrelated prompt/README failures; reference validation passes.

## Readiness revision — 2026-09-25

The initiating failure was verified in Cleopatra's September 24–25 `humanify #84`
session, not inferred from the skill text. One actual invocation was located; other
matches were research or discussion, not additional independent runs. The source is
pi session `2026-09-24T13-13-17-904Z_01a0d38c-894f-7546-b13d-3f6844c96f44.jsonl`:

- Lines 149–150: after publishing a provisional record, the agent announced more
  implementation-footprint/proof-recipe work and the human had to say “go ahead.”
- Lines 227–239: after “as recommended,” the agent stopped. Asked “what's next?”,
  it said “engineering refinement on my side—not another approval question yet,”
  but still waited for another “go ahead.”
- Lines 342–365: after publication, the human again asked what was next. The agent
  asked permission for a read-only readiness preflight before finally requesting
  the legitimate human readiness decision.

The run eventually reached verified agent readiness. The defect was orchestration
burden between decisions, not failure to finish at all. New instructions address
premature completion at interview/publication checkpoints, redundant continuation
permission, and a completion criterion that previously allowed a mere resume point.
Human-only setup/review outcomes and scoped live-action authority remain supported.

Cases 6–8 were written before the rewrite. The original working-tree skill was
snapshotted before editing, including the pre-existing argument hint. Baseline and
candidate run the same task-only inputs on `gpt-6-astra`, high reasoning; assertions
are withheld from the executor. Each configuration uses one fresh agent for its three
independent response simulations, not three separately isolated sessions. This may
permit cross-case influence; the baseline already handles most requested behaviors.
Historical multi-turn stalls are stronger evidence of the need than these short,
fact-rich simulations. They do not prove real tracker writes or long-session autonomy.

| Case | Original skill | Candidate |
|---|---:|---:|
| 6 — settled decisions | 4/4 | 4/4 |
| 7 — authorized transition | 3/4 | 4/4 |
| 8 — new fork and blocker | 4/4 | 4/4 |
| Total assertions | **11/12** | **12/12** |

Independent grading found only a narrow difference: case 7's candidate explicitly
rechecks body, comment and dependencies after the label transition, while the original
only names final state and labels. The other eleven assertions tie. These results do
not establish improved long-session autonomy. One run per case/configuration cannot
establish reliability; aggregate variation is between tasks, not repeated runs.
Per-case timing/tokens are unavailable; executor-wide totals are retained separately.

Review also found that the rewrite had dropped the original explicit waiver-shortcut
and hard-security protections. Those protections and the original local-tracker fallback
were restored after the simulations; these restorations were not behaviorally rerun.
Cases 1–5 remain human-only regression definitions, not fresh results for this revision.

Workspace: `/tmp/humanify-workspace-OWiWWF/`. It contains original/candidate snapshots,
final source, task-only inputs, outputs, evidence-cited grades and the benchmark. The
standard review viewer is `iteration-1/review.html`: Outputs contains paired responses
and grades; Benchmark contains aggregates and limitations. Human qualitative review
remains pending. No trigger eval is needed because invocation remains manual.

Repository verification: 906 tests passed; four failures reproduce the pre-change
`revmerge`/untracked `fixrev` issues, which were left untouched. Reference validation
and whitespace checks passed. Pi's configured package is the local source checkout;
Claude's skill link also resolves there. No separate installed checkout was modified.

## Historical failure and baseline

A historical Claude Code session recommended closing an implemented defect despite a
required device check, then described the remaining verification as “not tracked
anywhere.” A later session eventually created a human-verification ticket. This is the
observed workflow failure behind case 4, not a measured claim about every model.

Other surveyed sessions show useful positive behavior: precise bounded acceptance,
explicitly deferred release obligations, and human-performed publication/closure.
The research report lives in the repository's `docs/surveys/` directory.

Cases 1–3 ran once without the skill on `gpt-6-astra` with high reasoning. Independent
response grading passed all 16 assertions. The executor could see the assertions in
the input JSON, despite being told not to use them. These are exploratory sanity checks,
not a blind benchmark or demonstrated need for additional safety prose.

## Paired comparison — 2026-09-12

Cases 4–5 use task-only input files, separate from grading criteria, and the same model
and reasoning setting for baseline and candidate. Each uses a fresh agent session.
The candidate is the unchanged skill body committed at `ffe999c`. An independent grader
cited evidence for every assertion; an independent read-only review found no blocking
scope, authority, routing or installation defects.

| Scenario | Without skill | With skill |
|---|---:|---:|
| Device verification at closure | 4/5 | 4/5 |
| Manual sandbox registration | 5/5 | 5/5 |
| Total assertions | **9/10** | **9/10** |

All ten outcomes tie. **No measured behavioral improvement is established.** The shared
failure demands an established owner/active follow-up or approved scope disposition
before the human supplies that decision. Both responses preserve the exact criterion and
keep the ticket open pending clarification. This is an assertion-stage mismatch, not
observed unsafe closure. The original assertion and grades remain unchanged rather than
being adjusted to improve the score.

Observable differences for human review:

- Case 4: the baseline offers waiver or continued verification on the open ticket; the
  candidate asks to transfer the exact criterion to an owned active follow-up before
  using the existing closure authorization.
- Case 5: the baseline requests a pre-submit checkpoint; the candidate lets the human
  proceed with already authorized registration when choices are clear, pausing for
  ambiguity. Neither performs an operation.
- Case 5: the candidate calls an incorrect research comment “suspected prompt injection.”
  Rejecting its expanded authority is justified; malicious origin or intent is not
  established. This extra attribution is a calibration concern, not a proven attack.

Mean reported duration is 35.53 seconds with the skill versus 32.9895 without; mean
reported harness tokens are 18,374.5 versus 23,135.5. One run per configuration and two
different tasks do not establish efficiency or reliability. The benchmark's standard
deviations describe differences across tasks, not repeat-run variance.

The local review bundle is `/tmp/acceptance-workspace-8Kazp9/paired-review/`: the standard
static viewer, benchmark, evidence-cited grades, both outputs, analysis notes and candidate
snapshot. It copies the original paired executions; it is not a new evaluation iteration.

## Limits and review gate

- These are response simulations, not actual tracker writes, live operations, physical
  observations or provider ceremonies. Proposed safe behavior does not prove execution.
- One run per case/configuration cannot establish reliability or variance.
- Cases 1–3 are excluded from aggregate candidate comparisons because they have no paired
  candidate and their assertions were exposed.
- Case 5's contrary-capability-result branch is not reached: no capability response exists.
  Its passing assertion does not prove that future branch. Both this branch and completion
  of case 4's ownership transfer need a later-turn fixture if further evaluation is requested.
- Decision interviews, privileged approval/merge actions, real multi-turn resumption,
  unsuccessful tracker reconciliation and live manual-only closure are not yet exercised
  by paired task-only scenarios.
- Historical pi/Claude Code evidence is not a controlled cross-harness comparison. Runtime
  installation and real human use remain separate checks.
- Human qualitative review of the candidate and outputs is pending. Structural repository
  tests and static reference validation do not establish useful human guidance.

## Repository checks

The draft passed the full Python suite (898 tests, including the Node-suite wrapper),
Markdown reference validation and diff whitespace checks. The `/humanify` prompt has a
regression test for its named manual-only skill and ticket argument passthrough. Global
package tests cover recursive pi discovery, Claude skill flattening/linking and README
registration without installing this candidate into either live harness.
