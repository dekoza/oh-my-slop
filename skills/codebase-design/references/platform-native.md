# Platform Native — Before You Reach for a Dependency

A checklist of what's already available. Check this before adding any new package.

## Python stdlib

| Need | Use |
|---|---|
| File paths, directory walking | `pathlib.Path` |
| Data classes, named tuples | `dataclasses`, `collections.namedtuple` |
| Context managers | `contextlib` |
| Caching / memoization | `functools.lru_cache`, `functools.cache` |
| Partial application, reduce | `functools.partial`, `functools.reduce` |
| Grouping, counting, chaining | `itertools`, `collections.Counter`, `collections.defaultdict` |
| URL parsing | `urllib.parse` |
| Date/time | `datetime`, `zoneinfo` |
| JSON | `json` |
| Hashing, HMAC | `hashlib`, `hmac` |
| Temp files, temp dirs | `tempfile` |
| Subprocess | `subprocess` |
| Logging | `logging` |
| Enum | `enum.Enum` |
| Type validation (basic) | `isinstance`, `typing` |
| Async I/O | `asyncio`, `anyio` |
| HTTP client (stdlib) | `urllib.request` |
| Email parsing | `email` |
| CSV | `csv` |
| Config files | `configparser` |
| CLI args | `argparse` |

## Django / DRF

| Need | Use |
|---|---|
| DB queries, aggregations | Django ORM (`annotate`, `aggregate`, `Subquery`, `Exists`) |
| Pagination | DRF `PageNumberPagination`, `CursorPagination` |
| Serialization | DRF Serializers, `SerializerMethodField` |
| Auth / permissions | DRF `permission_classes`, Django `authenticate` |
| Validation | DRF field validators, Django `clean()` |
| Signals | Django `post_save`, `pre_delete`, etc. |
| Management commands | `call_command`, custom `BaseCommand` |
| Testing | `TestCase`, `APITestClient`, `override_settings` |
| Caching | Django cache framework (`cache_page`, `cached_property`) |
| File storage | Django `FileField`, `Storage` backends |

## Browser (JavaScript / HTMX)

| Need | Use |
|---|---|
| HTTP requests | `fetch()` |
| URL manipulation | `URL`, `URLSearchParams` |
| Formatting dates/numbers | `Intl.DateTimeFormat`, `Intl.NumberFormat` |
| Deep clone objects | `structuredClone()` |
| DOM manipulation | `querySelector`, `closest`, `toggleAttribute` |
| Events | `addEventListener`, `dispatchEvent` |
| History / navigation | `history.pushState`, `Navigation API` |
| Web Storage | `localStorage`, `sessionStorage` |
| Observers | `MutationObserver`, `IntersectionObserver`, `ResizeObserver` |
| HTMX swaps | `hx-swap`, `hx-target`, `hx-trigger` |
| CSS custom properties | `getComputedStyle`, `setProperty` |

## Node.js

| Need | Use |
|---|---|
| File system | `node:fs`, `node:fs/promises` |
| Path manipulation | `node:path` |
| Crypto (hash, random, HMAC) | `node:crypto` |
| Child processes | `node:child_process` |
| Streams | `node:stream` |
| HTTP server | `node:http` |
| Environment | `node:process` (avoid `dotenv` for single-file scripts) |
| Test runner | `node:test`, `node:assert` |

## PostgreSQL

| Need | Use |
|---|---|
| Full-text search | `tsvector`, `tsquery`, `to_tsvector` |
| Array operations | `ANY`, `ARRAY[]`, `array_agg` |
| JSON storage / query | `jsonb`, `->`, `->>`, `@>` |
| Upsert | `INSERT ... ON CONFLICT DO UPDATE` |
| Window functions | `ROW_NUMBER()`, `LAG()`, `LEAD()` |
| Recursive queries | `WITH RECURSIVE` |
| UUID generation | `gen_random_uuid()` (pgcrypto) |
| Case-insensitive match | `ILIKE`, `citext` |
