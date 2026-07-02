---
name: hyperscript
description: >
  _hyperscript front-end scripting: `_=` attributes, `script=` / `data-script`,
  `text/hyperscript` script tags, event handlers like `on click`, DOM commands like
  `toggle`/`put`/`take`, `send`/`trigger`, `behavior`, `worker`, `socket`, or HTMX
  companion scripting. Triggers on: "hyperscript", "_=" , "script=", "data-script",
  "on click", "toggle", "HTMX companion", "inline hyperscript", or when the user
  shows inline `_=` snippets without naming the language.
scope: hyperscript
target_versions: "_hyperscript 0.9.x (verified against 0.9.14 public docs)"
last_verified: 2026-04-06
source_basis: official docs + reference + cookbook + README
---

# Hyperscript

Use this skill for `_hyperscript` implementation, debugging, and code review. Read only the reference file(s) needed for the task.

## Quick Start

1. Identify the domain of the task (syntax/scope, DOM manipulation, events/async, advanced features/JS interop).
2. Open the matching file from `references/`.
3. Implement using hyperscript's natural-language command syntax.
4. Validate that the solution stays within hyperscript's sweet spot: localized DOM/event behavior on individual elements.

## When NOT to Use Hyperscript

1. If the task requires complex client-side state shared across many unrelated elements, use JavaScript.
2. If the task is primarily HTMX request/response wiring (`hx-get`, `hx-swap`, etc.), use the `htmx` skill.
3. If the solution would be mostly `js ... end` blocks, skip hyperscript and write JavaScript directly.
4. If the task requires a full SPA router, state management library, or build-step framework, hyperscript is not the tool.

## Setup Essentials

**CDN install** (dependency-free, no build step):

```html
<script src="https://unpkg.com/hyperscript.org@0.9.14"></script>
```

**Build/import**:

```js
import _hyperscript from 'hyperscript.org';
_hyperscript.browserInit();
```

**Attribute names**: `_`, `script`, or `data-script` on elements.

**Global features** via `<script type="text/hyperscript">` tags (behaviors, functions, init blocks). Features in script tags apply to `body`.

**External `.\_hs` files** must load before the hyperscript script tag:

```html
<script type="text/hyperscript" src="/behaviors._hs"></script>
<script src="https://unpkg.com/hyperscript.org@0.9.14"></script>
```

**Processing dynamically inserted DOM**: call `_hyperscript.processNode(element)` on elements inserted via manual JavaScript DOM APIs. HTMX swaps and hyperscript's own `put` command process inserted fragments automatically.

## Critical Rules

1. **Use `_hyperscript.processNode()` for manually inserted HTML.** Newly injected DOM from manual JS APIs (appendChild, innerHTML assignment) must be processed. HTMX swaps and the hyperscript `put` command handle this automatically.

2. **Queue semantics matter.** Event handlers default to `queue last`. Make queue behavior explicit when correctness depends on it:
   - `queue last` (default): drops intermediate events, keeps only the last pending one
   - `queue all`: runs all events sequentially in order
   - `queue first`: queues only the first pending event, drops the rest
   - `queue none`: drops all events while the handler is active
   - `every` prefix: runs handlers in parallel with no queuing

3. **Attribute storage is string-based.** Values stored through `@attr` become strings. Convert explicitly (e.g., `@data-count as Int`) when numeric or structured behavior is needed.

4. **Math expressions require full parenthesization.** Hyperscript does not use normal operator precedence for mixed math. `(x * x) + (y * y)` is required; `x * x + y * y` is a parse error.

5. **Use JS interop deliberately.** Use `call` and `get` for JS function calls; reserve inline `js ... end` for cases where hyperscript genuinely cannot express the logic. If the solution becomes mostly `js ... end`, use JavaScript directly.

6. **Prefer local behavior, not global sprawl.** Hyperscript is strongest for localized DOM/event behavior scoped to individual elements. State shared across many unrelated elements belongs in JavaScript.

7. **HTMX ownership stays separate.** Use hyperscript for local glue around HTMX events (disabling buttons, toggling classes on lifecycle events), not as a replacement for HTMX request semantics.

8. **Advanced features require separate scripts.** `worker`, `socket`, and `eventsource` are NOT in the default hyperscript bundle. They require either the "Whole 9 Yards" release or individual script includes (`/dist/workers.js`, `/dist/socket.js`, `/dist/eventsource.js`). Always emit the correct script includes when using these features.

9. **`behavior` definitions must precede `install`.** Behaviors defined locally (in `<script type="text/hyperscript">`) must appear before elements that install them. Behaviors loaded from external `._hs` files must load before the hyperscript script tag.

## HTMX Companion Guidance

Hyperscript excels at local UI glue around HTMX lifecycle events:

- Disable buttons during requests: `on htmx:beforeRequest add @disabled then on htmx:afterRequest remove @disabled`
- Toggle loading indicators on HTMX lifecycle events
- Manage local element state in response to `htmx:afterSwap`, `htmx:beforeSend`, etc.

When hyperscript handles `htmx:*` events, the code should be short and focused on the element's own state. If the logic starts coordinating multiple remote elements or making its own HTTP requests, the task has moved into HTMX territory.

HTMX request/response semantics, `hx-*` attributes, swap strategies, and extension APIs stay in the `htmx` skill. Route to it when the question is about request configuration, swap targets, or server response format.

## Reference Map

- Syntax, variables, scope, conversions, functions, exceptions: `references/core-language.md`
- DOM queries, DOM mutation, transitions, measurement: `references/dom-and-commands.md`
- Event handlers, queueing, filters, async transparency, waits: `references/events-and-async.md`
- `fetch`, JS interop, `behavior`, `worker`, `socket`, `eventsource`, extensions: `references/advanced-and-interop.md`
- Cross-file index and quick lookup: `references/REFERENCE.md`

## Task Routing

- Installing or initializing hyperscript -> Setup Essentials above
- Understanding syntax, scope, conversions, functions, or exceptions -> `references/core-language.md`
- Querying or mutating the DOM -> `references/dom-and-commands.md`
- Event handlers, queueing, filters, or waits -> `references/events-and-async.md`
- `fetch`, navigation, JS calls, inline JS, `behavior`, `worker`, sockets, eventsource, or extending the language -> `references/advanced-and-interop.md`
- HTMX + hyperscript patterns -> HTMX Companion Guidance above
- Unsure where to start -> `references/REFERENCE.md`
- HTMX attribute semantics, swap strategies, server interaction -> `htmx` skill
- UI component classes and layout -> `tabler` skill
- Server-side framework lifecycle -> `django` or `litestar` skill
