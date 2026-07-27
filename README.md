# oh-my-slop

After enough hours watching AI confidently produce wrong code, you stop hoping it'll get better and start building guardrails instead.

This repo is a collection of those guardrails — curated skills, pi extensions, and bundled agent defaults that encode the knowledge AI models claim to have but demonstrably don't. Everything here was distilled from real production mistakes and hard-won lessons, not tutorial cosplay.

## How to use

This repo is `pi`-first now. Install it as a package to get the bundled skills without auto-enabling the extensions.

```bash
pi install git:github.com/dekoza/oh-my-slop
# or from a local checkout
pi install .
```

After installation, pi auto-discovers:

- skills from `./skills`

The `workflow-watchdog` extension loads automatically on install (it only monitors — no code execution). The other extensions are shipped but remain opt-in. Add an explicit path in your pi `settings.json` if you want one active:

```json
{
  "extensions": [
    "/path/to/oh-my-slop/extensions/job-pipeline/index.ts"
  ]
}
```

For git installs, pi keeps the checkout under `~/.pi/agent/git/...` globally or `.pi/git/...` project-locally, so point the path at that installed checkout. The bundled agent definitions in `./agents` are only seeded if you opt into `subagent-bundled-agents`.

If you only want the markdown skills for OpenCode or some other agent stack, you can still steal `./skills` and wire them up manually. That path still exists. It is just no longer the main story.

### First run in a project

Run [`/setup-project-skills`](skills/setup-project-skills/SKILL.md) once per repo, before the first time you reach for `wayfinder`, `to-tickets`, `to-spec`, `triage`, `qa`, or `two-axis-review`. It interviews you about three things the workflow skills otherwise have to guess at, and writes the answers to `docs/agents/` in that project:

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

These ship in the repo, but the root `pi install` keeps them inactive until you opt in by path.

<details>
<summary><strong>Extensions (5, opt-in)</strong></summary>

| Extension | What it does |
|---|---|
| **[adaptive-routing](extensions/adaptive-routing/README.md)** | Classifies prompt intent and routes to the best available model. Supports shadow mode, locking, telemetry, and per-intent policy. |
| **[provider-failover](extensions/provider-failover/README.md)** | Wraps GitHub Copilot models with automatic provider failover on 429/overload errors. Keeps the best working route sticky. |
| **[job-pipeline](extensions/job-pipeline/README.md)** | Runs a full development pipeline: model-driven interview → scout → planning loop with adversarial jester critique → TDD workers → proof deck → review → retro. Human gates at every decision point. Earns autonomy through clean retrospectives. |
| **[subagent-bundled-agents](extensions/subagent-bundled-agents/)** | Seeds bundled markdown subagents from `./agents` into pi's project or shared agent storage without clobbering user overrides once you opt into the extension. |
| **[workflow-watchdog](extensions/workflow-watchdog/)** | Monitors pi's workflow for failure patterns: loop detection (repeating messages), mistake tracking (consecutive tool errors), and optional supervisor model escalation for rescue instructions. |

</details>

## Skills

<details>
<summary><strong>Skills (61)</strong></summary>

