---
name: improve-codebase-architecture
description: Scan the codebase for deepening and simplification opportunities, present them as a visual dual-axis HTML report (deepen vs. simplify), then grill through the candidate you pick.
disable-model-invocation: true
license: MIT (adapted from mattpocock/skills)
---

# Improve Codebase Architecture

## When this skill loads, start the review now

This skill is manual-only (`disable-model-invocation: true`); it is never auto-triggered. So if you are reading this, the user has **already issued the entire request** by invoking `/skill:improve-codebase-architecture`. The invocation itself is the task — they want an architecture review of the codebase in the current working directory.

Do not ask "what would you like me to do?" or wait for further instructions before acting. That extra round-trip is exactly the friction this section exists to kill. Begin **Phase 1: Explore** immediately and proceed through **Phase 2: Present candidates as an HTML report**. The first legitimate pause is the one **Phase 3** names: the selection prompt, where you propose a set of candidates to ticketize and the user confirms or amends it.

The single legitimate reason to pause before starting: there is no recognizable codebase in the current working directory. Only then ask the user for the path to review.

If the exploration finishes and nothing real surfaces — the architecture is already deep, nothing is bloated — say so plainly and stop. A short "no strong candidates: here's why the current shape holds up" is the honest result; don't manufacture weak candidates to fill the report.

---

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones — and **simplification opportunities** — refactors that cut bloat, dead code, and over-engineering. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary:

- Use the [`codebase-design`](../../practice/codebase-design/SKILL.md) skill for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use these terms exactly in every suggestion — don't drift into "component," "service," "API," or "boundary."
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

- **Ticketed** — the friction is real and still sits in the codebase, so **the card renders**; only the filing is suppressed, and the candidate is held out of the ticketization seed **unless the user overrides**. Link the existing issue in a `Ticketed #N` badge. Suppress the duplicate write, not the observation — an independent rediscovery corroborates a ticket nobody prioritised.
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
- **Candidate id** — an axis-prefixed handle assigned here, in report order: `D1…Dn` down the Deepen group, then `S1…Sn` down Simplify. Rendered as a badge; Phase 3 refers to candidates by it.

Group candidates by axis: **Deepen** candidates first, then **Simplify** candidates. A module appearing on both axes gets two cards.

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use the project's domain terminology for the domain, and the `codebase-design` vocabulary for the architecture.** If the project defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**Decision conflicts**: if a candidate contradicts an existing ADR — or a decision ticket closed against it — only surface it when the friction is real enough to warrant revisiting that decision. Mark it clearly in the card with the Decision callout (_"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor a recorded decision forbids.

