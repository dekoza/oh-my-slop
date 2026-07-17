---
name: skill-creator
description: >
  Use when creating or editing SKILL.md files, diagnosing skill-triggering failures,
  or measuring whether a skill improves agent behavior. Also use before publishing a
  new or materially changed skill.
---

# Skill Creator

Create and refine skills through evaluation-driven development: observe the unassisted
failure, add the smallest useful guidance, and verify the behavioral change.

This skill owns the authoring and validation workflow. The `writing-great-skills` skill
owns prose craft: invocation load, leading words, information hierarchy, context pointers,
and pruning. Apply both when editing skill text.

## Critical rules

1. **Gate creation first.** Confirm that a skill is the right artifact before creating one.
2. **Establish RED before drafting.** For a new skill, run representative prompts without
   it. For an existing skill, snapshot the old version before editing and use that snapshot
   as the baseline.
3. **Grade behavior, not vibes.** Write observable assertions whose truth can be supported
   by files, command output, or quoted evidence. Keep subjective output for human review.
4. **Preserve comparison integrity.** Run baseline and candidate against the same prompt,
   input files, model, and environment.
5. **Let the user judge qualitative quality.** Show outputs and benchmark evidence before
   claiming that one version is better.
6. **Apply the local standard.** In this repository, every touched skill must pass
   [`references/skill-quality-standard.md`](references/skill-quality-standard.md).

## Quick start

1. **Decide** whether the need belongs in a skill and classify its type.
2. **Capture** 2–3 representative evals and run the baseline.
3. **Draft** only enough guidance to address observed failures.
4. **Compare** candidate and baseline, grade objective assertions, and show both to the user.
5. **Iterate** on observed failures, then validate description triggering and deployment.

The skill is ready only when its applicable quality checks pass, the candidate has evidence
against the baseline, and the user has reviewed qualitative outputs.

## Should this be a skill?

Create or retain a skill when the behavior is recurring, specialized, and benefits from
instructions that an agent must discover or a human must deliberately invoke.

Choose a different artifact when the need is primarily:

| Need | Better artifact |
|---|---|
| One conversation or one-off transformation | Prompt or prompt template |
| Fully deterministic operation | Script or tool |
| Repository-wide contributor rule | `AGENTS.md` or project documentation |
| Architectural choice and rationale | ADR |
| Large factual corpus with no agent workflow or discovery need | External reference |
| Existing skill already owns the same ground | Improve or route to that skill |

Before creating anything, search the available skills for overlap. Split a proposed skill only
when a branch needs independent invocation or when a sequence boundary must hide later steps;
do not split merely to shorten a file.

## Full workflow

### 1. Capture intent and classify

Extract answers already present in the conversation before asking the user. Resolve:

- What behavior should change?
- Which user requests or project conditions should invoke it?
- What output or action proves success?
- Which existing skill is nearest, and why is extending it insufficient?
- Is the output objectively gradable, qualitatively reviewable, or both?

Classify the skill because the type determines its evals:

| Type | Distinguishing question | Default evaluation |
|---|---|---|
| **Discipline** | Does it enforce a costly rule agents may rationalize away? | Functional evals plus pressure scenarios |
| **Technique** | Does it prescribe concrete steps for performing a task? | Functional evals |
| **Pattern** | Does it teach recognition and a reusable decision model? | Functional plus recognition evals |
| **Reference** | Does it supply facts, APIs, or syntax needed on demand? | Functional plus retrieval evals |

A technique says **how to act**; a pattern says **what shape to recognize and reason with**.
If one skill contains independent types with different invocation conditions, reconsider its
boundary.

**Completion criterion:** the intended behavior, invocation mode, nearest existing skill,
type, success evidence, and expected output are explicit.

### 2. Establish the baseline (RED)

Create 2–3 prompts that resemble real requests, including input files when the task depends on
them. Write verifiable assertions before seeing candidate output so the target cannot move to
fit the result.

- **New skill:** run the prompts without the skill.
- **Existing skill:** copy the original skill to the evaluation workspace before editing, then
  run prompts with that snapshot.
- **Discipline skill:** use scenarios combining at least three pressures and record the exact
  rationalizations. Read
  [`references/testing-pressure-scenarios.md`](references/testing-pressure-scenarios.md)
  before writing those scenarios.
- **Technique skill:** include successful execution plus a realistic error or recovery case.
- **Pattern skill:** include recognition cases and vocabulary-sharing near-misses.
- **Reference skill:** include retrieval cases and cases where the reference does not apply.

Save the eval definitions in `evals/evals.json`. Use the schema in
[`references/schemas.md`](references/schemas.md).

**Completion criterion:** every eval has a baseline output and at least one documented failure
or gap that the proposed skill change will address. If the baseline already succeeds, sharpen
the scenario or reject unnecessary skill content.

### 3. Draft the candidate (GREEN)

Write the smallest change that addresses the baseline failures.

For frontmatter:

- Preserve an existing skill's `name`.
- Choose invocation mode deliberately.
- For model-invoked skills, start the description with “Use when” or “Use whenever,” include
  only triggering conditions, use third person, stay within three sentences and about 75 words,
  and keep any trigger list to eight user-shaped items.
