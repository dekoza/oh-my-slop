---
name: litestar
description: "Use when tasks involve core Litestar framework work: `Litestar(...)`, route handlers, controllers, routers, requests, dependency injection, DTOs, middleware, lifecycle hooks, exception handling, templating, static files, testing, websockets, or guards. Use this whenever the user is building or fixing Litestar apps, not just when they explicitly say 'Litestar'. Do not use as the source of truth for generic FastAPI or Starlette guidance, or for deep ORM-specific patterns outside Litestar's own framework surface."
---

# Litestar Framework Reference

Use this skill for core Litestar framework implementation and integration. It covers application structure, layered configuration, handlers, requests, dependency injection, DTOs, middleware, lifecycle hooks, exceptions, templating, static files, testing, websockets, and guards. Read only the reference files needed for the task.

## Quick Start

1. Identify the primary task domain: app structure, handlers, requests, DI, DTOs, middleware, errors, templates, testing, or websockets.
2. Open the single best matching file from `references/`.
3. Open a second reference only if the task clearly crosses domains.
4. Implement using verified Litestar patterns, not generic ASGI guesses.
5. State in the final answer which references you used and what tests or verification the change needs.

## When Not To Use This Skill

- **Generic FastAPI or Starlette advice** - Do not treat Litestar as a drop-in alias. Handler signatures, DI, DTOs, layering, and websockets differ in important ways.
- **ORM-specific implementation details** - For deep SQLAlchemy, Piccolo, or repository-plugin behavior, use the relevant integration docs or project-specific skill.
- **HTMX attribute semantics** - Litestar covers HTMX integration points, not full `hx-*` behavior. For swap, trigger, and attribute rules, load `@htmx`.
- **Project business rules** - For app-specific architecture, load the project's custom skill.

## Critical Rules

1. **Use semantic HTTP decorators** - Prefer `@get`, `@post`, `@put`, `@patch`, `@delete`, not `@route()`, unless multi-method handling is truly required.
2. **Annotate everything** - Litestar requires full argument and return type annotations for handlers. Missing annotations fail app startup.
3. **Keep runtime types available** - Handler and dependency annotations are inspected at runtime. `TYPE_CHECKING`-only imports can break signature parsing unless you provide `signature_types` or `signature_namespace`.
4. **Decide sync execution explicitly** - Synchronous handlers and dependencies should set `sync_to_thread=True` for blocking work or `False` for safe non-blocking work. Implicit sync raises warnings.
5. **Respect layer precedence** - For layered settings, the closest layer to the handler wins. Guards are the exception: they accumulate.
6. **Middleware order is deterministic** - Middleware executes app -> router -> controller -> handler, left to right within each layer.
7. **Dependency keys must match kwargs** - Dependency dictionary keys and injected parameter names must match exactly, and scope is limited to the declaring layer.
8. **Yield dependencies clean up before send** - Cleanup runs after the handler returns but before the HTTP response is sent. Cleanup failures are re-raised later as `ExceptionGroup`.
9. **Request body defaults to JSON** - For forms, multipart, or MessagePack, annotate `data` with `Body(media_type=...)`. File uploads should use `UploadFile`.
10. **404 and 405 are app-layer concerns** - Router-generated `404 Not Found` and `405 Method Not Allowed` happen before most middleware and lower-layer exception handlers. Handle them at the app layer.
11. **Websocket dependencies are connection-scoped** - Listener and stream dependencies are evaluated for the connection lifetime, not per message. Do not hold scarce resources for long-lived streams.
12. **Use current static-files API** - Prefer `create_static_files_router()`. `StaticFilesConfig` is deprecated in current docs.
13. **Say the timing nuance explicitly** - When explaining router-generated `404` / `405`, do not stop at consequences like "controller middleware does not see them." State directly that Litestar raises them before the normal middleware stack is called.
14. **Cite references in the final answer, not only in scratch work** - If the task asks for sources or the skill expects them, name the reference files in the answer itself.

