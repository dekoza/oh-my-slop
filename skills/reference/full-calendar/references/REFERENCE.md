# FullCalendar — Quick Reference Index

Cross-file lookup table. Find what you need, then read the full reference.

## Initialization & Setup

| Topic | File | Section |
|-------|------|---------|
| CDN script tag setup | `initialization.md` | CDN Script Tags |
| ES6 / npm setup | `initialization.md` | ES6 Build System |
| Plugin list (free + premium) | `initialization.md` | Plugin Index |
| Calendar constructor | `initialization.md` | Calendar Lifecycle |
| Dynamic option get/set | `initialization.md` | Calendar Lifecycle |
| Options that can't be set dynamically | `initialization.md` | Options that cannot be set dynamically |
| `destroy()` / `render()` | `initialization.md` | Calendar Lifecycle |

## Event Data

| Topic | File | Section |
|-------|------|---------|
| Event input properties | `events.md` | Event Parsing |
| `end` is exclusive (off-by-one) | `events.md` | Critical: end is exclusive |
| `allDay` inference rules | `events.md` | Critical: allDay inference |
| Event Object (parsed, read-only) | `events.md` | Event Object |
| Event methods (`setProp`, `setDates`, etc.) | `events.md` | Event Methods |
| Calendar event methods (`getEvents`, `addEvent`) | `events.md` | Calendar Event Methods |
| JSON feed source | `events.md` | 2. JSON Feed |
| Array source | `events.md` | 1. Array |
| Function source | `events.md` | 3. Function |
| Multiple sources | `events.md` | Multiple Sources |
| Event lifecycle callbacks | `events.md` | Event Lifecycle Callbacks |
| JSON response format | `events.md` | JSON Response Format |
| Recurring events | `events.md` | Recurring Event Properties |
| `extendedProps` | `events.md` | Event Parsing — extendedProps |
| `extraParams` (JSON feed) | `events.md` | 2. JSON Feed — Extended form |
| Cache busting | `events.md` | Cache busting |

## Views & Navigation

| Topic | File | Section |
|-------|------|---------|
| Available views (dayGrid, timeGrid, list, etc.) | `views.md` | Available Views |
| `headerToolbar` / `footerToolbar` | `views.md` | Toolbar Configuration |
| Custom buttons | `views.md` | Custom Buttons |
| Button text override | `views.md` | Button Text Override |
| Date navigation methods | `views.md` | Methods |
| `validRange` | `views.md` | Date Navigation — Options |
| Time slot options (`slotDuration`, `slotMinTime`, etc.) | `views.md` | Day/Time Options |
| Business hours | `views.md` | Business Hours |
| Week numbers | `views.md` | Week Numbers |
| Nav links | `views.md` | Nav Links |
| Sizing (`height`, `aspectRatio`, etc.) | `views.md` | Sizing |
| Localization | `views.md` | Localization |
| Time zones | `views.md` | Time Zones |
| View-specific options | `views.md` | View-Specific Options |

## User Interaction Callbacks

| Topic | File | Section |
|-------|------|---------|
| `dateClick` | `callbacks.md` | Date Clicking |
| `select` / `selectable` | `callbacks.md` | Date Selecting |
| `eventClick` | `callbacks.md` | Event Clicking |
| `eventMouseEnter` / `eventMouseLeave` | `callbacks.md` | Event Clicking (subsection) |
| Drag-and-drop setup | `callbacks.md` | Event Dragging & Resizing |
| `eventDrop` | `callbacks.md` | eventDrop |
| `eventResize` | `callbacks.md` | eventResize |
| External dragging | `callbacks.md` | External Dragging |
| `datesSet` | `callbacks.md` | View/Date Lifecycle |
| `loading` | `callbacks.md` | View/Date Lifecycle |

## Display & Customization

| Topic | File | Section |
|-------|------|---------|
| Event color options | `display.md` | Event Display Options |
| Background events | `display.md` | Background Events |
| Event render hooks (4-hook pattern) | `display.md` | Render Hooks |
| `eventContent` (custom rendering) | `display.md` | Event Render Hooks |
| `eventDidMount` (tooltips, etc.) | `display.md` | Event Render Hooks |
| Day-cell render hooks | `display.md` | Day-Cell Render Hooks |
| Day-header render hooks | `display.md` | Day-Header Render Hooks |
| Slot render hooks (timeGrid) | `display.md` | Slot Render Hooks |
| More-link / event popover | `display.md` | More-Link Render Hooks |
| Content injection formats | `display.md` | Content Injection Formats |
| CSS custom properties | `display.md` | CSS Custom Properties |
| Key CSS classes | `display.md` | Key CSS Classes |
| Bootstrap 5 theming | `display.md` | Theming |

## HTMX Integration

| Topic | File | Section |
|-------|------|---------|
| FullCalendar + HTMX hybrid | `htmx-patterns.md` | Approach 1 |
| `htmx.ajax()` bridge from callbacks | `htmx-patterns.md` | Key Pattern: Bridging |
| Refreshing calendar after HTMX mutation | `htmx-patterns.md` | Refreshing Calendar |
| Django JSON endpoint example | `htmx-patterns.md` | Backend JSON Endpoint |
| Server-rendered grid (no FullCalendar) | `htmx-patterns.md` | Approach 2 |
| CSS Grid calendar layout | `htmx-patterns.md` | CSS for the Server-Rendered Grid |
| `grid-column-start` offset calculation | `htmx-patterns.md` | grid-column-start Offset |
| Which approach to choose | `htmx-patterns.md` | Which Approach to Use? |
