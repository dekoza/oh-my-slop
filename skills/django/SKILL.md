---
name: django
description: >
  Use when working with Django code — looking up ORM, view, template, form, admin,
  auth, settings, testing, or async patterns, or debugging Django-specific behavior.
  Triggers on: "Django", "manage.py", "models.py", "ORM", "migration", "template
  tag", "Django admin", or any file inside a Django project layout. This is the
  reference skill — the mandatory workflow checklist lives in django-discipline.
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: production experience
---

# Django 6.0 Framework Reference

Route the task to the matching reference file below and read only what the task needs. Workflow enforcement — migrations, linting, N+1 prevention, import discipline, rename safety, testing guardrails — lives solely in the `django-discipline` skill, which applies to every change in a Django project alongside this reference.

## Critical Gotchas

1. **Model field verification** — Read the actual model definition before writing queries or test fixtures. Do not guess field names.
2. **auto_now=True bypass** — Fields with `auto_now=True` cannot be set via `.save()`. Use `.objects.filter().update(field=value)` to override.
3. **TemplateResponse for deferred rendering** — Use `TemplateResponse` when middleware must inspect or modify template context after the view returns. Use `render()` for simple views where context is final.
4. **URL patterns are hierarchical** — Child URLconf should NOT repeat the parent prefix. Catch-all patterns (`path("")`) must be LAST in `urlpatterns`.
5. **Template tags don't work in static files** — `{{ var|safe }}` and `{% url ... %}` are NOT processed in external `.js` / `.css` files — they're served as static assets. Solutions: inline `<script>` config block, data attributes on DOM elements, or a JSON endpoint view.
6. **JSON traps** — Values stored in `TextField` are strings; call `json.loads()` before dictionary-style access. Django renders Python lists in templates as `[\'item\']` (single quotes); use `json.dumps()` in the view context for valid JS/JSON.
7. **Templates own markup** — Inline HTML in Python is last resort and stays under ~60 characters (hard max 66) per indentation block; beyond that, move it into a template/include/partial.
8. **Form validation at the model level** — Django forms inherit model validation. Define custom validation in model `clean()` and form `clean_*()` methods.

## Routing

| File | Use for |
|------|---------|
| `references/models-orm.md` | Defining models, querysets, migrations, ORM optimization |
| `references/views-urls.md` | Building views, URL routing, class-based views |
| `references/templates.md` | Creating or extending templates |
| `references/forms-validation.md` | Building forms, validation, form rendering |
| `references/admin.md` | Customizing Django admin |
| `references/auth-security.md` | Authentication, permissions, security patterns |
| `references/settings-config.md` | Settings, configuration, environment-specific setup |
| `references/testing.md` | Writing tests (unit, integration, or E2E — includes Playwright/live_server pitfalls) |
| `references/middleware-signals.md` | Middleware, signals, request/response cycle |
| `references/architecture.md` | Project structure, patterns, architectural decisions |
| `references/async-tasks.md` | Async views, tasks, celery, background jobs |
| `references/django6-new.md` | Django 6.0 new features and deprecations |
| `references/internals.md` | Django internals, metaprogramming, deep framework behavior |
