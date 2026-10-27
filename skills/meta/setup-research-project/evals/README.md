# Research setup smoke evaluation

Scenarios and predeclared assertions: [evals.json](evals.json).

## Scope and results

Two dry-run proposals were evaluated with and without the new skill, one run per
scenario, using `gpt-6.1-sol`, medium thinking and built-in tools only. The author
inspected the saved outputs and graded the same assertions in both configurations.

| Scenario | Without skill | With skill | Observed gap addressed |
|---|---|---|---|
| Fresh Markdown-only setup | 4/5 | 5/5 | Save at milestones rather than only closing; state abrupt-ending limits |
| Re-sync and partial memory failure | 4/5 | 5/5 | Verify stale notes through search/read and propose a reviewed correction |

Eight assertions passed both configurations; those are non-regression checks, not
proof of added value. No repeated runs or independent grading were performed. The
frontmatter dependency on `grilling` was corrected during candidate execution;
behavioral text and the consumer template stayed unchanged. Repository tests, not
these proposals, verify dependency metadata.

## Limits

The agents wrote proposals only. They did not install consumer files, execute memory
calls, continue a real project across sessions, or demonstrate crash recovery. These
results do not establish unattended compliance, privacy enforcement, improved recall
speed or guaranteed journaling. Qualitative usefulness remains for human review.

Raw proposals, grades, timing, benchmark and the standard static review viewer were
saved in an external temporary evaluation workspace, not in the installable skill.
That workspace is not a permanent dependency of this skill. Trigger evals do not
apply because this skill is user-invoked.
