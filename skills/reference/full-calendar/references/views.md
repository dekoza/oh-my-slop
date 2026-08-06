# FullCalendar — Views, Toolbar, and Navigation

## Available Views

Each view requires its plugin. The standard CDN bundle includes all free view plugins.

### DayGrid Views (plugin: `@fullcalendar/daygrid`)

| View Name | Description |
|-----------|-------------|
| `dayGridMonth` | Classic monthly calendar grid |
| `dayGridWeek` | Week as a grid row |
| `dayGridDay` | Single day as a grid |
| `dayGridYear` | Full year as a grid |

### TimeGrid Views (plugin: `@fullcalendar/timegrid`)

| View Name | Description |
|-----------|-------------|
| `timeGridWeek` | Week with time slots on the y-axis |
| `timeGridDay` | Single day with time slots |

### List Views (plugin: `@fullcalendar/list`)

| View Name | Description |
|-----------|-------------|
| `listYear` | List of events for a year |
| `listMonth` | List of events for a month |
| `listWeek` | List of events for a week |
| `listDay` | List of events for a day |

### Multi-Month Views (plugin: `@fullcalendar/multimonth`)

| View Name | Description |
|-----------|-------------|
| `multiMonthYear` | Year with multiple month grids |

### Premium Views (paid)

| View Name | Plugin | Description |
|-----------|--------|-------------|
| `resourceTimelineDay/Week/Month/Year` | `@fullcalendar/resource-timeline` | Horizontal timeline with resources |
| `resourceTimeGridDay/Week` | `@fullcalendar/resource-timegrid` | Vertical time grid with resource columns |
| `resourceDayGridDay/Week/Month` | `@fullcalendar/resource-daygrid` | Day grid with resource columns |

## Toolbar Configuration

### `headerToolbar`

Default:
```js
headerToolbar: {
  start: 'title',
  center: '',
  end: 'today prev,next'
}
```

- Properties: `start` (or `left`), `center`, `end` (or `right`).
- **Comma** between values = adjacent buttons (no gap).
- **Space** between values = small gap.
- Set to `false` to hide the toolbar entirely.

Available toolbar values:

| Value | Description |
|-------|-------------|
| `title` | Current month/week/day text |
| `prev` | Navigate back one unit |
| `next` | Navigate forward one unit |
| `prevYear` | Navigate back one year |
| `nextYear` | Navigate forward one year |
| `today` | Navigate to current date |
| *any view name* | Button to switch to that view |

**Example:** month/week toggle with navigation:

```js
headerToolbar: {
  start: 'prev,next today',
  center: 'title',
  end: 'dayGridMonth,timeGridWeek,timeGridDay'
}
```

### `footerToolbar`

Same format as `headerToolbar`. Default: `false` (hidden).

### Custom Buttons

```js
customButtons: {
  myButton: {
    text: 'custom!',
    click: function() {
      alert('clicked the custom button!');
    }
  }
},
headerToolbar: {
  start: 'prev,next today myButton',
  center: 'title',
  end: 'dayGridMonth,timeGridWeek'
}
```

### Button Text Override

```js
buttonText: {
  today: 'Today',
  month: 'Month',
  week: 'Week',
  day: 'Day',
  list: 'List'
}
```

## Date Navigation

### Options

| Option | Description |
|--------|-------------|
| `initialDate` | Starting date (not dynamically settable — use `gotoDate()`) |
| `initialView` | Starting view (not dynamically settable — use `changeView()`) |
| `validRange` | Restrict navigable date range: `{ start: '2024-01-01', end: '2025-01-01' }` |
| `dateIncrement` | Custom duration for prev/next when using a custom view |
| `dateAlignment` | Align the date range to a specific unit (e.g., `'week'`) |

### Methods

