# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── skills/, extensions/, scripts/, tests/
```

## This file is the authority on where the glossary lives

If a skill mentions "the project's domain glossary" without naming a path, it means
whatever this file points at — `CONTEXT.md` by default. A repo that keeps its
glossary somewhere else (`UBIQUITOUS_LANGUAGE.md`, a section of `AGENTS.md`, a wiki
page) should say so here rather than leaving each skill to guess.

**This repo splits its glossary in two.** `CONTEXT.md` holds the **workflow**
vocabulary — issue tracker, issue vs ticket, decision ticket, map, frontier, triage
role. The **skill-authoring** vocabulary — predictability, model- vs user-invoked,
context load, leading word, progressive disclosure, duplication — lives in
[`skills/meta/writing-great-skills/GLOSSARY.md`](../../skills/meta/writing-great-skills/GLOSSARY.md),
which is a disclosed reference of that skill and is already authoritative. Read
whichever half your task touches; authoring work usually wants both. The two do not
overlap, and neither should be copied into the other.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
