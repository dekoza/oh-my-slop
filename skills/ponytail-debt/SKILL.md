---
name: ponytail-debt
description: Harvest SHORTCUT markers from the codebase and report them grouped by file, flagging any missing upgrade paths.
disable-model-invocation: true
---

# Ponytail Debt

Harvest `SHORTCUT:` markers from the codebase. Read-only unless `--output-debt-file` is passed.

## Marker format

Shortcuts are tagged during development (typically in TDD cycles):

```python
# SHORTCUT: <what's skipped>. Upgrade: <what to do when this matters>.
```

Both `#` (Python) and `//` (TypeScript/JS) styles are recognized.

## What it finds

Every `SHORTCUT:` marker in source files. Reports:

- File and line number
- What was simplified/skipped
- Upgrade path (if present)
- ⚠️ flag on markers missing an upgrade path

## How to run

The script is bundled alongside this SKILL.md in the skill's `scripts/` directory. The agent should resolve the path to this SKILL.md file and run:

```bash
uv run python <path-to-this-skill>/scripts/ponytail_debt.py <target-path> [--output-debt-file]
```

- `<path-to-this-skill>` — directory containing this SKILL.md (e.g. `~/.pi/agent/git/github.com/dekoza/oh-my-slop/skills/ponytail-debt`)
- `<target-path>` — root directory to scan (default: `.`)
- `--output-debt-file` — write `SHORTCUT-DEBT.md` for persistent tracking

## Output format

Grouped by file:

```
## path/to/file.py
  L42: <what was simplified>. ceiling: <upgrade path>.
  L87: <what was simplified>. ceiling: none. ⚠️ no-trigger

---
<N> markers, <M> with no trigger.
```

## Workflow

1. Run the script against the project root.
2. Present all markers grouped by file.
3. Flag markers missing upgrade paths — these are time bombs.
4. For each marker, ask: resolve now, schedule later, or accept permanently.
5. Run with `--output-debt-file` to write `SHORTCUT-DEBT.md` for tracking.

## Marker lifecycle

| Phase | Action |
|-------|--------|
| Write code | Tag shortcuts with `# SHORTCUT:` markers |
| Refactor | Resolve or upgrade shortcuts before they compound |
| Audit | Run this skill to find all markers |
| Track | Generate `SHORTCUT-DEBT.md` for the team |

## Pair with

- **tdd** — where shortcuts are tagged during the red-green cycle
- **ponytail-audit** — for finding bloat the agent didn't tag
- **codebase-design** — for the ladder that prevents shortcuts in the first place
