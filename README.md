# oh-my-slop

After enough hours watching AI confidently produce wrong code, you stop hoping it'll get better and start building guardrails instead.

This repo is a collection of those guardrails — curated skills, pi extensions, and bundled agent defaults that encode the knowledge AI models claim to have but demonstrably don't. Everything here was distilled from real production mistakes and hard-won lessons, not tutorial cosplay.

## How to use

This repo is `pi`-first now. Install it as a package to get the bundled skills and extensions.

```bash
pi install git:github.com/dekoza/oh-my-slop
# or from a local checkout
pi install .
```

After installation, pi auto-discovers:

- skills from `./skills`
- prompt templates from `./prompts`
- the monitoring-only `workflow-watchdog` extension

The extension loads automatically. Existing installations pick it up after
`pi update --extensions` and a pi restart or `/reload`.

### Factory retirement

Factory was an unusable proof-of-concept that was never fully utilized. **Cleopatra**
takes over its orchestration duties as a separate project. This package no longer
ships the `factory` binary, `/factory` extension, Factory policy generation or its
proof-only skill. The predecessor Factory/pipeline copies are removed too.

Update the package and reload or restart pi. Remove an explicitly configured old
Factory extension entry if it points at a removed path. Existing consumer policy,
databases, inventories, credentials, worktrees and branches are left untouched;
this is not an automatic migration to Cleopatra. Consult Cleopatra's own project
for successor setup. Source recovery and the rationale are in
[the retirement decision](docs/adr/0003-retire-factory-in-favor-of-cleopatra.md).

The bundled agent definitions in `./agents` are only seeded if you opt into
`subagent-bundled-agents`.

If you only want the markdown skills for OpenCode or some other agent stack, you can still steal `./skills` and wire them up manually. That path still exists. It is just no longer the main story.

### Claude Code

Skills here are grouped into buckets — `skills/reference/`, `skills/practice/`, `skills/workflow/`, `skills/meta/`. pi recurses until it finds a `SKILL.md`, so those buckets cost it nothing. **Claude Code scans exactly one level** of `~/.claude/skills`: every immediate child must itself hold a `SKILL.md`, and a grouping directory is not descended into. Symlink a whole bucket in and it resolves without error while every skill inside it goes missing.

`scripts/link-skills.sh` links each skill in at the depth Claude Code expects:

```bash
scripts/link-skills.sh                 # link all 70 into ~/.claude/skills
scripts/link-skills.sh --dry-run       # print what it would do, change nothing
scripts/link-skills.sh --prune         # also drop links to skills this repo no longer has
scripts/link-skills.sh ~/somewhere     # or point it at another directory
```

It is idempotent, removes any whole-bucket symlink it finds, and never touches links pointing outside this repo. Re-run it after pulling a change that re-files a skill.

### First run in a project

Run [`/setup-project-skills`](skills/meta/setup-project-skills/SKILL.md) once per repo, before the first time you reach for `wayfinder`, `to-tickets`, `to-spec`, `triage`, `qa`, `humanify`, or `two-axis-review`. It interviews you about three things the workflow skills otherwise have to guess at, and writes the answers to `docs/agents/` in that project:

- **Issue tracker** — which forge holds agent work, and which (if any) holds human-filed intake. The skills never open work tickets on the intake tracker.
- **Triage labels** — the strings behind the canonical roles, so `triage` applies your existing labels instead of creating duplicates.
- **Domain docs** — where the glossary and ADRs live, and whether the repo is single- or multi-context.

Skip it and the skills still run, falling back to a local-markdown tracker and the canonical label names — but each one re-derives your setup from scratch every session, and they will not always agree with each other. The setup is what makes them agree.

Each skill follows the same structure:

```
skill-name/
├── SKILL.md              # Entry point — critical rules, quick start, reference map
└── references/
    ├── topic-a.md         # Detailed reference for a specific domain
    ├── topic-b.md
    └── ...
```

The agent reads `SKILL.md` first, then loads only the reference files relevant to the current task.

## Why this exists

AI coding assistants hallucinate API parameters, ignore framework conventions, and produce code that looks plausible until you actually run it. The standard response is to paste documentation into prompts and hope for the best.

These skills and extensions are a more structured attempt at the same losing battle. They give AI agents:

- **Critical rules** they will otherwise violate on every other generation
- **Gotcha lists** compiled from actual bugs, not theoretical edge cases
- **Reference maps** so they look things up instead of inventing things

Does it work? Sometimes. Better than without? Measurably. A reason for optimism? No.

