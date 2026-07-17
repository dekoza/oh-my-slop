# caveman trigger-eval — §4 case 1 (known overtriggering failure)

Reproduces the overtrigger the council flagged (caveman firing on generic brevity
requests like "be brief" / "less tokens") and gates the description fix.

- Harness: `skill-creator/scripts/run_eval.py`, 3 runs/query.
- Model: `anthropic/claude-opus-4-8` (the session model).
- Eval set: `trigger-evals.json` — 7 explicit-caveman positives, 9 brevity/compression
  near-miss negatives.

| Description | Passed | Overtrigger cases (should NOT fire) |
|---|---|---|
| **Old** (`less tokens`, `be brief`, `token efficiency` in triggers) | 13/16 | "be brief" 2/3, "use fewer tokens" 3/3, "make answers shorter" 3/3 — all wrongly fired |
| **New** (explicit-caveman-only, negative-trigger clause) | **16/16** | all 0/3 — overtrigger eliminated, positives still 3/3 |

The new description removes the generic-brevity trigger phrases and adds an explicit
"Not a general 'be brief' or 'fewer tokens' request" clause; positive triggering on
"caveman mode" / "/caveman" / "wenyan mode" is unaffected.
