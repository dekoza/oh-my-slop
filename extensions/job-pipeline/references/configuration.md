# Configuration

Config is stored at `~/.pi/agent/extensions/job-pipeline/config.json`.
Edit directly or use `/job-pool` for interactive pool configuration.

If the file does not exist, the extension starts with empty pools (no models
assigned). `/job` will fail at the pool draw step until pools are configured.

## Full schema

```jsonc
{
  // ── Model pools ───────────────────────────────────────────────────────────
  // One pool per role. Each pool is a list of model IDs in "provider/id"
  // format. At job start one model is drawn randomly from each pool.
  // The draw is stable for the entire job.
  "pools": {
    "scout":       { "models": ["github-copilot/gpt-5-mini"] },
    "planner":     { "models": ["github-copilot/claude-sonnet-4-5", "github-copilot/gpt-5"] },
    "jester":      { "models": ["github-copilot/gpt-5", "github-copilot/claude-sonnet-4-5"] },
    "task-writer": { "models": ["github-copilot/gpt-5-mini"] },
    "worker":      { "models": ["github-copilot/gpt-5-mini"] },
    "reviewer":    { "models": ["github-copilot/claude-sonnet-4-5"] }
  },

  // ── Human gates ───────────────────────────────────────────────────────────
  // "compulsory"  — pipeline pauses, dialog shown, you must approve/deny.
  // "auto-accept" — pipeline proceeds automatically, decision logged.
  "gates": {
    "scoutQuestion": { "mode": "compulsory" },
    "planApproval":  { "mode": "compulsory" },
    "proofReview":   { "mode": "compulsory" },
    "retroReview":   { "mode": "compulsory" }
  },

  // ── Autonomy ──────────────────────────────────────────────────────────────
  // cleanRetrosRequired: consecutive clean retros before the extension
  // suggests switching a gate to auto-accept. Minimum 1.
  "autonomy": {
    "cleanRetrosRequired": 3
  },

  // ── Costs ────────────────────────────────────────────────────────────────
  // track: whether to record per-role token usage in job state.
  "costs": {
    "track": true
  }
}
```

## Partial-load tolerance

The config loader (`lib/config.mjs`) applies section-by-section validation.
A malformed section is replaced with its default value and a warning is
logged. The extension never fails to start due to a bad config file.

Invalid values and their fallbacks:

| Field | Invalid value | Fallback |
|---|---|---|
| Pool `models` | Empty array or non-strings | Default (empty pool) |
| Gate `mode` | Anything other than `compulsory`/`auto-accept` | `compulsory` |
| `cleanRetrosRequired` | 0, negative, non-number | `3` |

## Pool selection rules

1. The eligible set for a role = configured models ∩ models available in pi.
2. If the eligible set is empty for any role, the pool draw fails with an error.
3. For the `jester` role: if the eligible set has more than one model,
   the draw excludes the model drawn for `planner`. This ensures the
   adversarial pairing always uses different perspectives.
4. If `jester` and `planner` share the only available model, both use it
   (no error; logged as a warning during the draw).

## Recommended tier assignments

| Role | Recommended tier | Reason |
|---|---|---|
| scout | Free / cheap | High read volume, broad file scan |
| worker | Free / cheap | High volume, TDD implementation |
| task-writer | Mid | Dependency graph reasoning matters |
| planner | Mid / premium | Plan quality determines everything downstream |
| reviewer | Mid / premium | Quality gate before human sees output |
| jester | Mid | Adversarial reasoning, must differ from planner |

## Adding multiple models per pool

Edit the config file directly to add more models. The extension picks one
randomly per job, providing natural rotation:

```json
"planner": {
  "models": [
    "github-copilot/claude-sonnet-4-5",
    "github-copilot/gpt-5",
    "openrouter/anthropic/claude-opus-4"
  ]
}
```

Use `/job-pool planner` to interactively add models one at a time, then
inspect and edit the file to reorder or add further entries.

## Gate progression path

The intended path toward full autonomy:

```
Start:  all gates compulsory
        ↓  (3 clean retros)
Step 1: retroReview → auto-accept
        ↓  (3 more clean retros)
Step 2: scoutQuestion → auto-accept
        ↓  (3 more clean retros)
Step 3: planApproval → auto-accept
        ↓  (3 more clean retros, verify with full manual review first)
Step 4: proofReview → auto-accept

Regression: any retro with proposed changes → all manually-progressed
            gates revert to compulsory. Edit config to re-apply.
```

The extension suggests progression but does not enforce it.
The config file is the authoritative source of truth for gate modes.