Case in point: the agent messed up twice while creating this repo (deleting an uncommitted skill and `README.md`) to the point that I needed to hand it the solution scraped from the terminal with a spatula. And all I asked was to sanitize the contents. The irony is killing me.

## Extensions

These ship in the repo and load automatically through the root `pi install` manifest.

<details>
<summary><strong>Extensions (2)</strong></summary>

| Extension | Loading | What it does |
|---|---|---|
| **[workflow-watchdog](extensions/workflow-watchdog/)** | Automatic | Monitors pi's workflow for failure patterns: loop detection, consecutive tool errors, and optional supervisor-model escalation. |
| **[local-router](extensions/local-router/)** | Automatic; requires configuration | Registers a `local` provider backed by the OpenAI-compatible router named by `PI_LOCAL_ROUTER_BASE_URL`. Without a nonblank URL it does nothing: no discovery requests or warnings. Models are discovered at load time and on refresh. If discovery fails, pi continues without local models and warns once per outage (five-second discovery timeout). Use `/reload` after the router returns, or refresh the model catalog. |

</details>

### Local router setup and migration

The router extension now loads with oh-my-slop; a separate installed copy is no longer
needed. Export your router's URL in the shell that starts pi, for example:

```sh
export PI_LOCAL_ROUTER_BASE_URL='http://127.0.0.1:8080'
```

Explicit extension loading also requires this variable now; the extension no longer
probes localhost by default. Restart pi after changing your shell environment.

If you previously installed a standalone copy at `~/.pi/agent/extensions/local-router/index.ts`,
disable that copy in pi's global `settings.json` so it cannot register the same provider
or fail startup. Add this entry to the existing `extensions` array (preserve other entries):

```json
"extensions": ["-extensions/local-router/index.ts"]
```

The exclusion is relative to pi's global settings directory; do not put `~` after the
`-` prefix, because pi's exact exclusion matcher does not expand it. This leaves the
standalone files intact while the package supplies the maintained extension.
Configured `local/*` model patterns may still produce nonfatal "No models match" warnings
while the router is offline; use another provider until it returns.

## Skills

<details>
<summary><strong>Skills (70)</strong></summary>

Grouped by what you came looking for: an API surface (**Reference**), a way of
working (**Practice**), a job to run (**Workflow**), or the agent's own toolkit
(**Meta**). A skill lives in exactly one bucket, and its directory is the
authority — `skills/<bucket>/<skill>/SKILL.md`.

#### Reference

Framework, library, and protocol lookup — reach for these when you need the API surface, not an opinion.

