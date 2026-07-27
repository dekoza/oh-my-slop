---
name: improve-codebase-architecture
description: Scan the codebase for deepening and simplification opportunities, present them as a visual dual-axis HTML report (deepen vs. simplify), then grill through the candidate you pick.
disable-model-invocation: true
license: MIT (adapted from mattpocock/skills)
---

# Improve Codebase Architecture

## When this skill loads, start the review now

This skill is manual-only (`disable-model-invocation: true`); it is never auto-triggered. So if you are reading this, the user has **already issued the entire request** by invoking `/skill:improve-codebase-architecture`. The invocation itself is the task — they want an architecture review of the codebase in the current working directory.

Do not ask "what would you like me to do?" or wait for further instructions before acting. That extra round-trip is exactly the friction this section exists to kill. Begin **Phase 1: Explore** immediately, proceed through **Phase 2: Present candidates as an HTML report**, and only pause at the point Phase 2 explicitly tells you to ask "Which of these would you like to explore?"

The single legitimate reason to pause before starting: there is no recognizable codebase in the current working directory. Only then ask the user for the path to review.

If the exploration finishes and nothing real surfaces — the architecture is already deep, nothing is bloated — say so plainly and stop. A short "no strong candidates: here's why the current shape holds up" is the honest result; don't manufacture weak candidates to fill the report.

---

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones — and **simplification opportunities** — refactors that cut bloat, dead code, and over-engineering. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary:

- Use the [`codebase-design`](../codebase-design/SKILL.md) skill for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use these terms exactly in every suggestion — don't drift into "component," "service," "API," or "boundary."
- The domain language in any project glossary gives names to good seams; ADRs record decisions this command should not re-litigate.

## Process

### 1. Explore

Understand the project's architecture from existing docs, AGENTS.md, the issue tracker index, and code inspection.

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

#### History Awareness

Temporal Awareness reads commits; History Awareness reads issues. The failure it prevents is **duplication**: a review that re-proposes friction someone already filed, re-litigates a decision already closed against, or throws away evidence it could have cited.

The tracker index was **already pulled during orientation** and stays in context for the whole session, so matching costs **no extra queries** — read candidate Files and module names against titles you already hold. Run this pass *after* Temporal Awareness, so no drill-down is spent on a candidate that will not render.

**Routing.** Consult the repo's issue-tracker doc. For **every** surface it declares, use that surface's documented **List issues** verb to pull the index, and its **Read an issue** verb for drill-downs. The doc is the thing that knows how many surfaces there are and which one is intake — never hardcode a tracker, a label scheme, or a CLI here.

**Index scope** — number, title, labels, state, closed-at, per surface:

- **Open** issues — no window. Open is open.
- **Closed** issues — the last **6 months**. Recency is what makes friction meaningful; a bug cluster on a since-rewritten module is noise. Same logic as the git-log window above, at tracker time scale.
- **Closed `wayfinder:*` maps and tickets — all-time**, by label. A decision from 18 months ago still binds, and label-findable history is what makes decision-respect work without depending on rejection labels existing.

Cap **200 issues per surface**. When the cap bites, the report says so rather than silently reviewing a truncated tracker — and only then does keyword-filtering the **List issues** verb become worth a query.

**Drill-down** pulls body *and* comments in one call — **always with comments**, because the seams people fought with live in the comment thread — capped at **~10 issues per review**. It fires in **exactly two situations**:

- confirming a suspected match whose title alone cannot settle it;
- opening a **cluster of 3+ issues sharing a module or feature term** — the signal-mining trigger, which runs *before* candidates exist and steers where exploration goes.

**The bar is the moot test: resolving that ticket would make the candidate moot.** Sharing a file is not enough — a repo's busiest module attracts unrelated tickets, and a loose bar would suppress every candidate touching it, silently gutting the review. Weaker-but-real overlap earns a corroboration citation, nothing more. Judge it like the deletion test: a crisp counterfactual, binary, occasionally wrong — no confidence tiers, no "possible duplicate" state. The error to prefer: a duplicate ticket is visible and closeable; a wrongly suppressed candidate is invisible and the user never learns it existed.

**Three relations, three effects:**

- **Ticketed** — the friction is real and still sits in the codebase, so **the card renders**; only the filing is suppressed, and the candidate is **never filed as a new ticket**. Link the existing issue in a `Ticketed #N` badge. Suppress the duplicate write, not the observation — an independent rediscovery corroborates a ticket nobody prioritised.
- **Decided against** — a closed decision ticket is an ADR on a different surface, so it **reuses the ADR rule verbatim**: surface it only when the friction is real enough to warrant revisiting, marked with the Decision callout naming the ticket (`#22`) where an ADR would name `ADR-0007`.
- **Corroborated** — **evidence, never suppression.** Cite the issue numbers inline in the card's Problem sentence. It may justify a stronger Recommendation strength, but as a judgement call and **never as a counting rule** — a mechanical rule would let issue volume game the grade.

**Untracked candidates carry nothing** — no badge, no callout, no citation. The card looks exactly as it does today.

**No tracker, or nothing recorded.** With no issue-tracker doc, or a local-markdown fallback with nothing in it, this pass **no-ops silently**: **no badges, no callouts, no citations**, and **no prompt to run `/setup-project-skills`**. The only trace is one clause in the report header.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell them the absolute path. If the open command fails (headless shell, no desktop), print the absolute path and tell the user to open it manually; the report is still written.

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

**Decision conflicts**: if a candidate contradicts an existing ADR — or a decision ticket closed against it — only surface it when the friction is real enough to warrant revisiting that decision. Mark it clearly in the card with the Decision callout (_"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor a recorded decision forbids.

See [HTML Report](references/html-report.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, conduct a specification interview to walk the design tree with them — constraints, dependencies, the shape of the changed module, what sits behind the seam, what tests survive.

Route by what the candidate needs:

- **Contested trade-off or rollout/coupling risk** — where the change could go wrong, or reasonable people would disagree on it — run [`court-jester`](../court-jester/SKILL.md) for adversarial review before committing to the shape.
- **Open-ended "what shape should this take"** — where the design space is wide and nothing's obviously risky — run a collaborative specification interview (`grilling`) to walk the options with the user.

Default to the interview; escalate to court-jester when the candidate carries real risk.

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
