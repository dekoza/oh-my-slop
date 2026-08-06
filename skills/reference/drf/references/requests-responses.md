---
domain: requests-responses
category: reference
priority: high
---

# DRF Requests, Responses, Exceptions & Status Codes Reference

Use when working with DRF Request/Response objects, exception handling, or status code selection.

### 1. Request Object

**DRF `Request` wraps Django `HttpRequest` via composition (NOT inheritance) — it adds parsed body, auth, and content negotiation.**

```python
from rest_framework.request import Request
```

Parsing properties:
| Property | Description |
|----------|-------------|
| `.data` | Parsed body — all methods, all content types. Replaces `request.POST` + `request.FILES` |
| `.query_params` | Alias for `request.GET`. Use for clarity |
| `.parsers` | List of `Parser` instances (auto-set from view) |

Authentication properties:
| Property | Description |
|----------|-------------|
| `.user` | `User` instance or `AnonymousUser` (lazy — triggers auth on first access) |
| `.auth` | Auth context (e.g., `Token` instance) or `None` |
| `.authenticators` | List of `Authentication` instances |

Content negotiation properties:
| Property | Description |
|----------|-------------|
| `.accepted_renderer` | Renderer instance selected by negotiation |
| `.accepted_media_type` | Media type string accepted by negotiation |

Browser enhancement properties:
| Property | Description |
|----------|-------------|
| `.method` | Uppercased HTTP method. Supports browser `PUT`/`PATCH`/`DELETE` via form method override |
| `.content_type` | Media type string of request body, or empty string |
| `.stream` | Stream representing request body |

Standard `HttpRequest` access: `request.META`, `request.session`, `request.COOKIES`, etc. are all available directly.

**Warning:** `WrappedAttributeError` is raised when `.user` or `.auth` access fails due to an authenticator's internal `AttributeError` — the real cause is in the authenticator, not DRF. Malformed body → `ParseError` (400). Unknown content type → `UnsupportedMediaType` (415).

### 2. Response Object

**`Response` takes serialized data and renders it based on content negotiation — never pass raw serializer instances.**

```python
from rest_framework.response import Response
from rest_framework import status

Response(data, status=None, template_name=None, headers=None, content_type=None)
```

| Argument | Default | Description |
|----------|---------|-------------|
| `data` | (required) | Serialized (primitive) data — NOT a `Serializer` instance |
| `status` | `200` | HTTP status code |
| `template_name` | `None` | For `HTMLRenderer` |
| `headers` | `None` | Dict of HTTP headers |
| `content_type` | `None` | Usually set by renderer automatically |

Response attributes:
| Attribute | Description |
|-----------|-------------|
| `.data` | Unrendered serialized data |
| `.status_code` | Numeric HTTP status |
| `.content` | Rendered content (`.render()` must be called first) |
| `.accepted_renderer` | Renderer that will render response (auto-set) |
| `.accepted_media_type` | Media type from negotiation (auto-set) |
| `.renderer_context` | Dict passed to renderer's `.render()` (auto-set) |

Setting headers:
```python
response = Response(data)
response['Cache-Control'] = 'no-cache'
```

**Warning:** `Response` raises `AssertionError` if you pass a `Serializer` instance as `data` — always pass `serializer.data` instead.

### 3. Exception Hierarchy

**DRF catches `APIException` subclasses, Django's `Http404`, and Django's `PermissionDenied` — everything else becomes 500.**

| Class | Status | Signature | Notes |
|-------|--------|-----------|-------|
| `APIException` | varies | `()` | Base. Set `.status_code`, `.default_detail`, `.default_code` |
| `ParseError` | 400 | `(detail=None, code=None)` | Malformed request data |
| `AuthenticationFailed` | 401/403 | `(detail=None, code=None)` | Bad credentials |
| `NotAuthenticated` | 401/403 | `(detail=None, code=None)` | No credentials provided |
| `PermissionDenied` | 403 | `(detail=None, code=None)` | Authenticated but denied |
| `NotFound` | 404 | `(detail=None, code=None)` | Equivalent to Django `Http404` |
| `MethodNotAllowed` | 405 | `(method, detail=None, code=None)` | HTTP method not supported |
| `NotAcceptable` | 406 | `(detail=None, code=None)` | No renderer for Accept header |
| `UnsupportedMediaType` | 415 | `(media_type, detail=None, code=None)` | No parser for Content-Type |
| `Throttled` | 429 | `(wait=None, detail=None, code=None)` | Rate limit exceeded |
| `ValidationError` | 400 | `(detail=None, code=None)` | `detail` can be list/dict/nested |

