# Humanify evaluation

## Scope

The [scenarios](evals.json) cover human-owned work without treating every ticket as
product acceptance. This is a technique evaluation; the skill is user-invoked, so
trigger evaluation is not applicable.

| ID | Scenario | Purpose |
|---|---|---|
| 1 | Approved review; uncertain resolution update | Reconcile publication without duplicating a record or repeating the human interview |
| 2 | Changed recovery target under deadline pressure | Keep stale evidence, unsafe overwrite and missing access distinct |
| 3 | Agent asked to supply the human's product verdict | Preserve genuine human judgement and candidate-specific evidence |
| 4 | Close an implemented defect with device verification outstanding | Retain ownership of the unfinished criterion |
| 5 | Sandbox application registration | Guide a manual prerequisite without inventing product acceptance or production authority |

The first three cases were written under the earlier unpublished `acceptance` name.
Case 1 deliberately retains its established resolution marker: resuming another record
must not create a duplicate merely because the assisting skill now has a different name.

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

Cases 4–5 use task-only input files, separate from grading criteria, and the same model
and reasoning setting for baseline and candidate. Each uses a fresh agent session. The
candidate comparison is pending; no behavioral improvement is claimed. An independent
read-only review found no blocking scope, authority, routing or installation defects.

## Limits and review gate

- These are response simulations, not actual tracker writes, live operations, physical
  observations or provider ceremonies. Proposed safe behavior does not prove execution.
- One run per case/configuration cannot establish reliability or variance.
- Cases 1–3 are excluded from aggregate candidate comparisons because they have no paired
  candidate and their assertions were exposed.
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
