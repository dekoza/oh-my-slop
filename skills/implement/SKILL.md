---
name: implement
description: Implement a piece of work based on a spec or set of tickets.
license: MIT (adapted from mattpocock/skills)
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use the `tdd` skill, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end. Follow the project's mandatory checks (AGENTS.md / CLAUDE.md) if it declares any.

Once done, use the `two-axis-review` skill to review the work against both the repo's standards and the originating spec.

Commit your work to the current branch.
