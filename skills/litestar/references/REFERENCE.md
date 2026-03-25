---
domain: reference-index
category: documentation
priority: high
---

# Litestar Reference Index

Use this index to pick the smallest Litestar reference file that matches the task. Start with one file, add a second only when the task clearly crosses domains, and keep generic FastAPI or Starlette assumptions out of scope.

## Route Elsewhere

- Generic `hx-*` attribute semantics, swap rules, trigger syntax, or HTMX architecture -> use `@htmx`
- Deep SQLAlchemy, Piccolo, repository, or ORM plugin details -> use the relevant integration docs or project skill
- Project business rules, domain models, or workflow constraints -> use the project's custom skill
- Generic ASGI advice that is not Litestar-specific -> do not use this skill as the only source of truth

## Reference Guides

| Domain | File | Use For |
|---|---|---|
| App Structure & Layering | `references/architecture-layers.md` | `Litestar(...)`, routers/controllers, app state, lifespan, layered precedence, guards |
| Handlers & Requests | `references/handlers-requests.md` | HTTP handlers, semantic decorators, reserved kwargs, request bodies, uploads, custom requests |
| Dependencies & DTOs | `references/dependencies-dto.md` | `Provide`, `Dependency`, yield cleanup, validation, DTO layering, return DTOs |
| Middleware, Hooks & Errors | `references/middleware-hooks-errors.md` | middleware order, lifecycle hooks, exception handlers, 404/405 behavior |
| Websockets & Testing | `references/websockets-testing.md` | websocket APIs, connection-scoped DI, stream pitfalls, test clients, subprocess clients |
| Templates & Static Files | `references/templating-static.md` | `TemplateConfig`, `Template`, CSRF input, static routers, static URL generation |
| Integrations & Boundaries | `references/integrations.md` | HTMX plugin surface, template-engine extras, plugin boundaries, version-aware cautions |

## Common Task Routing

1. Identify the primary domain.
2. Open the single best matching reference file.
3. Add a second file only when the task crosses domains.
4. State which references you used and what must be verified.

- Creating an app, router tree, controller, or lifespan setup -> read `references/architecture-layers.md`
- Writing or fixing handlers, parameters, or request parsing -> read `references/handlers-requests.md`
- Adding dependencies, `Provide`, `Dependency`, or DTOs -> read `references/dependencies-dto.md`
- Building middleware, exception handlers, or lifecycle hooks -> read `references/middleware-hooks-errors.md`
- Writing websocket listeners, streams, or Litestar tests -> read `references/websockets-testing.md`
- Rendering templates or serving static assets -> read `references/templating-static.md`
- Adding HTMX support or deciding framework boundaries -> read `references/integrations.md`

- Multipart upload bug with validation or DTOs -> read `references/handlers-requests.md` and `references/dependencies-dto.md`
- 404/405 handler not firing -> read `references/middleware-hooks-errors.md` and `references/architecture-layers.md`
- Long-lived websocket stream holding DB resources -> read `references/websockets-testing.md` and `references/dependencies-dto.md`

## Suggested Reading Order

1. Start with this file.
2. Open one domain file for the immediate task.
3. Open additional files only when cross-domain integration is required.
4. When answering, name the references used and call out tests, startup checks, or deprecation risks.
