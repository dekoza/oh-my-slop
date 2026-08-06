# FullCalendar — Display, Render Hooks, and Styling

## Event Display Options

| Option | Default | Description |
|--------|---------|-------------|
| `eventColor` | none | Shorthand for background + border color of all events |
| `eventBackgroundColor` | none | Background color for all events |
| `eventBorderColor` | none | Border color for all events |
| `eventTextColor` | none | Text color for all events |
| `eventDisplay` | `'auto'` | How events render: `'auto'`, `'block'`, `'list-item'`, `'background'`, `'inverse-background'`, `'none'` |
| `eventTimeFormat` | varies | Date formatting object for event time text |
| `displayEventTime` | `true` | Show time text on events |
| `displayEventEnd` | varies | Show end time |
| `nextDayThreshold` | `'00:00:00'` | Multi-day events ending before this time show one fewer day |
| `eventOrder` | `'start,-duration,allDay,title'` | Sort order for events on the same day |
| `eventOrderStrict` | `false` | Strict ordering even if it causes gaps |
| `progressiveEventRendering` | `false` | Render events as they arrive |

### Background Events

Set `display: 'background'` on an event to render it as a background highlight:

```js
events: [
  { title: 'Business', start: '2024-09-01T09:00', end: '2024-09-01T17:00', display: 'background' },
  { title: 'Holiday', start: '2024-09-05', end: '2024-09-06', display: 'background', color: '#ff9f89' }
]
```

`'inverse-background'` highlights everything EXCEPT the specified range.

## Render Hooks

FullCalendar uses a four-hook pattern for DOM customization. Each area that supports hooks provides:

| Suffix | Description |
|--------|-------------|
| `*ClassNames` | Add CSS classes. Returns a string or array of strings. |
| `*Content` | Replace inner content. Returns text, `{ html }`, `{ domNodes }`, or uses a function. |
| `*DidMount` | Called after the element is added to the DOM. Receives `info.el`. |
| `*WillUnmount` | Called before the element is removed from the DOM. Receives `info.el`. |

### Event Render Hooks

```js
// Add classes conditionally
eventClassNames: function(info) {
  if (info.event.extendedProps.urgent) {
    return ['urgent-event'];
  }
},

// Custom content via DOM nodes
eventContent: function(info) {
  var timeEl = document.createElement('b');
  timeEl.textContent = info.timeText;
  var titleEl = document.createElement('span');
  titleEl.textContent = info.event.title;
  return { domNodes: [timeEl, titleEl] };
},

// Modify element after mounting
eventDidMount: function(info) {
  info.el.title = info.event.extendedProps.description || '';
},

// Cleanup before unmounting
eventWillUnmount: function(info) {
  // destroy tooltips, etc.
}
```

`eventContent` and `eventClassNames` are called on every data change. `eventDidMount` is called only once per element creation.

**`eventContent` argument properties:** `event`, `timeText`, `isStart`, `isEnd`, `isMirror`, `isPast`, `isFuture`, `isToday`, `view`.

**`eventDidMount` and `eventWillUnmount` also receive:** `el` (the HTML element).

### Day-Cell Render Hooks

| Hook | Description |
|------|-------------|
| `dayCellClassNames` | Classes on each day cell |
| `dayCellContent` | Content inside the day cell |
| `dayCellDidMount` | After day cell is in DOM |
| `dayCellWillUnmount` | Before day cell is removed |

`info` properties: `date`, `dayNumberText`, `isPast`, `isFuture`, `isToday`, `isOther`, `view`, `el` (mount hooks only).

### Day-Header Render Hooks

| Hook | Description |
|------|-------------|
| `dayHeaderClassNames` | Classes on day-of-week header |
| `dayHeaderContent` | Content in header cell |
| `dayHeaderDidMount` | After header is in DOM |
| `dayHeaderWillUnmount` | Before header is removed |

### Slot Render Hooks (TimeGrid)