| Skill | What it covers |
|-------|---------------|
| **[DRF](skills/reference/drf/SKILL.md)** | Django REST Framework — serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, content negotiation, versioning, and testing. |
| **[Django-Allauth](skills/reference/django-allauth/SKILL.md)** | Django-allauth integration reference — account flows, SocialApp/provider setup, OAuth/OIDC/SAML boundaries, MFA, usersessions, headless auth, IdP mode, troubleshooting, and version-sensitive pitfalls. |
| **[Django](skills/reference/django/SKILL.md)** | Django 6.0 framework patterns — models, views, URLs, templates, forms, admin, auth, testing, architecture. The gotchas section alone justifies this skill's existence. |
| **[Docker](skills/reference/docker/SKILL.md)** | Dockerfiles, compose files, build context, daemon behavior, bind mounts, DNS resolution, `.dockerignore`, secret handling, image publishing, and cross-environment debugging. |
| **[FullCalendar](skills/reference/full-calendar/SKILL.md)** | FullCalendar JS library — initialization, views, event sources, callbacks, drag-and-drop, render hooks, toolbar config, localization, and CSS customization. |
| **[Gitea](skills/reference/gitea/SKILL.md)** | Gitea and the `tea` CLI — repo/login resolution (and the silent fallback that targets the wrong repo), issues, PRs, labels, milestones, releases, plus issue dependencies and scripting via `tea api`. |
| **[HTMX](skills/reference/htmx/SKILL.md)** | Attributes, requests, swapping strategies, events, extensions, and the patterns that make hypermedia-driven UIs actually work. |
| **[HTTP Status Codes](skills/reference/http-status-codes/SKILL.md)** | API response code semantics and edge cases: 400 vs 422, 401 vs 403, 404 vs 410, 409 vs 412 vs 428, 429 vs 503, 201 vs 202 vs 204, and redirect behavior like 303 vs 307 vs 308. |
| **[Hyperscript](skills/reference/hyperscript/SKILL.md)** | `_hyperscript` front-end scripting — event handlers, queue semantics, DOM commands, async transparency, `behavior`, `worker`, `socket`, JS interop boundaries, and HTMX companion patterns. |
| **[LangChain](skills/reference/langchain/SKILL.md)** | Python LangChain ecosystem reference — package boundaries across `langchain`, `langchain-core`, provider integrations, LangGraph, LangSmith, LCEL/runnables, `init_chat_model`, `create_agent`, retrieval wiring, tracing, evals, and migration off `langchain-classic`. |
| **[Litestar](skills/reference/litestar/SKILL.md)** | Litestar framework — route handlers, controllers, dependency injection, DTOs, middleware, lifecycle hooks, exception handling, templating, testing, websockets, and guards. |
| **[PR Presentation](skills/reference/pr/SKILL.md)** | Shared evidence-oriented PR bodies and repair comments — existing templates/metadata first, actual candidate-linked proof and gaps, conditional visuals, consumers and recovery limits. Presentation grants no publication authority. |
| **[PrestaShop](skills/reference/prestashop/SKILL.md)** | PrestaShop 9 modules: module structure, hooks, front/admin controllers, modern configuration pages, services, persistence, external API integrations, cron/commands, packaging, compatibility, or release debugging. Prevents inventing framework classes, guessing hook contracts, or shipping fake Symfony/PrestaShop internals. |
| **[Python Async](skills/reference/python-async/SKILL.md)** | Python async and concurrency — AnyIO, asyncio, Trio, task groups, cancel scopes, async testing, thread offloading, async streams, event-loop ownership, and uvloop. |
| **[Pyke](skills/reference/pyke/SKILL.md)** | Pyke (Python Knowledge Engine, scitools-pyke) — .krb/.kfb/.kqb source files, knowledge_engine.engine API, pattern matching, backward/forward chaining, plans, the special knowledge base, and question bases. |
| **[Tabler](skills/reference/tabler/SKILL.md)** | Tabler UI component reference — CSS classes, variants, layout patterns, modals, plugins. Everything an agent needs to stop guessing class names. |

#### Practice

How to work well — disciplines, design vocabulary, and the book-derived practice skills.

