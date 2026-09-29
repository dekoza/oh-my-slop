# Scaffold-first and impact-surface evaluation

## Purpose

The [scenarios](evals.json) reproduce the Cleopatra coordination lesson: shared
foundations need enforced order, not promises to synchronize. They cover a new
controller under deadline pressure, overlapping work in an existing application,
and genuinely independent plugins whose impact can later change.

This is a technique evaluation with discipline pressure cases. The skill remains
user-invoked; trigger evaluation is not applicable.

## Observed comparison — 2026-09-10

The original skill was snapshotted from commit `d695e01` before editing. Baseline
and candidate used the same prompts, harness-default model and medium thinking.
Each configuration used one fresh agent session for all three scenarios. A separate
grader checked the original assertions and actual declared graph paths against the
saved outputs. No live tracker or implementation was exercised.

| Scenario | Original snapshot | Candidate |
| --- | ---: | ---: |
| New controller | 1/4 | 4/4 |
| Reporting and contract revisions | 2/5 | 5/5 |
| Independent plugins; changed registry impact | 3/4 | 4/4 |
| Total assertions | **6/13** | **13/13** |

Concrete output differences:

- **Scaffolding order:** the baseline made four executable contracts unblocked and
  put shared setup in ticket 5, blocked by those contracts. The candidate put
  scaffolding first, then common conventions, then executable contracts.
- **Shared files:** the baseline permitted A/B together because “shared files
  without shape changes do not create an edge.” The candidate added A→B for the
  registration and fixture mutations, despite different hunks.
- **Contract revisions:** the baseline made both revisions unblocked. The candidate
  ordered them and withheld approval while exact ownership/footprints were unknown.
- **Changed impact:** the baseline kept registry additions concurrent unless the
  interface changed. The candidate required a pause, updated declarations and an
  ordering edge before resuming.
- **Positive control:** both versions allowed the inspected disjoint JSON/CSV plugin
  changes together and avoided redundant scaffold/contract tickets.

These observations address premature completion of graph planning and remove stale
exceptions in the old policy. They do not establish general planning reliability.

## Limits and review status

- Human qualitative review is pending; these counts are objective assertion results,
  not a claim of accepted skill quality or build readiness.
- One run only; scenarios shared context within each configuration. No repeat-run
  variance or per-scenario timing/token estimate is available.
- Six assertions passed both configurations. Some assertions overlap, so the total
  does not represent thirteen independent safety demonstrations.
- The integration-gate assertion has an ambiguous negative formulation. The grader
  required actual collision paths rather than merely prose rejecting shortcuts;
  that interpretation fails the baseline despite its anti-shortcut language.
- Missing coverage includes mixed serial/parallel graphs after uncertainties resolve,
  cycle repair, distinct-file shared invariants, live dependency publication/read-back
  and real running-worker pause/resumption.
- Both outputs add product/consumer follow-ups; their useful scope and session size
  remain human-review questions.

## Repository verification

Historical results below predate Factory retirement. They describe the recorded
candidate commits, not the current skill body or an available Factory runner.

At candidate commit `28492e3`, the targeted ticket/skill/reference checks passed
(**358 tests**) and the reference validator passed. The full Python suite reported
**887 passed, 1 failed**; its Node-suite wrapper reported **1908 passed, 1 failed**.
The sole Node failure requires a configured `gitea` remote for the repository's own
Factory configuration. The same named test fails in the unchanged primary checkout.
No remote configuration or unrelated Factory source was changed to make it pass.

Static prose checks protect policy presence and existing ticket conventions. The
scenario comparison supplies separate behavioral evidence; neither proves that a
production controller enforces the emitted graph.

### Canonical source verification

The operator identified `/home/minder/projekty/oh-my-slop/` as the source repository.
Only the two task commits were transferred into its dedicated worktree, based on
Gitea main `c14d4ff`; unrelated source work was preserved. The skill body is
byte-identical to the evaluated candidate. Source commit `f8bfd07` passed the full
Python suite (**888 tests, including the Node-suite wrapper**) and reference
validation. The source checkout has the expected `gitea` remote, so the installed
checkout's environment-dependent failure did not reproduce there. No Factory
source or remote configuration was changed to obtain that result.
