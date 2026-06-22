---
description: Audit codebase for over-engineering and bloat
argument-hint: "[path]"
---
Run a whole-repo audit for over-engineering and bloat on `${1:-.}`. Read the codebase and produce a ranked list of what to cut. This is read-only — no files are modified.

## Tags

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## What to hunt

Dependencies the stdlib or platform already ships; single-implementation interfaces; factories with one product; wrappers that only delegate; files exporting one thing; dead flags and config; hand-rolled stdlib.

## Rules

- **Model-driven, not heuristic.** Read the code, reason about usage and intent. Confirm cross-file usage before flagging `delete` or `yagni`. A Django view referenced by string in `urls.py` is not dead; a `Protocol` implemented elsewhere has more than one implementation.
- **Check git history.** Before flagging, run `git log --oneline -10` to catch lagging indicators from recent refactors.
- **One-shot report.** Present ranked findings, then stop. Do not start fixing, do not re-explore the codebase, do not drift into an architecture tour.

## Output format

One line per finding, ranked biggest cut first:

```
<tag> <what to cut>. <replacement>. [path]
```

End with:

```
net: -<N> lines, -<M> deps possible.
```

Nothing to cut: `Lean already. Ship.`

Scope: over-engineering and complexity only. Correctness bugs, security holes, and performance are out of scope.