| Skill | What it covers |
|-------|---------------|
| **[Critical Partner](skills/practice/critical-partner/SKILL.md)** | Persistent adjustable interaction stance: calibrated challenge, directness, compression, warmth, and humor, with non-adjustable evidence, accuracy, security, and destructive-action floors. |
| **[Codebase Design](skills/practice/codebase-design/SKILL.md)** | Shared vocabulary for designing deep modules — depth, seam, adapter, leverage, locality. Dependency categories for safe deepening. Design-it-twice parallel interface exploration. |
| **[Construction Craft](skills/practice/construction-craft/SKILL.md)** | Day-to-day construction discipline — preflight checks, intent-first routines, explicit data meaning, knowledge-level DRY, reversible choices, reproducible automation, measured tuning, and whole-output capture (`tee`, never `head`/`tail`/`>`). |
| **[Data-Intensive](skills/practice/data-intensive/SKILL.md)** | Distributed data systems — consistency models, replication, partitioning, schema evolution, event sourcing, stream processing. Based on Designing Data-Intensive Applications (Kleppmann). |
| **[Diagnosing Bugs](skills/practice/diagnosing-bugs/SKILL.md)** | Representative permanent red before repair, green and original scenario verification, owned cleanup and cleaned-candidate recheck; proportionate project gates. 10 feedback-loop construction strategies for hard bugs and performance regressions. |
| **[Django-Discipline](skills/practice/django-discipline/SKILL.md)** | Mandatory Django workflow discipline — auto-generate migrations, ruff before manual cleanup, N+1 prevention, public API imports. Enforces tool-first patterns agents otherwise skip. |
| **[Docker Discipline](skills/practice/docker-discipline/SKILL.md)** | Mandatory Docker workflow — non-root UID matching host, USER after RUN, port merge behavior, separate compose.test.yml for lifecycle independence, healthchecks. Enforces patterns agents otherwise skip. |
| **[Documentation Lifecycle](skills/practice/documentation-lifecycle/SKILL.md)** | Spec-first documentation workflow — feature specs, specification interviews, ADRs, exact reference docs, runbooks, Diátaxis user docs, and documentation drift triage. |
| **[Domain-Driven Design](skills/practice/domain-driven-design/SKILL.md)** | Strategic design (Bounded Contexts, Context Mapping, Subdomains), tactical patterns (Entities, Value Objects, Aggregates, Domain Events), Ubiquitous Language discipline, integration patterns (ACL, OHS). Synthesized from Evans + Vernon. |
| **[Enterprise Patterns](skills/practice/enterprise-patterns/SKILL.md)** | Infrastructure decisions around a domain — business-logic pattern by force (Transaction Script/Table Module/Domain Model), Unit of Work, Identity Map, offline concurrency, session-state placement, Remote Facade, forbidden-pattern review blockers. Defers domain modeling to DDD. Based on Patterns of Enterprise Application Architecture (Fowler). |
| **[Git Discipline](skills/practice/git-discipline/SKILL.md)** | Git workflow — commit after every wave, conventional commits, untracked files sacred, FORBIDDEN commands (git clean, reset --hard, rm -rf on user files), no force push without permission. |
| **[Legacy Code](skills/practice/legacy-code/SKILL.md)** | Safe changes to untested/unclear code — characterization tests, seams, dependency breaking, sprout/wrap techniques. Based on Working Effectively with Legacy Code (Feathers). |
| **[Production Readiness](skills/practice/production-readiness/SKILL.md)** | Production resilience — timeouts, retries, circuit breakers, bulkheads, backpressure, load shedding, observability, deployment safety. Based on Release It! (Nygard). |
| **[Refactoring Pass](skills/practice/refactoring-pass/SKILL.md)** | Behavior-preserving structural improvements — code smells, named moves (extract, inline, move, rename), preparatory/follow-up refactoring, stop conditions. Based on Refactoring (Fowler). |
| **[Resolving Merge Conflicts](skills/practice/resolving-merge-conflicts/SKILL.md)** | Conflict resolution within the authorized merge/rebase — trace both intents and governing requirements, preserve unrelated work, stage only inspected resolutions, and return incompatible intent to its owner. Checks use testing-workflow. Continuation needs explicit authority; abort needs attributed, preserved recovery evidence and its own grant. |
| **[TDD](skills/practice/tdd/SKILL.md)** | Test-driven development with red-green-refactor. Vertical-slice discipline (one test → one implementation), anti-horizontal-slicing, integration-style tests through public interfaces. Django-specific patterns: httpx.MockTransport, mail.outbox, override_settings. |
| **[Testing Workflow](skills/practice/testing-workflow/SKILL.md)** | TDD mandatory (red-green-refactor), use `tee` not `head`/`tail`/`>`, Playwright rules (headless, navigation via UI not URLs), Docker test environment (compose.test.yml, no public ports). |
| **[UI Design Direction](skills/practice/ui-design-direction/SKILL.md)** | UI/UX direction and hostile design-lead critique for dashboards, landing pages, admin tools, mobile apps, typography, chart choices, trust signals, hierarchy, and conversion friction. |
| **[Webapp Testing](skills/practice/webapp-testing/SKILL.md)** | Playwright workflow for local webapp testing — server lifecycle, rendered-DOM reconnaissance, browser logs, screenshots, and recorded video artifacts for repros and walkthroughs. |

#### Workflow

Rituals you run — session and tracker state, from interview through implementation to review.

