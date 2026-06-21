---
name: improve-codebase-architecture
description: Scan a codebase for deepening and simplification opportunities — shallow modules, dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead flags. Present findings as a visual HTML report with dual-axis candidates (deepen vs. simplify), then grill through whichever one you pick. Use when the user says "improve architecture", "architecture review", "find deepening opportunities", "what should I refactor", "codebase health check", or wants to improve testability and reduce bloat.
disable-model-invocation: true
license: MIT (adapted from mattpocock/skills)
---

# Improve Codebase Architecture

## When this skill loads, start the review now

This skill is manual-only (`disable-model-invocation: true`); it is never auto-triggered. So if you are reading this, the user has **already issued the entire request** by invoking `/skill:improve-codebase-architecture`. The invocation itself is the task — they want an architecture review of the codebase in the current working directory.

Do not ask "what would you like me to do?" or wait for further instructions before acting. That extra round-trip is exactly the friction this section exists to kill. Begin **Phase 1: Explore** immediately, proceed through **Phase 2: Present candidates as an HTML report**, and only pause at the point Phase 2 explicitly tells you to ask "Which of these would you like to explore?"

The single legitimate reason to pause before starting: there is no recognizable codebase in the current working directory. Only then ask the user for the path to review.

---

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones — and **simplification opportunities** — refactors that cut bloat, dead code, and over-engineering. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary:

- Use the [`codebase-design`](../codebase-design/SKILL.md) skill for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use these terms exactly in every suggestion — don't drift into "component," "service," "API," or "boundary."
- The domain language in any project glossary gives names to good seams; ADRs record decisions this command should not re-litigate.

## Process

### 1. Explore

Understand the project's architecture from existing docs, AGENTS.md, and code inspection.

Then explore the codebase organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

#### Ponytail Audit Pass

Run a **ponytail-audit** pass over the codebase to find bloat that the deletion test misses — code-level over-engineering that isn't about module boundaries. The audit is model-driven: invoke the `ponytail-audit` skill (it auto-triggers) and let it read the tree and produce its ranked findings.

Incorporate the audit findings into your candidate list, tagged as `simplify` (vs. the `deepen` candidates from the deletion test). A module can appear on both axes — too shallow in interface, too bloated in implementation. The audit hunts:

- **Dead code** — defined but never referenced across the whole repo
- **Reinvented stdlib** — custom implementations of built-in functionality
- **Speculative abstractions** — ABCs/Protocols with a single implementation
- **Pass-through wrappers** — functions that only delegate
- **Dead feature flags** — hardcoded toggles that should be removed

See [`ponytail-audit`](../ponytail-audit/SKILL.md) for the full detection catalog and its read-only, one-shot boundaries.

#### Temporal Awareness

Before flagging candidates, check `git log --oneline -20` for refactors in the last 48–72 hours. A candidate that looks contradictory may be a **lagging indicator** — a problem already being resolved by a commit you're about to repeat.

Patterns to recognize:
- **Deepening sequence:** multiple commits consolidating the same domain (e.g., `OrderService` → `OrderManagementService` → `OrderDomain`). A "simplify by splitting" signal is residual from a pre-consolidation state. Don't re-flag it.
- **Two-step refinement:** first commit extracts commonality, second commit parameterizes it (e.g., four QR views → two pairs with shared helper → two parameterized views with `<fmt>` kwarg). Not contradictory — incomplete deepening.
- **Genuine contradiction:** unrelated concerns in one file (e.g., three middlewares sharing `middleware.py` with no behavioral relationship). This is **accidental coupling**, not deepening. Flag for splitting.
- **Simplification enabling deepening:** deleting redundant checks before consolidating remaining logic. Compatible, not contradictory.

If a candidate is already being resolved by recent commits, mark it `temporal: resolving` and skip it. If resolved, mark it `temporal: resolved` and skip it. Only flag `temporal: fresh` candidates.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files** — which files/modules are involved.
- **Axis** — `deepen` (increase depth) or `simplify` (cut bloat), rendered as a badge.
- **Problem** — why the current architecture is causing friction.
- **Solution** — plain English description of what would change.
- **Benefits** — explained in terms of locality and leverage, and how tests would improve.
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the change.
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge.
- **Temporal status** — one of `fresh`, `resolving`, `resolved`. If `resolving`, note which commit is addressing it. If `resolved`, explain why the signal is lagging.

Group candidates by axis: **Deepen** candidates first, then **Simplify** candidates. A module appearing on both axes gets two cards.

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use the project's domain terminology for the domain, and the `codebase-design` vocabulary for the architecture.** If the project defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

See [HTML Report](references/html-report.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, conduct a specification interview to walk the design tree with them — constraints, dependencies, the shape of the changed module, what sits behind the seam, what tests survive.

Use the [`court-jester`](../court-jester/SKILL.md) skill for adversarial review of the proposed change, or conduct a collaborative specification interview.

**Deepening and simplification coexistence.** When a candidate is both a deepening target (consolidate fragmented logic) and a simplification target (split for testability), they are not contradictory — they operate on different axes. Depth is an interface property; internal splitting is an implementation property.

Apply the invariant: **the public interface must remain small and stable while internal structure evolves freely.** If tests call private methods, or callers bypass the interface, the deepening has failed and the Contrarian's critique applies.

Stopping criteria (from council consensus):
- Public methods: ≤ 8. If the deepened module exposes more, extract a sub-service.
- Internal regions: ≤ 4 (e.g., CRUD, Dashboard, Receiver, Misc). If a region exceeds ~120 lines, it's a candidate for its own private class — but keep it internal, same file.
- Total class: ~600 lines is the extraction trigger. Beyond that, even well-organized regions become hard to scan.

The temporal sequence is: **consolidate first** (establish the boundary), **then split internally** (organize within it). Never do both simultaneously — consolidation creates the coherent boundary that makes internal splitting meaningful.

**Shortcut generation.** When a simplification is accepted but deferred (not done now), generate a `# SHORTCUT:` marker at the relevant code site:

```python
# SHORTCUT: <what's skipped>. Upgrade: <what to do when this matters>.
```

Note deferred shortcuts in the report so they can be tracked. See [`ponytail-debt`](../ponytail-debt/SKILL.md) for the marker lifecycle and debt tracking.

## Reference

See [HTML Report](references/html-report.md) for the full HTML scaffold, diagram patterns, and styling guidance.