- For user-invoked skills, set `disable-model-invocation: true` and use one plain human-facing
  description line without trigger language.

For the body:

- Put critical rules first.
- Keep steps and branch decisions in `SKILL.md`; disclose branch-specific or heavy reference
  material through direct pointers.
- Give every step a checkable completion criterion.
- Use positive, imperative instructions and remove no-ops, duplication, and sediment.
- Keep `SKILL.md` below 500 lines; give long references a contents map when partial reading
  could hide relevant branches.
- Keep references one level from `SKILL.md`.
- Bundle scripts for deterministic repeated work and state whether to execute or read them.

Read [`references/anthropic-best-practices.md`](references/anthropic-best-practices.md) when
working on progressive disclosure, executable helpers, or unfamiliar skill structure. Use
[`references/graphviz-conventions.dot`](references/graphviz-conventions.dot) only for a
non-obvious decision or loop that genuinely benefits from a flowchart.

**Completion criterion:** every added instruction traces to an observed baseline failure or a
mandatory standard, and the draft passes the body-structure checklist in the local standard.

### 4. Evaluate and review

Read [`references/evaluation-workflow.md`](references/evaluation-workflow.md), then run the
candidate against the same evals and conditions as the baseline. Grade objective assertions,
aggregate benchmark data, inspect variance and non-discriminating assertions, and generate the
standard review viewer. Use
[`agents/grader.md`](agents/grader.md) for grading and
[`agents/analyzer.md`](agents/analyzer.md) for the analyst pass.

Use [`agents/comparator.md`](agents/comparator.md) only when a blind A/B comparison will answer
a real decision that ordinary output review cannot.

**Completion criterion:** baseline and candidate artifacts are complete, grades cite evidence,
the benchmark has been analyzed beyond headline pass rate, and the user has reviewed the
qualitative outputs.

### 5. Refactor from evidence

Change the skill in response to observed behavior:

- Generalize from failures instead of encoding an eval's incidental details.
- Remove instructions that do not affect behavior.
- Promote repeated deterministic work into a bundled script.
- For discipline skills, add counters only for rationalizations actually observed, then rerun
  the same pressure scenarios.
- Stop when feedback is empty, the user accepts the result, or another iteration produces no
  meaningful improvement.

**Completion criterion:** the revised skill remains green on prior evals and any new regression
eval reproduces the newly discovered failure.

### 6. Verify description triggering

Optimize the description after the body stabilizes. Apply the risk policy in the local
skill-quality standard: known trigger failures, material model-invoked description rewrites,
and new model-invoked skills require trigger evals. User-invoked skills and format-only edits do
not.

Read
[`references/description-optimization.md`](references/description-optimization.md) for eval-set
review, measured optimization, fallbacks, and reporting.

**Completion criterion:** required trigger evals pass on validation cases, or the unresolved
measurement is explicitly reported without claiming success. Reserve a separate final test set
when an unbiased performance estimate is required.

### 7. Validate and deploy

Run the repository's skill/reference validators and affected tests. When distributing a
`.skill` artifact, package with `scripts/package_skill.py`; `present_files` controls only whether
the artifact can be presented directly. Otherwise offer packaging and report the validated
skill path. Commit or publish only through the repository's normal workflow.

Read
[`references/environment-adaptations.md`](references/environment-adaptations.md) when subagents,
a display, writable installation paths, `opencode`, or file-presentation tools are unavailable.

**Completion criterion:** validators and tests pass, intended files are present, generated
workspaces are outside the installable skill directory, and the user receives the artifact or
its exact path.

## Maintenance and retirement

Re-enter the same RED → GREEN → review loop when session evidence shows undertriggering,
overtriggering, ignored rules, stale facts, broken tooling, or overlap with another skill.
Reproduce the failure before editing.

Retire or merge a skill when its invocation ground is fully owned elsewhere, its workflow has
become deterministic enough for a script, or repeated evaluations show no behavioral lift.
Preserve migration guidance for users and update every inbound reference; do not leave two
skills claiming the same rule.

## Failure handling

Preserve completed artifacts when a run, grader, benchmark, or viewer fails. Record the command,
full captured output, and which comparisons remain incomplete. Retry only after identifying a
specific transient cause. A partial comparison is not evidence that the candidate improved.
The evaluation and environment references contain stage-specific recovery paths.

## Final quality gate

Apply only the checks relevant to the skill's type and invocation mode:

- [ ] Creation gate and overlap check completed.
- [ ] Name and invocation mode are deliberate; existing names are preserved.
- [ ] Frontmatter and description meet the local standard.
- [ ] Critical rules are at the top; steps have completion criteria.
- [ ] `SKILL.md` is below 500 lines and branch-specific depth is disclosed directly.
- [ ] Baseline failures are recorded and candidate changes trace to them.
- [ ] Assertions are verifiable; subjective qualities are left to human review.
- [ ] Discipline pressure tests and trigger evals ran when policy requires them.
- [ ] User reviewed candidate and baseline outputs before an improvement claim.
- [ ] Repository validators and affected tests pass.
- [ ] Packaging was completed or offered when distribution is in scope.
- [ ] Maintenance impact, inbound references, and retirement risk were checked.