| Skill | What it covers |
|-------|---------------|
| **[Cleanroom Rewrite](skills/workflow/cleanroom-rewrite/SKILL.md)** | Reimplement a codebase from scratch based on behavioral spec, without copying implementation. Legal reimplementations, spec-driven rewrites, two-agent processes. |
| **[Court Jester](skills/workflow/court-jester/SKILL.md)** | Structured adversarial reasoning for stress-testing plans, proposals, architecture, and strategy. Devil's-advocate reviews, pre-mortems, red teams, assumption checks. |
| **[Domain Modeling](skills/workflow/domain-modeling/SKILL.md)** | Active domain-model discipline — challenge terms against the glossary, sharpen fuzzy language, stress-test with scenarios, update CONTEXT.md inline, offer ADRs sparingly (hard-to-reverse + surprising + real trade-off). |
| **[Fix PR](skills/workflow/fix-pr/SKILL.md)** | Repair review findings and conflicts against the PR's actual target; commit before review, bind checks/review/publication to fixed candidate SHAs, and recertify after changes. Update the same open PR without implicit merge or history-rewrite authority. |
| **[Grill Me](skills/workflow/grill-me/SKILL.md)** | User-invoked wrapper: run a grilling session on the current plan or design. |
| **[Grill With Docs](skills/workflow/grill-with-docs/SKILL.md)** | Grilling session that also maintains docs as decisions land — CONTEXT.md glossary entries and ADRs via domain-modeling. |
| **[Grilling](skills/workflow/grilling/SKILL.md)** | The interview primitive — the design tree worked in rounds, each round asking the whole frontier of ready questions, facts looked up vs decisions asked, no enacting until the user confirms. Reused by grill-me, grill-with-docs, triage, wayfinder. |
| **[Handoff](skills/workflow/handoff/SKILL.md)** | Compact the current conversation into a handoff document for another agent to pick up. References artifacts by path/URL, redacts sensitive info, saves to temp directory. |
| **[Humanify](skills/workflow/humanify/SKILL.md)** | Exception-only repair for inherited, incomplete or changed-premise tickets: investigate, settle consequential choices and verify human-authorized readiness against the shared brief criteria. Retains human-only outcomes and execution blockers. |
| **[Implement](skills/workflow/implement/SKILL.md)** | Build one ticket-sized slice — TDD, committed-candidate two-axis review and bounded repairs; standalone PR by default, or an explicitly authorized branch-only worker handoff. |
| **[Implement Spec](skills/workflow/implement-spec/SKILL.md)** | Manual supervised whole-spec run — isolated branch-only workers, verified run-local prerequisites, serialized integration and one combined PR or branch-only deliverable. |
| **[Improve Codebase Architecture](skills/workflow/improve-codebase-architecture/SKILL.md)** | Dual-axis architecture scan: finds deepening opportunities (shallow modules) AND simplification opportunities (dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead flags). Visual HTML report, then a wayfinder map with one ticket per chosen candidate and an in-session work-through of the one you pick. Uses codebase-design vocabulary, integrates ponytail-audit. Manual-only: runs only on an explicit request and reviews the scope it names; reading the skill starts nothing. |
| **[LLM Council](skills/workflow/council/SKILL.md)** | Multi-advisor decision protocol: 5 independent perspectives, anonymized peer review, chairman synthesis. For high-stakes uncertainty where being wrong is expensive. |
| **[Ponytail Audit](skills/workflow/ponytail-audit/SKILL.md)** | Scan for over-engineering — dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead feature flags. Read-only, ranked by impact. |
| **[Ponytail Debt](skills/workflow/ponytail-debt/SKILL.md)** | Harvest `SHORTCUT:` markers left during development. Flags missing upgrade paths. Optionally writes `SHORTCUT-DEBT.md` for tracking. |
| **[Prototype](skills/workflow/prototype/SKILL.md)** | Throwaway prototyping discipline — logic branch (terminal app for state machines) or UI branch (radically different variants on one route, a switcher that renders the chosen variant and survives reload; production excludes prototypes on the server). Seven universal rules: pure interface, throwaway, one command, no persistence, skip polish, surface state, preserve before a scoped cleanup. A planning prototype ends with findings; production adoption is separately authorized. |
| **[QA](skills/workflow/qa/SKILL.md)** | Interactive QA session — user reports bugs conversationally, agent clarifies, explores the codebase for domain language, and files durable user-focused tracker issues (single or dependency-ordered breakdowns); concrete reproduction and expectation make an issue well specified, and only a scoped human grant makes it agent-ready. |
| **[Retro](skills/workflow/retro/SKILL.md)** | Manually review the current or explicitly named session; rank evidence-backed prevention proposals against upkeep and noise. Inspect checks and wiring; apply nothing. |
| **[Research](skills/workflow/research/SKILL.md)** | Delegate reading legwork to a background agent — primary sources only, every claim cited, findings landed as a Markdown note in the repo. |
| **[Review Spec](skills/workflow/review-spec/SKILL.md)** | The spec axis of a two-axis review, independently invocable — missing requirements, scope creep, and requirements implemented wrongly, each quoting the spec line it rests on. Review only, never edits. |
| **[Review Standards](skills/workflow/review-standards/SKILL.md)** | The standards axis of a two-axis review, independently invocable — documented repo standards plus a fixed Fowler smell baseline, every finding cited, smells never blocking. Review only, never edits. |
| **[Restore Test Pyramid](skills/workflow/restore-test-pyramid/SKILL.md)** | User-invoked ritual that pushes E2E-only assertions down to integration/unit tiers — per-assertion classification, fidelity gate (migrated assertion must go red under the same mutation), one happy-path smoke per flow, xdist pass. |
| **[Teach](skills/workflow/teach/SKILL.md)** | Multi-session teaching ritual — the current directory becomes a stateful workspace (MISSION.md, HTML lessons, learning records, glossary) grounding lessons in the learner's mission and zone of proximal development. |
| **[To Questionnaire](skills/workflow/to-questionnaire/SKILL.md)** | Turn a decision you can't answer alone into a Markdown questionnaire for the one person who can fill it in — grills the send (who, expertise, need) not the subject, then writes a structured, ordered file. |
| **[To Spec](skills/workflow/to-spec/SKILL.md)** | Synthesize a proportionate spec preserving decisions, acceptance conditions, exclusions and deferrals. Reuse agreed seams; publication alone grants no implementation readiness. |
| **[Wizard](skills/workflow/wizard/SKILL.md)** | Generate an interactive bash wizard that walks a human through a manual setup or migration procedure — opening URLs, capturing values, confirming each step, and writing `.env` files and CI secrets (GitHub and Gitea/Forgejo Actions). |
| **[To Tickets](skills/workflow/to-tickets/SKILL.md)** | Produce bounded implementation briefs and an audited graph; own factual refinement, reuse scoped grants and verify publication before readiness transitions. Preserve scaffolding, contract-first ordering for new or changed interfaces with reuse of evidenced unchanged ones, walking skeleton, expand–contract and terminal human acceptance. |
| **[Triage](skills/workflow/triage/SKILL.md)** | Issue/PR triage state machine — categorise, verify the claim, grill into shape, write durable agent briefs, maintain an .out-of-scope/ knowledge base of rejected requests. |
| **[Two-Axis Review](skills/workflow/two-axis-review/SKILL.md)** | Run both review axes over the changes since a fixed point and aggregate them without reranking — sub-agents when the harness has them, sequentially when it does not. |
| **[Wayfinder](skills/workflow/wayfinder/SKILL.md)** | Plan work too big for one session as a shared map of decision tickets on the issue tracker — destination, frontier, fog of war — resolved one ticket per session until the way is clear. |

