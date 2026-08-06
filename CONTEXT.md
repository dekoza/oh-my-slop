# oh-my-slop

A library of agent skills, the slash-command templates that front them, and the pi
extensions and tests that keep them installable. This file is the glossary for the
**workflow** half of that domain — how work is tracked, routed, and closed.

The **skill-authoring** half — Predictability, Model-Invoked, Context Load, Leading
Word, Router Skill, Progressive Disclosure, Duplication — lives in
[`skills/meta/writing-great-skills/GLOSSARY.md`](skills/meta/writing-great-skills/GLOSSARY.md)
and is not repeated here.

## Language

**Issue tracker**:
The forge or convention hosting a repo's issues. This repo has two, split by who
writes to them: the **agent work tracker** (Gitea) holds everything skills produce —
specs, tickets, maps; the **intake tracker** (GitHub) holds what humans and the
community file, and is read and triaged but never written to with new work. The
binding lives in [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
_Avoid_: backlog, backlog manager, backlog backend, issue host

**Issue**:
A single tracked unit inside an **Issue tracker** — the tracker's own native object,
whoever created it. What `triage` processes and what a human files on intake.
_Avoid_: item, card, story

**Ticket**:
An **Issue** this skill set authored onto the **agent work tracker**. Every ticket is
an issue; not every issue is a ticket. Two kinds, distinguished by label and never
carried at once: a **Decision ticket** (`wayfinder:<type>`) and an *implementation
ticket* (`workflow:implement` plus a state label), which holds a slice of a build to
execute. Use **Issue** for the tracker's unit and **Ticket** for work we put there —
the seam that makes `to-tickets` and `triage` read correctly side by side.
_Avoid_: task, work item

**Decision ticket**:
A `wayfinder` unit — a child **Ticket** of a **Map** holding a *question* whose
resolution is a decision, not a slice of a build. The *decision* qualifier is what
separates it from an implementation ticket; `wayfinder` introduces the full term,
then says "ticket".
_Avoid_: investigation ticket, research ticket, spike

**Map**:
The single **Issue** labelled `wayfinder:map` that indexes one wayfinding effort —
its destination, its notes, the decisions closed so far, and the fog still ahead. An
index, never a store: a decision lives in its **Decision ticket**, and the map only
gists and links it.
_Avoid_: plan, epic, roadmap, backlog

**Frontier**:
The edge of what is takeable now. On a **Map**, the open, unblocked, unclaimed
**Decision tickets**; in a `grilling` session, every question whose prerequisites are
already settled. One metaphor, two objects — see *Flagged ambiguities*.
_Avoid_: ready queue, next up, TODO

**Triage role**:
A canonical state-machine label carried by an **Issue** during triage — one at a
time. Each role maps to a real label string in the **Issue tracker** via
[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).
_Avoid_: status, stage, state label

## Flagged ambiguities

- **"Issue" vs "ticket"** — resolved: **Issue** is the tracker's native unit,
  **Ticket** is an issue this skill set authored onto the agent work tracker. The
  split is already how the tree reads — `triage` says "issue" and never "ticket";
  `to-tickets` and `wayfinder` say "ticket" — so it is blessed rather than collapsed.
  Upstream `mattpocock/skills` collapses both into **Issue** and avoids "ticket"
  except for **Decision ticket**; we deliberately diverge, because `to-tickets` is a
  skill name and the rename would touch ~70 sites to erase a distinction we make.
- **"Frontier"** — kept deliberately polysemous across `wayfinder` (takeable tickets)
  and `grilling` (askable questions). Same metaphor, different objects, and no reader
  has to disambiguate: the two never appear in one scope. Not a conflict to resolve.
- **"Map"** — a `wayfinder:map` **Issue**, never `CONTEXT-MAP.md` (this repo is
  single-context, so no context map exists to confuse it with).