## Reference Map

| File | Domain | Use For |
|------|--------|---------|
| architecture-layers.md | App Structure & Layering | `Litestar(...)`, routers/controllers, lifespan, state, layer precedence, guards |
| handlers-requests.md | Handlers & Requests | HTTP handlers, reserved kwargs, request bodies, uploads, reverse URLs, custom requests |
| dependencies-dto.md | Dependencies & DTOs | `Provide`, `Dependency`, yield cleanup, validation, DTO layering, return DTO behavior |
| middleware-hooks-errors.md | Middleware, Hooks & Errors | middleware factories, hook timing, exception handlers, 404/405 behavior |
| websockets-testing.md | Websockets & Testing | `websocket`, `websocket_listener`, `websocket_stream`, test clients, live server patterns |
| templating-static.md | Templates & Static Files | `TemplateConfig`, template responses, CSRF inputs, static routers, URL generation |
| integrations.md | Integrations & Boundaries | HTMX integration points, template-engine extras, plugin boundaries, version-aware cautions |
| REFERENCE.md | Cross-file Index | smallest-file routing, scope boundaries, and reading order |

## Task Routing

1. Choose the primary reference from the routes below.
2. Add one secondary reference only when the task clearly crosses domains.
3. Keep the answer grounded in the references actually used.
4. State whether tests, startup verification, or schema checks are needed.

- **Creating `Litestar(...)`, routers, controllers, app state, lifespan, or layered config** -> `references/architecture-layers.md`
- **Building HTTP handlers, path params, request parsing, uploads, or custom requests** -> `references/handlers-requests.md`
- **Implementing DI, `Provide`, `Dependency`, or DTO configuration** -> `references/dependencies-dto.md`
- **Adding middleware, lifecycle hooks, or exception handlers** -> `references/middleware-hooks-errors.md`
- **Building websocket listeners, streams, or Litestar tests** -> `references/websockets-testing.md`
- **Rendering templates or serving static files** -> `references/templating-static.md`
- **HTMX plugin usage, template engine extras, or framework boundary questions** -> `references/integrations.md`
- **Cross-cutting routing help** -> `references/REFERENCE.md`

- **Multipart upload endpoint with DTO or dependency validation** -> `references/handlers-requests.md` + `references/dependencies-dto.md`
- **Custom error handling that fails for 404 or 405** -> `references/middleware-hooks-errors.md` + `references/architecture-layers.md`
- **HTMX partial rendering in a Litestar app** -> `references/integrations.md` + `references/templating-static.md`
- **Websocket endpoint with auth or connection-scoped resources** -> `references/websockets-testing.md` + `references/dependencies-dto.md`
- **Startup failure after moving imports behind `TYPE_CHECKING` or using forward refs** -> `references/handlers-requests.md` + `references/architecture-layers.md`
- **Warnings or confusion around sync handlers and thread offloading** -> `references/handlers-requests.md` + `references/architecture-layers.md`

## Output Expectations

- Name the reference files used.
- Call out the Litestar rules that matter for the change.
- State the minimum verification steps: tests, startup validation, request or websocket checks, or OpenAPI checks.
- If runtime annotation availability or `sync_to_thread` behavior is part of the issue, say that explicitly instead of giving generic Python advice.
- For router-generated `404` / `405`, explicitly say they are raised before the normal middleware stack is called.
- Flag any 2.x vs 3.0 transition or deprecation risk if it affects the task.

Use a short closing line when it helps the answer stay anchored, for example:

- `References used: `references/handlers-requests.md`, `references/dependencies-dto.md``
- `References used: `references/middleware-hooks-errors.md`, `references/architecture-layers.md``

## Content Ownership

This skill owns core Litestar framework patterns: app structure, layering, handlers, requests, DI, DTOs, middleware, lifecycle hooks, exceptions, templating, static files, testing, guards, and websockets.

It does not own generic HTMX attribute semantics, deep ORM integration internals, or project-specific business architecture.
