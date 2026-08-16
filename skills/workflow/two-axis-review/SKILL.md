---
name: two-axis-review
description: >
  Use when the user wants the changes since a fixed point reviewed against the repo's
  coding standards, against the originating spec, or both. Triggers on: "review since
  X", "review this branch", "review the PR against the spec", "does this match the
  ticket", "standards check", "two-axis review".
license: MIT (adapted from mattpocock/skills)
requires:
  - review-standards
  - review-spec
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating issue / spec?

This skill runs both axes and aggregates their findings. **Each axis is its own skill** —
`review-standards` and `review-spec` — carrying its own brief, its own trust boundary, and (for
standards) the smell baseline. They are independently invocable, so a caller who wants one axis
runs that skill directly and skips this one.

## Running the axes

**Run each axis with its own context, and do not carry one axis's findings into the other.**
Cross-contamination is the thing the split exists to prevent: a reviewer who has just read a
list of style complaints reads the spec differently.

How you isolate them depends on what you have:

- **A sub-agent or parallel task tool** — run each axis in its own agent, in parallel. Best
  isolation, and the two axes do not wait on each other.
- **No spawn tool** — run them **sequentially in this session**, `review-standards` first, and
  write each report out in full before starting the next. Between them, re-read the diff rather
  than working from what you remember of it.

**Do not assume a spawn tool exists.** Not every harness has one, the ones that do expose it
differently, and an unavailable tool must degrade to the sequential path rather than fail the
review.

**Both axes always run to completion.** Do not stop at the first rejection — the second axis's
findings are exactly what a fix needs, and a review that quits early makes the operator run it
twice.

If there is genuinely no spec, `review-spec` reports "no spec available"; note that in the
aggregate rather than omitting the section.

## Aggregating

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly
cleaned.

**Do not merge or rerank findings across axes.** Union them and keep them labelled. The two
axes measure different things, so a combined ranking implies a common scale that does not
exist.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_.
Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass,
  Standards fail.**

Reporting them separately stops one axis from masking the other.
