---
name: drf
description: >
  Use when building, securing, or fixing REST APIs with Django REST Framework
  (anything importing rest_framework). Triggers on: "DRF", "serializer",
  "ViewSet", "APIView", "router", "permission classes", "throttling",
  "pagination". Not for pure Django ORM/template/form/admin work — use django
  for those.
---

# Django REST Framework Reference

Use this skill for DRF API implementation: serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, testing, and configuration. Apply the critical rules below, then route to the reference files the task needs.

## Critical Rules

1. **`fields` or `exclude` is mandatory** — Since v3.3.0, `ModelSerializer.Meta` MUST declare `fields` or `exclude`. Omitting both raises `ImproperlyConfigured`.
2. **Writable nested representations require explicit code** — `ModelSerializer.create()` and `.update()` do NOT support writable nested serializers by default. You must override these methods.
3. **Reverse relations are NOT auto-included** — `ModelSerializer` and `HyperlinkedModelSerializer` do not include reverse FK/M2M fields. Add them explicitly to `fields`.
4. **M2M with `through` model defaults to read-only** — Relational fields targeting `ManyToManyField` with a `through` model are automatically `read_only=True`.
5. **Object-level permissions skip creation** — `has_object_permission()` is NOT called during object creation (POST). Restrict creation in `perform_create()` or the serializer.
6. **Permission composition precedence** — `~` highest, then `&`, then `|`. Use parentheses to be explicit.
7. **`HiddenField` disappears in partial updates** — `HiddenField()` does not appear in `partial=True` serializers (PATCH requests).
8. **`UniqueTogetherValidator` treats fields as required** — All fields in a `UniqueTogetherValidator` are implicitly `required=True`, except those with `default` values.
9. **ViewSet `action` unavailable in early methods** — `self.action` is NOT set when `get_parsers`, `get_authenticators`, or `get_content_negotiator` are called.
10. **No trailing slash in router `register()` prefix** — Routers append slashes automatically. `router.register(r'users', ...)` not `r'users/'`.
11. **Throttling uses non-atomic cache operations** — Race conditions possible under high concurrency. Not a security measure against brute force.
12. **`CursorPagination` defaults to `-created` ordering** — Models MUST have a `created` field, or override the `ordering` attribute.
13. **`Request` uses composition, not inheritance** — DRF `Request` wraps Django `HttpRequest` via composition. Access standard attributes via `request.META`, `request.session` etc.
14. **`extra_kwargs` silently ignored for explicit fields** — If you declare a field on the serializer class AND have `extra_kwargs` for it, the `extra_kwargs` do nothing.
15. **Serializer relations cause N+1 queries** — Nested and related serializer fields fire one query per object during list serialization. Pair every list-returning view with `select_related`/`prefetch_related` on its queryset (django-discipline's ORM rule applies to DRF views too).

## When Not To Use This Skill

- **Pure Django ORM/views/templates** — Load `django` for models, querysets, template rendering, forms, admin, or middleware outside `rest_framework`.
- **FastAPI / Django Ninja APIs** — This skill is `rest_framework`-only; do not apply DRF patterns to other API frameworks.
- **HTMX interaction flows** — For partial rendering, swaps, triggers, load `htmx`.
- **Tabler UI work** — For Tabler components and CSS patterns, load `tabler`.
- **HTTP status code deep semantics** — For 400 vs 422, 401 vs 403, redirect codes, load `http-status-codes`.
- **Project-specific business rules** — Load the project's custom skill.

## Routing

Choose the primary reference; add one secondary reference only when the task clearly crosses domains. Keep the answer grounded in the reference files actually used.

**Single-domain** (one file):

| Use for | File |
|---------|------|
| Serializer hierarchy, field types, relations, validators, nested writes | `references/serializers-fields.md` |
| APIView, generics, mixins, viewsets, `@action`, routers | `references/views-viewsets.md` |
| Authentication, permissions, throttling | `references/auth-permissions.md` |
| Filter backends, search, ordering, pagination | `references/filtering-pagination.md` |
| Request, Response, exceptions, status codes | `references/requests-responses.md` |
| Parsers, renderers, negotiation, metadata | `references/parsers-renderers.md` |
| Test utilities, complete settings reference | `references/testing-settings.md` |
| Dispatch flow, parsing pipeline, versioning, schemas | `references/internals.md` |

**Cross-domain** (two files):

- Full CRUD API → `views-viewsets.md` + `serializers-fields.md`
- Secured API → `auth-permissions.md` + `views-viewsets.md`
- Filtered/paginated lists → `filtering-pagination.md` + `views-viewsets.md`
- Custom content handling → `parsers-renderers.md` + `requests-responses.md`
- Serializer with permissions → `serializers-fields.md` + `auth-permissions.md`

## Output Expectations

- Name the reference files used.
- State the minimum tests or verification steps.
- Call out the critical DRF rules applied.
