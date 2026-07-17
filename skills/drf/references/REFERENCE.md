---
domain: reference-index
category: documentation
priority: high
---

# DRF Reference Index

Cross-file routing guide for Django REST Framework reference material.

## Route Elsewhere

These topics are NOT covered by the DRF skill:

- **Django ORM / models / migrations** → `@django`
- **Django views / templates / forms** → `@django`
- **Django admin** → `@django`
- **HTMX attributes / swap strategies** → `@htmx`
- **Tabler UI components** → `@tabler`
- **HTTP status code deep semantics** → `@http-status-codes`

## Reference Guides

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

## Common Task Routing

**Single-domain** (one file):
- Serializer work → `serializers-fields.md`
- View/router work → `views-viewsets.md`
- Auth/permission work → `auth-permissions.md`
- Filtering/pagination → `filtering-pagination.md`
- Request/response handling → `requests-responses.md`
- Parser/renderer customization → `parsers-renderers.md`
- Test writing → `testing-settings.md`
- Settings questions → `testing-settings.md`
- Internal hooks/debugging → `internals.md`

**Cross-domain** (two files):
- Full CRUD API → `views-viewsets.md` + `serializers-fields.md`
- Secured API → `auth-permissions.md` + `views-viewsets.md`
- Filtered/paginated lists → `filtering-pagination.md` + `views-viewsets.md`
- Custom content handling → `parsers-renderers.md` + `requests-responses.md`
- Serializer with permissions → `serializers-fields.md` + `auth-permissions.md`

## Suggested Reading Order

1. Start with `serializers-fields.md` — serializers are the heart of DRF
2. Then `views-viewsets.md` — how serializers connect to HTTP
3. Then `auth-permissions.md` — securing the API
4. Finally domain-specific files as needed
