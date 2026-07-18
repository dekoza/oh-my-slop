# construction-craft trigger eval — §4 case 3 (new model-invoked skill)

The current `trigger-evals.json` contains **24 cases**: 12 construction-craft positives and 12
specialist or non-implementation near-miss negatives. The positives give two distinct phrasings
each to six invocation branches: construction prerequisites/routine-data shape, knowledge and
artifact drift, reversibility, recurring-work or decay containment, concurrency ownership, and
evidence-poor estimates or tuning. Functional evals cover table-driven logic and assertions versus
validation without turning those implementation details into additional description branches.

## Completed measurement before adversarial expansion

- Harness: `skill-creator/scripts/run_eval.py`, 3 runs/query, 50% case threshold.
- Model: `anthropic/claude-opus-4-8`.
- Eval set: the initial 16-case set (8 positives and 8 specialist negatives).
- Result: **16/16 cases passed**, 47/48 individual trigger decisions correct.
- Weak point: the recurring release-automation positive triggered in 2/3 runs.

This result is retained as iteration evidence, not claimed as validation of the current description
or expanded eval set.

## Final validation: **incomplete**

Adversarial review found that the initial positives echoed the description too closely and omitted
several branches. The set was expanded to the current 24 cases, including shared-vocabulary
near-misses, and the description was narrowed in response to observed overtriggering.

A complete 3-runs/query pass of the final description could not finish because the Anthropic
backend exhausted its configured extra usage. Direct diagnosis returned:

> You're out of extra usage. Add more at claude.ai/settings/usage and keep going.

The harness surfaced the backend/protocol failures and discarded incomplete batches instead of
recording them as trigger misses. A GitHub Copilot `gpt-4.1` smoke run was not substituted: it
undertriggered the skill and is not the target model used by the completed iteration evidence.
No final 24-case score is claimed.

When model usage is restored, rerun the unchanged `trigger-evals.json` against the committed
`SKILL.md` description with 3 runs/query. If backend load requires chunking, keep the model,
description, run count, timeout, and threshold identical across chunks and aggregate only complete
chunks.
