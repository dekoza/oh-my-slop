---
domain: views-viewsets
category: reference
priority: high
---

# DRF Views, ViewSets & Routers Reference

Use when building API views, viewsets, custom actions, or URL routing for DRF endpoints.

### 1. APIView Fundamentals

**APIView is the base class for all DRF views — it wraps Django's `View` with request parsing, authentication, permissions, throttling, and content negotiation.**

```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

class BookList(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        books = Book.objects.all()
        serializer = BookSerializer(books, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = BookSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
```

Differences from Django `View`:
- Receives DRF `Request` (not `HttpRequest`) — parsed body via `request.data`
- Returns DRF `Response` (content-negotiated rendering)
- `APIException` subclasses caught and converted to error responses
- Authentication, permission, and throttle checks run before handler

API policy attributes (all configurable per-view):
| Attribute | Controls |
|-----------|----------|
| `renderer_classes` | Response rendering |
| `parser_classes` | Request body parsing |
| `authentication_classes` | Who is making the request |
| `throttle_classes` | Rate limiting |
| `permission_classes` | Access control |
| `content_negotiation_class` | Content type selection |

**Warning:** `check_object_permissions(request, obj)` must be called explicitly in custom `APIView` code. Generic views call it from `get_object()`, but if you fetch objects manually, permissions won't be checked.

### 2. @api_view Decorator

**Function-based views for simple endpoints — fastest to write, but limited to one function per URL.**

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def book_list(request):
    if request.method == 'GET':
        books = Book.objects.all()
        serializer = BookSerializer(books, many=True)
        return Response(serializer.data)
    serializer = BookSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)
```

Default: `['GET']` only. Other methods return 405.

Policy decorators (must come AFTER `@api_view`):
`@renderer_classes(...)`, `@parser_classes(...)`, `@authentication_classes(...)`, `@throttle_classes(...)`, `@permission_classes(...)`, `@schema(...)`.

**Warning:** Decorator order matters — `@api_view` must be the outermost (top) decorator. Policy decorators below it modify the wrapped view's attributes.

### 3. GenericAPIView

**Extends `APIView` with queryset/serializer handling — the foundation for all generic views and viewsets.**

```python
from rest_framework.generics import GenericAPIView

class BookList(GenericAPIView):
    queryset = Book.objects.select_related('author').all()
    serializer_class = BookSerializer
    lookup_field = 'pk'          # default
    lookup_url_kwarg = None      # defaults to lookup_field
    pagination_class = None      # per-view override
    filter_backends = []         # per-view filter backends
