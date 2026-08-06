---
domain: auth-permissions
category: reference
priority: high
---

# DRF Authentication, Permissions & Throttling Reference

Use when implementing authentication schemes, permission policies, access control, or rate limiting.

### 1. Authentication Flow

**Authentication runs first in the request lifecycle — it determines `request.user` and `request.auth` before permissions or throttling.**

1. Each class in `authentication_classes` is tried in order.
2. First successful auth sets `request.user` and `request.auth` — remaining classes are skipped.
3. If none authenticates: `request.user = AnonymousUser`, `request.auth = None`.
4. If any raises `AuthenticationFailed`: request is rejected immediately.

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        'rest_framework.authentication.BasicAuthentication',
    ]
}

# Per-view (replaces global, not additive)
class MyView(APIView):
    authentication_classes = [TokenAuthentication]

# FBV
@api_view(['GET'])
@authentication_classes([TokenAuthentication])
def my_view(request): ...
```

**Warning:** `SessionAuthentication` enforces CSRF for unsafe methods (POST/PUT/PATCH/DELETE). Anonymous requests can skip CSRF. This catches people who test with `APIClient` (CSRF disabled by default) but get 403 in the browser.

### 2. Built-in Authentication Classes

**Choose based on your client type — browser, mobile, or server-to-server.**

| Class | `request.user` | `request.auth` | Unauth Response | Key Requirement |
|-------|---------------|----------------|-----------------|-----------------|
| `BasicAuthentication` | `User` | `None` | 401 + `WWW-Authenticate: Basic` | HTTPS in production |
| `TokenAuthentication` | `User` | `Token` instance | 401 + `WWW-Authenticate: Token` | `rest_framework.authtoken` in `INSTALLED_APPS` + migrate |
| `SessionAuthentication` | `User` | `None` | 403 | CSRF required for unsafe methods |
| `RemoteUserAuthentication` | `User` | `None` | — | `RemoteUserBackend` in `AUTHENTICATION_BACKENDS` |

### 3. TokenAuthentication Setup

**The simplest token scheme — one token per user, stored in the database.**

1. Add `'rest_framework.authtoken'` to `INSTALLED_APPS`
2. Run `manage.py migrate`
3. Create tokens: `Token.objects.create(user=user)` or use `post_save` signal
4. Client sends: `Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b`
5. Built-in endpoint: `path('api-token-auth/', views.obtain_auth_token)`
6. CLI: `manage.py drf_create_token <username>` (regenerate with `-r`)

Custom keyword (e.g., `Bearer`):
```python
class BearerAuthentication(TokenAuthentication):
    keyword = 'Bearer'
```

**Warning:** DRF's built-in `TokenAuthentication` is one-token-per-user with no expiry. For production APIs with token rotation, expiry, or per-client tokens, use `django-rest-knox` or `djangorestframework-simplejwt`.

### 4. Custom Authentication

**Subclass `BaseAuthentication` for custom schemes — two methods control everything.**

```python
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

class APIKeyAuthentication(BaseAuthentication):
    def authenticate(self, request):
        api_key = request.META.get('HTTP_X_API_KEY')
        if not api_key:
            return None  # try next authenticator
        try:
            key_obj = APIKey.objects.select_related('user').get(key=api_key, is_active=True)
        except APIKey.DoesNotExist:
            raise AuthenticationFailed('Invalid API key.')
        return (key_obj.user, key_obj)  # (user, auth)

    def authenticate_header(self, request):
        return 'X-API-Key'  # triggers 401 instead of 403 for unauthenticated requests
```

- Return `None` → try next authenticator
- Return `(user, auth)` → set `request.user` and `request.auth`
- Raise `AuthenticationFailed` → reject immediately
- `authenticate_header()` → return `WWW-Authenticate` value. Without it, unauthenticated requests get 403 instead of 401.

### 5. 401 vs 403 Response Rules

**The response code depends on authentication state AND whether `WWW-Authenticate` is available.**

- **401**: unauthenticated + first auth class has `authenticate_header()` method returning a value
- **403**: authenticated but denied, OR unauthenticated + no `WWW-Authenticate` header available

Django 5.1+ `LoginRequiredMiddleware`: DRF views are automatically opted out. Use `DEFAULT_AUTHENTICATION_CLASSES` and `DEFAULT_PERMISSION_CLASSES` instead.

### 6. Permission Basics

**Permissions run after authentication — they decide whether the authenticated (or anonymous) user can access the resource.**

1. Each class in `permission_classes` is checked.
2. Any failure raises `PermissionDenied` (403) or `NotAuthenticated` (401).
3. Per-view `permission_classes` **replaces** global — it's not additive.

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated']
}
# Default if not specified: AllowAny

# Per-view
class MyView(APIView):
    permission_classes = [IsAuthenticated]
```

### 7. Built-in Permission Classes

**Most APIs need just `IsAuthenticated` — add complexity only when required.**

