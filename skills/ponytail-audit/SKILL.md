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

## Scope and stopping rule

The audit is a **bounded, one-shot deliverable**, not the opening move of a general code review. The script's ranked output (findings + `net:` summary) **is** the result. Your job is to present it and stop — not to re-audit by hand, and not to expand into a broader architecture tour ("let me look at key modules, URL patterns, the overall architecture…"). That broader tour is a different activity; if the user wants it, that's what `improve-codebase-architecture` is for. Don't silently switch skills mid-audit.

The reason this matters: once a model has a list of findings in hand, the temptation is to "go deeper" to build confidence before presenting. But the script already did the scan — re-exploring duplicates that work, burns tokens, and drifts past the point where the user wanted to be asked. The findings are cheap for the user to triage; they don't need you to pre-validate the whole codebase first.

**Targeted verification is allowed; expansive exploration is not.** The line between them:

- ✅ Allowed: reading the specific `file:line` of a single borderline finding to confirm it's not a false positive before you present it. The AST heuristics do produce false positives, and presenting one obvious miss undermines trust in the rest. Keep this surgical — one file, one finding.
- ❌ Not allowed: reading URL configs, module graphs, "key modules," or "the overall architecture" to contextualize the findings. That's scope creep, not verification.

**Hard stop:** after presenting the grouped findings and the one-sentence-per-finding explanation, ask the user which findings to act on — and stop. Do not run further tools, do not start fixing, do not re-explore. Wait for the user's answer. Re-running the script only happens at step 5, *after* the user has chosen and fixes have been applied.

## What it finds

| Tag | Meaning |
|-----|---------|
| `delete` | Dead code — defined but never referenced |
| `stdlib` | Reinvented stdlib — custom implementation of a built-in |
| `native` | Reinvented platform — custom implementation of a native API |
| `yagni` | Speculative abstraction — ABC/Protocol with ≤1 implementation, or hardcoded feature flag |
| `shrink` | Pass-through wrapper — function that only delegates, or type alias that renames a primitive |

## How to run

The script is bundled alongside this SKILL.md in the skill's `scripts/` directory. The agent should resolve the path to this SKILL.md file and run:

```bash
uv run python <path-to-this-skill>/scripts/ponytail_audit.py <target-path> [--min-score N]
```

- `<path-to-this-skill>` — directory containing this SKILL.md (e.g. `~/.pi/agent/git/github.com/dekoza/oh-my-slop/skills/ponytail-audit`)
- `<target-path>` — root directory to scan (default: `.`)
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
2. Optionally verify a handful of borderline findings by reading their specific `file:line` (see the Scope section — targeted only, never a tour). Drop any confirmed false positives before presenting.
3. Present findings grouped by tag, biggest cuts first, including the `net:` summary line.
4. For each finding, explain the issue in one sentence and suggest the fix.
5. **Stop.** Ask the user which findings to act on. Do not call any more tools until they answer — no fixing, no re-exploring, no "let me keep digging."
6. Only after the user picks findings and fixes are applied: re-run the script to verify the reduction.

## Pair with

- **codebase-design** — for the "before you build" ladder that prevents bloat in the first place
- **ponytail-debt** — for tracking shortcuts that were deliberately left behind
- **court-jester** — for adversarial review of whether a finding is actually bloat or justified complexity