```

Key methods:
| Method | Purpose |
|--------|---------|
| `get_queryset()` | Returns queryset. Always use instead of `self.queryset` directly — the class attribute is shared across requests |
| `get_object()` | Lookup single instance via `lookup_field`. Calls `check_object_permissions()` automatically |
| `get_serializer_class()` | Override for action-specific serializers |
| `get_serializer(*args, **kwargs)` | Instantiates serializer with context (`request`, `view`, `format`) |
| `filter_queryset(queryset)` | Applies `filter_backends` sequentially |
| `paginate_queryset(queryset)` | Returns page or `None` |
| `get_paginated_response(data)` | Returns paginated `Response` |

Save/delete hooks (called by mixins):
- `perform_create(serializer)` — override to inject data: `serializer.save(owner=request.user)`
- `perform_update(serializer)` — called by `UpdateModelMixin`
- `perform_destroy(instance)` — called by `DestroyModelMixin`

**Warning:** `get_queryset()` should always use `.all()` or clone the queryset — the class-level `queryset` attribute is evaluated once and cached. Accessing `self.queryset` directly reuses the same queryset object across requests.

### 4. Mixins

**Each mixin provides a single action method — combine them with `GenericAPIView` for custom view behavior.**

| Mixin | Action Method | HTTP | Success Status |
|-------|--------------|------|----------------|
| `ListModelMixin` | `.list()` | GET (list) | 200 |
| `CreateModelMixin` | `.create()` | POST | 201 (+ Location header if `url` key in data) |
| `RetrieveModelMixin` | `.retrieve()` | GET (detail) | 200 |
| `UpdateModelMixin` | `.update()` / `.partial_update()` | PUT / PATCH | 200 |
| `DestroyModelMixin` | `.destroy()` | DELETE | 204 |

All from `rest_framework.mixins`.

### 5. Concrete Generic Views

**Pre-composed views for common patterns — the fastest path to a working API endpoint.**

| Class | Mixins | HTTP Methods |
|-------|--------|-------------|
| `CreateAPIView` | Create | POST |
| `ListAPIView` | List | GET |
| `RetrieveAPIView` | Retrieve | GET |
| `DestroyAPIView` | Destroy | DELETE |
| `UpdateAPIView` | Update | PUT, PATCH |
| `ListCreateAPIView` | List + Create | GET, POST |
| `RetrieveUpdateAPIView` | Retrieve + Update | GET, PUT, PATCH |
| `RetrieveDestroyAPIView` | Retrieve + Destroy | GET, DELETE |
| `RetrieveUpdateDestroyAPIView` | Retrieve + Update + Destroy | GET, PUT, PATCH, DELETE |

All from `rest_framework.generics`.

**Warning:** Since DRF 3.0, PUT on a non-existent object returns 404 (not auto-create). Override `update()` to restore old behavior if needed.

### 6. ViewSet Classes

**ViewSets map actions to HTTP methods — combined with routers, they auto-generate URL patterns.**

| Class | Inherits | Includes Actions |
|-------|----------|-----------------|
| `ViewSet` | `APIView` | None — define explicitly |
| `GenericViewSet` | `GenericAPIView` | None — add via mixins |
| `ModelViewSet` | `GenericAPIView` + all 5 mixins | list, create, retrieve, update, partial_update, destroy |
| `ReadOnlyModelViewSet` | `GenericAPIView` + List + Retrieve | list, retrieve |

Introspection attributes (available during dispatch):
- `self.action` — current action name (e.g., `'list'`, `'create'`, `'set_password'`)
- `self.detail` — `True` for detail-level actions, `False` for list-level
- `self.basename`, `self.suffix`, `self.name`, `self.description`

Custom viewset composition:
```python
from rest_framework import mixins, viewsets

class CreateListRetrieveViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    pass
```

**Warning:** `self.action` is NOT set when `get_parsers()`, `get_authenticators()`, or `get_content_negotiator()` are called — these run before action dispatch. Do not branch on `self.action` in those methods.

### 7. @action Decorator

**Adds custom endpoints to viewsets — the router automatically generates URLs for them.**

```python
from rest_framework.decorators import action

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    @action(detail=True, methods=['post'], permission_classes=[IsAdminUser])
    def set_password(self, request, pk=None):
        user = self.get_object()
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data['password'])
        user.save()
        return Response({'status': 'password set'})

    @action(detail=False, methods=['get'])
    def recent_users(self, request):
        recent = User.objects.order_by('-date_joined')[:10]
        serializer = self.get_serializer(recent, many=True)
        return Response(serializer.data)
```

| Argument | Default | Description |
|----------|---------|-------------|
| `detail` | (required) | `True` = `{pk}/url_path/`, `False` = `url_path/` |
| `methods` | `['get']` | HTTP methods |
| `url_path` | method name | URL segment |
| `url_name` | method name | Reverse URL name component |
| `permission_classes` | — | Override viewset-level |
| `serializer_class` | — | Override viewset-level |
| `filter_backends` | — | Override viewset-level |
| `throttle_classes` | — | Override viewset-level |

Additional method mapping for same URL:
```python
@set_password.mapping.delete
def unset_password(self, request, pk=None):
    ...