#### Meta

About the agent and its own toolkit, not about your code.

| Skill | What it covers |
|-------|---------------|
| **[Git Guardrails (Claude Code)](skills/meta/git-guardrails-claude-code/SKILL.md)** | Set up PreToolUse hooks that block dangerous git commands (push, reset --hard, clean, branch -D) — git-discipline enforced by machinery, not prompts. |
| **[Setup Project Skills](skills/meta/setup-project-skills/SKILL.md)** | Run once per repo to configure the workflow skills — issue tracker bindings (agent work vs human intake), triage label vocabulary, and domain doc layout — written to `docs/agents/` and pointed at from CLAUDE.md/AGENTS.md. |
| **[Skill Creator](skills/meta/skill-creator/SKILL.md)** | Meta-skill for creating, modifying, and benchmarking other skills — evals, variance analysis, and description optimization for triggering accuracy. |
| **[Websearch](skills/meta/websearch/SKILL.md)** | Search the web via locally installed SearXNG instance. Configurable endpoint via `/skill:websearch url`. |
| **[Writing Great Skills](skills/meta/writing-great-skills/SKILL.md)** | Prose-level craft reference for skill authoring — leading words, no-ops, negation, context vs cognitive load, premature completion, progressive disclosure. Complements skill-creator's eval workflow. |

</details>

## Prompt Templates

Prompt templates are slash commands — type `/name` in the editor and it expands into a request that hands off to a bundled skill. Each template is an entry point, not a second copy of the flow: the skill stays the single source of truth, and the template exists because it forwards its arguments, which `/skill:<name>` cannot. So `/arch ~/some/repo` reviews another tree in one shot.

<details>
<summary><strong>Prompt templates (15)</strong></summary>