| Skill | What it covers |
|-------|---------------|
| **[Cleanroom Rewrite](skills/cleanroom-rewrite/SKILL.md)** | Reimplement a codebase from scratch based on behavioral spec, without copying implementation. Legal reimplementations, spec-driven rewrites, two-agent processes. |
| **[Construction Craft](skills/construction-craft/SKILL.md)** | Day-to-day construction discipline — preflight checks, intent-first routines, explicit data meaning, knowledge-level DRY, reversible choices, reproducible automation, and measured tuning. |
| **[Caveman](skills/caveman/SKILL.md)** | Ultra-compressed communication mode for when you want fewer tokens, less hedging, and the same technical substance. Speaks like a competent cave dweller on purpose. |
| **[Data-Intensive](skills/data-intensive/SKILL.md)** | Distributed data systems — consistency models, replication, partitioning, schema evolution, event sourcing, stream processing. Based on Designing Data-Intensive Applications (Kleppmann). |
| **[Legacy Code](skills/legacy-code/SKILL.md)** | Safe changes to untested/unclear code — characterization tests, seams, dependency breaking, sprout/wrap techniques. Based on Working Effectively with Legacy Code (Feathers). |
| **[Production Readiness](skills/production-readiness/SKILL.md)** | Production resilience — timeouts, retries, circuit breakers, bulkheads, backpressure, load shedding, observability, deployment safety. Based on Release It! (Nygard). |
| **[Refactoring Pass](skills/refactoring-pass/SKILL.md)** | Behavior-preserving structural improvements — code smells, named moves (extract, inline, move, rename), preparatory/follow-up refactoring, stop conditions. Based on Refactoring (Fowler). |
| **[Enterprise Patterns](skills/enterprise-patterns/SKILL.md)** | Infrastructure decisions around a domain — business-logic pattern by force (Transaction Script/Table Module/Domain Model), Unit of Work, Identity Map, offline concurrency, session-state placement, Remote Facade, forbidden-pattern review blockers. Defers domain modeling to DDD. Based on Patterns of Enterprise Application Architecture (Fowler). |
| **[LLM Council](skills/council/SKILL.md)** | Multi-advisor decision protocol: 5 independent perspectives, anonymized peer review, chairman synthesis. For high-stakes uncertainty where being wrong is expensive. |
| **[Codebase Design](skills/codebase-design/SKILL.md)** | Shared vocabulary for designing deep modules — depth, seam, adapter, leverage, locality. Dependency categories for safe deepening. Design-it-twice parallel interface exploration. |
| **[Court Jester](skills/court-jester/SKILL.md)** | Structured adversarial reasoning for stress-testing plans, proposals, architecture, and strategy. Devil's-advocate reviews, pre-mortems, red teams, assumption checks. |
| **[Django](skills/django/SKILL.md)** | Django 6.0 framework patterns — models, views, URLs, templates, forms, admin, auth, testing, architecture. The gotchas section alone justifies this skill's existence. |
| **[Django-Discipline](skills/django-discipline/SKILL.md)** | Mandatory Django workflow discipline — auto-generate migrations, ruff before manual cleanup, N+1 prevention, public API imports. Enforces tool-first patterns agents otherwise skip. |
| **[Django-Allauth](skills/django-allauth/SKILL.md)** | Django-allauth integration reference — account flows, SocialApp/provider setup, OAuth/OIDC/SAML boundaries, MFA, usersessions, headless auth, IdP mode, troubleshooting, and version-sensitive pitfalls. |
| **[Diagnosing Bugs](skills/diagnosing-bugs/SKILL.md)** | Structured diagnosis loop for hard bugs and performance regressions — build feedback loop, reproduce, minimise, hypothesise, instrument, fix, regression test. 10 feedback-loop construction strategies. |
| **[English Only](skills/english-only/SKILL.md)** | Enforce English-only identifiers, comments, docstrings, and messages in all code. No exceptions — applies regardless of user language. Triggers on non-English signals. |
| **[Domain-Driven Design](skills/domain-driven-design/SKILL.md)** | Strategic design (Bounded Contexts, Context Mapping, Subdomains), tactical patterns (Entities, Value Objects, Aggregates, Domain Events), Ubiquitous Language discipline, integration patterns (ACL, OHS). Synthesized from Evans + Vernon. |
| **[Documentation Lifecycle](skills/documentation-lifecycle/SKILL.md)** | Spec-first documentation workflow — feature specs, specification interviews, ADRs, exact reference docs, runbooks, Diátaxis user docs, and documentation drift triage. |
| **[Handoff](skills/handoff/SKILL.md)** | Compact the current conversation into a handoff document for another agent to pick up. References artifacts by path/URL, redacts sensitive info, saves to temp directory. |
| **[Docker](skills/docker/SKILL.md)** | Dockerfiles, compose files, build context, daemon behavior, bind mounts, DNS resolution, `.dockerignore`, secret handling, image publishing, and cross-environment debugging. |
| **[Docker Discipline](skills/docker-discipline/SKILL.md)** | Mandatory Docker workflow — non-root UID matching host, USER after RUN, port merge behavior, separate compose.test.yml for lifecycle independence, healthchecks. Enforces patterns agents otherwise skip. |
| **[DRF](skills/drf/SKILL.md)** | Django REST Framework — serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, content negotiation, versioning, and testing. |
| **[FullCalendar](skills/full-calendar/SKILL.md)** | FullCalendar JS library — initialization, views, event sources, callbacks, drag-and-drop, render hooks, toolbar config, localization, and CSS customization. |
| **[Git Discipline](skills/git-discipline/SKILL.md)** | Git workflow — commit after every wave, conventional commits, untracked files sacred, FORBIDDEN commands (git clean, reset --hard, rm -rf on user files), no force push without permission. |
| **[Gitea](skills/gitea/SKILL.md)** | Gitea and the `tea` CLI — repo/login resolution (and the silent fallback that targets the wrong repo), issues, PRs, labels, milestones, releases, plus issue dependencies and scripting via `tea api`. |
| **[HTMX](skills/htmx/SKILL.md)** | Attributes, requests, swapping strategies, events, extensions, and the patterns that make hypermedia-driven UIs actually work. |
| **[Testing Workflow](skills/testing-workflow/SKILL.md)** | TDD mandatory (red-green-refactor), use `tee` not `head`/`tail`/`>`, Playwright rules (headless, navigation via UI not URLs), Docker test environment (compose.test.yml, no public ports). |
| **[HTTP Status Codes](skills/http-status-codes/SKILL.md)** | API response code semantics and edge cases: 400 vs 422, 401 vs 403, 404 vs 410, 409 vs 412 vs 428, 429 vs 503, 201 vs 202 vs 204, and redirect behavior like 303 vs 307 vs 308. |
| **[Improve Codebase Architecture](skills/improve-codebase-architecture/SKILL.md)** | Dual-axis architecture scan: finds deepening opportunities (shallow modules) AND simplification opportunities (dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead flags). Visual HTML report, then a wayfinder map with one ticket per chosen candidate and an in-session work-through of the one you pick. Uses codebase-design vocabulary, integrates ponytail-audit. |
| **[Hyperscript](skills/hyperscript/SKILL.md)** | `_hyperscript` front-end scripting — event handlers, queue semantics, DOM commands, async transparency, `behavior`, `worker`, `socket`, JS interop boundaries, and HTMX companion patterns. |
| **[Ponytail Audit](skills/ponytail-audit/SKILL.md)** | Scan for over-engineering — dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead feature flags. Read-only, ranked by impact. |
| **[Ponytail Debt](skills/ponytail-debt/SKILL.md)** | Harvest `SHORTCUT:` markers left during development. Flags missing upgrade paths. Optionally writes `SHORTCUT-DEBT.md` for tracking. |
| **[LangChain](skills/langchain/SKILL.md)** | Python LangChain ecosystem reference — package boundaries across `langchain`, `langchain-core`, provider integrations, LangGraph, LangSmith, LCEL/runnables, `init_chat_model`, `create_agent`, retrieval wiring, tracing, evals, and migration off `langchain-classic`. |
| **[Litestar](skills/litestar/SKILL.md)** | Litestar framework — route handlers, controllers, dependency injection, DTOs, middleware, lifecycle hooks, exception handling, templating, testing, websockets, and guards. |
| **[PrestaShop](skills/prestashop/SKILL.md)** | PrestaShop 9 modules: module structure, hooks, front/admin controllers, modern configuration pages, services, persistence, external API integrations, cron/commands, packaging, compatibility, or release debugging. Prevents inventing framework classes, guessing hook contracts, or shipping fake Symfony/PrestaShop internals. |
| **[Prototype](skills/prototype/SKILL.md)** | Throwaway prototyping discipline — logic branch (terminal app for state machines) or UI branch (radically different variants on one route). Six universal rules: throwaway, one command, no persistence, skip polish, surface state, delete when done. |
| **[Python Async](skills/python-async/SKILL.md)** | Python async and concurrency — AnyIO, asyncio, Trio, task groups, cancel scopes, async testing, thread offloading, async streams, event-loop ownership, and uvloop. |
| **[Skill Creator](skills/skill-creator/SKILL.md)** | Meta-skill for creating, modifying, and benchmarking other skills — evals, variance analysis, and description optimization for triggering accuracy. |
| **[Teach](skills/teach/SKILL.md)** | Multi-session teaching ritual — the current directory becomes a stateful workspace (MISSION.md, HTML lessons, learning records, glossary) grounding lessons in the learner's mission and zone of proximal development. |
| **[Tabler](skills/tabler/SKILL.md)** | Tabler UI component reference — CSS classes, variants, layout patterns, modals, plugins. Everything an agent needs to stop guessing class names. |
| **[TDD](skills/tdd/SKILL.md)** | Test-driven development with red-green-refactor. Vertical-slice discipline (one test → one implementation), anti-horizontal-slicing, integration-style tests through public interfaces. Django-specific patterns: httpx.MockTransport, mail.outbox, override_settings. |
| **[Restore Test Pyramid](skills/restore-test-pyramid/SKILL.md)** | User-invoked ritual that pushes E2E-only assertions down to integration/unit tiers — per-assertion classification, fidelity gate (migrated assertion must go red under the same mutation), one happy-path smoke per flow, xdist pass. |
| **[UI Design Direction](skills/ui-design-direction/SKILL.md)** | UI/UX direction and hostile design-lead critique for dashboards, landing pages, admin tools, mobile apps, typography, chart choices, trust signals, hierarchy, and conversion friction. |
| **[Webapp Testing](skills/webapp-testing/SKILL.md)** | Playwright workflow for local webapp testing — server lifecycle, rendered-DOM reconnaissance, browser logs, screenshots, and recorded video artifacts for repros and walkthroughs. |
| **[Websearch](skills/websearch/SKILL.md)** | Search the web via locally installed SearXNG instance. Configurable endpoint via `/skill:websearch url`. |
| **[Setup Project Skills](skills/setup-project-skills/SKILL.md)** | Run once per repo to configure the workflow skills — issue tracker bindings (agent work vs human intake), triage label vocabulary, and domain doc layout — written to `docs/agents/` and pointed at from CLAUDE.md/AGENTS.md. |
| **[QA](skills/qa/SKILL.md)** | Interactive QA session — user reports bugs conversationally, agent clarifies, explores the codebase for domain language, and files durable user-focused tracker issues (single or dependency-ordered breakdowns). |
| **[Two-Axis Review](skills/two-axis-review/SKILL.md)** | Review changes since a fixed point along two independent axes via parallel sub-agents: Standards (repo conventions + Fowler smell baseline) and Spec (does the diff match the originating issue/PRD). |
| **[To Spec](skills/to-spec/SKILL.md)** | Turn the current conversation into a spec/PRD — problem statement, user stories, implementation and testing decisions — published to the issue tracker or `docs/specs/`. No interview, pure synthesis. |
| **[To Tickets](skills/to-tickets/SKILL.md)** | Break a plan, spec, or conversation into tracer-bullet tickets — vertical slices with explicit blocking edges — published to the tracker or one local file per ticket. Expand–contract sequencing for wide refactors. |
| **[Wayfinder](skills/wayfinder/SKILL.md)** | Plan work too big for one session as a shared map of investigation tickets on the issue tracker — destination, frontier, fog of war — resolved one ticket per session until the way is clear. |
| **[Grilling](skills/grilling/SKILL.md)** | The interview primitive — one question at a time until shared understanding, facts looked up vs decisions asked, no enacting until the user confirms. Reused by grill-me, grill-with-docs, triage, wayfinder. |
| **[Grill Me](skills/grill-me/SKILL.md)** | User-invoked wrapper: run a grilling session on the current plan or design. |
| **[Grill With Docs](skills/grill-with-docs/SKILL.md)** | Grilling session that also maintains docs as decisions land — CONTEXT.md glossary entries and ADRs via domain-modeling. |
| **[Domain Modeling](skills/domain-modeling/SKILL.md)** | Active domain-model discipline — challenge terms against the glossary, sharpen fuzzy language, stress-test with scenarios, update CONTEXT.md inline, offer ADRs sparingly (hard-to-reverse + surprising + real trade-off). |
| **[Triage](skills/triage/SKILL.md)** | Issue/PR triage state machine — categorise, verify the claim, grill into shape, write durable agent briefs, maintain an .out-of-scope/ knowledge base of rejected requests. |
| **[Implement](skills/implement/SKILL.md)** | Work a spec or tickets to completion — TDD at pre-agreed seams, regular typechecks, full suite at the end, two-axis review before committing. |
| **[Resolving Merge Conflicts](skills/resolving-merge-conflicts/SKILL.md)** | Conflict-resolution loop — trace each side's intent from primary sources, preserve both intents, never invent behaviour, never abort, verify with the project's checks. |
| **[Research](skills/research/SKILL.md)** | Delegate reading legwork to a background agent — primary sources only, every claim cited, findings landed as a Markdown note in the repo. |
| **[Writing Great Skills](skills/writing-great-skills/SKILL.md)** | Prose-level craft reference for skill authoring — leading words, no-ops, negation, context vs cognitive load, premature completion, progressive disclosure. Complements skill-creator's eval workflow. |
| **[Git Guardrails (Claude Code)](skills/git-guardrails-claude-code/SKILL.md)** | Set up PreToolUse hooks that block dangerous git commands (push, reset --hard, clean, branch -D) — git-discipline enforced by machinery, not prompts. |

