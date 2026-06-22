---
description: Architecture health check with HTML report
argument-hint: "[path]"
---
Scan the codebase at `${1:-.}` for architectural friction. Surface **deepening opportunities** (shallow modules that should consolidate) and **simplification opportunities** (bloat, dead code, over-engineering). Aim: testability and AI-navigability.

## Vocabulary

Use these terms exactly: **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**. Don't drift into "component," "service," "API," or "boundary."

## Process

### 1. Explore

- Read existing docs, AGENTS.md, and code.
- Note friction: where does understanding one concept require bouncing between many modules? Where are modules **shallow** — interface nearly as complex as the implementation? Where do tightly-coupled modules leak across seams? Which parts are untested or hard to test?
- Apply the **deletion test**: would deleting a suspected shallow module concentrate complexity, or just move it? "Yes, concentrates" is the signal.
- Run a **bloat audit** pass — read the tree and look for:
  - `delete:` dead code, unused flexibility, speculative features
  - `stdlib:` hand-rolled stdlib (name the replacement function)
  - `native:` platform/dependency doing what the runtime already does
  - `yagni:` abstraction with one implementation, config nobody sets
  - `shrink:` same logic, fewer lines
  Confirm cross-file usage before flagging — a view referenced by string in `urls.py` is not dead; a `Protocol` with another implementation is not YAGNI. Model-driven, not heuristic.
- Check `git log --oneline -20` for recent refactors. Skip candidates already being resolved (`temporal: resolving`) or resolved (`temporal: resolved`). Only flag `temporal: fresh` candidates.

### 2. Present as HTML report

Write a self-contained HTML file to `<tmpdir>/architecture-review-<timestamp>.html`. Use Tailwind via CDN for styling, Mermaid via CDN for graph-shaped diagrams. Open it for the user (`xdg-open`/`open`/`start`).

Each candidate gets a card with:
- **Files** involved
- **Axis** — `deepen` or `simplify` badge
- **Problem** — why current architecture causes friction
- **Solution** — plain English description of the change
- **Benefits** — explained in terms of locality and leverage, test improvements
- **Before / After diagram** — side-by-side visual
- **Recommendation strength** — `Strong`, `Worth exploring`, or `Speculative` badge
- **Temporal status** — `fresh`, `resolving`, or `resolved`

Group: **Deepen** candidates first, then **Simplify**. End with a **Top recommendation** section.

After the file is written, ask: "Which of these would you like to explore?"

### 3. Grilling loop (when user picks a candidate)

Conduct a specification interview: constraints, dependencies, the shape of the changed module, what sits behind the seam, what tests survive. Use adversarial review for the proposed change.

Stopping criteria:
- Public methods: ≤ 8
- Internal regions: ≤ 4 (~120 lines each)
- Total class: ~600 lines is the extraction trigger