| Command | What it does |
|---|---|
| **`/jester <plan>`** | Stress-test a plan with adversarial reasoning — auto-selects the strongest critique mode (socratic, dialectic, pre-mortem, red team, evidence audit). |
| **`/council <decision>`** | 5 independent advisors + anonymized peer review + chairman synthesis. For high-stakes decisions where being wrong is expensive. |
| **`/audit [path]`** | Ranked bloat/over-engineering findings — dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead flags. |
| **`/debt [path] [--output-debt-file]`** | Harvest `SHORTCUT:` markers left during development. Flags missing upgrade paths. |
| **`/handoff`** | Compact the conversation into a handoff document for another agent. References artifacts, redacts secrets, saves to temp. |
| **`/humanify <ticket>`** | Turn a human-blocked ticket into agent-implementable work; you decide, the agent drives refinement through authorized readiness. |
| **`/implement-spec <spec> [instructions]`** | Implement one approved ticket graph in a supervised session, with a combined branch/PR and explicit publication boundaries. |
| **`/refine-ticket <ticket-number>`** | Forward the supplied ticket arguments to `humanify` for human-authorized agent readiness; ambiguity, authority and separate implementation remain with the skill. |
| **`/fixrev <pull_request>`** | Fix review findings and target-branch conflicts through `fix-pr`, verify and publish to the same PR; leave merging separate. |
| **`/revmerge <pull_request>`** | Now review-only through `two-axis-review`; replaces the former implicit comment/merge flow. Posting and merging must be separately authorized after review. |
| **`/questionnaire <topic>`** | Turn an unanswerable decision into a Markdown questionnaire for the one person who can fill it in. |
| **`/arch [path]`** | Architecture health check with visual HTML report — deepening and simplification candidates, before/after diagrams, then a wayfinder map and an in-session work-through of the candidate you pick. |
| **`/wizard [description]`** | Generate an interactive bash wizard that walks a human through a manual setup or migration procedure. |
| **`/ui-review <product> <keywords>`** | Data-driven UI/UX critique — design system search, color/typography direction, accessibility, anti-patterns. |
| **`/proto <question> [logic\|ui]`** | Throwaway prototype — terminal app for state machines or radically different UI variants on one route. |

</details>

`/fixrev` now routes its existing review-repair job through `fix-pr` and also resolves
conflicts with the PR's actual target branch. It retains `grilling` for human decisions,
protects other work, and updates the same open PR; it does not authorize a PR merge or
published-history rewrite. Run `/reload` in an active pi session to load this template.

### Planning to implementation

```text
bounded discussion / research / optional prototype
  → synthesis when needed
  → ticket construction, graph audit and readiness assessment
  → scoped approval, publication and readback
  → one-slice or supervised whole-spec implementation
  → verification, review and authorized publication
  → human acceptance
```

- Use [Wayfinder](skills/workflow/wayfinder/SKILL.md) for multi-session decisions;
  synthesize scattered primary resolutions with [to-spec](skills/workflow/to-spec/SKILL.md).
  The map indexes decisions; it is not the execution brief.
- From a usable spec, [to-tickets](skills/workflow/to-tickets/SKILL.md) owns bounded
  construction briefs and the audited graph. A sufficient small brief can go directly
  to [implement](skills/workflow/implement/SKILL.md), without an artificial parent spec.
- Select `implement` for one eligible slice, or
  [implement-spec](skills/workflow/implement-spec/SKILL.md) for an approved supervised graph.
  Consumers recheck changed inputs, reuse unchanged accepted decisions/evidence and
  leave routine engineering choices to the implementer.
- [humanify](skills/workflow/humanify/SKILL.md) is exceptional repair for inherited,
  incomplete or changed-premise tickets—not a compulsory stage after ticket production.
  Human-only outcomes and terminal reviews remain human-owned.

