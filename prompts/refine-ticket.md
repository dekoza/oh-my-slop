---
description: Refine one ticket through human-authorized agent readiness
argument-hint: "<ticket-number>"
---
Use the `humanify` skill to refine ticket `$1` in the current project's configured tracker through human-authorized agent readiness, informed by `construction-craft` and the project's oh-my-slop conventions, with implementation in a separate session; require exactly one positive ticket number (optionally prefixed with `#`) in `$@`, and if missing, invalid or ambiguous, ask for `/refine-ticket <ticket-number>` before any ticket work rather than choosing a ticket. If it isn't among your available skills, locate its `SKILL.md` in the installed `oh-my-slop` package and follow that.
