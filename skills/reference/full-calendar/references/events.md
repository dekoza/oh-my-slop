# FullCalendar — Events

## Event Parsing (Input Format)

When you provide events — via array, JSON feed, or `addEvent()` — you give plain objects. FullCalendar parses them into Event Objects. All properties are optional:

| Property | Type | Description |
|----------|------|-------------|
| `id` | String/Int | Unique identifier |
| `groupId` | String/Int | Events sharing a groupId drag/resize together |
| `allDay` | Boolean | Show in all-day section. Inferred from start/end format if omitted |
| `start` | ISO8601 string or ms timestamp | When the event begins (**inclusive**) |
| `end` | ISO8601 string or ms timestamp | When the event ends (**exclusive**) |
| `title` | String | Display text |
| `url` | String | Browser navigates here on click (prevent with `jsEvent.preventDefault()`) |
| `className` / `classNames` | String/Array | CSS classes on the event element |
| `editable` | Boolean | Override global `editable` for this event |
| `startEditable` | Boolean | Override global `eventStartEditable` |
| `durationEditable` | Boolean | Override global `eventDurationEditable` |
| `display` | String | `'auto'`, `'block'`, `'list-item'`, `'background'`, `'inverse-background'`, `'none'` |
| `overlap` | Boolean | Override global `eventOverlap` |
| `constraint` | groupId/`"businessHours"`/object | Override global `eventConstraint` |
| `color` | String | Shorthand for backgroundColor + borderColor |
| `backgroundColor` | String | Event background color |
| `borderColor` | String | Event border color |
| `textColor` | String | Event text color |
| `extendedProps` | Object | Custom properties accessible at `event.extendedProps` |
| *any other property* | any | Silently moved to `extendedProps` |

### Recurring Event Properties

| Property | Description |
|----------|-------------|
| `daysOfWeek` | Array of ints: `[0]` = Sunday, `[1]` = Monday, etc. |
| `startTime` | Duration string (e.g., `'10:00'`) |
| `endTime` | Duration string |
| `startRecur` | Date when recurrence begins |
| `endRecur` | Date when recurrence ends |

### Critical: `end` is exclusive

An event with `start: '2024-09-01'` and `end: '2024-09-03'` spans Sep 1 and Sep 2 only. The event ends before Sep 3 begins. This matches iCalendar RFC 5545.

### Critical: `allDay` inference

If `start` and `end` are both date-only strings (`2024-09-01`) without time parts, `allDay` is inferred as `true`. If either has a time part, `allDay` is `false`.

## Event Object (After Parsing)

Once parsed, an Event Object has read-only properties. Modify via methods:

| Property | Type | Notes |
|----------|------|-------|
| `id` | String | |
| `groupId` | String | |
| `allDay` | Boolean | |
| `start` | Date object | Obeys calendar timeZone |
| `end` | Date object or null | |
| `startStr` | String | ISO8601 |
| `endStr` | String | ISO8601 |
| `title` | String | |
| `url` | String | |
| `classNames` | Array | |
| `editable` | Boolean/null | |
| `display` | String | |
| `backgroundColor` | String | |
| `borderColor` | String | |
| `textColor` | String | |
| `extendedProps` | Object | All custom properties end up here |
| `source` | EventSource/null | Reference to originating source |

### Event Methods

```js
event.setProp('title', 'New Title');
event.setExtendedProp('department', 'Engineering');
event.setStart('2024-09-15');
event.setEnd('2024-09-17');
event.setDates('2024-09-15', '2024-09-17');
event.setAllDay(true);
event.moveStart({ days: 1 });
event.moveEnd({ days: -1 });
event.moveDates({ days: 2 });
event.remove();
event.toPlainObject();  // serialize back to plain object
```

### Calendar Event Methods

```js
calendar.getEvents();                    // all Event Objects
calendar.getEventById('my-id');          // single Event Object
calendar.addEvent({ title: 'New', start: '2024-09-01' });
calendar.addEvent(eventData, sourceId);  // associate with a source
```

## Event Sources

### 1. Array

```js
var calendar = new FullCalendar.Calendar(el, {
  events: [
    { title: 'Event 1', start: '2024-09-05T09:00:00', end: '2024-09-05T18:00:00' },
    { title: 'Event 2', start: '2024-09-08', end: '2024-09-10' }
  ]
});
```

### 2. JSON Feed (most common for server backends)

```js
var calendar = new FullCalendar.Calendar(el, {
  events: '/api/events/'
});
```

FullCalendar auto-sends `?start=ISO8601&end=ISO8601` query parameters when the view's date range changes. The endpoint must return a JSON array of event objects.

**Extended form** for extra control:

```js
events: {
  url: '/api/events/',
  method: 'POST',
  extraParams: {
    category: 'meetings'
  },
  extraParams: function() {   // dynamic params
    return { token: getToken() };
  },
  failure: function() {
    alert('Error loading events');
  },
  color: 'blue',
  textColor: 'white'
}
```

**Param customization:**

| Option | Default | Description |
|--------|---------|-------------|
| `startParam` | `'start'` | Query param name for range start |
| `endParam` | `'end'` | Query param name for range end |
| `timeZoneParam` | `'timeZone'` | Query param name for timezone |
| `lazyFetching` | `true` | Re-use cached events if date range overlaps |

**Cache busting:**

```js
extraParams: function() {
  return { _: new Date().valueOf() };
}
```

### 3. Function

```js
events: function(fetchInfo, successCallback, failureCallback) {
  fetch('/api/events/?start=' + fetchInfo.startStr + '&end=' + fetchInfo.endStr)
    .then(response => response.json())
    .then(data => successCallback(data))
    .catch(err => failureCallback(err));
}
```

`fetchInfo` contains: `start` (Date), `end` (Date), `startStr`, `endStr`, `timeZone`.

You can also return a Promise instead of using callbacks.

### Multiple Sources

```js
eventSources: [
  { url: '/api/meetings/', color: 'blue' },
  { url: '/api/holidays/', color: 'green', display: 'background' }
]
```

### Event Source Methods

```js
calendar.getEventSources();
calendar.getEventSourceById('src-1');
calendar.addEventSource({ url: '/api/new-source/' });
calendar.refetchEvents();           // re-fetch all sources
eventSource.refetch();              // re-fetch a single source
eventSource.remove();               // remove a source
```

### Event Lifecycle Callbacks

| Callback | When |
|----------|------|
| `eventAdd` | After an event is added to the calendar |
| `eventChange` | After an event's properties change |
| `eventRemove` | After an event is removed |
| `eventsSet` | After all event data is set/changed (bulk) |
| `eventSourceSuccess` | After a source successfully returns data |
| `eventSourceFailure` | After a source fails to return data |
| `loading` | `true` when fetching starts, `false` when it ends |

### JSON Response Format

The backend must return a JSON array:

```json
[
  {
    "id": "1",
    "title": "Team Meeting",
    "start": "2024-09-05T09:00:00",
    "end": "2024-09-05T10:00:00",
    "extendedProps": {
      "department": "Engineering",
      "room": "A-101"
    }
  },
  {
    "id": "2",
    "title": "All Hands",
    "start": "2024-09-08",
    "end": "2024-09-09",
    "color": "#ff6600"
  }
]
```

ISO8601 strings and millisecond timestamps both work. Native JS Date constructor strings (`new Date(...)`) do **not** work in JSON.