These arrows are orientation, not invocation or permission. Brief sufficiency,
scoped authority and present eligibility are separate checks; readiness labels do not
waive blockers or claims. Reuse an adequate grant rather than repeat approval, and
renew only changed effects. Existing execution, verification and publication contracts
still govern. Fresh configured skill discovery is verified in the
[handoff spec](docs/specs/implementation-ticket-handoff.md#runtime-discovery-verification);
it is not proof of an active-session reload, real fresh-worker construction or publication.
Those operational checks remain pending.

### PR presentation

Use the model-discoverable [pr reference](skills/reference/pr/SKILL.md) to prepare
or improve a PR body or repair comment. `implement`, `implement-spec` and `fix-pr`
route their presentation to this single source. Existing repository templates,
closing references, robot markers, machine metadata and configured domain docs win.
Draft preparation does not grant posting, pushing, merging or closure: standalone,
branch-only, combined delivery and same-PR repair authority remain with their owners.

### Selected-session retrospective

Invoke `/skill:retro` to review the current session, or `/skill:retro <session>`
for an explicitly named session. [Retro](skills/workflow/retro/SKILL.md) returns
ranked proposals, including wiring existing checks or removing noisy rules; it
applies none. Missing evidence stays a gap, not permission to search other sessions
or services. It is manual-only, not an automatic implementation/review stage.

### Selected compact review evidence

When the caller explicitly selects compact evidence and verifies an approved route,
`implement`, `implement-spec` and `two-axis-review` use the
[shared transport branch](skills/workflow/two-axis-review/references/compact-evidence.md).
The maintained pi-subagents adapter accepts it on its existing spawn RPC; a harness version
that also exposes top-level `Agent.review_evidence` must be confirmed in the installed schema.
Nested/workflow workers leave those reviewer calls to their caller.
Full independent findings, raw evidence, current checks and human acceptance remain required.
Ordinary invocations are unchanged. This wiring is not a measured efficiency claim or
permission to start an unbudgeted pilot.

### Supervised whole-spec implementation

Use `/implement-spec <spec> [instructions]` when an approved spec already has
build-ready tickets and you want one session to coordinate them. Keep `implement`
for one slice at a time. The coordinator defaults to serial workers, preserves
worktrees and keeps tracker closure separate from verified integration. Request
branch-only final delivery when you do not want a push or PR. It is not a durable
or unattended orchestration service; see the
[skill's contract](skills/workflow/implement-spec/SKILL.md). Reload pi to discover
the new template. The Cleopatra milestone pilot has not run; scenario checks are
not evidence of operational reliability.

### Human-in-the-loop tickets

Use `/humanify <ticket>` to take a human-blocked ticket through to agent implementation
readiness. The agent investigates, asks bounded `grilling` rounds, incorporates your answers,
writes the implementation brief and runs the readiness preflight without waiting for
“what next?” You decide consequential forks and explicitly authorize readiness; the agent
publishes and verifies the corresponding ticket state. Implementation starts separately.

`/refine-ticket <ticket-number>` now enters this same workflow instead of stopping at
`grilling`'s approved planning brief. It retains explicit ticket selection and construction
context. Existing publication-only approvals still grant no readiness: the agent finishes
available preparation and asks for the specific readiness authorization. Use `/reload` in
an active pi session to load the updated template.

Workflow routing is not readiness: `needs-info` + `workflow:implement` identifies an
implementation proposal with missing information or unfinished refinement, not permission
to execute. Record each gap's owner and next action. `ready-for-human` identifies required
human action or judgement; `ready-for-agent` requires a sufficient brief and the applicable
authorization. Prerequisites and claims remain independent execution gates.

This replaces the earlier progress-record/resume-point default: an interview or published
checkpoint is no longer the finish line. Explicitly human-only setup, field checks and
terminal reviews still finish on their own outcomes, not invented implementation work.
Live changes retain scoped authorization, unresolved obligations retain owners, and terminal
review labels remain unchanged. No next ticket starts automatically.

## Critical Partner setup and use

[`critical-partner`](skills/practice/critical-partner/SKILL.md) gives the agent a persistent, adjustable interaction stance instead of a one-off critique command. It controls challenge, directness, compression, warmth, and humor while keeping evidence integrity, technical accuracy, security caution, and destructive-action caution fixed at maximum.

### Setup

1. Install this package using the command under [How to use](#how-to-use). Pi discovers the skill automatically.
2. Edit or create the global `~/.pi/agent/AGENTS.md`. Merge the following block into existing rules; do not overwrite unrelated instructions:

```markdown
### Critical Partner

Use the `critical-partner` skill for every response.

Profile:

- challenge: 75
- directness: 80
- compression: 60
- warmth: 25
- humor: 10

Evidence integrity, technical accuracy, security caution, and destructive-action caution remain at 100 regardless of profile.
```

[`agent/AGENTS.md`](agent/AGENTS.md) contains the complete bundled example. The repository-level [`AGENTS.md`](AGENTS.md) is only the contributor guide for this repository; it is not the global profile template. Package installation deliberately does not replace an existing global AGENTS.md.

3. Start a new pi session or run `/reload` so pi reloads the context file and skill.

### Use and tune it

No slash command is required after setup. The global rule activates the skill for every response.

Set each dial from 0 to 100. Values use coarse behavioral bands: 0–24 low, 25–49 moderate, 50–74 substantial, 75–89 high, and 90–100 maximum. Edit the profile in `~/.pi/agent/AGENTS.md`, then run `/reload`.

- **Challenge**: how actively the agent tests assumptions and searches for material weaknesses.
- **Directness**: how quickly and plainly it states disagreement or defects.
- **Compression**: how aggressively it removes words without removing substance.
- **Warmth**: how much social softness and reassurance it uses.
- **Humor**: how often it uses optional levity.

The four fixed floors cannot be lowered by profile settings. Higher-risk work also raises the minimum challenge automatically. Use `/skill:court-jester` when you want a separate, structured maximum-strength critique rather than the everyday stance.

## Contributing

If you have a framework skill worth sharing — one born from production pain, not tutorial optimism — contributions are welcome. The bar is: would this have prevented a real bug?

## License

[Unlicense](LICENSE) — public domain. Take what's useful. No attribution needed.
