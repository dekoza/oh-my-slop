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

Keep dependency-graph scheduling across tickets with the **caller or controller**; this skill is the implementation worker, not a second orchestrator.

## Always work in a worktree

Never implement in the primary checkout. If the session is not already inside a dedicated Git worktree, create one before the first edit — `git-discipline`'s worktree location rule applies (a descriptive `<task-id>-<short-handle>` under the ignored root-level `.worktrees/`), branched from the current base branch. If the caller already placed the session in a worktree, use that one and create nothing.

Every edit, test run, and git command targets **that worktree's directory** — no `git -C` back into the primary checkout, no edits outside the worktree path. Leave the worktree in place when the session ends; removing it is the caller's call.

## Build and verify

Use the `tdd` skill, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end. For E2E tests, follow the `testing-workflow` skill's "E2E policy for implementation runs" — per-slice targeted runs, full E2E delegated to the PR's CI check, never a full in-session E2E run without consent. Follow the project's mandatory checks (AGENTS.md / CLAUDE.md) if it declares any.

Once done, use the `two-axis-review` skill to review the work against both the repo's standards and the originating spec.

Commit your work to the worktree's branch.

## Open the pull request

The PR is part of this invocation, not a follow-up — every run ends with one open.

Once the work is committed and both review axes have passed, push the worktree's branch and open a PR against the base branch it was created from, following the tracker doc's "open a pull request" convention for this repo's forge. The body names the ticket with the forge's closing keyword (`Closes #N`) so the merge closes it, and states what the slice does and how it was verified.

- **Do not merge it, and do not wait on CI.** The full-suite check `testing-workflow` delegates to the PR runs there; merging is the user's or caller's call.
- **One PR per slice.** If the branch already has an open PR, push to it and update its body instead of opening a second.
- **No forge** (a local markdown tracker): there is nowhere to open a PR. Push the branch if a remote exists and report the branch name as the deliverable — that is this repo's complete outcome, not a skipped step.

Report the PR URL when reporting completion.

## Bring down what you brought up

If anything in this session started Docker containers — test infrastructure, a dev stack, a one-off `docker compose run`, a warm E2E environment — bring down each stack **you** started before reporting completion, using the same compose file you started it with (`docker compose -f compose.test.yml down`, etc.). Dev and test stacks have independent lifecycles, so bringing one down does not touch the other (see `docker-discipline`). Add `-v` only for volumes this session created. Leave stacks that were already running when the session began exactly as they were.

## Completion

The invocation is complete when this one ticket-sized slice meets its acceptance criteria, affected checks pass under the project's test policy, both review axes have completed, the worktree's branch contains the committed result, and its PR is open and reported by URL (or, on a forge-less repo, the branch is pushed and named). Every Docker stack this session started is down. No other frontier ticket has been started.
