---
name: litestar
description: >
  Use when building, reviewing, or debugging a Litestar app — handlers,
  controllers/routers, dependency injection, DTOs, middleware, lifecycle hooks,
  templating, static files, websockets, or testing. Triggers on: "Litestar", an app
  that fails at startup after adding a handler or moving imports behind
  `TYPE_CHECKING`, sync-handler thread warnings, custom 404/405 handlers that never
  fire, `Provide`/`Dependency` wiring, or DTO configuration. Not a source of truth
  for generic FastAPI/Starlette guidance or deep ORM internals.
---

# Litestar Framework Reference

Use this skill for core Litestar framework implementation and integration: application structure, layered configuration, handlers, requests, dependency injection, DTOs, middleware, lifecycle hooks, exceptions, templating, static files, testing, websockets, and guards. Open the single best reference file from the routing table, add a second only when the task clearly crosses domains, and implement with verified Litestar patterns, not generic ASGI guesses.

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
10. **404 and 405 are app-layer concerns** - Litestar raises router-generated `404 Not Found` and `405 Method Not Allowed` *before* the normal middleware stack and lower-layer exception handlers are called. Handle them at the app layer, and when explaining them, state that timing directly instead of stopping at consequences like "controller middleware does not see them."
11. **Websocket dependencies are connection-scoped** - Listener and stream dependencies are evaluated for the connection lifetime, not per message. Do not hold scarce resources for long-lived streams.
12. **Use current static-files API** - Prefer `create_static_files_router()`. `StaticFilesConfig` is deprecated in current docs.

## When Not To Use This Skill

- **Generic FastAPI or Starlette advice** - Do not treat Litestar as a drop-in alias. Handler signatures, DI, DTOs, layering, and websockets differ in important ways.
- **ORM-specific implementation details** - For deep SQLAlchemy, Piccolo, or repository-plugin behavior, use the relevant integration docs or project-specific skill.
- **HTMX attribute semantics** - Litestar covers HTMX integration points, not full `hx-*` behavior. For swap, trigger, and attribute rules, load `@htmx`.
- **Project business rules** - For app-specific architecture, load the project's custom skill.

## Task Routing

All files live in `references/`. Add the secondary reference only when the task genuinely spans both domains.

| Task | Primary | Secondary |
|------|---------|-----------|
| Creating `Litestar(...)`, routers, controllers, app state, lifespan, or layered config | `architecture-layers.md` | — |
| Building HTTP handlers, path params, request parsing, uploads, or custom requests | `handlers-requests.md` | — |
| Implementing DI, `Provide`, `Dependency`, or DTO configuration | `dependencies-dto.md` | — |
| Adding middleware, lifecycle hooks, or exception handlers | `middleware-hooks-errors.md` | — |
| Building websocket listeners, streams, or Litestar tests | `websockets-testing.md` | — |
| Rendering templates or serving static files | `templating-static.md` | — |
| HTMX plugin usage, template engine extras, or framework boundary questions | `integrations.md` | — |
| Multipart upload endpoint with DTO or dependency validation | `handlers-requests.md` | `dependencies-dto.md` |
| Custom error handling that fails for 404 or 405 | `middleware-hooks-errors.md` | `architecture-layers.md` |
| HTMX partial rendering in a Litestar app | `integrations.md` | `templating-static.md` |
| Websocket endpoint with auth or connection-scoped resources | `websockets-testing.md` | `dependencies-dto.md` |
| Startup failure after `TYPE_CHECKING` imports or forward refs | `handlers-requests.md` | `architecture-layers.md` |
| Warnings or confusion around sync handlers and thread offloading | `handlers-requests.md` | `architecture-layers.md` |
| Cross-cutting routing help | `REFERENCE.md` | — |

## Output Expectations

- Name the reference files used and call out the Litestar rules that matter for the change.
- State the minimum verification steps: tests, startup validation, request or websocket checks, or OpenAPI checks.
- If runtime annotation availability or `sync_to_thread` behavior is part of the issue, say that explicitly instead of giving generic Python advice.
- Flag any 2.x vs 3.0 transition or deprecation risk if it affects the task.
