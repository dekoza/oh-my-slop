---
name: implement
description: >
  Use when the user wants one ticket-sized implementation slice built from a spec or
  build-ready ticket. Triggers on: "implement this ticket", "build this slice",
  "work this spec".
license: MIT (adapted from mattpocock/skills)
#disable-model-invocation: true
requires:
  - construction-craft
  - git-discipline
  - tdd
  - testing-workflow
  - two-axis-review
---

Implement one ticket-sized slice described by the user's spec or build-ready ticket.

## Scope: one ticket per session

A spec with no ticket list may be the slice when it fits one reviewable change. When the input contains multiple implementation tickets, work **exactly one unblocked frontier ticket** in this session. Use the ticket named by the caller; otherwise take the first unblocked ticket in the caller's order. Leave blocked and remaining tickets for fresh sessions.

Keep dependency-graph scheduling, branch creation, and worktree lifecycle with the **caller or controller**. Work only in the **current worktree** and on its current branch; this skill is the implementation worker, not a second orchestrator.

## Build and verify

Use the `tdd` skill, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end. For E2E tests, follow the `testing-workflow` skill's "E2E policy for implementation runs" — per-slice targeted runs, full E2E delegated to the PR's CI check, never a full in-session E2E run without consent. Follow the project's mandatory checks (AGENTS.md / CLAUDE.md) if it declares any.

Once done, use the `two-axis-review` skill to review the work against both the repo's standards and the originating spec.

Commit your work to the current branch.

## Completion

The invocation is complete when this one ticket-sized slice meets its acceptance criteria, affected checks pass under the project's test policy, both review axes have completed, and the current branch contains the committed result. No other frontier ticket has been started.
