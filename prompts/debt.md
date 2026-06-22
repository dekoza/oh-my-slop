---
description: Find all SHORTCUT markers in the codebase
argument-hint: "[path] [--output-debt-file]"
---
Harvest `SHORTCUT:` markers from the codebase. Run the bundled script:

```bash
uv run python /home/minder/.pi/agent/git/github.com/dekoza/oh-my-slop/skills/ponytail-debt/scripts/ponytail_debt.py ${1:-.} $2
```

Then present all markers grouped by file, in this format:

```markdown
## path/to/file.py
  L42: <what was simplified>. ceiling: <upgrade path>.
  L87: <what was simplified>. ceiling: none. ⚠️ no-trigger

---
<N> markers, <M> with no trigger.
```

Flag markers missing upgrade paths — these are time bombs. For each marker, ask: resolve now, schedule later, or accept permanently.

Use `--output-debt-file` to write `SHORTCUT-DEBT.md` for persistent tracking.
