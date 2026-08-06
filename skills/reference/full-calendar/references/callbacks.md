# FullCalendar — Callbacks

All callbacks are passed as options to the Calendar constructor. They receive a single object argument with context-specific properties.

## Date Clicking

### `dateClick`

Fires when the user clicks a date cell or time slot. **Requires** the `interaction` plugin.

```js
dateClick: function(info) {
  console.log('Clicked:', info.dateStr);  // '2024-09-15' or '2024-09-15T10:30:00'
  console.log('All day?', info.allDay);
  console.log('Element:', info.dayEl);
  console.log('View:', info.view.type);
  console.log('JS event:', info.jsEvent);
}
```

`info` properties: `date` (Date), `dateStr` (ISO8601), `allDay` (Boolean), `dayEl` (HTMLElement), `jsEvent` (native event), `view` (View Object), `resource` (premium).

Does NOT fire in list view when clicking a day heading.

## Date Selecting

### `select`

Fires when the user selects a date range (click-drag or touch-hold-drag). **Requires** `interaction` plugin + `selectable: true`.

```js
selectable: true,
select: function(info) {
  console.log('Selected from', info.startStr, 'to', info.endStr);
  console.log('All day?', info.allDay);
  // Prompt user to create event, then:
  calendar.addEvent({ title: 'New Event', start: info.start, end: info.end, allDay: info.allDay });
  calendar.unselect();
}
```

`info` properties: `start` (Date), `end` (Date — **exclusive**), `startStr`, `endStr`, `allDay`, `jsEvent`, `view`, `resource` (premium).

### `unselect`

Fires when the current selection is cleared.

### Selection Options

| Option | Default | Description |
|--------|---------|-------------|
| `selectable` | `false` | Enable date range selection |
| `selectMirror` | `false` | Show a mirror event while selecting in timeGrid |
| `unselectAuto` | `true` | Auto-unselect when clicking elsewhere |
| `unselectCancel` | `''` | CSS selector for elements that should NOT trigger unselect |
| `selectOverlap` | `true` | Allow selecting over existing events |
| `selectConstraint` | none | Restrict selection to certain times |
| `selectAllow` | none | Programmatic control: `function(selectInfo) { return bool }` |
| `selectMinDistance` | `0` | Minimum pixels before selection starts (prevents accidental) |

## Event Clicking

### `eventClick`

Fires when an event is clicked. Does NOT require the `interaction` plugin.

```js
eventClick: function(info) {
  console.log('Event:', info.event.title);
  console.log('Event ID:', info.event.id);
  console.log('Element:', info.el);
  
  // Prevent default URL navigation
  info.jsEvent.preventDefault();
  
  // Access extended props
  console.log('Custom:', info.event.extendedProps.department);
}
```

`info` properties: `event` (Event Object), `el` (HTMLElement), `jsEvent` (native event), `view` (View Object).

If the event has a `url` property, clicking navigates to that URL by default. Call `info.jsEvent.preventDefault()` to prevent this.

### `eventMouseEnter` / `eventMouseLeave`

```js
eventMouseEnter: function(info) { /* info.event, info.el, info.jsEvent, info.view */ },
eventMouseLeave: function(info) { /* same properties */ }
```

## Event Dragging & Resizing

All drag/resize callbacks require the `interaction` plugin and `editable: true`.

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `editable` | `false` | Enable both dragging and resizing |
| `eventStartEditable` | inherits `editable` | Allow dragging the event start |
| `eventDurationEditable` | inherits `editable` | Allow resizing (duration change) |
| `eventResizableFromStart` | `false` | Allow resizing from the start edge |
| `eventResourceEditable` | inherits `editable` | Allow drag between resources (premium) |
| `droppable` | `false` | Allow external elements to be dropped onto calendar |
| `eventDragMinDistance` | `5` | Pixels before drag starts |
| `dragRevertDuration` | `500` | Revert animation duration (ms) |
| `dragScroll` | `true` | Auto-scroll while dragging |
| `snapDuration` | matches `slotDuration` | Time snap interval for dragging |
| `eventOverlap` | `true` | Allow overlapping events |
| `eventConstraint` | none | Restrict drag/resize to time windows |
| `eventAllow` | none | Programmatic: `function(dropInfo, event) { return bool }` |

### `eventDrop`

Fires after dragging stops and the event has moved.

```js
eventDrop: function(info) {
  console.log('Moved:', info.event.title);
  console.log('New start:', info.event.startStr);
  console.log('Old start:', info.oldEvent.startStr);
  console.log('Delta:', info.delta);  // { years, months, days, milliseconds }
  
  // Persist to server
  fetch('/api/events/' + info.event.id + '/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: info.event.startStr,
      end: info.event.endStr
    })
  }).catch(function() {
    info.revert();  // undo the drag if server fails
  });
}
```

`info` properties: `event`, `oldEvent`, `relatedEvents`, `delta`, `revert()`, `el`, `jsEvent`, `view`, `oldResource`, `newResource` (premium).

### `eventResize`

Fires after resizing stops and the event's duration has changed.

```js
eventResize: function(info) {
  console.log('Resized:', info.event.title);
  console.log('New end:', info.event.endStr);
  console.log('Duration change:', info.endDelta);
  
  fetch('/api/events/' + info.event.id + '/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ end: info.event.endStr })
  }).catch(function() {
    info.revert();
  });
}
```

`info` properties: `event`, `oldEvent`, `relatedEvents`, `startDelta`, `endDelta`, `revert()`, `el`, `jsEvent`, `view`.

### Other Drag/Resize Callbacks

| Callback | When |
|----------|------|
| `eventDragStart` | Dragging begins (`info.event`, `info.jsEvent`, `info.view`) |
| `eventDragStop` | Dragging stops (regardless of whether event moved) |
| `eventResizeStart` | Resizing begins |
| `eventResizeStop` | Resizing stops |
| `drop` | External element dropped onto calendar |
| `eventReceive` | External element with event data dropped (or event from another calendar) |
| `eventLeave` | Event about to leave this calendar for another |

## External Dragging

Drop elements from outside the calendar onto it:

```js
// Make external element draggable
import { Draggable } from '@fullcalendar/interaction';

new Draggable(containerEl, {
  itemSelector: '.draggable-event',
  eventData: function(eventEl) {
    return {
      title: eventEl.innerText,
      duration: '02:00'
    };
  }
});

// Calendar receives dropped events
var calendar = new Calendar(el, {
  droppable: true,
  eventReceive: function(info) {
    // info.event is the newly created Event Object
    // Persist to server...
  }
});
```

## View/Date Lifecycle

### `datesSet`

Fires whenever the calendar's date range changes (navigation, view change).

```js
datesSet: function(info) {
  console.log('View:', info.view.type);
  console.log('Start:', info.startStr);
  console.log('End:', info.endStr);
  // Useful for syncing other UI with the calendar's visible range
}
```

### `loading`

```js
loading: function(isLoading) {
  if (isLoading) {
    showSpinner();
  } else {
    hideSpinner();
  }
}
```

### `windowResize`

```js
windowResize: function(info) {
  // info.view is the current View Object
}
```

## View Render Hooks

| Hook | When |
|------|------|
| `viewClassNames` | Add CSS classes to the view container |
| `viewDidMount` | After the view element is added to the DOM |
| `viewWillUnmount` | Before the view element is removed |
