# oh-my-slop

After enough hours watching AI confidently produce wrong code, you stop hoping it'll get better and start building guardrails instead.

This is a collection of those guardrails — framework-specific skills that encode the knowledge AI models claim to have but demonstrably don't. Each skill is a curated reference designed for AI coding agents, distilled from real production mistakes and hard-won lessons.

## What's here

| Skill | What it covers |
|-------|---------------|
| **[Court Jester](skills/court-jester/SKILL.md)** | Structured adversarial reasoning for stress-testing plans, proposals, architecture, and strategy. Devil's-advocate reviews, pre-mortems, red teams, assumption checks. |
| **[Django](skills/django/SKILL.md)** | Django 6.0 framework patterns — models, views, URLs, templates, forms, admin, auth, testing, architecture. The gotchas section alone justifies this skill's existence. |
| **[Django-Allauth](skills/django-allauth/SKILL.md)** | Django-allauth integration reference — account flows, SocialApp/provider setup, OAuth/OIDC/SAML boundaries, MFA, usersessions, headless auth, IdP mode, troubleshooting, and version-sensitive pitfalls. |
| **[Docker](skills/docker/SKILL.md)** | Dockerfiles, compose files, build context, daemon behavior, bind mounts, DNS resolution, `.dockerignore`, secret handling, image publishing, and cross-environment debugging. |
| **[DRF](skills/drf/SKILL.md)** | Django REST Framework — serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, content negotiation, versioning, and testing. |
| **[FullCalendar](skills/full-calendar/SKILL.md)** | FullCalendar JS library — initialization, views, event sources, callbacks, drag-and-drop, render hooks, toolbar config, localization, and CSS customization. |
| **[HTMX](skills/htmx/SKILL.md)** | Attributes, requests, swapping strategies, events, extensions, and the patterns that make hypermedia-driven UIs actually work. |
| **[HTTP Status Codes](skills/http-status-codes/SKILL.md)** | API response code semantics and edge cases: 400 vs 422, 401 vs 403, 404 vs 410, 409 vs 412 vs 428, 429 vs 503, 201 vs 202 vs 204, and redirect behavior like 303 vs 307 vs 308. |
| **[Hyperscript](skills/hyperscript/SKILL.md)** | `_hyperscript` front-end scripting — event handlers, queue semantics, DOM commands, async transparency, `behavior`, `worker`, `socket`, JS interop boundaries, and HTMX companion patterns. |
| **[Litestar](skills/litestar/SKILL.md)** | Litestar framework — route handlers, controllers, dependency injection, DTOs, middleware, lifecycle hooks, exception handling, templating, testing, websockets, and guards. |
| **[PrestaShop](skills/prestashop/SKILL.md)** | PrestaShop 9 modules: module structure, hooks, front/admin controllers, modern configuration pages, services, persistence, external API integrations, cron/commands, packaging, compatibility, or release debugging. Prevents inventing framework classes, guessing hook contracts, or shipping fake Symfony/PrestaShop internals. |
| **[Python Async](skills/python-async/SKILL.md)** | Python async and concurrency — AnyIO, asyncio, Trio, task groups, cancel scopes, async testing, thread offloading, async streams, event-loop ownership, and uvloop. |
| **[Skill Creator](skills/skill-creator/SKILL.md)** | Meta-skill for creating, modifying, and benchmarking other skills — evals, variance analysis, and description optimization for triggering accuracy. |
| **[Tabler](skills/tabler/SKILL.md)** | Tabler UI component reference — CSS classes, variants, layout patterns, modals, plugins. Everything an agent needs to stop guessing class names. |

## Why this exists

AI coding assistants hallucinate API parameters, ignore framework conventions, and produce code that looks plausible until you actually run it. The standard response is to paste documentation into prompts and hope for the best.

These skills are a more structured attempt at the same losing battle. They give AI agents:

- **Critical rules** they will otherwise violate on every other generation
- **Gotcha lists** compiled from actual bugs, not theoretical edge cases
- **Reference maps** so they look things up instead of inventing things

Does it work? Sometimes. Better than without? Measurably. A reason for optimism? No.

Case in point: The agent messed up two times while creating this repo (deleting uncommited skill and README) to the point that I needed to hand it the solution scraped from the terminal with a spatula. And all I asked was to sanitize the contents. The irony is killing me...

## How to use

These skills are built for [OpenCode](https://github.com/opencode-ai/opencode) agents. Drop the skill directories into your OpenCode skills path and reference them in your agent configuration.

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

## The AGENTS.md and Anti-Sycophancy

The [AGENTS.md](AGENTS.md) file contains non-negotiable rules for any agent working in this context. It is not a suggestion. It is a technical constraint.

The most critical part is the **Hardline Review and Honesty Policy**. This clause is a countermeasure against the single most dangerous property of AI code assistants: the tendency to agree with the user even when the user is wrong. I have seen too much code fail because an AI was too "polite" to point out a flaw.

In this repo, disagreement is not a failure. Unearned agreement is.

## Contributing

If you have a framework skill worth sharing — one born from production pain, not tutorial optimism — contributions are welcome. The bar is: would this have prevented a real bug?

## License

[Unlicense](LICENSE) — public domain. Take what's useful. No attribution needed.
