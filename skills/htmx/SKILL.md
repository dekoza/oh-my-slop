---
name: htmx
description: >
  Use when adding, reviewing, or debugging HTMX behavior — hx-* attributes, swap
  strategies, partial page updates, or the SSE/WebSocket extensions. Triggers on:
  "HTMX", "hx-get"/"hx-post"/"hx-swap"/"hx-target", "partial reload", "nothing
  happens when I click" (silent swap failure), "SSE", "WebSockets", or when
  templates being edited contain hx-* attributes.
scope: htmx
target_versions: "HTMX 2.x"
last_verified: 2026-03-19
source_basis: official docs
---

# HTMX


Use this skill for HTMX implementation and integration. Read only the reference file(s) needed for the task.

## Quick Start

1. Identify the domain of the task (attributes, requests, swapping, events, patterns).
2. Open the matching file from `references/`.
3. Implement using HTML-first, hypermedia-driven patterns.
4. Validate that server responses return HTML fragments, not JSON.

## Critical Rules

1. **HTML responses** - HTMX expects HTML responses from the server, not JSON. Keep the HTMX paradigm: backend renders HTML; frontend is minimal
2. **Attribute inheritance** - Most attributes inherit to children. **Not inherited:** `hx-trigger`, `hx-on*`, `hx-swap-oob`, `hx-preserve`, `hx-history-elt`, `hx-validate`. Use `hx-disinherit` or `unset` to stop inheritance
3. **Default swap is innerHTML** - Always confirm the intended swap method
4. **Form values auto-included** - Non-GET requests automatically include the closest enclosing form's values
5. **Progressive enhancement** - Build HTML that degrades gracefully without JS. Use `hx-boost` for enhancing traditional link/form navigation; see `references/gotchas.md` for hx-boost scope and pitfalls
6. **Escape user content** - Escape all user-supplied content server-side to prevent XSS
7. **CSS lifecycle classes** - HTMX toggles `htmx-request`, `htmx-swapping`, `htmx-settling`, and `htmx-added` during requests — hook transitions and indicators on these
8. **data-prefix supported** - All `hx-*` attributes can also be written as `data-hx-*` for HTML validation compliance

## Development Constraints

Choosing HTMX implies the backend-partials paradigm: the server renders HTML fragments from templates/includes/partials, and frontend JavaScript stays minimal. Prefer backend-rendered components; use includes/partials/macros to avoid duplication and reduce inline HTML.

## When NOT to Use HTMX

- Pure client-side UI state (menus, tabs with loaded content, accordions) — keep it client-side; a server round-trip adds nothing.
- Rapid-feedback interactions — real-time collaborative editing, drag with instant visual feedback, per-keystroke validation.
- DOM regions managed by React/Vue or another SPA framework — HTMX swaps get overwritten on the next render; never overlap the two.

Details and alternatives: `references/gotchas.md`.

## Common Pitfalls

- **Silent target failures** - A mistyped `hx-target` drops the response with only an `htmx:targetError` event and no visible feedback. Run `htmx.logAll()` when "nothing happens".
- **Errors don't render** - In HTMX 2.x, 4xx/5xx responses are not swapped, so the user sees no failure. Handle `htmx:responseError` globally or use the `response-targets` extension; allow 422 validation responses to swap via `htmx:beforeSwap`.
- **Inheritance surprises** - Children inherit a parent's `hx-target` and most other attributes. Scope with explicit attributes on the child or block with `hx-disinherit`.
- **Global `hx-boost`** - Boosting `<body>` breaks external links, downloads, and file uploads. Boost specific containers and set an explicit `hx-target`.
- **Fragment/full-page mixups** - Branch on the `HX-Request` header server-side to serve fragments vs full pages, and set `Vary: HX-Request` so caches don't serve one as the other.
- **Hardcoded test markers** - Use template variables for dynamic markers (e.g. `{{ result_marker }}`) instead of hardcoded strings so templates and tests stay in sync.

## Reference Map

- Adding HTMX behavior to elements (all `hx-*` attributes, values, modifiers) -> `references/attributes.md`
- Configuring how/when requests fire (triggers, headers, parameters, CSRF, caching, CORS) -> `references/requests.md`
- Controlling where/how responses render (swap methods, targets, OOB swaps, morphing, view transitions) -> `references/swapping.md`
- Handling events, JS interop, configuration, debugging -> `references/events-api.md`
- Building common UI patterns (search, infinite scroll, modals, etc.) -> `references/patterns.md`
- Using WebSockets, SSE, Idiomorph, preloading, response targeting, or head merging -> `references/extensions.md`
- Pitfall depth, accessibility, error handling, architecture decisions -> `references/gotchas.md`
- Cross-cutting concerns or unsure where to start -> `references/REFERENCE.md` then domain-specific files
