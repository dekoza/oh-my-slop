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

## Browser (JavaScript)

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
| CSS custom properties | `getComputedStyle`, `setProperty` |
| AbortController (cancel requests) | `AbortController`, `AbortSignal` |
| Clipboard | `navigator.clipboard.writeText` / `readText` |
| Fullscreen | `element.requestFullscreen()` |
| Intersection (lazy load) | `IntersectionObserver` (no scroll listeners needed) |

## HTMX

HTMX is a first-class browser platform for hypermedia-driven UIs. If your project already includes HTMX, these are native capabilities — don't write custom JS for them.

| Need | Use | Notes |
|---|---|---|
| AJAX requests from HTML | `hx-get`, `hx-post`, `hx-put`, `hx-patch`, `hx-delete` | No `fetch()` boilerplate. Server returns HTML fragments, not JSON. |
| Partial page swaps | `hx-swap` | `innerHTML` (default), `outerHTML`, `beforebegin`, `afterbegin`, `beforeend`, `afterend`, `delete`, `none` |
| Target elements | `hx-target` | CSS selector for where the response renders. Defaults to the element itself. |
| Trigger control | `hx-trigger` | Event + filters + modifiers. **Not inherited** — must be set per element. |
| Form auto-include | Built-in | Non-GET requests auto-include the closest enclosing form's values. No manual serialization. |
| Out-of-band swaps | `hx-swap-oob` | Swap response elements into other parts of the DOM without targeting. |
| History integration | `hx-push-url`, `hx-history` | Push URLs into browser history; HTMX handles back/forward. |
| Progressive enhancement | `hx-boost` | Enhances plain links/forms into AJAX. Page works without JS. |
| CSS request indicators | `htmx-request`, `htmx-swapping`, `hx-settling` | HTMX adds/removes CSS classes during the request lifecycle. Use for loading spinners and transitions. |
| Attribute inheritance | Built-in | Most `hx-*` attributes inherit to children. Use `hx-disinherit` to stop. |
| WebSockets | `hx-ext="ws"` | Extension. No custom `WebSocket` client code. See [extensions](../../../reference/htmx/references/extensions.md). |
| Server-Sent Events | `hx-ext="sse"` | Extension. No custom `EventSource` client code. |
| DOM morphing | `hx-ext="morph"` | Extension. Idiomorph swap — preserves focus, scroll, state better than innerHTML. |
| Preload | `hx-ext="preload"` | Extension. Preload pages on hover/visible. |
| Response targeting | `hx-ext="response-targets"` | Extension. Handle 4xx/5xx by swapping to a different target. |
| Head tag merging | `hx-ext="head-support"` | Extension. Merge `<head>` tags from responses (meta, link, script). |
| Server partial detection | `HX-Request` header | Server checks this header to return partials vs full pages. |
| Request parameters | `hx-params` | Control which form fields are included: `all`, `none`, `not <list>`, `*` wildcard. |
| Request headers | `hx-headers` | Attach custom headers to requests (e.g., CSRF tokens). |
| Confirm dialogs | `hx-confirm` | Built-in confirmation before issuing a request. |
| Disable during request | `hx-disable` | Disables the element while a request is in flight. |
| Validation | `hx-validate` | Use native HTML5 validation before issuing requests. |
| Loading indicators | `hx-indicator` | CSS selector for element to show/hide during request. |
| Error handling | `hx-on::htmx:response-error` | Event handlers for request failures. |
| Polling | `hx-trigger="every <interval>"` | Built-in polling without `setInterval`. |
| Event cancellation | `hx-on::htmx:beforeRequest` | Return `false` to cancel a request before it fires. |

**Full API reference:** See the [`htmx` skill](../../../reference/htmx/SKILL.md) and its reference files for complete attribute docs, swap methods, events, extensions, patterns, and gotchas.

**Key principle:** HTMX expects HTML responses, not JSON. The server renders partials. The frontend stays minimal. If you're writing custom JS for AJAX, DOM updates, or event-driven UI, you're fighting the platform.

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
