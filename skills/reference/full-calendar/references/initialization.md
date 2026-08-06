# FullCalendar — Initialization

## CDN Script Tags (Simplest)

Include the standard bundle from a CDN. It contains core, interaction, daygrid, timegrid, list, and multimonth plugins:

```html
<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js"></script>
```

Then initialize:

```html
<script>
document.addEventListener('DOMContentLoaded', function() {
  var calendarEl = document.getElementById('calendar');
  var calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    events: '/api/events/'
  });
  calendar.render();
});
</script>

<div id="calendar"></div>
```

The global bundle exposes `FullCalendar` as a namespace. Use `FullCalendar.Calendar` — not a bare `Calendar`.

### Individual Plugin Script Tags

Instead of the full bundle, load only what you need:

```html
<script src="https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.20/index.global.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@fullcalendar/daygrid@6.1.20/index.global.min.js"></script>
```

When loaded as globals, plugins auto-register — no `plugins: []` array needed.

## ES6 Build System

```bash
npm install @fullcalendar/core @fullcalendar/interaction @fullcalendar/daygrid
```

```js
import { Calendar } from '@fullcalendar/core';
import interactionPlugin from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';

const calendar = new Calendar(document.getElementById('calendar'), {
  plugins: [interactionPlugin, dayGridPlugin],
  initialView: 'dayGridMonth',
  events: '/api/events/'
});
calendar.render();
```

With ES6, you **must** list plugins explicitly in the `plugins` array. Omitting a plugin means its views/features are unavailable.

## Plugin Index

### Standard (Free)

| Package | What it provides |
|---------|-----------------|
| `@fullcalendar/core` | `Calendar` class, core engine |
| `@fullcalendar/interaction` | `dateClick`, `selectable`, drag-n-drop, resize |
| `@fullcalendar/daygrid` | `dayGridMonth`, `dayGridWeek`, `dayGridDay` views |
| `@fullcalendar/timegrid` | `timeGridWeek`, `timeGridDay` views |
| `@fullcalendar/list` | `listYear`, `listMonth`, `listWeek`, `listDay` views |
| `@fullcalendar/multimonth` | `multiMonthYear` view |
| `@fullcalendar/scrollgrid` | Advanced horizontal scrolling |
| `@fullcalendar/bootstrap5` | Bootstrap 5 theming |
| `@fullcalendar/google-calendar` | Google Calendar feed |
| `@fullcalendar/icalendar` | iCalendar feed |
| `@fullcalendar/rrule` | Recurrence rules via rrule library |
| `@fullcalendar/luxon3` | Luxon date formatting + timezone |
| `@fullcalendar/moment` | Moment.js formatting |
| `@fullcalendar/moment-timezone` | Moment Timezone named timezones |

### Premium (Paid license)

| Package | What it provides |
|---------|-----------------|
| `@fullcalendar/timeline` | Horizontal timeline views (no resources) |
| `@fullcalendar/resource` | Base resource support |
| `@fullcalendar/resource-daygrid` | Resource-enabled DayGrid views |
| `@fullcalendar/resource-timegrid` | Resource-enabled TimeGrid views |
| `@fullcalendar/resource-timeline` | Resource-enabled Timeline views |
| `@fullcalendar/adaptive` | Print optimization |

The premium bundle (`fullcalendar-scheduler/index.global.min.js`) includes everything from both tables.

## Calendar Lifecycle

```js
// Create
var calendar = new FullCalendar.Calendar(el, options);

// Mount into the DOM
calendar.render();

// Update options at runtime
calendar.setOption('locale', 'pl');

// Read current option
calendar.getOption('locale');

// Navigate
calendar.gotoDate('2024-06-01');
calendar.changeView('timeGridWeek');
calendar.prev();
calendar.next();
calendar.today();

// Batch rendering (avoids intermediate redraws)
calendar.batchRendering(function() {
  calendar.setOption('weekends', false);
  calendar.setOption('locale', 'fr');
});

// Tear down
calendar.destroy();
```

### Options that cannot be set dynamically

| Option | Use this method instead |
|--------|------------------------|
| `initialDate` | `calendar.gotoDate(date)` |
| `initialView` | `calendar.changeView(viewName)` |
| `events` | `calendar.addEventSource(source)` |
| `eventSources` | `calendar.addEventSource(source)` |

### Options that take effect only on future fetches

`defaultTimedEventDuration`, `defaultAllDayEventDuration`, `defaultAllDay`, `forceEventDuration`, `eventDataTransform`, `startParam`, `endParam`, `timeZoneParam`.