See [HTML Report](references/html-report.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet — that is what the grill in §4 is for. Once the file is written and open, go straight to Phase 3: the candidates get picked there, as a proposal the user vetoes rather than as an open question.

### 3. Ticketize the chosen candidates

The report sits in a temp directory and will be gone. The candidates the user picked, the ones they didn't, and *why* — none of it survives unless it is written somewhere durable, so the review's findings become a **wayfinder map** with one ticket per chosen candidate. The map and its tickets are the record of truth; the report was a presentation artifact, and its content is fully carried into text here.

**Report written → map charted, always** — including the **zero-pick** case where the user vetoes everything. That run is the most decision-dense output there is ("we reviewed this codebase and consciously declined all of it, here's why"), and it needs somewhere to live. **No report → no map**: the "nothing real surfaced" short-circuit at the top of this skill stays map-free, because charting an empty map would be manufacturing an artifact to match a rule.

#### Selection: propose a set, take the veto

Selection is **default-with-veto** — you propose a concrete set and ask the user to confirm or amend it. Seed the proposal with every candidate that is `Strong` or `Worth exploring` **and** `temporal: fresh` **and** not `Ticketed`.

State the proposal compactly **in the terminal**, followed by one line naming what was skipped and how to pull it in. The user must never have to **re-scan** the HTML to know what is being proposed:

> Proposing 3 of 6 candidates as tickets:
>
> - **D1** Collapse the Order intake pipeline — deepen · Strong
> - **D3** Give the pricing adapter a real seam — deepen · Worth exploring
> - **S2** Delete the dead `LEGACY_CHECKOUT` flag — simplify · Strong
>
> Skipping S1 and S3 (Speculative) and D2 (already ticketed). Say "add S1" to pull any of them in.

Then ask **once**. "Yes", "all", "drop D2", "only D1 and S1", "none" are each a one-word reply: the prompt degenerates to one word when you guessed right and to named picks when you didn't. Stating the default out loud is what makes a bad default visible instead of silent.

**Candidate ids.** Every candidate carries an axis-prefixed id — `D1…Dn` for deepen, `S1…Sn` for simplify — assigned in **report order** (the Deepen group first, then Simplify), rendered as a badge on its card and echoed in the proposal. This is what makes the veto usable: titles are ambiguous exactly where the axes overlap, and one module may hold a card on both axes.

#### Chart the map

Chart a wayfinder map per the [`wayfinder`](../wayfinder/SKILL.md) skill, following its charting mode. Wayfinder owns every tracker operation involved — where the map and its child tickets live, how they are labelled and parented, how blocking edges are wired, how the frontier is queried. This skill carries **no tracker operations of its own**: don't inline an operation set, don't read the tracker doc to author anything, don't reach for a CLI. What follows is *content* — what goes in the bodies — never how to write it.

A repo with no tracker inherits wayfinder's **local-markdown fallback**, and the flow is otherwise identical. No degrade path, no hard stop; at most one line mentioning that `/setup-project-skills` gets them a forge-backed tracker.

Two things about the candidate tickets themselves:

- Create them **unassigned**. The grill target is picked by a later prompt, so at creation time you don't yet know which one it will be — and an assignee *is* a claim, so assigning them all would leave wayfinder's **frontier** query (open, unassigned, unblocked) returning nothing on the very next session. The map would look fully worked the moment it was charted.
- Label every one `wayfinder:grilling` — wayfinder's default type, and the post-pick flow is a specification interview. The label is uniform, so routing rides in the body instead; a `wayfinder:court-jester` type would bend wayfinder's vocabulary to fit this skill, so it stays uninvented.

#### The candidate ticket body

Question first, evidence below:

```markdown
Part of #<map>

## Question

Should the Order intake pipeline be collapsed into a single deep module,
and if so where does the seam land — what stays behind the interface,
and what do the surviving tests call?

## From the review

**Axis:** deepen · **Strength:** Strong · **Candidate:** D1 · Review of 2026-07-27

**Files:** `orders/handler.py`, `orders/validator.py`, `orders/repo.py`

**Problem** — Understanding one order requires bouncing between four
modules; `OrderRepo` leaks pricing concerns across its seam.

**Proposed shape** (the review's guess, not a decision) — Collapse the
four into one `OrderIntake` module; pricing moves behind the interface.

**Benefits** — Tests hit one interface. Pricing stops leaking.
Four shallow wrappers pass the deletion test.
```

- **`## Question` states the real open decision.** Not the report card transcribed with a generic "should we do this?" bolted on top — that would let the grilling session treat the proposal as settled, the opposite of what a wayfinder ticket is for.
- **The report's Solution is demoted to `Proposed shape` — the review's guess, not a decision.** That is its actual epistemic status: it was written before any interview happened, so the ticket must not read as settled.
- **Problem, Files and Benefits are carried across, not summarized away.** The report is ephemeral, so evidence you don't carry is lost permanently — and it is cheap to copy, expensive to reconstruct.
- **The `D1`/`S1` id lives in the body as provenance, never as a title prefix.** It is a report-run-local handle that dies with the report, while the ticket's durable identity is its index and its name — and wayfinder refers to tickets by name. In the body it still lets the map's `Out of scope` lines and the terminal proposal be traced back, without a dead handle colonizing every title.
- **The before/after diagram is not transcribed** — deliberately dropped, not an oversight. Its job is scanning a long report to choose among eight candidates; a ticket's reader has already chosen and is about to open the files. Transcribing Mermaid would also reward drawing every diagram in Mermaid so it survives ticketization — the report's visuals degraded to serve the tracker, and the hand-built ones could not transcribe at all.
- **Court-jester routing rides on the `## From the review` metadata line**, present **only** when the review judged the candidate contested — a contested trade-off, or rollout/coupling risk:

  ```
  **Axis:** deepen · **Strength:** Strong · **Route:** court-jester · **Candidate:** D1
  ```

#### The map body

**Title:** `Architecture review — <repo> — <date>`

Wayfinder owns the body's sections; this is what a review map puts in them, `Decisions so far` and `Not yet specified` both starting empty:

```markdown
## Destination

Every candidate carried into this map is decided — each one either specified
far enough to route out as implementation work, or consciously ruled out.
Done when no candidate ticket remains open.

## Notes

- Review of `<path>`, run <date>. The HTML report was written to a temp path
  and is gone; this map and its tickets are the record.
- Skills to consult per session: `codebase-design` for the architecture
  vocabulary (module, interface, depth, seam, adapter, leverage, locality) —
  use these terms exactly. `grilling` by default; `court-jester` for any
  ticket carrying a `Route: court-jester` hint.
- Candidates are independent decisions unless a blocking edge says otherwise.
- Stopping criteria for a `deepen` candidate: ≤ 8 public methods; ≤ 4 internal
  regions; ~600 lines total is the extraction trigger.

## Decisions so far

## Not yet specified

## Out of scope

<!-- unchosen candidates from the review — they never graduate -->
```

A review map is structurally odd for wayfinder: not one effort finding its way to a single destination, but a **basket** of independent decisions that surfaced together, so the Destination has to be honest about that. A **thematic** destination ("the Order intake and pricing seams are settled") needs a unifying story across candidates that usually doesn't exist; an **aspirational** one ("a deeper, less bloated architecture") is never reachable, so the map could never close.

The **Notes** block is load-bearing because a work-through session weeks later arrives via `/wayfinder` having never loaded this skill: vocabulary discipline and court-jester routing not written on the map are simply lost. So are the three stopping criteria, which exist nowhere else — the work-through section below is their source of truth, and it lives in the skills directory rather than in the repo under review, so a path reference on the map would resolve to nothing for whoever opens it. Qualify them as **deepen-only** and drop the parenthetical attribution the section below carries; provenance means nothing to a reader there. Emit them **always**, including on a **simplify-only** map — three lines of harmless text beat a conditional this skill has to state and the evals have to cover.

**`Not yet specified` is charted empty.** Every candidate arrives with a full report card, so nothing is fog; the section exists only for what a later work-through session surfaces.

#### Recording the unchosen — `Out of scope`

The unchosen candidates go on the map's `Out of scope` section. That is the right home: an unchosen candidate is sharp — it has a full report card, so it isn't fog — and it isn't a step on the route, so it isn't a decision. It never graduates. Dropping these would make every future review start from zero: History Awareness reads exactly what is written here, and re-proposing a deliberately declined candidate is the failure it exists to prevent.

**Three classes, each line led by a bolded class label** so a later review can scan it:

```markdown
- **Vetoed** — D2 Split the pricing adapter (deepen · Worth exploring) —
  "deliberate, see ADR-0007" — user's words.
- **Not added** — S3 Inline the retry helper (simplify · Speculative) —
  below the proposed set; not raised.
- **Already ticketed** — D4 Collapse the notification fan-out (deepen ·
  Strong) — held out of the seed by History Awareness; see
  [Notifications double-send on retry](link).
```

- **Vetoed** — you proposed it, the user declined. Quote the user's stated reason **verbatim** when they gave one; "deliberate — see ADR-0007" is worth far more to a later run than "not chosen". And **never invent** a reason for a candidate the user said nothing about.
- **Not added** — below the proposed set, not pulled in. Use the fixed phrase `below the proposed set; not raised` and add no invented rationale. It reads as "not now", not "no".
- **Already ticketed** — held out of the seed by History Awareness and not overridden. This class **links the pre-existing ticket**.

**`Vetoed` and `Not added` carry no link.** Those candidates were never ticketized, so the map line *is* the whole record. That diverges from wayfinder's `Out of scope`, which normally links the closed ticket; `Already ticketed` is the sole exception, because its ticket already exists. The divergence is deliberate, and recorded here plainly so nobody later "fixes" it by creating tickets **purely to close them**.

A candidate ruled out later, **during work-through** — a ticket that existed and turned out to sit past the destination — follows wayfinder's normal rule unchanged: **close the ticket, link it**. Two paths into one section.

#### Blocking edges — one narrow rule

Wire **`deepen` blocks `simplify`** in exactly one situation: the two candidates' **Files overlap** *and* the simplify candidate proposes **splitting or reorganizing rather than deleting**. **Otherwise no edge** — candidates are independent decisions, and all of them sit on the frontier.

This is **deliberately rare**, for two reasons. All five ponytail-audit categories are **deletions**, so the report's `simplify` candidates are almost always the no-edge kind; the obvious blanket rule ("same module on both axes, deepen blocks simplify") would fire constantly and be wrong nearly every time. Consolidate-before-split is real, but so is the opposite ordering — deleting redundant checks before consolidating what remains — and which one applies depends on the kind of simplification. Second, a wrong edge is expensive: some trackers **refuse** to close a blocked issue, and no list output reveals blocked-ness, so a speculative edge doesn't merely mis-order the frontier — it hides a ticket and then refuses to let anyone close it, with no visible cause.

The report's **Top recommendation** is expressed as **first in map order**, **not as a blocking edge**. Map order is already how wayfinder breaks frontier ties, so no edge is needed to say "do this one first".

#### Report what you charted

Tell the user what exists now: the map and each candidate ticket, **by name** with its link — wayfinder's rule, because a wall of bare numbers is illegible — alongside the id each was proposed under, so the terminal proposal can be traced.

### 4. Grill a candidate — a wayfinder work-through

The candidates are tickets now, so grilling one is no longer a conversation *about* a candidate: it is a **work-through** of a candidate ticket, following [`wayfinder`](../wayfinder/SKILL.md)'s work-through mode — claimed, resolved, closed, recorded on the map. The report is already gone by the time this starts, and the map is the record of truth; what the interview establishes survives only if it lands on the tracker.

**A named divergence.** Wayfinder's charting mode ends with *"Stop — charting the map is one session's work; do not also resolve the other tickets."* Ticketize-then-grill breaks that rule **on purpose**: the context that makes this grill cheap — the exploration, the audit, the evidence behind every card — exists in this session and nowhere else, and re-reading it in a fresh session buys nothing. Exactly one ticket, the picked one, is worked here; the rest wait for their own sessions. Written out plainly so the next reader records it as a deliberate divergence rather than filing it as a bug.

#### The prompt: separate, defaulted, gated on tickets existing

Ask **after** ticketization, as its own question — not folded into the selection prompt. Selection settles what gets written down; this settles what gets worked now, and merging the two buries the second question inside a reply to the first.

The report's **Top recommendation** is the default target:

> Charted 3 tickets. Grill **Collapse the Order intake pipeline** (D1, the top recommendation) now?
>
> Say "grill S2 instead" to pick another, or "no, stop here" to end at the map.

Both alternatives are first-class answers, not fallbacks — a run that stops at a charted map is a complete run, not an abandoned one.

**The gate is tickets, not report.** A **zero-pick** run charts its map and stops: its Top recommendation still names a candidate the user has just vetoed, and offering it reads as *"you declined everything — shall we grill the thing you declined?"* No candidate tickets → no prompt, and the session ends at the map.

#### Claim first, then resolve — with the close made conditional

**Claim the ticket first**, before any work — assign it, per wayfinder, so a concurrent session skips it. Only then start the interview.

- **The interview converges** — post the answer as a **resolution comment** on the ticket, **close** it, and append the gist to the map's `Decisions so far`. Wayfinder's ordinary resolution, unchanged.
- **It does not converge** — the decision turns out to need call sites nobody has read, or the session simply runs out — post what **was** established as a comment, **release the claim** (unassign), and leave the ticket **open**.

A false close and a silent loss are both worse than an open ticket carrying real progress: closing advertises a decision that was never made, and dropping the half-formed answer sends the next session back to the report card that no longer exists.

#### Routing: honour the `Route:` field

Routing was decided at ticketization and written onto the body's metadata line. This step **honours it** rather than re-deciding it — the judgement was made minutes ago with the whole report in view.

- **The label carries no routing signal.** Every candidate ticket is `wayfinder:grilling`, uniformly, so `Route:` in the body is the **only** carrier. Said here explicitly so nobody later "simplifies" the pair by inventing a `wayfinder:court-jester` type — the thing §3 keeps uninvented.
- **No `Route:` line** — run the specification interview ([`grilling`](../grilling/SKILL.md)) and walk the design tree with the user: constraints, dependencies, the shape of the changed module, what sits behind the seam, what tests survive.
- **`Route: court-jester`** — run [`court-jester`](../court-jester/SKILL.md) and **then** the interview. A prelude, not an alternative: court-jester defaults to one pass and is agent-driven, so its synthesis is the *agent's* recommendation, while every candidate ticket is HITL — wayfinder is explicit that such a ticket "only resolves through that live exchange; the agent never stands in for the human's side of it". court-jester sharpens the thesis; the live interview is what makes the close legitimate.
- **`Route:` is a hint, not a verdict.** Escalate mid-interview if it surfaces a contested trade-off or rollout/coupling risk the card missed — the field was written from a report card, and the interview sees more than the card did.
- **An escalation that then fails to converge writes the corrected `Route:` back** into the ticket body, before the claim is released. Otherwise the next session inherits the card's judgement and pays to rediscover the risk.

#### What the interview walks

**Deepening and simplification coexistence.** When a candidate is both a deepening target (consolidate fragmented logic) and a simplification target (split for testability), they are not contradictory — they operate on different axes. Depth is an interface property; internal splitting is an implementation property.

Apply the invariant: **the public interface must remain small and stable while internal structure evolves freely.** If tests call private methods, or callers bypass the interface, the deepening has failed and the Contrarian's critique applies.

Stopping criteria (from council consensus) — this section is their **source of truth**, and §3 emits them onto the map's Notes for the work-through sessions that never load this skill:
- Public methods: ≤ 8. If the deepened module exposes more, extract a sub-service.
- Internal regions: ≤ 4 (e.g., CRUD, Dashboard, Receiver, Misc). If a region exceeds ~120 lines, it's a candidate for its own private class — but keep it internal, same file.
- Total class: ~600 lines is the extraction trigger. Beyond that, even well-organized regions become hard to scan.

**Sequencing — consolidate first, then split internally.** [`codebase-design`](../../practice/codebase-design/SKILL.md) carries the rule and the reasoning, and the map's Notes already send every session there; use it rather than a second copy that can drift.

#### When the decision lands, route its work out

A converged decision that is build-ready gets its implementation filed **in-session**, while the context is at its peak: invoke [`to-tickets`](../to-tickets/SKILL.md), marking each generated ticket `workflow:implement` plus its `ready-for-agent` or `ready-for-human` state. This is wayfinder's standing rule to route build-ready work out of the decision frontier, applied to the *candidate's* implementation work. A design nobody filed is worth about as much as a design nobody made.

**A deferred simplification is not a marker this session writes.** This skill produces a locked design and routes the building out; it **never touches the reviewed repo's code**. [`tdd`](../../practice/tdd/SKILL.md) is where a `# SHORTCUT:` marker is authored, and [`ponytail-debt`](../ponytail-debt/SKILL.md) owns its lifecycle, harvesting markers from source. So when the interview accepts a simplification but defers it, the deferral becomes an **acceptance criterion on the implement ticket** just filed, and the implementer writes the marker when the code is actually written:

> - [ ] Tag the skipped retry backoff at its call site with
>   `# SHORTCUT: <what's skipped>. Upgrade: <what to do when this matters>.`

"A simplification we are not doing now" has exactly three fates:

- **Still an open decision** — its own ticket on the map, created the way wayfinder's work-through creates any newly-surfaced ticket.
- **Decided skip with a known upgrade path** — a `# SHORTCUT:` marker, authored by the implementer, specified as the acceptance criterion above.
- **Ruled out** — a line in the map's `Out of scope`.

## Reference

See [HTML Report](references/html-report.md) for the full HTML scaffold, diagram patterns, and styling guidance.
