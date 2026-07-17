---
name: full-calendar
description: >
  Use when building, configuring, or debugging a FullCalendar instance — views,
  event sources, callbacks, drag-and-drop, or render hooks. Triggers on:
  "FullCalendar", "event calendar", "dayGrid"/"timeGrid", "events show on the
  wrong day" (exclusive end dates), "calendar not rendering", "dateClick or
  drag-drop not working" (missing interaction plugin), a JSON event feed, or
  wiring a calendar into an HTMX-driven app.
---

# FullCalendar Skill

Comprehensive reference for FullCalendar v6 — a full-sized, drag-and-drop event calendar rendered entirely in JavaScript. FullCalendar is plugin-based, framework-agnostic (with optional React/Vue/Angular connectors), and works naturally with server-rendered backends via JSON feeds.

## Quick Start

1. Identify what you need: initialization, event data, user interaction, or display customization.
2. Open the matching reference file (see Reference Map below).
3. Use the vanilla JS API — FullCalendar's `Calendar` class, not framework wrappers — unless the project explicitly uses React/Vue/Angular connectors.
4. For HTMX-driven apps, prefer the JSON feed event source and server-rendered content patterns described in `htmx-patterns.md`.

## Critical Rules

1. **`end` dates are exclusive.** An event ending `2024-09-03` spans through `2024-09-02` and stops before `2024-09-03`. This matches iCalendar RFC 5545 and Google Calendar API semantics. Agents and backend code producing event JSON must respect this — off-by-one end dates are the most common FullCalendar bug.
2. **`interaction` plugin is required for `dateClick`, `selectable`, and drag/resize.** It is NOT required for `eventClick` or `eventMouseEnter`/`eventMouseLeave`. The standard CDN bundle includes it, but ES6 users must import `@fullcalendar/interaction` and add it to `plugins: []`.
3. **JSON feed dates must be ISO8601 strings or millisecond timestamps.** Native JS `Date` objects cannot be serialized to JSON. Do not send `new Date(...)` strings.
4. **Dynamic option changes use `setOption()` / `getOption()`.** But `events` and `eventSources` cannot be dynamically set — use `addEventSource()` / `refetchEvents()` instead. `initialDate` and `initialView` cannot be set either — use `gotoDate()` and `changeView()`.
5. **Non-standard event properties go to `extendedProps`.** During parsing, any property not in the standard set is moved into `event.extendedProps`. Access them there, not on the event root.
6. **Content injection varies by environment.** In vanilla JS, `eventContent` returns text, `{ html }`, or `{ domNodes }`. React/Vue/Angular connectors have their own content injection patterns — do not mix them.
7. **`allDay` inference.** If `allDay` is not explicitly set, FullCalendar infers it from `start`/`end` formats. ISO strings without time parts (e.g., `2024-09-01`) are treated as all-day; strings with time parts are not.
8. **Toolbar values are space/comma separated.** Space = gap between groups. Comma = adjacent buttons. Example: `'prev,next today'` puts prev/next together, then a gap, then today.
9. **Timezone shifts come from `timeZone` mismatches.** FullCalendar defaults to the browser's local timezone. ISO date strings with UTC offsets are converted into the calendar's zone; strings without offsets are taken as-is. Named timezones (anything beyond `local`/`UTC`) require a timezone plugin — without one they silently degrade to UTC — and JSON feeds receive the active zone via `timeZoneParam` so the backend can respond consistently.

## Core Concepts

FullCalendar has a small set of concepts that recur everywhere:

- **Calendar instance**: created with `new FullCalendar.Calendar(el, options)` (global bundle) or `new Calendar(el, { plugins: [...], ...options })` (ES6). Call `.render()` to mount.
- **Plugins**: each view type and feature is a separate package. The standard CDN bundle (`fullcalendar/index.global.min.js`) includes core, interaction, daygrid, timegrid, list, and multimonth.
- **Event sources**: where events come from — an array, a JSON feed URL, or a function. FullCalendar auto-fetches when the visible date range changes.
- **Callbacks (handlers)**: functions you pass as options that fire on user interaction or lifecycle events (e.g., `eventClick`, `dateClick`, `datesSet`).
- **Render hooks**: four-hook pattern (`*ClassNames`, `*Content`, `*DidMount`, `*WillUnmount`) for customizing the DOM of events, day cells, headers, etc.
- **Content injection**: render hooks that accept `*Content` can return plain text, `{ html: '...' }`, `{ domNodes: [...] }`, or a function returning any of these.

## HTMX Integration Context

FullCalendar and HTMX serve complementary roles. FullCalendar handles the calendar grid, date math, and client-side interactions. The backend provides event data via JSON. The key integration points:

- **Event data**: use a JSON feed URL that your backend serves. FullCalendar sends `start` and `end` query params automatically.
- **Event interactions**: on `eventClick` or `dateClick`, trigger HTMX requests to load modals/panels with server-rendered HTML, rather than building client-side forms.
- **Navigation**: FullCalendar handles its own month/week navigation. If you need the navigation to also update other page elements, use `datesSet` callback to trigger HTMX requests.
- **Alternative approach**: for simpler calendars, skip FullCalendar entirely and render the grid server-side with HTMX-powered navigation (see `htmx-patterns.md` for this pattern).

## Reference Map

| File | Covers |
|------|--------|
| `references/initialization.md` | CDN setup, ES6 imports, Calendar constructor, plugin system, destroy/re-render |
| `references/events.md` | Event model, parsing rules, sources (array, JSON feed, function), Event Object API, event methods |
| `references/views.md` | Available views, view plugins, toolbar, navigation, date display, sizing |
| `references/callbacks.md` | All callbacks: dateClick, eventClick, select, eventDrop, eventResize, datesSet, loading, lifecycle |
| `references/display.md` | Event display options, render hooks, content injection, CSS customization, colors |
| `references/htmx-patterns.md` | HTMX+FullCalendar integration, server-side calendar grid alternative, modal patterns |
| `references/REFERENCE.md` | Cross-file index and quick lookup table |

## Task Routing

| Task | Start here |
|------|-----------|
| Add a calendar to a page | `initialization.md` |
| Load events from backend API | `events.md` |
| Handle clicks, selections, drag-drop | `callbacks.md` |
| Customize event appearance | `display.md` |
| Configure toolbar, switch views | `views.md` |
| Integrate with HTMX backend | `htmx-patterns.md` |
| Look up a specific option/method | `REFERENCE.md` |