```

Reversing: `self.reverse_action('set-password', args=['1'])` or `self.reverse_action(self.set_password.url_name, args=['1'])`.

**Warning:** Do NOT use `.as_view()` with `@action` methods — it bypasses router setup and may ignore action-specific `permission_classes` and other overrides.

### 8. Routers

**Routers auto-generate URL patterns for viewsets — eliminating manual URL configuration.**

```python
from rest_framework.routers import SimpleRouter, DefaultRouter

router = DefaultRouter()
router.register(r'users', UserViewSet)                              # basename auto-derived
router.register(r'accounts', AccountViewSet, basename='account')    # explicit basename

urlpatterns = [
    path('api/', include(router.urls)),
]
```

`register()` arguments: `prefix` (URL prefix, no trailing slash), `viewset` (class), `basename` (optional — required if viewset has no `queryset`).

**SimpleRouter** generated URL patterns:
| URL | Method | Action | Name |
|-----|--------|--------|------|
| `{prefix}/` | GET | list | `{basename}-list` |
| `{prefix}/` | POST | create | `{basename}-list` |
| `{prefix}/{lookup}/` | GET | retrieve | `{basename}-detail` |
| `{prefix}/{lookup}/` | PUT | update | `{basename}-detail` |
| `{prefix}/{lookup}/` | PATCH | partial_update | `{basename}-detail` |
| `{prefix}/{lookup}/` | DELETE | destroy | `{basename}-detail` |
| `{prefix}/{lookup}/{url_path}/` | methods | `@action(detail=True)` | `{basename}-{url_name}` |
| `{prefix}/{url_path}/` | methods | `@action(detail=False)` | `{basename}-{url_name}` |

Constructor options: `SimpleRouter(trailing_slash=False)` removes trailing slashes. `SimpleRouter(use_regex_path=False)` uses Django `path()` converters instead of regex.

**DefaultRouter** adds:
- API root view at `/` (GET) with hyperlinks to all list views. Name: `api-root`.
- Optional `.json` format suffix routes on all URLs.

Lookup configuration (on viewset):
- `lookup_field = 'username'` (default: `'pk'`)
- `lookup_value_regex = '[0-9a-f]{32}'` (for regex routers)
- `lookup_value_converter = 'uuid'` (for path converter routers)

Using with URL namespaces:
```python
urlpatterns = [path('api/', include((router.urls, 'myapp')))]
```

Custom routers: subclass `SimpleRouter`, override `.routes` with `Route` and `DynamicRoute` namedtuples. For fully custom behavior, subclass `BaseRouter` and override `get_urls()`.

**Warning:** Do NOT include trailing slash in `register()` prefix — routers append slashes automatically. Namespacing with `HyperlinkedModelSerializer` requires `view_name='app_name:model-detail'` on serializer fields.

### 9. Dynamic Serializer and Permission Selection

**Override `get_serializer_class()` and `get_permissions()` for action-specific behavior.**

```python
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        if self.action in ('update', 'partial_update'):
            return UserUpdateSerializer
        return UserReadSerializer

    def get_permissions(self):
        if self.action == 'create':
            return [AllowAny()]
        if self.action == 'destroy':
            return [IsAdminUser()]
        return [IsAuthenticated()]
```

**Warning:** `get_permissions()` must return instantiated permission objects (`[IsAdminUser()]`), not classes (`[IsAdminUser]`). Same for `get_authenticators()`, `get_throttles()`, etc.

### 10. Dispatch Lifecycle

See `internals.md` section 1 for the complete dispatch flow diagram with all hooks.

Key points for view authors:
- Authentication → permissions → throttling run in `initial()` before your handler.
- CSRF exemption happens in `as_view()`, not `dispatch()` — safe to override `dispatch()`.
- `finalize_response()` attaches renderer, media type, and renderer context after your handler returns.

### 11. Third-Party Router Packages

**For nested resources or advanced routing patterns.**

- `drf-nested-routers` — nested resource URLs (`/users/1/posts/`)
- `DRF-extensions` — nested viewsets, collection controllers
