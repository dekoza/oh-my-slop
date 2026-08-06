---
domain: filtering-pagination
category: reference
priority: high
---

# DRF Filtering & Pagination Reference

Use when configuring filter backends, search, ordering, or pagination on list endpoints.

### 1. Filter Backend Architecture

**Filter backends narrow querysets via query parameters — they compose with `get_queryset()`, not replace it.**

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_FILTER_BACKENDS': ['django_filters.rest_framework.DjangoFilterBackend'],
}

# Per-view
class BookList(generics.ListAPIView):
    queryset = Book.objects.all()
    serializer_class = BookSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
```

Execution: `get_queryset()` runs first, then each filter backend in `filter_backends` narrows the result sequentially via `filter_queryset(self, request, queryset, view)`.

**Warning:** Filter backends apply to detail views too — a GET to `/products/42/?category=clothing` will 404 if product 42 doesn't match the filter.

### 2. DjangoFilterBackend

**The most common filter backend — equality-based filtering from query parameters.**

Requires: `pip install django-filter`, `'django_filters'` in `INSTALLED_APPS`

```python
from django_filters.rest_framework import DjangoFilterBackend

class BookList(generics.ListAPIView):
    queryset = Book.objects.all()
    serializer_class = BookSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['category', 'in_stock']  # simple equality
    # OR
    filterset_class = BookFilterSet  # advanced: custom FilterSet class
```

Query format: `?category=fiction&in_stock=true`

**Warning:** `filterset_fields` does nothing without `DjangoFilterBackend` in `filter_backends`. This is the #1 "my filters aren't working" cause.

### 3. SearchFilter

**Full-text-like search across multiple fields — single query parameter, AND logic across terms.**

```python
from rest_framework.filters import SearchFilter

class BookList(generics.ListAPIView):
    queryset = Book.objects.all()
    serializer_class = BookSerializer
    filter_backends = [SearchFilter]
    search_fields = ['title', 'author__name', '=isbn']
```

Query: `?search=django rest` (whitespace-separated terms, ALL must match)

Search field prefixes:
| Prefix | ORM Lookup | Example |
|--------|-----------|---------|
| (none) | `icontains` | `'title'` — case-insensitive contains |
| `^` | `istartswith` | `'^title'` — starts with |
| `=` | `iexact` | `'=isbn'` — exact match |
| `$` | `iregex` | `'$title'` — regex |
| `@` | `search` | `'@title'` — full-text search (PostgreSQL only) |

Features:
- Related field traversal: `'author__name'`
- JSONField nested lookups: `'data__breed'`, `'data__owner__other_pets__0__name'`
- Quoted phrases: `?search="django rest"` treated as single term
- Dynamic search fields: override `get_search_fields(self, view, request)`

Settings: `SEARCH_PARAM` (default `'search'`)

**Warning:** Multiple search terms use AND logic — all terms must match. There's no OR search built-in.

### 4. OrderingFilter

**Client-controlled result ordering via query parameter.**

```python
from rest_framework.filters import OrderingFilter

class BookList(generics.ListAPIView):
    queryset = Book.objects.all()
    serializer_class = BookSerializer
    filter_backends = [OrderingFilter]
    ordering_fields = ['title', 'price', 'created_at']  # whitelist
    ordering = ['-created_at']  # default ordering when no param given
```

Query syntax:
- Single: `?ordering=title`
- Reverse: `?ordering=-title`
- Multiple: `?ordering=-price,title`

Settings: `ORDERING_PARAM` (default `'ordering'`)

**Warning:** If `ordering_fields` is NOT set, it defaults to ALL serializer readable fields — potential data leakage. An attacker could order by `password_hash` or other sensitive fields to extract information via timing/ordering attacks. Always set `ordering_fields` explicitly.

### 5. Custom Filter Backend

**Subclass `BaseFilterBackend` for non-standard filtering logic.**

```python
from rest_framework.filters import BaseFilterBackend

class IsOwnerFilterBackend(BaseFilterBackend):
    def filter_queryset(self, request, queryset, view):
        return queryset.filter(owner=request.user)

    def to_html(self, request, queryset, view):
        return ''  # optional: HTML controls for browsable API
```

**Warning:** Custom filter backends must handle gracefully when their expected query parameter is absent — return the queryset unmodified.

### 6. Pagination Architecture

**Pagination wraps list responses with metadata — requires BOTH settings to be set.**

```python
# Global — BOTH required
REST_FRAMEWORK = {
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 100,
}

# Per-view override
class BookList(generics.ListAPIView):
    pagination_class = MyPagination  # or None to disable
```

**Warning:** Setting only `DEFAULT_PAGINATION_CLASS` without `PAGE_SIZE` (or vice versa) results in NO pagination. Both must be set.

### 7. PageNumberPagination

**Traditional page-based pagination — simple, familiar, supports "jump to page".**

```python
class StandardPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'  # None by default — must set to enable client control
    max_page_size = 100
