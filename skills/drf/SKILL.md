---
name: drf
description: "Use when tasks involve Django REST Framework (DRF) work: building, securing, or fixing REST APIs powered by `rest_framework`. Covers serializers, fields, relations, validators, views (`APIView`, `@api_view`, generics, viewsets), routers, `@action`, authentication, permissions, throttling, filtering, pagination, parsers, renderers, content negotiation, versioning, testing (`APIClient`/`APIRequestFactory`), and `REST_FRAMEWORK` settings. Use this whenever the user is working with DRF APIs, not just when they explicitly say 'DRF'. Do not use for pure Django ORM, views, templates, forms, or admin work outside the REST framework surface."
---

# Django REST Framework Reference

Use this skill for DRF API implementation: serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, testing, and configuration. Read only the reference files needed for the task. For pure Django framework work (ORM, templates, forms, admin), load `@django` instead.

## Quick Start

1. Identify the primary domain of the task (serializers, views/viewsets, auth/permissions, filtering/pagination, requests/responses, parsers/renderers, testing/settings, or internals).
2. Open the single best-matching file from `references/`.
3. Open a second reference only if the task clearly crosses domains.
4. Implement using verified DRF patterns and include tests.
5. State which references you used and what tests or verification the change needs.

## When Not To Use This Skill

- **Pure Django ORM/views/templates** — Load `@django` for models, querysets, template rendering, forms, admin, or middleware outside `rest_framework`.
- **HTMX interaction flows** — For partial rendering, swaps, triggers, load `@django-htmx-tabler-knowledge`.
- **Tabler UI work** — For Tabler components and CSS patterns, load `@tabler`.
- **HTTP status code deep semantics** — For 400 vs 422, 401 vs 403, redirect codes, load `@http-status-codes`.
- **Project-specific business rules** — Load the project's custom skill.

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

## Reference Map

| File | Domain | Use For |
|------|--------|---------|
| `serializers-fields.md` | Serialization | Serializer hierarchy, field types, relations, validators, nested writes |
| `views-viewsets.md` | Views & Routing | APIView, generics, mixins, viewsets, @action, routers |
| `auth-permissions.md` | Security | Authentication, permissions, throttling |
| `filtering-pagination.md` | Query Control | Filter backends, search, ordering, pagination |
| `requests-responses.md` | HTTP Layer | Request, Response, exceptions, status codes |
| `parsers-renderers.md` | Content | Parsers, renderers, negotiation, metadata |
| `testing-settings.md` | Testing & Config | Test utilities, complete settings reference |
| `internals.md` | Deep Internals | Dispatch flow, parsing pipeline, versioning, schemas |

## Task Routing

1. Choose the primary reference from the routes below.
2. Add one secondary reference only when the task clearly crosses domains.
3. Keep the answer grounded in the reference files actually used.
4. State whether tests or verification checks are required.

**Single-domain** (one file):
- Serializer work → `references/serializers-fields.md`
- View/viewset/router work → `references/views-viewsets.md`
- Auth/permission/throttling work → `references/auth-permissions.md`
- Filtering/pagination → `references/filtering-pagination.md`
- Request/response/exception handling → `references/requests-responses.md`
- Parser/renderer customization → `references/parsers-renderers.md`
- Test writing or settings → `references/testing-settings.md`
- Internal hooks/debugging/versioning → `references/internals.md`

**Cross-domain** (two files):
- Full CRUD API → `views-viewsets.md` + `serializers-fields.md`
- Secured API → `auth-permissions.md` + `views-viewsets.md`
- Filtered/paginated lists → `filtering-pagination.md` + `views-viewsets.md`
- Custom content handling → `parsers-renderers.md` + `requests-responses.md`
- Serializer with permissions → `serializers-fields.md` + `auth-permissions.md`
- Serializer with permissions → `serializers-fields.md` + `auth-permissions.md`

## Output Expectations

- Name the reference files used.
- State the minimum tests or verification steps.
- Call out the critical DRF rules applied.

## Content Ownership

This skill owns DRF patterns: `rest_framework`, serializers, views, viewsets, routers, authentication, permissions, throttling, filtering, pagination, parsers, renderers, testing, versioning, and settings.

Pure Django ORM, views, URLs, templates, forms, admin, auth, middleware, signals, and project architecture are out of scope — load `@django` for those.

For HTMX integration patterns, load `@django-htmx-tabler-knowledge`. For Tabler UI components, load `@tabler`.
