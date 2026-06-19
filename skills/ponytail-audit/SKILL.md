---
name: ponytail-audit
description: >
  Scan a codebase for over-engineering and bloat. Finds dead code, reinvented stdlib,
  unneeded dependencies, speculative abstractions, single-implementation interfaces,
  pass-through wrappers, and dead feature flags.
  Use when the user says "audit this", "find bloat", "over-engineering check",
  "ponytail-audit", "what can I cut", "trim this down", "YAGNI check",
  or wants to reduce code/dependency surface.
---

# Ponytail Audit

Scan the codebase for over-engineering. Read-only — no files are modified.

## What it finds

| Tag | Meaning |
|-----|---------|
| `delete` | Dead code — defined but never referenced |
| `stdlib` | Reinvented stdlib — custom implementation of a built-in |
| `native` | Reinvented platform — custom implementation of a native API |
| `yagni` | Speculative abstraction — ABC/Protocol with ≤1 implementation, or hardcoded feature flag |
| `shrink` | Pass-through wrapper — function that only delegates, or type alias that renames a primitive |

## How to run

```bash
uv run python scripts/ponytail_audit.py [path] [--min-score N]
```

- `path` — root directory to scan (default: `.`)
- `--min-score` — minimum severity threshold (default: 1, include everything)

## Output format

One line per finding, ranked biggest-cut-first:

```
[tag] <what to cut>. <replacement>. [file:line]
```

Ends with:

```
net: -<N> lines, -<M> deps possible.
```

## Workflow

1. Run the script against the project root.
2. Present findings grouped by tag, biggest cuts first.
3. For each finding, explain the issue in one sentence and suggest the fix.
4. Ask the user which findings to act on.
5. After fixes, re-run to verify reduction.

## Pair with

- **codebase-design** — for the "before you build" ladder that prevents bloat in the first place
- **ponytail-debt** — for tracking shortcuts that were deliberately left behind
- **court-jester** — for adversarial review of whether a finding is actually bloat or justified complexity
