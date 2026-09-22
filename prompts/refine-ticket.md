---
description: Refine one ticket into a bounded construction brief without authorizing implementation
argument-hint: "<ticket-number>"
---
Use the `grilling` skill for planning-only construction refinement of ticket `$1` in the current project's configured tracker, informed by `construction-craft` and the project's oh-my-slop conventions, into a bounded brief for human approval and subsequent publication to that ticket, not implementation or a readiness grant; require exactly one positive ticket number (optionally prefixed with `#`) in `$@`, and if missing, invalid or ambiguous, ask for `/refine-ticket <ticket-number>` before any ticket work rather than choosing a ticket.