| Class | Allow If |
|-------|---------|
| `AllowAny` | Always |
| `IsAuthenticated` | `request.user` is authenticated |
| `IsAdminUser` | `request.user.is_staff` is `True` |
| `IsAuthenticatedOrReadOnly` | Authenticated OR safe method (GET/HEAD/OPTIONS) |
| `DjangoModelPermissions` | Authenticated + model `add`/`change`/`delete` perms. Requires `.queryset` |
| `DjangoModelPermissionsOrAnonReadOnly` | Same but allows anon read |
| `DjangoObjectPermissions` | Per-object perms via backend (e.g., django-guardian). Requires `.queryset`. Does NOT filter list views — use a filter backend like `DjangoObjectPermissionsFilter` for that |

### 8. Permission Composition

**Combine permissions with `|`, `&`, `~` operators — same precedence as Python logical operators.**

```python
permission_classes = [IsAuthenticated | ReadOnly]
permission_classes = [IsAdminUser & IsAuthenticated]
permission_classes = [~IsBlacklisted]
permission_classes = [(IsAdminUser | IsOwner) & IsAuthenticated]
```

Precedence: `~` > `&` > `|`. Use parentheses for clarity.

### 9. Object-Level Permissions

**Control access to individual objects — but only when explicitly triggered.**

- Run when `get_object()` is called (generic views do this automatically).
- Override `has_object_permission(self, request, view, obj)` to implement.
- **NOT called during object creation** (POST) — restrict in `perform_create()` or serializer.
- **NOT applied to list views** for performance — filter the queryset instead.
- In custom `APIView`, must call `self.check_object_permissions(request, obj)` manually.

```python
class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return True

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.owner == request.user
```

Set `message` attribute for custom error text. Set `code` for custom error code.

**Warning:** Object-level permissions are never called for list endpoints. To restrict list results, filter the queryset in `get_queryset()` based on `request.user`.

### 10. Access Restriction Summary

**Where each restriction mechanism applies across different actions.**

| Method | list | create | retrieve | update | destroy |
|--------|------|--------|----------|--------|---------|
| `queryset` / `get_queryset()` | filter | no | filter | filter | filter |
| `has_permission()` | yes | yes | yes | yes | yes |
| `has_object_permission()` | no | no | yes | yes | yes |
| `serializer_class` | per-item | per-item | per-item | per-item | no |

### 11. Throttling

**Rate limiting at the application level — not a security measure, but a fairness/cost control.**

```python
REST_FRAMEWORK = {
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/day',
        'user': '1000/day',
    }
}
```

Rate format: `'number/period'` — period uses first character: `s`econd, `m`inute, `h`our, `d`ay.

Built-in throttle classes:
| Class | Key Identification | Rate Source | Scope |
|-------|-------------------|-------------|-------|
| `AnonRateThrottle` | IP address | `rate` attr or `DEFAULT_THROTTLE_RATES['anon']` | `'anon'` |
| `UserRateThrottle` | User ID (authed) or IP (anon) | `rate` attr or `DEFAULT_THROTTLE_RATES['user']` | `'user'` |
| `ScopedRateThrottle` | User ID or IP + view's `throttle_scope` | `DEFAULT_THROTTLE_RATES[scope]` | View's `throttle_scope` attr |

Per-view/per-action override:
```python
class MyView(APIView):
    throttle_classes = [UserRateThrottle]

@action(detail=True, methods=['post'], throttle_classes=[UserRateThrottle])
def my_action(self, request, pk=None): ...
```

### 12. Burst + Sustained Throttle Pattern

**Apply multiple rate limits simultaneously — short bursts and long-term quotas.**

```python
class BurstRateThrottle(UserRateThrottle):
    scope = 'burst'

class SustainedRateThrottle(UserRateThrottle):
    scope = 'sustained'

# Settings
REST_FRAMEWORK = {
    'DEFAULT_THROTTLE_CLASSES': [
        'myapp.throttles.BurstRateThrottle',
        'myapp.throttles.SustainedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'burst': '60/min',
        'sustained': '1000/day',
    }
}
```

### 13. Client IP Identification

**Correct IP detection requires knowing your proxy chain.**

- Uses `X-Forwarded-For` header if present, otherwise `REMOTE_ADDR`.
- Set `NUM_PROXIES` (integer) to extract correct IP from `X-Forwarded-For` behind proxies.
- All clients behind same NAT gateway = single client from throttle's perspective.

### 14. Custom Throttle

**Subclass `BaseThrottle` for non-standard rate limiting logic.**

```python
from rest_framework.throttling import BaseThrottle

class TenPerMinuteThrottle(BaseThrottle):
    def allow_request(self, request, view):
        # return True to allow, False to deny
        ...

    def wait(self):
        # return seconds to wait, or None
        ...
```

Custom cache backend:
```python
from django.core.cache import caches

class CustomAnonRateThrottle(AnonRateThrottle):
    cache = caches['alternate']
```

**Warning:** Throttling uses non-atomic cache operations — race conditions possible under high concurrency. Uses Django cache backend (`LocMemCache` by default). Not suitable as a security measure against brute-force attacks.

### 15. Third-Party Auth Packages

**For production APIs, third-party packages provide features DRF's built-in auth lacks.**

- **django-rest-knox** — per-client tokens, server-enforced logout, token expiry
- **Django OAuth Toolkit** — OAuth 2.0 (recommended for third-party API access)
- **djangorestframework-simplejwt** — JWT authentication
- **dj-rest-auth** — registration, login, social auth endpoints
- **Djoser** — registration, login, password reset views
