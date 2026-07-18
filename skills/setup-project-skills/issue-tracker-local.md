# Issue tracker: Local markdown

This repo has no forge-backed tracker. Issues, specs, and wayfinder maps live as
markdown files committed alongside the code.

## Conventions

- One feature per directory: `docs/tickets/<feature-slug>/`
- The spec for a feature is `docs/specs/<feature-slug>.md`
- Implementation tickets are one file per ticket at
  `docs/tickets/<feature-slug>/<NN>-<slug>.md`, numbered from `01` — **never** a
  single combined tickets file
- Triage state is a `Status:` line near the top of each file (see the triage label
  mapping for the role strings)
- Comments and conversation history append to the bottom under a `## Comments` heading
- The "issue number" a skill refers to is the `<NN>` prefix, scoped to its feature
  directory

## When a skill says "publish to the issue tracker"

Create a new file under `docs/tickets/<feature-slug>/` (creating the directory if
needed), or `docs/specs/<feature-slug>.md` for a spec.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the
ticket number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `docs/wayfinder/<effort>/map.md` — the Destination / Notes /
  Decisions-so-far / Fog body.
- **Child ticket**: `docs/wayfinder/<effort>/tickets/<NN>-<slug>.md`, numbered from
  `01`, with the question in the body. A `Type:` line records the ticket type
  (`research` / `prototype` / `grilling` / `task`); a `Status:` line records
  `open` / `claimed` / `resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when
  every ticket it lists is `resolved`.
- **Frontier query**: scan the tickets directory for files that are open, unblocked,
  and unclaimed; lowest number wins.
- **Claim**: set `Status: claimed` and save before doing any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`,
  then append a one-line gist plus relative link to the map's Decisions-so-far.
