---
name: django-discipline
description: >
  Mandatory Django workflow enforcement. Use when working in any Django project.
  Enforces: migrations (always run makemigrations first), ORM queries (select_related,
  prefetch_related, distinct()), imports (PEP 562 lazy __getattr__, # Circular import:
  comments), linting (ruff check --fix), and model changes. Overrides default Python
  patterns with Django conventions. Triggers on: "Django project", "manage.py exists",
  "pyproject.toml contains django", "requirements.txt contains django", or when any
  code is created/modified in a Django project. This is the DISCIPLINE skill — for
  framework reference (patterns, gotchas, internals), use django instead.
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-06-23
source_basis: production experience
---

# Django Discipline

## STOP — Read This Before Writing Any Django Code

This skill is **mandatory** for all Django project work. If you are about to create, modify, or fix code in a Django project — stop here and follow this checklist. These rules exist because agents consistently get them wrong.

**You are rationalizing if you think:**

| Excuse | Reality |
|--------|---------|
| "I'll just write the migration quickly by hand" | Manual migrations miss dependency chains and break migration graphs. Run `makemigrations` first. |
| "I'll fix the lint issues manually" | `ruff check --fix` handles 90% of lint issues in one shot. Run it before manual cleanup. |
| "I know Django, I don't need this" | That's exactly the attitude that produces N+1 queries and broken migration chains. Follow the checklist. |
| "This is a simple model change, no need for `makemigrations`" | There is no simple model change. Run `makemigrations`. Always. |
| "I'll add `select_related` later if it's slow" | You won't. The N+1 ships to production. Add it now. |

## Detection

You are in a Django project if:
- `manage.py` exists in the project root, OR
- `pyproject.toml` / `requirements.txt` contains `django`

When either is true, this checklist applies to **all** code you write or modify.

## Django Workflow Checklist

Follow these in order. Every item is mandatory.

### 1. Migrations — Always Auto-Generate First

```bash
python manage.py makemigrations
```

- **NEVER** write migration files by hand unless you need `RunPython`, `RunSQL`, or custom `AlterField` with data transforms.
- If you need `RunPython`/`RunSQL`: run `makemigrations` first to get the skeleton, then inject your custom code into the generated file.
- After creating migrations, verify with `python manage.py migrate --check` (or run migrations if the project is set up for it).
- If `makemigrations` detects no changes but you modified a model, **stop and investigate** — your model change may not be registered.

### 2. Linting — Ruff Before Manual Cleanup

```bash
ruff check --fix && ruff format
```

- Run this **after** every code change, before any manual lint cleanup.
- Only fix what ruff can't auto-fix yourself.
- Do NOT run `isort`, `black`, `flake8`, or `autoflake` separately — ruff subsumes all of them.
- Do NOT manually remove unused imports, fix formatting, or sort imports that ruff handles.

### 3. ORM — Prevent N+1 Queries

- **ForeignKey / OneToOne**: always use `.select_related("field")`
- **ManyToMany / reverse FK**: always use `.prefetch_related("field")`
- **M2M or reverse FK filtering**: always append `.distinct()` to avoid duplicate rows
- **Never** access related objects in a loop without eager loading

```python
# ❌ Bad: N+1 queries
for order in Order.objects.all():
    print(order.user.email)

# ✅ Good: single query with join
for order in Order.objects.select_related("user"):
    print(order.user.email)
```

### 4. Imports — Public API Only

- Import from the public interface: `from apps.context import Symbol`
- **Never** import from internal modules: `from apps.context.models import Symbol`
- For circular imports: use deferred imports inside functions with `# Circular import: <reason>` comment, or PEP 562 lazy `__getattr__` in `__init__.py`

### 5. Model Changes — Grep Before Renaming

Before renaming any model field:
- Grep the entire codebase for the field name: views, serializers, forms, templates, test fixtures, factories, admin, services
- Update **all** references, not just the model definition
- Run `makemigrations` after the rename

### 6. Testing — Django-Specific Patterns

- Use `update_or_create()` in test fixtures to avoid unique constraint violations
- Use `Sequence` for unique fields in tests, not `django_get_or_create`
- Prefix test-only settings with `TEST_` to avoid collisions with seed/migration data
- For E2E tests: navigate via UI clicks, not `page.goto(url)`

### 7. Settings — WhiteNoise Ordering

If using WhiteNoise: `WhiteNoiseMiddleware` must be **second** in `MIDDLEWARE`, directly after `SecurityMiddleware`.

## Adjacent Tools

- **Celery**: Load the `celery` skill for task patterns
- **DRF**: Load the `drf` skill for API patterns
- **django-debug-toolbar**: Dev-only. Never ship to production. Verify `INTERNAL_IPS` is set.
- **Reference patterns** (model fields, views, templates, forms, admin, auth, middleware): Load the `django` skill

## Enforcement

Every item in the checklist traces to a real production bug. If you skip a step, you are introducing risk that has already bitten this project. Follow the checklist.

### pytest Settings Module Verification

**Before running pytest**, verify `pyproject.toml` points to test settings:

```toml
# pyproject.toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "config.settings_test"  # NOT config.settings
```

If it points to `config.settings`, E2E tests will hit production CSP, CSRF middleware, and database — causing auth failures, origin-check errors, and data pollution. Test settings must:

- Disable/remove CSRF middleware (`CsrfViewMiddleware`)
- Add `http://127.0.0.1` to `CSRF_TRUSTED_ORIGINS` and `ALLOWED_HOSTS`
- Relax CSP directives for test environment
- Use SQLite in-memory or temp file
- Set `DEBUG = True` (allows CSRF middleware to bypass origin check)

Run `pytest --collect-only` to verify the correct settings module loads before committing to a full test run.