```

Query: `?page=3` or `?page=3&page_size=50`

Response:
```json
{
    "count": 1023,
    "next": "https://api.example.org/books/?page=4",
    "previous": "https://api.example.org/books/?page=2",
    "results": [...]
}
```

Configuration:
| Attribute | Default | Purpose |
|-----------|---------|---------|
| `page_size` | `PAGE_SIZE` setting | Items per page |
| `page_query_param` | `'page'` | Query parameter name |
| `page_size_query_param` | `None` | Client-controlled page size (disabled by default) |
| `max_page_size` | `None` | Max client-requested size (only if `page_size_query_param` set) |
| `last_page_strings` | `('last',)` | `?page=last` jumps to last page |

**Warning:** `page_size_query_param` defaults to `None` — clients CANNOT control page size unless you set it. `max_page_size` has no effect without it.

### 8. LimitOffsetPagination

**Database-style offset pagination — flexible but O(n) performance for large offsets.**

```python
class LargeSetPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 200
```

Query: `?limit=50&offset=100`

Response:
```json
{
    "count": 1023,
    "next": "https://api.example.org/books/?limit=50&offset=150",
    "previous": "https://api.example.org/books/?limit=50&offset=50",
    "results": [...]
}
```

Configuration:
| Attribute | Default | Purpose |
|-----------|---------|---------|
| `default_limit` | `PAGE_SIZE` setting | Limit when client omits parameter |
| `limit_query_param` | `'limit'` | Limit parameter name |
| `offset_query_param` | `'offset'` | Offset parameter name |
| `max_limit` | `None` | Maximum limit |

**Warning:** Large offsets cause performance problems — `OFFSET 1000000` scans and discards one million rows. Use `CursorPagination` for large datasets.

### 9. CursorPagination

**Opaque cursor-based pagination — consistent results under concurrent writes, O(1) performance.**

```python
class TimelinePagination(CursorPagination):
    page_size = 50
    ordering = '-created_at'  # MUST be a field that exists on the model
```

Query: `?cursor=cD0yMDIxLTAxLTIw` (opaque, generated by DRF)

Configuration:
| Attribute | Default | Purpose |
|-----------|---------|---------|
| `page_size` | `PAGE_SIZE` setting | Items per page |
| `cursor_query_param` | `'cursor'` | Query parameter name |
| `ordering` | `'-created'` | Field(s) for cursor ordering |

Ordering field requirements:
1. Must be **unchanging** after creation (timestamp, slug)
2. Must be **unique or nearly unique** (millisecond timestamps recommended)
3. Must be **non-nullable** and coercible to string
4. Must **NOT be a float** — precision errors break pagination; use `Decimal`
5. Must have a **database index**

Advantages:
- No duplicate items during concurrent inserts
- Fixed-time performance regardless of dataset size
- No "page N" — prevents scraping/crawling abuse

**Warning:** Default ordering is `'-created'` — your model MUST have a `created` field or you must override `ordering`. This is the #1 `CursorPagination` setup error. Crashes with `FieldError` if the field doesn't exist.

### 10. Custom Pagination

**Override `get_paginated_response` to customize the response structure.**

```python
class CustomPagination(PageNumberPagination):
    page_size = 25

    def get_paginated_response(self, data):
        return Response({
            'links': {
                'next': self.get_next_link(),
                'previous': self.get_previous_link(),
            },
            'total': self.page.paginator.count,
            'page': self.page.number,
            'page_size': self.page_size,
            'results': data,
        })
```

For fully custom pagination, subclass `BasePagination` and implement:
- `paginate_queryset(self, queryset, request, view=None)` → iterable
- `get_paginated_response(self, data)` → `Response`

**Warning:** Pagination only works automatically with generic views/viewsets. With `APIView`, you must call `paginate_queryset()` and `get_paginated_response()` manually.

### 11. Pagination with APIView (Manual)

**Generic views handle pagination automatically — APIView requires manual wiring.**

```python
class BookList(APIView):
    pagination_class = PageNumberPagination

    def get(self, request):
        books = Book.objects.all()
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(books, request, view=self)
        if page is not None:
            serializer = BookSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
        serializer = BookSerializer(books, many=True)
        return Response(serializer.data)
```

Look at `rest_framework.mixins.ListModelMixin.list()` source for the canonical pattern.

### 12. Combining Filters and Pagination

**Filters narrow the queryset BEFORE pagination — filter backends run in `filter_queryset()`, pagination in `paginate_queryset()`.**

```python
class BookList(generics.ListAPIView):
    queryset = Book.objects.select_related('author').all()
    serializer_class = BookSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['category', 'in_stock']
    search_fields = ['title', 'author__name']
    ordering_fields = ['title', 'price']
    ordering = ['-created_at']
    pagination_class = StandardPagination
```

Query example: `?category=fiction&search=django&ordering=-price&page=2&page_size=25`

**Warning:** `CursorPagination` can combine with `OrderingFilter`, but strongly restrict `ordering_fields` to fields that satisfy cursor requirements (unique, unchanging, indexed) — otherwise cursor guarantees break.
