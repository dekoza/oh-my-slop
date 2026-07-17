# Description optimization

Use this branch after the skill body is stable. A description is the model-invoked skill's
always-loaded context pointer; optimize it for correct selection, not for summarizing the body.

## Contents

- Preflight
- Build trigger evals
- Review the eval set
- Run measured optimization
- Apply and report
- Fallbacks

## Preflight

For a model-invoked skill, verify that the description:

- starts with “Use when” or “Use whenever”
- uses third person
- contains only invocation conditions, symptoms, and user-shaped phrases
- stays within three sentences and about 75 words
- limits any trigger list to eight items
- omits the skill's internal workflow and feature inventory

For a user-invoked skill, use one plain human-facing line and skip trigger optimization because
the model cannot select it.

Run measured trigger evals when the repository policy requires them: known trigger failures,
material model-invoked description rewrites, and new model-invoked skills.

## Build trigger evals

Create about 20 substantive queries, balanced between should-trigger and should-not-trigger.
Use realistic paths, tool names, constraints, and context. Include:

- varied phrasings for each genuine invocation branch
- requests that need the skill without naming it
- uncommon but valid requests
- near-misses sharing vocabulary with the skill
- cases where an adjacent skill should win
- the exact historical failure when one exists

Avoid toy positives and obviously irrelevant negatives. Each item has this shape:

```json
{"query": "the user's request", "should_trigger": true}
```

## Review the eval set

Read `assets/eval_review.html` from the skill root. Replace:

- `__EVAL_DATA_PLACEHOLDER__` with the JSON array as a JavaScript value
- `__SKILL_NAME_PLACEHOLDER__` with the skill name
- `__SKILL_DESCRIPTION_PLACEHOLDER__` with the current description

Write the generated review file under `/tmp/` and open it with the platform's normal browser
command. If opening fails, print the exact path for the user. Import the most recently exported
`eval_set.json` only after confirming it is the user's reviewed file.

## Run measured optimization

Verify that `opencode` exists and that the chosen model can emit skill-consult events. A model
backend that rejects the request can make every query look like a non-trigger.

Run from the `skill-creator` directory with an explicit model:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <available-model-id> \
  --max-iterations 5 \
  --verbose 2>&1 | tee /tmp/<skill-name>-description-loop.log
```

The loop partitions the eval set into training and validation cases, evaluates each query
multiple times, proposes revisions, and selects by validation score. The optimizer sees the
current validation score while iterating, so this is a tuned validation split, not an untouched
final test set. Read the captured log for progress; do not rerun merely to recover output that
was not preserved.

Reject a candidate that improves training while regressing validation performance. Inspect
per-query results because a tied aggregate can hide a lost critical trigger. For an unbiased
final estimate, run a separately reserved test set after selection.

## Apply and report

Take `best_description` from the loop output, rerun any repository-level trigger gate, and update
only the description field. Report:

- old and new descriptions
- training and validation scores
- historical failure cases and their final outcomes
- known variance or model limitations

A wording change without measured results is a draft, not an optimization claim.

## Fallbacks

- **No `opencode`:** apply the preflight checklist, save the eval set, and report trigger
  measurement as deferred.
- **No display:** present the generated review file path; do not skip user review silently.
- **All-zero trigger rates:** inspect backend errors and rerun with a verified model before
  changing the description.
- **Optimization loop crashes:** preserve the eval set and full captured log, fix the specific
  failure, and continue from the last valid measured candidate when supported.
- **No candidate beats baseline:** keep the original description and report that the attempted
  rewrite lacked evidence.