</details>

## Prompt Templates

Prompt templates are slash commands — type `/name` in the editor and it expands into a request that hands off to a bundled skill. Each template is an entry point, not a second copy of the flow: the skill stays the single source of truth, and the template exists because it forwards its arguments, which `/skill:<name>` cannot. So `/arch ~/some/repo` reviews another tree in one shot.

<details>
<summary><strong>Prompt templates (8)</strong></summary>

| Command | What it does |
|---|---|
| **`/jester <plan>`** | Stress-test a plan with adversarial reasoning — auto-selects the strongest critique mode (socratic, dialectic, pre-mortem, red team, evidence audit). |
| **`/council <decision>`** | 5 independent advisors + anonymized peer review + chairman synthesis. For high-stakes decisions where being wrong is expensive. |
| **`/audit [path]`** | Ranked bloat/over-engineering findings — dead code, reinvented stdlib, speculative abstractions, pass-through wrappers, dead flags. |
| **`/debt [path] [--output-debt-file]`** | Harvest `SHORTCUT:` markers left during development. Flags missing upgrade paths. |
| **`/handoff`** | Compact the conversation into a handoff document for another agent. References artifacts, redacts secrets, saves to temp. |
| **`/arch [path]`** | Architecture health check with visual HTML report — deepening and simplification candidates, before/after diagrams, then a wayfinder map and an in-session work-through of the candidate you pick. |
| **`/ui-review <product> <keywords>`** | Data-driven UI/UX critique — design system search, color/typography direction, accessibility, anti-patterns. |
| **`/proto <question> [logic\|ui]`** | Throwaway prototype — terminal app for state machines or radically different UI variants on one route. |

</details>

## The AGENTS.md and Anti-Sycophancy

There are two AGENTS files here, and confusing them is how documentation starts lying.

- [`agent/AGENTS.md`](agent/AGENTS.md) is the bundled cross-project agent ruleset. This is where the **Hardline Review and Honesty Policy** lives.
- [`AGENTS.md`](AGENTS.md) is the repo-specific guide for working on this repository.

If you mean the anti-sycophancy clause, you mean `agent/AGENTS.md`, not the repo-local file.

The most critical part is the **Hardline Review and Honesty Policy**. This clause is a countermeasure against the single most dangerous property of AI code assistants: the tendency to agree with the user even when the user is wrong. I have seen too much code fail because an AI was too "polite" to point out a flaw.

In this repo, disagreement is not a failure. Unearned agreement is.

## Contributing

If you have a framework skill worth sharing — one born from production pain, not tutorial optimism — contributions are welcome. The bar is: would this have prevented a real bug?

## License

[Unlicense](LICENSE) — public domain. Take what's useful. No attribution needed.
