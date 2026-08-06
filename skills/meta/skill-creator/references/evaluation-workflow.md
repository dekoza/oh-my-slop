# Evaluation workflow

Use this branch after eval prompts exist and before claiming that a new or revised skill is
better than its baseline.

## Contents

- Workspace layout
- Define the comparison
- Run the baseline and candidate
- Capture run metadata
- Grade objective assertions
- Aggregate and analyze
- Generate human review
- Iterate
- Recover from failures

## Workspace layout

Create `<skill-name>-workspace/` beside the skill directory, not inside the installable skill.
Use one directory per iteration and a descriptive directory per eval:

```text
<skill-name>-workspace/
├── skill-snapshot/                 # existing-skill baseline only
└── iteration-1/
    ├── eval-1-invoice-deduplication/
    │   ├── eval_metadata.json
    │   ├── without_skill/
    │   │   └── run-1/
    │   │       ├── outputs/
    │   │       ├── timing.json
    │   │       └── grading.json
    │   └── with_skill/
    │       └── run-1/
    │           ├── outputs/
    │           ├── timing.json
    │           └── grading.json
    ├── benchmark.json
    └── benchmark.md
```

The aggregator discovers `eval-*` directories, configuration directories, and `run-*`
directories in that exact hierarchy. Keep configuration names `with_skill` and
`without_skill` so generated benchmark data matches the viewer schema.

For an existing skill, copy the original into `skill-snapshot/` before editing and run that
snapshot under the `without_skill` configuration. Add `"baseline_source": "skill-snapshot"`
to `eval_metadata.json`. Preserve the snapshot across iterations when the decision is
“candidate versus original.” Use the previous iteration only when the decision explicitly
concerns the latest incremental change.

## Define the comparison

For every eval, create `eval_metadata.json`:

```json
{
  "eval_id": 1,
  "eval_name": "invoice-deduplication",
  "prompt": "Normalize the attached vendor invoice CSV and flag likely duplicates.",
  "assertions": [
    "outputs/review.csv exists",
    "outputs/review.csv contains a duplicate_reason column"
  ]
}
```

Assertions are binary claims supported by observable evidence. Prefer file existence, parsed
values, command exit status, exact required sections, or quoted behavior. Leave style, taste,
and usefulness to human review rather than forcing them into fake precision.

Keep the following identical across configurations:

- prompt and input files
- model and thinking settings
- available tools except the skill itself
- working-directory fixture
- timeout and environment variables

## Run the baseline and candidate

The order depends on the branch:

1. **New skill:** run the no-skill baseline first, inspect failures, then draft and run the
   candidate.
2. **Existing skill:** snapshot and run the old version before editing, then run the candidate.
3. **Already-defined comparison:** when both immutable configurations exist, launch matching
   evals concurrently to reduce environment drift.

A run prompt must name the skill path or the absence of a skill, the task, input files, output
directory, and outputs to save. Keep agent commentary with the outputs when it contains evidence
about decisions or failures.

## Capture run metadata

Write `timing.json` as soon as execution metadata becomes available:

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

If a harness cannot report a field, use `null` and record the limitation. Do not invent timing
or token values.

## Grade objective assertions

Read `agents/grader.md` from the skill root. Use a script for assertions that can be parsed or
computed; use a grader agent for evidence that requires interpreting outputs. Each run's
`grading.json` must use these exact fields:

```json
{
  "expectations": [
    {
      "text": "outputs/review.csv contains a duplicate_reason column",
      "passed": true,
      "evidence": "Parsed header: vendor,amount,duplicate_reason"
    }
  ]
}
```

A grade without evidence is incomplete. Grade baseline and candidate against the same assertion
text.

## Aggregate and analyze

From the `skill-creator` directory, run:

```bash
python -m scripts.aggregate_benchmark \
  <workspace>/iteration-N \
  --skill-name <name> 2>&1 | tee /tmp/<name>-benchmark.log
```

This produces `benchmark.json` and `benchmark.md`. Put each candidate configuration before its
baseline counterpart in manually assembled benchmark data.

Read `agents/analyzer.md` from the skill root and inspect:

- assertions that pass in every configuration and therefore do not discriminate
- assertions with high variance across repeated runs
- regressions hidden by an improved average
- time or token cost relative to behavioral lift
- errors or missing artifacts that invalidate a comparison

## Generate human review

Generate a static copy of the standard viewer; do not create custom review HTML. Static mode
returns control to the agent, works with or without a display, and leaves a durable artifact:

```bash
python eval-viewer/generate_review.py \
  <workspace>/iteration-N \
  --skill-name "<name>" \
  --benchmark <workspace>/iteration-N/benchmark.json \
  --static <workspace>/iteration-N/review.html \
  2>&1 | tee /tmp/<name>-viewer.log
```

Open `review.html` when a display is available; otherwise give the user its exact path.

For iteration 2 and later, add:

```text
--previous-workspace <workspace>/iteration-(N-1)
```

Tell the user that **Outputs** contains qualitative comparisons and formal grades, while
**Benchmark** contains aggregate metrics and analyst observations. Wait for their review before
claiming qualitative improvement.

When the viewer downloads `feedback.json`, copy it into the iteration directory.

## Iterate

Read `feedback.json`, preserve empty feedback as acceptance, and address specific complaints.
Add a regression eval when feedback exposes a reproducible failure. Rerun the full comparison
on the next iteration; do not compare candidate-only output to a remembered baseline.

Stop when the user accepts the result, feedback is empty, or another iteration produces no
meaningful improvement.

## Recover from failures

- **Executor fails:** preserve partial outputs and captured logs; rerun only the failed
  configuration after correcting a specific transient cause.
- **Timing unavailable:** record `null`; keep pass-rate comparison separate from cost claims.
- **Grader fails:** retain raw outputs and rerun grading; do not mark assertions failed merely
  because grading crashed.
- **Aggregation fails:** validate `grading.json` fields against `references/schemas.md`, fix the
  malformed artifact, and rerun aggregation.
- **Viewer fails:** use `--static`; if generation still fails, present exact output paths and
  benchmark files directly without claiming the review happened.
- **One configuration missing:** mark the eval incomplete and exclude it from comparative
  conclusions.