```js
calendar.prev();
calendar.next();
calendar.prevYear();
calendar.nextYear();
calendar.today();
calendar.gotoDate('2024-06-01');
calendar.incrementDate({ months: 1 });
calendar.getDate();                 // returns current Date
calendar.changeView('timeGridWeek');
calendar.changeView('timeGridDay', '2024-09-15');  // change view + date
```

## Date & Time Display

### Day/Time Options

| Option | Default | Description |
|--------|---------|-------------|
| `weekends` | `true` | Show Saturday/Sunday |
| `hiddenDays` | `[]` | Array of day-of-week ints to hide (0=Sun, 6=Sat) |
| `dayHeaders` | `true` | Show day-of-week headers |
| `dayHeaderFormat` | varies | Date formatting for day headers |
| `slotDuration` | `'00:30:00'` | Time slot interval in timeGrid views |
| `slotLabelInterval` | auto | Interval between slot labels |
| `slotLabelFormat` | varies | Format of time labels |
| `slotMinTime` | `'00:00:00'` | Earliest visible time |
| `slotMaxTime` | `'24:00:00'` | Latest visible time |
| `scrollTime` | `'06:00:00'` | Time to scroll to on initial render |
| `scrollTimeReset` | `true` | Reset scroll position on date change |
| `nowIndicator` | `false` | Show current-time line in timeGrid |
| `businessHours` | `false` | Highlight business hours |

### Business Hours

```js
businessHours: {
  daysOfWeek: [1, 2, 3, 4, 5],  // Mon-Fri
  startTime: '09:00',
  endTime: '17:00'
}

// Multiple ranges:
businessHours: [
  { daysOfWeek: [1, 2, 3, 4], startTime: '09:00', endTime: '17:00' },
  { daysOfWeek: [5], startTime: '09:00', endTime: '13:00' }
]
```

### Week Numbers

| Option | Default | Description |
|--------|---------|-------------|
| `weekNumbers` | `false` | Show ISO week numbers |
| `weekNumberCalculation` | `'local'` | `'local'`, `'ISO'`, or a function |
| `weekText` | `'W'` | Text before week number |

### Nav Links

| Option | Default | Description |
|--------|---------|-------------|
| `navLinks` | `false` | Make day/week numbers clickable to navigate |
| `navLinkDayClick` | changes view | Function or view name for day click |
| `navLinkWeekClick` | changes view | Function or view name for week click |

## Sizing

| Option | Default | Description |
|--------|---------|-------------|
| `height` | auto | `'auto'`, a pixel value, `'100%'`, or a function |
| `contentHeight` | auto | Height of the calendar content area (excludes header/footer) |
| `aspectRatio` | `1.35` | Width-to-height ratio |
| `expandRows` | `false` | Expand rows to fill height in dayGrid |
| `stickyHeaderDates` | auto | Sticky header when scrolling |
| `handleWindowResize` | `true` | Auto-resize on window resize |

## Localization

```js
var calendar = new FullCalendar.Calendar(el, {
  locale: 'pl',                // Polish
  firstDay: 1,                 // Monday
  direction: 'ltr',            // or 'rtl'
  buttonText: {
    today: 'Dziś',
    month: 'Miesiąc',
    week: 'Tydzień',
    day: 'Dzień'
  }
});
```

When using the CDN bundle, all locales are included. With ES6:

```js
import plLocale from '@fullcalendar/core/locales/pl';

new Calendar(el, {
  locale: plLocale
});
```

## Time Zones

```js
timeZone: 'UTC'          // default: 'local' (browser timezone)
timeZone: 'Europe/Warsaw'  // requires a timezone plugin (luxon3 or moment-timezone)
```

Without a timezone plugin, only `'local'` and `'UTC'` are supported. For named timezones, add `@fullcalendar/luxon3` or `@fullcalendar/moment-timezone`.

## View-Specific Options

Apply options to specific views only:

```js
views: {
  dayGridMonth: {
    dayMaxEventRows: 3
  },
  timeGridWeek: {
    slotDuration: '00:15:00'
  }
}
```
