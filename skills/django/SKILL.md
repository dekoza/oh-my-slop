---
name: django
description: "Use when tasks involve Django models, views, URLs, templates, forms, admin, auth, middleware, signals, settings, testing, or project architecture. Covers Django 6.0 framework patterns, gotchas, and internals."
---

# Django 6.0 Framework Reference

Use this skill for Django 6.0 framework implementation and integration. Django is a high-level Python web framework that encourages rapid development and clean, pragmatic design. This skill covers the core framework patterns, ORM, views, templates, forms, admin, authentication, testing, and internal architecture. Read only the reference files needed for the task.

## Quick Start

1. Identify the domain of the task (models, views, URLs, templates, forms, admin, auth, testing, or architecture).
2. Open the matching file from `references/`.
3. Implement using Django conventions and best practices for version 6.0.
4. Validate using Django's testing framework and ensure migrations are included.

## Critical Rules

1. **Model field verification** - Always read the actual model definition before writing queries or test fixtures. Do not guess field names.
2. **select_related/prefetch_related** - Use `.select_related()` for FK and `.prefetch_related()` for M2M to prevent N+1 queries. This is the #1 Django performance bug.
3. **distinct() after M2M filtering** - Always call `.distinct()` after filtering through M2M or reverse FK relations to prevent duplicate rows.
4. **auto_now=True bypass** - Fields with `auto_now=True` cannot be set via `.save()`. Use `.objects.filter().update(field=value)` to override.
5. **TemplateResponse for deferred rendering** - Use `TemplateResponse` when middleware must inspect or modify template context after the view returns (e.g., injecting user data, modifying variables). Use `render()` for simple views where context is final and no middleware interaction is needed.
6. **URL patterns are hierarchical** - Child URLconf should NOT repeat parent prefix. Catch-all patterns (`path("")`) must be LAST in `urlpatterns`.
7. **Circular import prevention** - Use PEP 562 lazy `__getattr__` in `__init__.py` or place deferred imports inside functions with `# Circular import:` comments.
8. **Cross-context imports via public API** - Import from public interface (`from apps.context import Symbol`), never from internal modules (`from apps.context.models import Symbol`).
9. **Test fixtures and migrations** - Check model constraints and field types before writing test fixtures. Use `update_or_create()` to avoid unique constraint violations.
10. **Form validation at the model level** - Django forms inherit model validation. Always define custom validation in model `clean()` and form `clean_*()` methods.

## Django Web Development Defaults

- Primary web framework context: **Django** with templates/partials as the default rendering approach.
- Keep HTML generation in templates whenever possible; avoid embedding large markup strings in Python code.

## Template and Rendering Boundaries

- **Inline HTML in Python is last resort only** and must stay minimal.
- Readability limit: do not exceed ~60 characters (hard max: 66) of inline HTML **total per indentation block**.
- If markup grows beyond that threshold, move it into a Django template/include/partial.

## Backend Partials and HTMX Mindset

- Prefer backend-rendered components (django-partials style).
- Default composition path in Django: templates + includes/partials/macros.
- Keep the HTMX paradigm: server renders HTML fragments, frontend JS remains minimal.
- Use partials/includes/macros to reduce duplication and keep presentation logic out of Python.

## Additional Django Pitfalls

- **Model field rename safety**: when renaming model fields, grep all usages across views, services, serializers, forms, templates, test fixtures, factories, and admin.
- **WhiteNoise ordering**: `WhiteNoiseMiddleware` must be second in `MIDDLEWARE`, directly after `SecurityMiddleware`.
- **JSON in TextField**: values stored in `TextField` are strings; call `json.loads()` before dictionary-style access.

## Django Testing Guardrails

- Avoid `factory_boy` `django_get_or_create` in uniqueness tests; use `Sequence` for guaranteed unique values.
- Use test-only prefixes (for example `TEST_xxx`) to avoid collisions with seed or migration data.

## Playwright + Django E2E Pitfalls

- Prevent redirect loops: when `live_server` fixture is used, always navigate with `live_server.url`.
- Ensure navigation target is explicit: missing `base_url`/`live_server.url` can silently route tests to localhost and fail.
- Static assets are not automatically served by Django `live_server`; configure static handling for test runs.
- If static assets are required, run `manage.py collectstatic --noinput` before launching browser E2E tests.
- Fallback when browser E2E is unavailable: cover flow behavior with Django test client integration tests (or `httpx` transport where appropriate).

## Reference Map

| File | Domain | Patterns |
|------|--------|----------|
| models-orm.md | Models & ORM | 25 |
| views-urls.md | Views & URLs | 24 |
| templates.md | Templates | 21 |
| forms-validation.md | Forms & Validation | 21 |
| admin.md | Admin | 18 |
| auth-security.md | Auth & Security | 16 |
| settings-config.md | Settings & Config | 16 |
| testing.md | Testing | 17 |
| middleware-signals.md | Middleware & Signals | 18 |
| architecture.md | Architecture | 20 |
| async-tasks.md | Async & Tasks | 16 |
| django6-new.md | Django 6.0 Features | 14 |
| internals.md | Internals | 10 |

## Task Routing

- **Defining models, querysets, migrations, or ORM optimization** -> `references/models-orm.md`
- **Building views, URL routing, or class-based views** -> `references/views-urls.md`
- **Creating or extending templates** -> `references/templates.md`
- **Building forms, validation, or form rendering** -> `references/forms-validation.md`
- **Customizing Django admin** -> `references/admin.md`
- **Authentication, permissions, or security patterns** -> `references/auth-security.md`
- **Settings, configuration, or environment-specific setup** -> `references/settings-config.md`
- **Writing tests (unit, integration, or E2E)** -> `references/testing.md`
- **Middleware, signals, or request/response cycle** -> `references/middleware-signals.md`
- **Project structure, patterns, or architectural decisions** -> `references/architecture.md`
- **Async views, tasks, celery, or background jobs** -> `references/async-tasks.md`
- **Django 6.0 new features or deprecations** -> `references/django6-new.md`
- **Django internals, metaprogramming, or deep framework behavior** -> `references/internals.md`

