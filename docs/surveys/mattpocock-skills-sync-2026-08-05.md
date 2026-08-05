# Survey: mattpocock/skills cross-analysis (2026-08-05)

Cross-analysis of [mattpocock/skills](https://github.com/mattpocock/skills) @ `0986eba` (v1.2.1, 2026-08-05) against `oh-my-slop`. Produced by five parallel survey sub-agents from a full clone.

**Shared DNA:** 23 local skills carry `license: MIT (adapted from mattpocock/skills)`. Our last sync was ~2026-07-17; upstream has since shipped the 1.2.0/1.2.1 wave — 37 commits touching `skills/`.

**Upstream shape today:** 35 skills in five buckets (`engineering/`, `productivity/` = promoted and shipped in the plugin; `misc/`, `in-progress/`, `deprecated/` = not shipped). We carry 61 skills, flat, all shipped.

**Headline:** we are *ahead* of upstream on the workflow suite (wayfinder, to-tickets, triage, setup) and on verification (upstream has zero tests). We are *behind* on `grilling` — upstream reworked its core mechanic, and every caller inherits it. Four new upstream skills have no local counterpart and three are worth taking.

---

## Part 1 — Updates to existing skills

### Tier 1: adopt now (self-contained, high payoff)

#### 1.1 `grilling` — round-by-round frontier interview

The single biggest behavioural delta. Upstream `a4b2009` (2026-07-16) folded its `batch-grill-me` experiment into `grilling` and deleted the experiment. Our `skills/grilling/SKILL.md:11-13` is still the pre-rework one-at-a-time version.

The new mechanic, verbatim:

> Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

> A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Four sub-changes ship with it:

- **Pinned question format** (`294a2c9` → `1495d01`, settled after four iterations — don't re-derive it):
  ```
  ❓ **Q1** - **<question title>**: <body, possibly multiple paragraphs or choices>

  ➡️ <your recommended answer>
  ```
  The `**Recommendation:**` label was deliberately dropped; the arrow line stands alone. Purpose: a round becomes answerable by number ("1 yes, 2 the second option, 3 no").
- **Fact-finding must not block the round:** "a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now." Plus: "Finding _facts_ is your job, never the user's."
- **Termination criterion:** "The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed."
- **Second person throughout** ("Interview the user", not "Interview me") — matters because `wayfinder/SKILL.md:83` warns about a grilling agent answering its own questions.

Upstream is honest about the limit ("the frontier is the agent's judgement, not a computed graph") and documents an opt-out: a line in global `CLAUDE.md` — `When grilling, ask one question at a time.`

**Caller sync required if adopted** (upstream did this in `bfdaef8`): `README.md:147`, `skills/wayfinder/SKILL.md:87`, `skills/triage/SKILL.md:82` all promise "one question at a time". The two `should_trigger: true` evals in `skills/grilling/evals/trigger-evals.json:7,31` stay valid as triggers — a user asking for one-at-a-time is still a grilling request — but the opt-out should be documented.

Keep our frontmatter — our `Use when… / Triggers on:` description follows our own quality standard and is better than upstream's terse line. Adopt the body only.

#### 1.2 `diagnosing-bugs` — four rules we dropped in adaptation

Our version grew to 573 lines (vs upstream's 134) with a local Multi-Failure Triage section, and rewrote Phases 3–5 from scratch. Four discrete upstream rules were lost:

| Rule | Upstream | Our state |
|---|---|---|
| **Ranked hypothesis set** | "Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea." Each falsifiable as *"If \<X\> is the cause, then \<changing Y\> will make the bug disappear"*. Show the list to the user before testing, but don't block if they're AFK. | `:477-490` does one-at-a-time with escalation only after 3 refutations. No anchoring guard, no user checkpoint. |
| **Tagged debug logs** | "Tag every debug log with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup becomes a single grep. Untagged logs survive; tagged logs die." Plus debugger-first: "One breakpoint beats ten logs", never "log everything and grep". | `:516` says only "Keep instrumentation temporary". The Phase 5 cleanup checkbox at `:535` is an honour system. |
| **Regression test needs a correct seam** | "Write the regression test **before the fix** — but only if there is a **correct seam** for it… **If no correct seam exists, that itself is the finding.** The codebase architecture is preventing the bug from being locked down." | `:533` has an unconditional "convert the repro into a permanent test", fix applied first. |
| **Phase 6 — post-mortem** | State the winning hypothesis in the commit/PR "so the next debugger learns", then "ask: what would have prevented this bug?" and hand off to `/improve-codebase-architecture` — "**after** the fix is in, not before." | Folded into Phase 5; no prevention step, no handoff, despite us shipping the target skill. |

The seam rule is the sharpest — it reconnects to our own `codebase-design` seam vocabulary. Our fix-before-test ordering is a genuine local choice; the "no correct seam = finding" clause is additive either way.

#### 1.3 `improve-codebase-architecture` — YAGNI scoping gate

Upstream `45afd80` added a gate at the top of Explore that our rewrite dropped:

> **Scope before you scan — YAGNI.** If the user named a direction — a module, a subsystem, a pain point — take it… Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots… If the changes are scattered with no clear hot spot, widen the net.

Rationale: "a deepening opportunity in code nobody touches is a refactor you'll never cash in."

We do read `git log --oneline -20`, but only in **Temporal Awareness** (`:56-70`), which *suppresses* candidates after they exist — it never biases where exploration goes. Complementary, and the gate is cheaper. Slots in just before `SKILL.md:33`.

#### 1.4 `writing-great-skills` — the **cache** rule

New leading word from `f054def`, no local equivalent. Verbatim:

> The **environment** is a source of truth too — `package.json` scripts, config files, the directory layout, `--help` output — and a document that restates it is a **cache**: a copy of a lookup, earning its load only when the lookup is expensive. Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config confesses. Leave the one-file, one-command lookups to the environment, where they cannot go stale.

One paragraph, no structural cost, and directly useful in a Python repo (`pyproject.toml`, `manage.py`, `compose.test.yml`). Adoptable standalone.

#### 1.5 `prototype` — capture-not-delete, and the production gate

Two safety-shaped items landed just before our sync and were never adopted:

- **Capture it when done** (`371b9c9`) — we still say "Delete or absorb when done" (`:35`). Upstream: fold the validated decision into real code, then commit the prototype itself to a throwaway branch out of main with a context pointer on the implementation issue. "This is distinct from *absorbing*: lifting a validated reducer keeps the **decision**, not the prototype." Fits us *better* than upstream — we already have the Gitea tracker convention to hang the pointer on.
- **UI variant switcher must be hidden in production builds** — upstream `UI.md:77-92` gates the switcher on `NODE_ENV !== 'production'` "so a stray prototype merge can't ship the bar to users". Our inline Django/Tabler bar (`references/ui.md:82-86`) has **no `settings.DEBUG` gate**. Upstream also carries four anti-patterns we dropped: variants differing only in colour/copy; over-sharing code between variants ("a shared `<Header>` is fine; a shared `<Layout>` defeats the point"); wiring variants to real mutations; promoting a prototype straight to production.

### Tier 2: adopt with judgement

#### 2.1 `prototype` — logic branch is no longer a terminal app

`6bcbcb0` (2026-07-17, the one post-sync feature commit) rewrote the logic branch around a **single shareable HTML file** — no framework, bundler, or server — that a non-developer double-clicks and drives: labelled state panel, always-available free-play buttons, and tabbed guided walkthroughs, each scenario resetting to a known initial state, every label in domain language. The portable pure-logic module still lifts into real code; the HTML shell is the throwaway.

We still specify the ANSI-escape TUI (`references/logic.md:41-57`). The underlying rule change is real and framework-neutral: the artifact must be drivable by a PM or domain expert, which a Python TUI is not — and for a Django-oriented fork the HTML file is arguably more natural.

**Merge, don't replace.** Our three-way branch pick including "both, in sequence" (`:23`) and our structured NOTES.md template with Hypothesis/Confidence/Next step (`:41-49`) are both better than upstream's and should survive.

#### 2.2 `tdd` — the pre-agreed-seam handshake

Upstream: "**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. **No test is written at an unconfirmed seam.**" We softened this to a conditional planning checkbox (`:72`, "with the user when the task is ambiguous").

This closes a dangling reference in our own graph: `skills/implement/SKILL.md:10` already promises "Use the `tdd` skill, at pre-agreed seams", but `tdd` no longer defines what one is or that confirmation is unconditional.

Also worth taking, minor: upstream's qualifier that `codebase-design` "is a reference to consult, not a session to run" — it stops the agent burning a turn invoking a vocabulary skill.

**Do not adopt** upstream's "refactoring is not part of the loop" (it deleted its `refactoring.md`). We deliberately keep tdd step 4 and the SHORTCUT-harvest ritual. But note the observation behind it: we now carry refactoring guidance in three places (tdd step 4, `refactoring-pass`, and the Fowler smell baseline in `two-axis-review`), which is the duplication upstream was cutting. Worth a consolidation look on its own merits.

#### 2.3 `writing-great-skills` — the restructure (one decision, not three)

Upstream `1fc6573` renamed `writing-great-skills` → `writing-for-agents`, broadened its scope, and re-split its files. Treat as a single decision:

- **Scope broadening:** "Reference for writing any document an agent consumes — a skill, an `AGENTS.md` / `CLAUDE.md`, a doc reached by a pointer. The packaging differs; the writing does not." Consequence: **description** generalises to **context pointer** throughout, and its three rules survive generalised (front-load the leading word; one trigger per branch; cut identity the body already carries).
- **File re-split:** the axis changed from *summary vs. definitions* to *universal vs. skill-only*. `GLOSSARY.md` (201 lines) was **deduped away, not moved**; a new 22-line `SKILL-MECHANICS.md` holds frontmatter, model-vs-user invocation, splitting by invocation, and router skills. Total content dropped 284 → 102 lines.
- **Failure modes dissolved and co-located** — each failure moved beside the lever that cures it (sprawl → information hierarchy; premature completion → completion criteria; negation → leading words; duplication/sediment/no-op → pruning). The skill applying its own co-location rule to itself.
- **Completion criteria promoted** to its own section with **clarity** and **demand** as named axes and an ordered defence: "sharpen the bound first (local and cheap); only if it is irreducibly fuzzy _and_ you observe the rush, hide the later steps by splitting the sequence — and hiding only works across a real context boundary."

**Recommendation: adopt the co-location and completion-criteria consolidations; defer the rename.** Our name is load-bearing in five places (`README.md:155`, `skill-creator/SKILL.md:14`, `skill-quality-standard.md:7,58`, `GLOSSARY.md:3`), and the name only becomes wrong once the scope broadens. If `GLOSSARY.md` dissolves, `skill-quality-standard.md:58` must be repointed.

No conflict with our `skill-creator`: it owns the eval/benchmark workflow and the quality standard, `writing-great-skills` owns prose craft, and the boundary is stated in both directions. Our invocation-mode guidance is strictly richer than upstream's `SKILL-MECHANICS.md` (we have the primitive-exception rule for `grilling`/`prototype`/`ponytail-audit`) — ours wins.

### Tier 3: cheap cleanups

- **`subagent` → `Agent`.** `skills/codebase-design/references/design-it-twice.md:21` says "Spawn 3+ sub-agents using the **`subagent` tool**". No such tool exists — upstream correctly says `Agent`. Straight correctness bug.
- **PRD → spec rename residue** (upstream finished this in `a2f9333`): `skills/to-spec/SKILL.md:13` still hedges "you may know this document as a PRD"; `skills/setup-project-skills/issue-tracker-gitlab.md:3` still says "Issues and **PRDs**" while our github/local templates are already clean; `skills/two-axis-review/SKILL.md:14,34` still says PRD; `README.md:144` says "spec/PRD". Keep the PRD *trigger phrase* in `to-spec`'s description — that one earns its keep.
- **`README.md:146`** calls wayfinder's unit "investigation tickets"; upstream renamed to **decision tickets** and our own `wayfinder/SKILL.md:11` already says so.
- **CONTEXT.md/ADR wiring:** upstream's `diagnosing-bugs` opens by reading `CONTEXT.md` and checking ADRs in the area being touched. Neither our `diagnosing-bugs` nor our `tdd` references either, despite us shipping `domain-modeling` which owns them. (See §4.1 — the files don't exist yet.)

---

## Part 2 — New skills to digest

### ADOPT

**`wait-what`** (productivity, new 2026-08-05) — a seven-line, user-invoked skill that is *entirely* one user-voiced paragraph: "Wait — I don't understand where you've got to here. Re-pitch that: give me a little bit of context, talk in ASD-STE100 Simplified Technical English, and use the ubiquitous language from `CONTEXT.md`."

The design argument is the interesting part: concision skills fail by growing — a 400-line skill still leaves the model verbose — so this one is a single precise leading word and nothing else. Names describing the *output* (`/tldr`, `/no-fluff`) make the model clip words and lose you further; naming the *listener's* state asks for both halves at once, fewer words **and** the missing context. It repairs one message; it doesn't prevent the next.

No overlap with `caveman` (an output-*style* mode). Adopt near-verbatim; point the glossary reference at whatever `setup-project-skills` recorded in `docs/agents/domain.md`.

**`to-questionnaire`** (productivity, graduated 2026-07-28) — inverts the grilling primitive. Instead of interviewing you about the *subject*, it interviews you about the **send**: who the recipient is, what expertise they hold, what you can't resolve alone — in exactly two one-exchange rounds. Then writes a Markdown questionnaire against a fixed template (Purpose / From-To-How-used / Context / How to answer / themed sections, one idea per question, an answer stub under each, closing catch-all), ordered most-important-first because async gets one pass.

Fully portable, no tracker or language coupling. Nothing local produces an artifact aimed at a third party. Slots upstream of `to-spec`.

**`wizard`** (engineering, graduated + made model-invoked) — generates an interactive bash script that walks a *human* through steps an agent cannot take: third-party setup, credential provisioning, a one-off migration. The bundled `template.sh` (211 lines) is a fixed library above a `STAGES` marker, never hand-edited: progress with time-remaining, cross-platform URL opening including WSL, hidden secret entry, idempotent `.env` upserts, CI secret writes with graceful degradation, closing skip summary. The skill's only job is to scope the procedure and author its stages, then verify with `bash -n`/shellcheck — never run it, since it blocks on human input.

Model-invoked so the agent can reach for it the moment it hits a human-only step instead of dumping numbered instructions into chat. Explicit non-trigger: "don't invoke this for steps the agent can perform itself."

**Light adapt:** add a Gitea/Forgejo Actions branch beside the `gh secret`/`gh variable` path, and make the scoping step read `pyproject.toml`, `settings/*.py`, django-environ usage and `compose*.yml` rather than only Node config.

### ADAPT — the highest-value item, and the most work

**`ask-matt`** is two things bundled, and they should be judged separately.

**`PHASE-BOUNDARIES.md` is fully portable and should be taken close to verbatim.** A phase is a chunk of work inside a session — the grilling, the implementation, the QA — and the boundary between two is where you decide what to do with the context you've built. It gives an ordered five-option decision tree: **continue → `/clear` → `/handoff` → subagent → `/compact`**, justified by a primary-vs-secondary source table. Three corrections come with it:

- **`/handoff` was oversold.** It's narrow: you need it only when something has to *travel* — a new harness, a new directory, a colleague, a side task forked mid-phase. What it buys is portability.
- **`/compact` is the default, not the first reach.** It sits at the bottom, after four cheaper or more precise questions. Starting there produces a session confidently wrong about whatever the summary flattened.
- **Continue is the one to rule out first** — the only move that keeps the conversation as a primary source rather than a summary of one.

(Swap the aihero.dev "smart zone" link for a plain parenthetical; upstream updated the figure from ~120k to ~150k tokens.)

**The router half must be rewritten, not ported.** Every skill name is Matt's, and we diverge: no `wizard`/`to-questionnaire`/`wait-what` yet, `code-review` → `two-axis-review`, `setup-matt-pocock-skills` → `setup-project-skills`, plus ~25 skills upstream doesn't have.

But we need a router more than upstream does. **Our own standard demands it** — `writing-great-skills/SKILL.md:26`: "When user-invoked skills multiply past what you can remember, that piled-up cognitive load is cured by a **router skill**." We have eleven user-invoked skills, invisible to the model, and a flat 61-row alphabetical README table that is an inventory, not a map. A proposed shape: `qa` as a third on-ramp beside `triage`; `council`/`court-jester` as standalone decision tools; `ponytail-*`/`restore-test-pyramid` under codebase health with `improve-codebase-architecture`; and a fourth bucket upstream has no equivalent of — "reference underneath" for the Django/Docker/testing/framework skills.

Budget this as an authoring task, not a copy.

### Optional

- **`writing-fragments` / `writing-shape` / `writing-beats`** (in-progress, a three-skill set) — a deliberate explore→exploit pipeline for prose. Fragments appends heterogeneous material to one file (including a **leading word**, the coinage the piece hangs on); shape and beats grow a separate article from that pile, arguing each block's *format* out loud. `writing-beats` carries the most transferable idea: a **grounding** model where a beat is only reachable once every concept it requires has been introduced by an earlier beat. Zero tooling dependencies, fully portable, but outside our engineering remit. Take all three or none — the pipeline doesn't make sense split. The grounding model would improve `writing-great-skills` and `documentation-lifecycle` even if the skills aren't adopted.
- **`claude-handoff`** (in-progress) — our `handoff` writes a summary to a file; this one launches `claude --bg` with the summary as the prompt so a fresh agent picks it up immediately. Hard-bound to the Claude Code CLI. Cheapest form is a "Dispatch" section appended to our existing `handoff`, gated on the harness — not a second skill. It also mandates redacting secrets, since the summary becomes a prompt.
- **`setup-ts-deep-modules`** (in-progress) — TS-only tooling, but the *pattern* is our `codebase-design` vocabulary made mechanical, and Python has a direct analogue in **import-linter** that we mention nowhere. Three transferable ideas: depth-based public/private (root files are entry points, every subfolder is private) rather than a hand-maintained allowlist; a **prove-it-bites gate** (add a deep import, watch lint fail, revert — that pass/fail/pass observation is the completion criterion); and a context pointer from `AGENTS.md`.

### SKIP

- **`setup-pre-commit`** — Husky + lint-staged + Prettier; nothing survives translation to Python `pre-commit` + ruff. A fork-native version is worth writing, but that's authoring, not adoption.
- **`scaffold-exercises`** — hardcoded to Matt's course repo layout and `ai-hero-cli`.
- **`migrate-to-shoehorn`** — TypeScript codemod by definition.
- **`loop-me`** — portable and interesting, but personal-productivity workflow automation; we ship nothing adjacent.

---

## Part 3 — Repo-level conventions worth borrowing

1. **Promoted vs non-promoted buckets.** Upstream's five buckets carry an invariant: everything in `engineering/`/`productivity/` must appear in the README *and* the plugin manifest; everything in `misc/`/`in-progress/`/`deprecated/` must appear in neither. `in-progress/` has a social contract — "Beta. These skills are public on purpose — try them and tell me what breaks." Graduation is a ritual that forces README + manifest + docs + router update in one commit.

   **This fits us better than it fits upstream.** Upstream deferred Codex support partly because `plugin.json` takes a single path string, so a bucketed repo can't express a curated subset (ADR 0002). Our `package.json` `pi.skills` takes an **array** — `["./skills/engineering", "./skills/productivity"]` is expressible today. We currently ship all 61 skills with no beta tier and no retirement path.

2. **The invocation split in the README**, with the mechanics inline. We have eleven skills the model can never reach and nothing tells a human they exist as a group.

3. **Two authoring rules we don't state and should** (from `.agents/invocation.md`):
   - "A user-invoked skill may invoke model-invoked skills, but it can never reach another user-invoked skill." We hit this wall — it's why `prompts/` exists — without ever naming the rule.
   - "Dependencies are expressed as `/skill`-style prose invocation, not deep `../other-skill/FILE.md` cross-references. Shared reference docs live inside the skill that owns them." Our `scripts/validate_refs.py:82-97` happily accepts `../other-skill/x.md`; a "no reference escapes its skill dir" assertion is ~5 lines and encodes a real invariant.

   Also worth writing down: the hard/soft dependency split from ADR 0001 (hard-dependency skills carry an explicit "run `/setup-…` if not" line; soft-dependency skills reference the glossary in vague prose only, "which keeps them token-light and avoids cargo-culting the setup pointer"). We *apply* this; we haven't recorded it.

4. **`.out-of-scope/`** — a knowledge base of rejected requests: the decision, why it's out of scope, existing escape hatches, and prior request issue numbers. Ironic gap: our `triage` skill advertises maintaining one, and this repo doesn't have one.

5. **Changesets + CHANGELOG.** Upstream's changesets are prose-rich and curated; the CHANGELOG then becomes an evidence source for docs. Our `package.json` has been `0.1.0` forever and "where did this skill go?" has no answer. Lower priority since `pi install git:` resolves a ref.

6. **`scripts/link-skills.sh`** — symlinks every non-deprecated skill into `~/.claude/skills` and `~/.agents/skills`, so `git pull` updates installed skills. We claim Claude Code as a target but punt to "steal `./skills`". Also cheap: a `.claude-plugin/plugin.json` (~40 lines) for one-command Claude Code install.

**Where we're ahead, and shouldn't regress:** upstream has zero tests and zero evals; we have 22 pytest modules plus evals in 48 of 61 skills. Upstream's invariants are prose; ours are asserted. Our `AGENTS.md` names targeted verification commands per change type; upstream's `CLAUDE.md` names none. Our `prompts/` layer, two-tracker split, and attribution hygiene have no upstream equivalent. Our description standard is numeric (75 words, eight triggers, 500 lines) where upstream's is prose-only, and our invocation-mode reasoning is better argued.

---

## Part 4 — Our own drift, surfaced by the comparison

Not upstream deltas — things the cross-check exposed in our tree.

1. **`docs/agents/domain.md:5-10` declares `CONTEXT.md` at root and `docs/adr/` as the glossary authorities. Neither exists.** Every skill that reads "the project's domain glossary" resolves to nothing. `council-debates/` is gitignored, so our actual decision record isn't in the repo either. Either create them or fix the pointer — the file even says "This file is the authority on where the glossary lives".

2. **`references/html-report.md` lost the sections `improve-codebase-architecture` still mandates.** Upstream's "Top recommendation" and "Tone" sections (the module/interface/seam vocabulary whitelist, and the "never substitute component/service/API/boundary" list) are gone, but `SKILL.md:124`, `:279`, `:295`, `:303` all depend on them. The spec for a section the skill requires lives nowhere.

3. **`qa` files unlabelled issues.** `grep -n "label\|ready-for" skills/qa/SKILL.md` returns nothing. Every other skill in the suite resolves state through `triage-labels.md`; qa's issues land on the Gitea tracker invisible to triage's `needs-triage` queue and to `to-tickets`' `workflow:implement` routing. It should apply `needs-triage` + `bug` on filing so its output feeds `/triage`.

4. **Commented-out `#disable-model-invocation: true`** in `skills/handoff/SKILL.md:5` and `skills/wayfinder/SKILL.md:8`, set by `e8f2701` ("required when used inside conversation"). This encodes a real pi harness constraint — a skill can't reach a user-invoked skill — but as a YAML comment it reads as an accident. Document the constraint and the convention, or delete the lines.

5. **Undocumented routing divergence.** Upstream routes wayfinder → `to-spec` → `to-tickets` → `implement`, explicitly warning that "looping the map straight into `/implement` skips that collapse and throws the linked detail away". We route wayfinder → `to-tickets` → `implement` (`wayfinder/SKILL.md:19`), and `improve-codebase-architecture:673` does the same. Defensible — we route per-decision rather than collapsing the whole map — but nothing records it as deliberate, so a future sync will "fix" it.

---

## Part 5 — Deliberate divergences: do NOT sync

| Upstream change | Our position |
|---|---|
| `qa` deleted (→ `/triage` + `/to-tickets`) | **Keep.** Upstream's qa was frozen in April and never got the tracker-config rework; ours reads the tracker doc and glossary and is strictly better than what was deleted. Its distinct value is the conversational multi-bug capture loop — triage processes issues that already exist, to-tickets slices a plan. Fix the labelling gap (§4.3) instead. |
| `to-tickets` trailing "work the frontier one ticket at a time with /implement" deleted | **Keep.** Upstream could delete it because `ask-matt` carries the chain. We have no router, so our `:115` is the only place the handoff is written. Exactly the line a naive sync would drop. |
| tdd: "refactoring is not part of the loop", `refactoring.md` deleted | **Keep ours.** But see §2.2 on the triple-duplication observation. |
| `writing-great-skills` → `writing-for-agents` rename, no alias | **Defer.** Name is load-bearing in five places; it only becomes wrong if the scope broadens. |
| `setup-*` dropped `qa` from consumer lists | **Don't sync** — we still ship qa. |
| `design tree` → `decision tree` in ICA | **Ignore** — upstream is self-inconsistent (its own `grilling` still says design tree); we're internally consistent. |
| `agents/openai.yaml` in every skill dir (Codex metadata) | **Irrelevant** unless Codex becomes a target. Note we have one orphan: `skills/teach/agents/openai.yaml`, inherited in the port, matching nothing else — a file that lies. |
| GitHub-only tracker assumptions | Ours is a superset (two-tracker split, Gitea default). |

**Also removed upstream** (`c66bdee`): `ubiquitous-language` → `domain-modeling`, `design-an-interface` → `codebase-design`, `request-refactor-plan` → `to-spec` + `improve-codebase-architecture`, plus the personal bucket (`edit-article`, `obsidian-vault` — the latter called out as dangerous for hardcoding Matt's own vault path *while being model-invocable*). Three of the four absorptions already happened in our tree. `deprecated/` is now empty by policy: "a retired skill is deleted, and the changeset that removes it names its replacement."

---

## Suggested sequencing

**Wave 1 — mechanical, no decisions:** §1.3 YAGNI gate · §1.4 cache rule · §1.5 both prototype items · Tier 3 cleanups (`subagent`→`Agent`, PRD→spec, decision tickets).

**Wave 2 — one skill each, self-contained:** §1.1 grilling rounds + caller sync · §1.2 diagnosing-bugs' four rules · §2.2 tdd seam handshake · §4.2/§4.3 the html-report and qa-labelling repairs.

**Wave 3 — adopt new skills:** `wait-what` · `to-questionnaire` · `wizard` (with the Gitea/Python adaptation).

**Wave 4 — authoring work, wayfinder-shaped:** the router skill + `PHASE-BOUNDARIES.md` · the `writing-great-skills` restructure decision (§2.3) · §4.1 CONTEXT.md/ADR resolution · the bucket split (§3.1).