| Hook | Description |
|------|-------------|
| `slotLabelClassNames` | Classes on time slot labels |
| `slotLabelContent` | Content of time slot labels |
| `slotLabelDidMount` | After slot label is in DOM |
| `slotLabelWillUnmount` | Before slot label is removed |
| `slotLaneClassNames` | Classes on the slot lane |
| `slotLaneContent` | Content in the slot lane |
| `slotLaneDidMount` | After slot lane is in DOM |
| `slotLaneWillUnmount` | Before slot lane is removed |

### More-Link Render Hooks (Event Popover)

| Option | Description |
|--------|-------------|
| `dayMaxEventRows` | Max event rows before "+N more" link |
| `dayMaxEvents` | Max events per day before "+N more" link |
| `eventMaxStack` | Max event stack depth |
| `moreLinkClick` | Action when "+N more" is clicked: `'popover'` (default), `'day'`, `'week'`, or a function |

## Content Injection Formats

The `*Content` hooks accept these formats:

```js
// Plain text (auto-escaped)
eventContent: 'some text'

// HTML string (be cautious of XSS)
eventContent: { html: '<i>italic event</i>' }

// DOM nodes
eventContent: { domNodes: [myElement] }

// Function returning any of the above
eventContent: function(arg) {
  var el = document.createElement('div');
  el.innerHTML = '<b>' + arg.timeText + '</b> ' + arg.event.title;
  return { domNodes: [el] };
}

// Virtual DOM (Preact h() function — second arg)
eventContent: function(arg, createElement) {
  return createElement('i', {}, arg.event.title);
}
```

Content injection in vanilla JS only. React/Vue/Angular connectors use their own patterns (JSX, slots, templates).

## CSS Customization

### CSS Custom Properties (v6)

FullCalendar v6 exposes CSS custom properties for common values:

```css
:root {
  --fc-border-color: #ddd;
  --fc-daygrid-event-dot-width: 8px;
  --fc-event-bg-color: #3788d8;
  --fc-event-border-color: #3788d8;
  --fc-event-text-color: #fff;
  --fc-event-selected-overlay-color: rgba(0, 0, 0, 0.25);
  --fc-today-bg-color: rgba(255, 220, 40, 0.15);
  --fc-now-indicator-color: red;
  --fc-page-bg-color: #fff;
  --fc-neutral-bg-color: rgba(208, 208, 208, 0.3);
  --fc-neutral-text-color: #808080;
  --fc-list-event-hover-bg-color: #f5f5f5;
  --fc-non-business-color: rgba(215, 215, 215, 0.3);
  --fc-bg-event-color: rgb(143, 223, 130);
  --fc-bg-event-opacity: 0.3;
  --fc-highlight-color: rgba(188, 232, 241, 0.3);
  --fc-small-font-size: 0.85em;
}
```

### Key CSS Classes

| Class | Purpose |
|-------|---------|
| `.fc` | Root calendar element |
| `.fc-event` | Event elements |
| `.fc-event-title` | Event title text |
| `.fc-event-time` | Event time text |
| `.fc-daygrid-event` | Event in dayGrid view |
| `.fc-timegrid-event` | Event in timeGrid view |
| `.fc-day-today` | Today's cell |
| `.fc-day-past` | Past day cells |
| `.fc-day-future` | Future day cells |
| `.fc-day-other` | Days from other months shown in grid |
| `.fc-button` | Toolbar buttons |
| `.fc-toolbar` | Toolbar container |
| `.fc-toolbar-title` | Title in toolbar |
| `.fc-bg-event` | Background events |
| `.fc-highlight` | Date selection highlight |
| `.fc-now-indicator` | Current-time line in timeGrid |

### Theming

```js
// Bootstrap 5 theming
themeSystem: 'bootstrap5'
// Requires @fullcalendar/bootstrap5 plugin + Bootstrap 5 CSS loaded on the page
```

Without `themeSystem`, FullCalendar uses its own default theme ("standard").
