# oh-my-slop

After enough hours watching AI confidently produce wrong code, you stop hoping it'll get better and start building guardrails instead.

This repo is a collection of those guardrails — curated skills, pi extensions, and bundled agent defaults that encode the knowledge AI models claim to have but demonstrably don't. Everything here was distilled from real production mistakes and hard-won lessons, not tutorial cosplay.

## How to use

This repo is `pi`-first now. Install it as a package and let pi discover the bundled skills and extensions without making you hand-wire paths like some kind of YAML penitent.

```bash
pi install git:github.com/dekoza/oh-my-slop
# or from a local checkout
pi install .
```

After installation, pi can discover:

- skills from `./skills`
- extensions: `adaptive-routing`, `provider-failover`, `job-pipeline`, `subagent-bundled-agents`
- bundled agent definitions from `./agents`, seeded by `subagent-bundled-agents` into pi's project or shared agent storage without overwriting user overrides

If you only want the markdown skills for OpenCode or some other agent stack, you can still steal `./skills` and wire them up manually. That path still exists. It is just no longer the main story.

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

<details>
<summary><strong>Extensions (4)</strong></summary>

| Extension | What it does |
|---|---|
| **[adaptive-routing](extensions/adaptive-routing/README.md)** | Classifies prompt intent and routes to the best available model. Supports shadow mode, locking, telemetry, and per-intent policy. |
| **[provider-failover](extensions/provider-failover/README.md)** | Wraps GitHub Copilot models with automatic provider failover on 429/overload errors. Keeps the best working route sticky. |
| **[job-pipeline](extensions/job-pipeline/README.md)** | Runs a full development pipeline: model-driven interview → scout → planning loop with adversarial jester critique → TDD workers → proof deck → review → retro. Human gates at every decision point. Earns autonomy through clean retrospectives. |
| **[subagent-bundled-agents](extensions/subagent-bundled-agents/)** | Seeds bundled markdown subagents from `./agents` into pi's project or shared agent storage without clobbering user overrides. |

</details>

## Skills

<details>
<summary><strong>Skills (18)</strong></summary>

| Skill | What it covers |
|-------|---------------|
| **[Caveman](skills/caveman/SKILL.md)** | Ultra-compressed communication mode for when you want fewer tokens, less hedging, and the same technical substance. Speaks like a competent cave dweller on purpose. |
| **[Court Jester](skills/court-jester/SKILL.md)** | Structured adversarial reasoning for stress-testing plans, proposals, architecture, and strategy. Devil's-advocate reviews, pre-mortems, red teams, assumption checks. |
| **[Django](skills/django/SKILL.md)** | Django 6.0 framework patterns — models, views, URLs, templates, forms, admin, auth, testing, architecture. The gotchas section alone justifies this skill's existence. |
| **[Django-Allauth](skills/django-allauth/SKILL.md)** | Django-allauth integration reference — account flows, SocialApp/provider setup, OAuth/OIDC/SAML boundaries, MFA, usersessions, headless auth, IdP mode, troubleshooting, and version-sensitive pitfalls. |
| **[Docker](skills/docker/SKILL.md)** | Dockerfiles, compose files, build context, daemon behavior, bind mounts, DNS resolution, `.dockerignore`, secret handling, image publishing, and cross-environment debugging. |
| **[DRF](skills/drf/SKILL.md)** | Django REST Framework — serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, content negotiation, versioning, and testing. |
| **[FullCalendar](skills/full-calendar/SKILL.md)** | FullCalendar JS library — initialization, views, event sources, callbacks, drag-and-drop, render hooks, toolbar config, localization, and CSS customization. |
| **[HTMX](skills/htmx/SKILL.md)** | Attributes, requests, swapping strategies, events, extensions, and the patterns that make hypermedia-driven UIs actually work. |
| **[HTTP Status Codes](skills/http-status-codes/SKILL.md)** | API response code semantics and edge cases: 400 vs 422, 401 vs 403, 404 vs 410, 409 vs 412 vs 428, 429 vs 503, 201 vs 202 vs 204, and redirect behavior like 303 vs 307 vs 308. |
| **[Hyperscript](skills/hyperscript/SKILL.md)** | `_hyperscript` front-end scripting — event handlers, queue semantics, DOM commands, async transparency, `behavior`, `worker`, `socket`, JS interop boundaries, and HTMX companion patterns. |
| **[LangChain](skills/langchain/SKILL.md)** | Python LangChain ecosystem reference — package boundaries across `langchain`, `langchain-core`, provider integrations, LangGraph, LangSmith, LCEL/runnables, `init_chat_model`, `create_agent`, retrieval wiring, tracing, evals, and migration off `langchain-classic`. |
| **[Litestar](skills/litestar/SKILL.md)** | Litestar framework — route handlers, controllers, dependency injection, DTOs, middleware, lifecycle hooks, exception handling, templating, testing, websockets, and guards. |
| **[PrestaShop](skills/prestashop/SKILL.md)** | PrestaShop 9 modules: module structure, hooks, front/admin controllers, modern configuration pages, services, persistence, external API integrations, cron/commands, packaging, compatibility, or release debugging. Prevents inventing framework classes, guessing hook contracts, or shipping fake Symfony/PrestaShop internals. |
| **[Python Async](skills/python-async/SKILL.md)** | Python async and concurrency — AnyIO, asyncio, Trio, task groups, cancel scopes, async testing, thread offloading, async streams, event-loop ownership, and uvloop. |
| **[Skill Creator](skills/skill-creator/SKILL.md)** | Meta-skill for creating, modifying, and benchmarking other skills — evals, variance analysis, and description optimization for triggering accuracy. |
| **[Tabler](skills/tabler/SKILL.md)** | Tabler UI component reference — CSS classes, variants, layout patterns, modals, plugins. Everything an agent needs to stop guessing class names. |
| **[UI Design Direction](skills/ui-design-direction/SKILL.md)** | UI/UX direction and hostile design-lead critique for dashboards, landing pages, admin tools, mobile apps, typography, chart choices, trust signals, hierarchy, and conversion friction. |
| **[Webapp Testing](skills/webapp-testing/SKILL.md)** | Playwright workflow for local webapp testing — server lifecycle, rendered-DOM reconnaissance, browser logs, screenshots, and recorded video artifacts for repros and walkthroughs. |

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
