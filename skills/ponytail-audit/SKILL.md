---
name: ponytail-audit
description: >
  Whole-repo audit for over-engineering and bloat. Reads the codebase and
  produces a ranked list of what to delete, simplify, or replace with
  stdlib/native equivalents: dead code, reinvented stdlib, speculative
  abstractions with one implementation, pass-through wrappers, dead flags.
  Use when the user says "audit this codebase", "find bloat",
  "over-engineering check", "ponytail-audit", "what can I cut",
  "trim this down", "YAGNI check", or wants to reduce code/dependency
  surface. One-shot report, applies nothing.
license: MIT (adapted from DietrichGebert/ponytail)
---

# Ponytail Audit

A whole-repo audit for over-engineering. Read the codebase, then produce a
ranked list of what to cut. Read-only — no files are modified, no fixes
applied.

This audit is **model-driven, not heuristic.** Over-engineering detection is
a cross-file, intent-laden judgment: a function is only dead once you've
confirmed nothing references it across the whole repo; an abstraction is only
speculative once you've counted its implementations everywhere; a wrapper is
only pass-through once you've read what it actually does. Name patterns and
per-file occurrence counts cannot make those calls — they produce
near-universal false positives. So read the code, reason about usage and
intent, and only flag what you can justify against the actual code.

## Tags

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Hunt

Read the tree and look for: dependencies the stdlib or platform already ships;
single-implementation interfaces; factories with one product; wrappers that
only delegate; files exporting one thing; dead flags and config; hand-rolled
stdlib.

Before flagging anything `delete` or `yagni`, confirm the cross-file usage
yourself — grep the repo and read the callers. A Django view referenced by
string in `urls.py` is not dead; a `Protocol` implemented in another module
has more than one implementation; a settings flag is config, not a dead
feature flag. A finding you cannot justify against the actual code is a false
positive; drop it rather than pad the report.

## Output

One line per finding, ranked biggest cut first:

```
<tag> <what to cut>. <replacement>. [path]
```

End with:

```
net: -<N> lines, -<M> deps possible.
```

Nothing to cut: `Lean already. Ship.`

## Boundaries

Scope: over-engineering and complexity only. Correctness bugs, security
holes, and performance are out of scope — route them to a normal review, not
this one. Lists findings, applies nothing. One-shot.

**Stop after presenting.** Present the ranked findings, then ask the user
which to act on — and stop. Do not start fixing, do not re-explore the
codebase to "build confidence," and do not drift into a general architecture
tour ("let me look at key modules, URL patterns, the overall architecture…").
That broader tour is a different activity; if the user wants it, that's what
`improve-codebase-architecture` is for. The findings are cheap for the user
to triage; they don't need you to pre-validate the whole codebase first.

## Pair with

- **codebase-design** — the "before you build" ladder that prevents bloat in the first place
- **ponytail-debt** — tracking shortcuts deliberately left behind
- **court-jester** — adversarial review of whether a finding is actually bloat or justified complexity