Inspecting exceptions:
```python
exc.detail              # textual description (string/list/dict)
exc.get_codes()         # code identifier
exc.get_full_details()  # {'message': ..., 'code': ...}
```

### 4. ValidationError Conventions

**Use `serializers.ValidationError` — not Django's `django.core.exceptions.ValidationError`.**

```python
from rest_framework import serializers

# Field-level error
raise serializers.ValidationError("Must be positive.")

# Dict for field-level errors
raise serializers.ValidationError({'name': 'Required', 'email': 'Invalid format'})

# Non-field errors use NON_FIELD_ERRORS_KEY (default 'non_field_errors')
raise serializers.ValidationError("Order total exceeds limit.")
```

Generic views call `serializer.is_valid(raise_exception=True)` automatically — `ValidationError` is raised and caught by the exception handler, producing a 400 response.

**Warning:** If you call `is_valid()` WITHOUT `raise_exception=True` and manually return `Response(serializer.errors, status=400)`, the custom exception handler is bypassed — that response is not an exception. Always use `raise_exception=True` (or raise `ValidationError` explicitly) to ensure the exception handler processes all validation errors.

### 5. Custom Exception Handler

**Override the global exception handler for consistent error response formats.**

```python
# settings.py
REST_FRAMEWORK = {
    'EXCEPTION_HANDLER': 'myapp.utils.custom_exception_handler'
}

# myapp/utils.py
from rest_framework.views import exception_handler

def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        response.data['status_code'] = response.status_code
    return response  # return None → Django default 500 handling
```

`context` dict includes `view`, `args`, `kwargs`, `request`.

Per-view override:
```python
class MyView(APIView):
    def get_exception_handler(self):
        return my_custom_handler
```

### 6. Custom APIException

**Subclass `APIException` for domain-specific error responses.**

```python
from rest_framework.exceptions import APIException

class ServiceUnavailable(APIException):
    status_code = 503
    default_detail = 'Service temporarily unavailable, try again later.'
    default_code = 'service_unavailable'
```

### 7. Generic Error Views

**Replace Django's default HTML error pages with JSON responses.**

```python
# urls.py
handler400 = 'rest_framework.exceptions.bad_request'
handler500 = 'rest_framework.exceptions.server_error'
```

### 8. Status Code Constants

**Use named constants from `rest_framework.status` — never bare integers.**

```python
from rest_framework import status

status.HTTP_200_OK
status.HTTP_201_CREATED
status.HTTP_204_NO_CONTENT
status.HTTP_400_BAD_REQUEST
status.HTTP_401_UNAUTHORIZED
status.HTTP_403_FORBIDDEN
status.HTTP_404_NOT_FOUND
status.HTTP_405_METHOD_NOT_ALLOWED
status.HTTP_429_TOO_MANY_REQUESTS
```

Helpers (module-level functions — pass the status code as argument):
```python
status.is_informational(code)  # 1xx
status.is_success(code)        # 2xx
status.is_redirect(code)       # 3xx
status.is_client_error(code)   # 4xx
status.is_server_error(code)   # 5xx
```

| Constant | Code | Typical DRF Usage |
|----------|------|-------------------|
| `HTTP_200_OK` | 200 | Default response, list, retrieve |
| `HTTP_201_CREATED` | 201 | `CreateModelMixin` success |
| `HTTP_204_NO_CONTENT` | 204 | `DestroyModelMixin` success |
| `HTTP_400_BAD_REQUEST` | 400 | Validation error, parse error |
| `HTTP_401_UNAUTHORIZED` | 401 | Unauthenticated (with `WWW-Authenticate`) |
| `HTTP_403_FORBIDDEN` | 403 | Permission denied |
| `HTTP_404_NOT_FOUND` | 404 | Object not found |
| `HTTP_405_METHOD_NOT_ALLOWED` | 405 | HTTP method not supported |
| `HTTP_429_TOO_MANY_REQUESTS` | 429 | Throttled |

**Warning:** `is_informational()`, `is_success()`, etc. are module-level functions, not methods on status code integers. Call them as `status.is_success(code)` — but note these are documented in the DRF codebase; in practice most code just compares `response.status_code` directly.
