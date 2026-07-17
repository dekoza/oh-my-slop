# Staleness audit of the 2026-06-18 council-debate findings

Audited 2026-07-17 for [Audit 2026-06-18 council-debate findings for staleness](http://192.168.129.37:30008/minder/oh-my-slop/issues/3)
(child of the map [Refine and complete the oh-my-slop skill library](http://192.168.129.37:30008/minder/oh-my-slop/issues/1)).

**Method:** for each `council-debates/*.json`, the actionable findings were extracted from
`chairman_verdict` (recommendation, first_step, blind_spots) and `peer_reviews[].what_all_missed`,
then judged against the *current* SKILL.md (+ references where relevant): applied / partially
applied / not applied. All 27 debate files were audited — the 24 skills listed on the ticket plus
`ui-design-direction`, `webapp-testing`, and `test-optimization`.

**Mapping notes:** `council.json` → `skills/council/` (frontmatter name `llm-council`).
`test-optimization.json` is a design debate, not a per-skill critique; its content maps to
`diagnosing-bugs`' Multi-Failure Triage section (largely folded in already). There is no
standalone test-optimization skill and it does not map to `testing-workflow`.

## Triage summary

| Skill | Verdict |
|---|---|
| caveman | not applied |
| codebase-design | partially applied |
| council (llm-council) | not applied |
| court-jester | not applied |
| diagnosing-bugs | partially applied |
| django | not applied |
| django-allauth | not applied |
| docker | not applied |
| documentation-lifecycle | not applied |
| drf | not applied |
| full-calendar | not applied |
| handoff | not applied |
| htmx | not applied |
| http-status-codes | not applied |
| hyperscript | not applied |
| improve-codebase-architecture | not applied |
| langchain | not applied |
| litestar | not applied |
| prestashop | not applied |
| prototype | not applied |
| python-async | not applied |
| skill-creator | not applied |
| tabler | not applied |
| tdd | not applied |
| test-optimization (→ diagnosing-bugs triage) | partially applied |
| ui-design-direction | not applied |
| webapp-testing | not applied |

**Bottom line:** none of the 27 critiques is fully applied; 3 are partially applied
(codebase-design, diagnosing-bugs, and test-optimization's triage procedure); the remaining 24
are essentially untouched. The debates are almost entirely still live input for the refinement
tickets. Caveat for those tickets: individual findings below predate the 2026-07-17
skill-quality standard (`skills/skill-creator/references/skill-quality-standard.md`) — a few
now conflict with it (e.g. calls to *add* trigger keywords) or are moot (Django 6.0 shipped);
re-judge each finding against the standard before applying.

## Per-skill detail

### caveman
Overall: not applied
Still open:
- "~75% token reduction" claim still in the description with no eval/measurement to back it (no evals dir, no measured before/after token counts).
- Auto-clarity safety rules (don't compress warnings/irreversible actions) still buried near the end, not elevated to rule #1.
- Wenyan variants still inline in SKILL.md; not moved to a separate reference file (no references/ dir exists).
- Description still triggers on "less tokens" and "be brief" — the overtriggering phrases the council wanted removed.
- No "When NOT to use" section (beginner explanations, sensitive comms) beyond the auto-clarity list.
- No "Composition" guidance for how caveman interacts with other style-modifying skills.
- No evals / test prompts (repo mandates them).
- No onboarding acknowledgment line on activation.
- No non-English-user guidance; compression rules remain English-centric (wenyan aside).
- "Multi-step sequence" heuristic still undefined; code-comment vs code boundary still fuzzy.
(Applied: the same-example-across-all-6-levels calibration table exists — the React re-render example.)

### codebase-design
Overall: partially applied
Still open:
- No front-and-center deepening workflow (identify shallow cluster → classify deps → propose seam → write two adapters → test at interface). The top "Before You Build — The Ladder" is a different (pre-build simplicity) workflow; the deepening workflow lives scattered in deepening.md.
- Implementation/adapter distinction reworded but not the concrete "one implementation = implementation, two+ interchangeable = adapters" rule the Executor asked for.
- No end-to-end worked example (shallow cluster → dependency classifications → seam → deepened module → before/after test count).
- No "when NOT to deepen / when shallow is correct" counterbalance (e.g., small focused utilities legitimately shallow).
- Frontmatter triggers still generic; no concrete code-smell triggers (e.g., "200-line class with 15 delegating methods").
- Dependency categories 3 (Remote-but-owned) and 4 (True external) still separate in deepening.md, not merged and no added structural distinction.
- No code-review integration (PR comment templates / checklist for spotting shallow modules).
- No post-deepening validation/success metrics (fewer tests, fewer call sites).
- Examples still Python-only despite language-agnostic claim.
- design-it-twice.md still has no handling for convergent designs / tie-break rubric when the agent can't form a strong opinion.

### council
Overall: not applied
Still open:
- No 10-line quick-start at the top (frame → spawn 5 → anonymize → peer review → chairman → verdict); skill still opens with prose and requires reading far in before acting.
- Worked example still at the bottom, not led with / moved to second position.
- No sub-agent error handling (retry failed agents, minimum response length).
- Sub-agent prompt templates still long/hedging ("Don't hedge…"), not trimmed to ~3 lines.
- Advisor descriptions still full paragraphs, not trimmed to one sentence each.
- No evals for the council skill (no evals dir).
- No "when to re-council" / user-disagreement interaction model.
(Partially: the framing step does include a workspace-scan checklist — AGENTS.md, memory/, referenced files, recent transcripts — though not elevated as a distinct quick-reference.)

### court-jester
Overall: not applied
Still open:
- No complete worked example (user input → mode selection → critique with all elements → synthesis).
- Critical Rules still 8 items; generic rules (steelman, drive-to-synthesis, say-plainly, concede) not cut to the skill-specific four.
- Quick Start and Core Workflow still separate/overlapping (and retain the Quick-Start "auto-select" vs Core-Workflow "do not block on interactive selection" contradiction).
- Mode selection still multi-layered (Default Mode Selection list + Reference Guide table + mode-selection-guide.md fallback); indirection not collapsed.
- Output Expectations still mandates all 5 elements for every output; not made 3 required + 2 optional.
- No negative examples / anti-patterns showing bad adversarial reasoning.
- No evals (no evals dir).
- Description field doesn't clarify the boundary vs llm-council.

### diagnosing-bugs
Overall: partially applied
Still open:
- Phase 4 still labeled "(optional)"; not made mandatory-with-skip-justification.
- No explicit recovery paths when the fix fails or breaks the suite (fix fails → back to Phase 3; breaks suite → hypothesis incomplete → revisit Phase 2).
- No general stop-rules/escalation criteria (time budget, known-issue lookup); only the "cannot build a loop" escalation exists.
- Evals still 3, covering only Phase 1 and Phase 3; no Phase 2/4/5 coverage and expectations remain concept-naming, not execution-level.
- "Tight" not defined once clearly at the top (only implied via the Phase 1 completion checklist).
- No one-paragraph quick-start summary of the overall loop→hypothesize→fix→regression flow.
- No production-vs-dev debugging guidance (blind spot flagged in verdict).
(Applied: the Phase 1 completion criterion is now a hard gate requiring a named command already run with pasted invocation+output, red-capable/deterministic/fast/agent-runnable checkboxes, and an explicit "no red-capable command, no Phase 2" stop — the council's first_step.)
### django
Overall: not applied
Still open:
- Version claim untouched: frontmatter still `Django 6.0` / `target_versions: "Django 6.0, Python 3.12+"`, `last_verified: 2026-03-19` (debate wanted 5.x or version-agnostic — though note Django 6.0 shipped Dec 2025, so this finding is now largely moot).
- Redundant `references/REFERENCE.md` still exists on disk; debate wanted it deleted (SKILL.md already keeps routing inline, so only the file removal is outstanding — partial).
- No inline "Quick Reference"/top-5 patterns section; SKILL.md still routes-only with zero code snippets.
- HTMX/tabler still framed as Django defaults ("Prefer backend-rendered components", "Default composition path in Django") rather than flagged as a project-specific convention.
- No migrations, caching, or management-commands reference files added (references/ has none of the three).
- Pattern-count column ("25", "24"...) still in Reference Map — opaque metric the debate flagged, unchanged.
- No maintenance/update-trigger note added to frontmatter.

### django-allauth
Overall: not applied
Still open:
- Critical Rules still 7 prohibitive items ("Do not assume/confuse/guess"); not rewritten into the requested 5-step positive decision procedure. Extension-point hierarchy still buried in rule 4 rather than led with.
- Adapter pattern still never named/taught as allauth's central customization concept (only mentioned in passing in rule 4).
- "When Not To Use" still says "pair `django`"/"pair `drf`" without defining what "pair" means operationally.
- No compound/multi-surface routing row (e.g. "Google login on a headless project" → socialaccount + providers + headless).
- No "Common Anti-Patterns" section naming the top allauth mistakes.
- Cross-surface interaction mapping (allauth settings ↔ Django settings like AUTH_USER_MODEL / email backend) not added.

### docker
Overall: not applied
Still open:
- Critical Rules still a flat 12-item list; not split into the requested Safety / Process / Agent-Behavior groups (the debate's designated first step).
- "Hypothetical Review Mode" section still duplicates Critical Rules 11–12; not consolidated.
- No Docker concepts primer (daemon/image/container/Dockerfile/Compose) for context-free routing.
- No "Quick Fixes" section for the common problems.
- No Docker Desktop reference file (Desktop still named in description); addressed only by a "not a full Desktop manual" disclaimer.
- No version-targeting note and no mention of AGENTS.md Docker-rule interaction.
- (Applied: Reference Map now defers to REFERENCE.md instead of a parallel table; Output Expectations format now qualified with "unless the user explicitly asks for a different format"; description first sentence tightened.)

### documentation-lifecycle
Overall: not applied
Still open:
- No worked example (vague request → interview → file written) anywhere in the skill.
- No fallback for missing reference files (skill still assumes references/ exist; no "create from template if absent").
- Routing Matrix rows and the step-1 classification items still near-match but don't match exactly (e.g. "vague or disputed change request" vs "Vague request with missing constraints").
- "canonical" still used repeatedly without a definition.
- Interview/synthesis jargon retained ("steelmanning", "Dialectic synthesis", "Socratic questions", "spirit of court-jester") — debate wanted this cut to plain actionable instructions (note: this was a clash, not consensus).
- (Applied: Rule 0 surfaced at top of Quick Start with a "is a failure" enforcement line; explicit file-on-disk verification step in Default Workflow.)

### drf
Overall: not applied
Still open:
- Critical Rules NOT moved above the reference/routing content; still sit after "When Not To Use" (the debate's designated first step).
- Duplicate cross-domain entry still present — "Serializer with permissions → serializers-fields.md + auth-permissions.md" appears twice (lines 87–88).
- No N+1-in-serializer-relations warning added (no Rule #15; no performance guidance).
- FastAPI / Django Ninja still absent from "When Not To Use".
- No "DRF-Django Boundary" section (CSRF, session vs token auth, queryset evaluation timing).
- Frontmatter description unchanged (not tightened for triggering).
### full-calendar
Overall: not applied
Still open:
- SKILL.md not rewritten as a decision-tree index; no inline "Top 10 bugs/pitfalls" list (only the 8 Critical Rules, still buried after Quick Start + Core Concepts).
- No complete copy-pasteable minimal example (CDN + JSON feed + eventClick) inline in SKILL.md.
- No version-pinning note in SKILL.md (still just "v6"; refs pin 6.1.20 but the skill entry gives no minor-version guidance).
- Critical Rules not moved to the top of SKILL.md.
- Timezone handling only appears as passing `timeZone`/`timeZoneParam` mentions in events.md; no real timezone pitfall guidance.
- No accessibility or mobile/touch/responsive guidance in views.md or display.md.
- No CDN-vs-ES6 bundle tradeoff guidance (both are shown but not "which to choose and when" / tree-shaking).
- No v5→v6 migration guidance anywhere.
- Description still lacks failure-mode triggers ("calendar not rendering", "events on wrong dates", "drag-drop not working").
- (Applied: recurring-event properties in events.md; evals.json now has 3 scenarios — though no explicit debug scenario.)

### handoff
Overall: not applied
Still open:
- No concrete, fully-populated example handoff document (the top-priority change) — template only.
- No "Decisions" section (key choices + rationale) in the template.
- Evals still generic with empty `files: []`; not rewritten to test behavior against a fixture (e.g. redact a real API key, reflect a specific git state) — redaction is only an assertion, not a driven test.
- "When to use" still sits at the bottom, not moved above "Structure".
- Description not sharpened around the three specific trigger scenarios.
- No guidance for the receiving agent on validating a handoff's claims before trusting them.
- `disable-model-invocation: true` implications unaddressed (field still present; description not made aggressive/precise to compensate).
- No guidance on timing (when during the session to write the handoff).
- No multi-session handoff-chain guidance (referencing prior handoffs).
- No fallback if the temp file is lost (e.g. also give the user a verbal copy).

### htmx
Overall: not applied
Still open:
- Common Pitfalls still only 2 items, not expanded to 7-8 distilled from gotchas.md (the debate's designated first step).
- Description still purely attribute-list; no intent/failure-mode trigger phrases.
- Lifecycle rule (Rule 7) still doesn't name the CSS classes (`htmx-request`, `htmx-swapping`, `htmx-settling`, `htmx-added`) — they exist only in reference files.
- No "Testing HTMX" section in SKILL.md.
- No "When NOT to use HTMX" callout in SKILL.md (content exists in gotchas.md but not surfaced in the entry point).
- Task Routing still organized by library concept, not by task type.
- Version targeting still "HTMX 2.x" with no specific minor.
- (Applied via references: accessibility/aria-live/focus, error handling incl. `htmx:responseError`/4xx-5xx, indicator/loading patterns, and Django `HX-Request`/CSRF are all covered in gotchas.md + requests.md.)

### http-status-codes
Overall: not applied
Still open:
- Description not trimmed to a ~40-word purpose statement (still the long multi-line trigger list).
- Quick Start section not removed.
- No "Common Mistakes"/top-3 anti-patterns callout box in SKILL.md.
- Reference files not consolidated from 6 to 3.
- No 207 Multi-Status coverage added.
- Eval 1 still a single 14-outcome mega-prompt, not split into two focused evals; no dedicated eval for ambiguous "multiple defensible codes" scenarios.
- No streaming-response status guidance (e.g. status when an SSE/chunked stream fails mid-flight).
- No HEAD-request status-code note.
- (Applied: 406 vs "just return JSON" content-negotiation note in client-errors.md; reference files now appear consistently table-based.)

### hyperscript
Overall: not applied
Still open:
- No "Debugging & Troubleshooting" section (top-5 parse errors, console symptoms, inspecting compiled behaviors) — the designated first step.
- HTMX Companion still ~2 examples, not expanded into a Patterns section with 5-8 inline examples.
- "When NOT to Use" bullets are still bare statements, not rewritten with bad-vs-better code examples.
- CDN version still hardcoded `0.9.14` with no variable/comment noting to track latest 0.9.x.
- Setup Essentials not restructured into two explicit paths ("I have an HTML file" vs "I use a build tool") — content is present but not framed as such.
- Description still advertises `worker`/`socket`/`eventsource` triggers the skill barely delivers on (Rule 8 flags they need separate bundles, but the trigger-to-content mismatch in the description stands).
- `scope: hyperscript` frontmatter meaning still unclarified.
- Critical Rules #6 and #7 still overlap (local-behavior vs HTMX-ownership) without merge or a differentiating example.
- (Applied: evals.json now covers 5 real failure-mode scenarios.)
### improve-codebase-architecture
Overall: not applied
Still open:
- No "no candidates found / architecture already deep" negative path — only a "no recognizable codebase" pause exists (recommendation #3).
- No scope boundaries (inline for small codebases, single-package for large ones) (recommendation #5).
- Grilling loop still offers court-jester "or" a collaborative interview with no routing rule, and lists interview topics as prose rather than a defined 5-7 question checklist (recommendation #2, Reviewer 5).
- codebase-design is only prose-referenced, not an explicit "load this skill" directive at step 1 start (First Principles; recommendation #4).
- html-report.md gives a candidate-card *spec* with fragmentary examples, not one complete filled-in fictional worked card with problem/solution/before-after/wins (first_step) — partial.
- Frontmatter description names the 3 phases but not the codebase-design vocabulary dependency or deletion test (Reviewer 1) — partial.
- Skill references still use fragile relative paths (`../codebase-design/SKILL.md`, `../court-jester/SKILL.md`) (Reviewer 3).
- No fallback when `xdg-open`/`open`/`start` fails (print path, tell user to open manually); html-report.md says only "OS temp directory" without the $TMPDIR/%TEMP% detail SKILL.md gives (Reviewer 4).
- No "when not to use / paradigm mismatch" guidance for event-driven/microservices architectures that don't map to deep modules (Reviewer 2).
- No negative-path eval in evals.json (recommendation #6).

### langchain
Overall: not applied
Still open:
- No 3-step decision tree at the top; routing is a 5-step Quick Start plus a 7-entry Task Routing list (first_step, Executor).
- No version-check guidance (`pip show langchain langchain-core langgraph` before trusting import advice) (first_step, unanimous).
- Critical Rules remain a flat 12-item list; top rules not promoted into a prioritized summary box (First Principles, agreed).
- "Content Ownership" section still present, not removed/minimized (Executor, agreed).
- Still prose-only — no minimal code examples (model init, `create_agent`, `StateGraph` compile) (unanimous).
- No async/await guidance (`ainvoke`/`astream` dual API) (blind spot).
- No cross-reference to `python-async`; "When Not To Use" names Django/Litestar/FastAPI but not python-async (blind spot).
- No LangSmith cost/privacy caveat — Rule 9 treats it as purely beneficial (blind spot).
- No `langchain-community` mention or version-pinning/0.x-vs-1.x guidance (Contrarian).

### litestar
Overall: not applied
Still open:
- Task Routing still two overlapping bullet lists, not merged into one Primary/Secondary table (first_step, unanimous).
- Output Expectations still long (6 bullets + closing-line examples) plus Rule 14 process boilerplate — not pruned/moved to AGENTS.md (agreed).
- Critical Rules remain a flat 14-item list; no Essential vs Advanced tiering (Outsider, recommendation).
- No "Last verified against Litestar X.Y" header / version markers (Executor, recommendation).
- No inline code example (complete handler with DTO + DI) (Executor).
- No Anti-Patterns section of common Litestar mistakes (Expansionist).
- OpenAPI/schema generation, Controller class pattern, TestClient testing pitfalls, and guard patterns still under-served at SKILL.md rule level (blind spots).

### prestashop
Overall: not applied
Still open:
- Reference Map still lists 11 files; not collapsed to ~5 task-flow files (first agreement).
- No glossary (module, hook, BO, FO, override, widget, service, configuration, tab, getContent) in SKILL.md (first_step).
- No minimal working example module at skill root (Phase 2).
- No validation script for banned namespace/autoload/hook-registration checks (Phase 2, Reviewer 4).
- No skill-boundary note relative to symfony/php/composer/docker skills (blind spot).
- "What to do when stuck" is scoped only to hooks (Rule 6); no general stop-and-ask rule for uncovered patterns (blind spot) — partial.
- No last_verified update process/maintenance strategy for PS10/PHP bumps (Reviewer 3).
- (Applied: getContent() redirect callout in Rules 4/12; evals already test defect detection; multistore noted in data-persistence reference.)

### prototype
Overall: not applied
Still open:
- "When done" still prose ("a NOTES.md next to the prototype") — no required NOTES.md template with fields (Question/Hypothesis/Approach/Answer/Confidence/Next Steps) (first_step, agreed).
- ui.md still contains a Django-specific view/template example instead of a framework-agnostic pattern (agreed defect).
- "Pick a branch" is still a hard binary; no decision tree and no composite "start with logic, then wrap in UI" case (agreed).
- No "prototype complete" checklist (Executor).
- No isolation/extraction principle ("put logic behind a pure interface") elevated to a top-level rule (First Principles).
- Testing boundary not clarified — Rule 4 says "no tests" but nothing states tests become mandatory when the prototype is absorbed into production (Reviewer 5).
- (N/A: the `disable-model-invocation` note — current frontmatter has no such field, so that finding does not apply.)
### python-async
Overall: not applied
Still open:
- Reference files still have zero code examples — 6 of 7 checked (`structured-concurrency`, `cancellation-timeouts`, `code-review-checklist`, `streams-synchronization`, `backend-asyncio`, `threads-boundaries`) contain no code fences at all; the top-priority "add 2-3 snippets + 1 anti-pattern per file" change is absent.
- Version claim not narrowed: SKILL.md `target_versions` and every reference header still say "Python 3.11-3.14" (debate wanted 3.11-3.13).
- No glossary reference file exists (structured concurrency, cancel scope, checkpoint, memory object stream, capacity limiter, blocking portal, etc. remain undefined).
- `code-review-checklist.md` is still bare questions with no "what good looks like" answers/standards.
- Output Expectations still a flat 6-item list; no tiered simple-vs-complex format.
- No Critical Rule on `contextvars` propagation or cancellation-aware worker threads (Rule 8 unchanged; Rule 12 only covers the from_thread callable split).
- Blind-spot content gaps still uncovered: async context manager / async generator cleanup (`__aenter__`/`__aexit__`, `athrow`, `aclose`), `asyncio.Runner` vs `asyncio.run()` guidance, eager task factory semantics.

### skill-creator
Overall: not applied
Still open:
- SKILL.md is still 676 lines, over its own 500-line rule — the flagged #1 credibility fix.
- Pressure Testing section still inline in SKILL.md (not moved to a reference file).
- "Single-agent environment instructions" and "Cowork-Specific Instructions" remain two near-duplicate sections, not merged.
- "Communicating with the user" (plumbers/grandparents) section still present.
- evals.json only partially fixed: `expectations` arrays exist but are still subjective ("realistic, not toy one-liners", "captures the workflow clearly") rather than binary/checkable assertions; `expected_output` is still prose.
- No "Should this even be a skill?" decision gate at the start.
- No maintenance / skill-rot / deprecation section.
- No condensed Quick Start path for experienced users.
- Reference linking only partially fixed — some files cited inline, but the full list is still dumped at the end.

### tabler
Overall: not applied
Still open:
- SKILL.md not rewritten as a decision guide — "Component Routing" is still a plain file listing, no "if you need X use Y" selection table.
- No anti-patterns / common-mistakes section (wrong card nesting, missing role attributes, Bootstrap/Tabler conflicts).
- No "start with these 3 files" onboarding pointer.
- Duplicated Color Reference and Size Reference blocks still in SKILL.md.
- No Tabler + HTMX (or Django) integration note (no "htmx" anywhere in SKILL.md).
- `last_verified: 2026-03-19` still present with no verification process.
- No accessibility guidance (ARIA/focus management).
- JS-vs-CSS component distinction still mostly unaddressed (only modal-init noted in Critical Pattern 10).
- Bootstrap relationship only partially clarified (stated in Critical Pattern 1, not the opening paragraph); no external doc links beyond the tabler.io URL.
- (Applied: dark-mode coverage now exists in `references/base/colors-typography.md`.)

### tdd
Overall: not applied
Still open:
- Planning checklist still heavy (8 items + user-approval gate); not reduced to ~3 items with a "just start" escape for small tasks.
- No "when NOT to use TDD" escape hatch (spikes, purely visual/CSS changes).
- No TROUBLESHOOTING section for blank-file paralysis, slow tests, or "test won't go red".
- No feature-decomposition guidance for when the user can't articulate testable behaviours (the council's biggest-gap item).
- Philosophy section still full-length, not cut to a two-sentence preamble.
- Mocking rules only partially inlined — `httpx.MockTransport` is mentioned (via AGENTS.md §9.3) but the "mock at system boundaries only" rule still lives in `references/mocking.md`.
- Anti-pattern section still uses a schematic WRONG/RIGHT diagram; concrete before/after code examples deferred to `references/goal-driven-examples.md` rather than shown.
- Bug-fix TDD only appears as one row in the transform table, not a dedicated reproduce→fix→commit variant.

### test-optimization
Mapping: the JSON has no `skill_name`/`skill_path` fields — it is a design debate ("Multi-Error E2E Fix Procedure Optimization", using `chairman_synthesis`, not a per-skill verdict). Its content maps to the **diagnosing-bugs** skill's "Multi-Failure Triage" section (the proposed 7-step procedure was folded in as Multi-Failure Triage steps 0-7). There is no standalone `test-optimization` skill, and it does not map to `testing-workflow` (which contains no triage procedure).
Overall: partially applied
Still open:
- Recommendation F ("after fires are out, restore the test pyramid — convert E2E-only assertions into unit/integration tests") is not reflected: diagnosing-bugs Step 0c fixes faster tiers first but never instructs converting E2E assertions down to lower tiers.
- (Applied: A flakiness quarantine → Step 0b `--count=3`; B tier-splitting → Step 0c; C concrete biggest-offender heuristics → Step 2c; D mid-triage regression gate → Step 5 newly-red handling; E diminishing-returns threshold → Step 6 (≤5 → single-bug `pytest -x`); serialized output → Step 1 `--json-report | tee` with tail/head/`>` forbidden.)
### ui-design-direction
Overall: not applied
Still open:
- Pre-delivery checklist still at the bottom (line 225), not moved to the top as an execution gate (the debate's explicit first_step).
- No real quick-start summary — only a one-line intro; nothing shows what the user types and what output/success looks like.
- YAML description still a ~150-word keyword wall; not shortened for reliable triggering.
- Workflow still search-script-first (step 2 "Start with the design-system command"); the "High-confidence guidance vs optional taste" section is not elevated to be the core reasoning framework.
- Error handling still just "if the script cannot run, say so and continue with manual reasoning" (line 32); no handling for empty/zero results or corrupted/missing bundled data.
- Persist section describes files created but has no collision policy (what happens if `design-system/<slug>/MASTER.md` already exists — overwrite/append/prompt).
- No automatic stack detection from repo files (package.json, tailwind.config); skill only says "don't guess the stack."
- No design-critique mode that audits existing code/CSS against the bundled UX guidelines.
- Persist still emits markdown only; no machine-readable design tokens (CSS custom properties / Tailwind config).
- No internationalization/localization guidance (RTL, cultural color associations, locale patterns).
- No data currency/update process for bundled references, and no skill-creator validation reference.

### webapp-testing
Overall: not applied
Still open:
- No assertion-bearing, copy-pasteable test-script template in Core Workflow; core guidance still has no `assert` (the unanimous top finding and stated first_step).
- Core workflow not restructured around an explicit assertion step (setup → server → recon → interaction → assertion → evidence).
- Video recording still prominent mid-skill (full recording pattern + "Video artifact rules"), not demoted to an Advanced/appendix section.
- HTMX wait guidance still buried in "API gotchas" / a best-practices bullet, not elevated to a core pattern section.
- `scripts/with_server.py` still uses `Popen(shell=True)` with `stdout/stderr=PIPE` that are never read (no communicate/read/--verbose) — server errors silently swallowed; bug unfixed and undocumented.
- Common pitfalls (all ❌) and Best practices (plain bullets) still not paired ❌/✅.
- No reference to the global AGENTS.md rules (Playwright detection, Docker-based test env, TDD mandate).
- Example anti-patterns unfixed: `static_html_automation.py` uses `wait_for_timeout(500)`; `static_html_automation.py`/`console_logging.py` write to pi-specific `/mnt/user-data/outputs/` instead of a consistent `/tmp/` path.
- Evals still happy-path only; no failure-scenario eval (server won't start, selector not found, assertion fails), and the "disappearing toast after login" eval still assumes an app/fixture that isn't provided.
- Triggering description still has no scope boundaries (when NOT to use; smoke-check vs full E2E).
- Skill still named webapp-testing with automation-only content; no rename and no added test-methodology content to justify the name.
