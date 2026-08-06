# FullCalendar — HTMX Integration Patterns

This reference covers how to use FullCalendar with HTMX-driven backends. Two approaches exist, and they can be combined.

## Approach 1: FullCalendar + HTMX Side-by-Side

Use FullCalendar for the calendar grid and client-side interactions. Use HTMX for everything else on the page (modals, panels, detail views). The backend provides event data via a JSON feed.

### Setup

```html
<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js"></script>
<script src="https://unpkg.com/htmx.org@2.0.0"></script>

<div id="calendar"></div>
<div id="event-detail"></div>

<script>
document.addEventListener('DOMContentLoaded', function() {
  var calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    initialView: 'dayGridMonth',

    // Backend provides event JSON
    events: '/api/events/',

    // On event click, load detail via HTMX
    eventClick: function(info) {
      info.jsEvent.preventDefault();
      htmx.ajax('GET', '/events/' + info.event.id + '/detail/', {
        target: '#event-detail',
        swap: 'innerHTML'
      });
    },

    // On date click, open "create event" form via HTMX
    dateClick: function(info) {
      htmx.ajax('GET', '/events/create/?date=' + info.dateStr, {
        target: '#event-detail',
        swap: 'innerHTML'
      });
    },

    // On drag-drop, persist change via fetch (not HTMX — it's a JSON API call)
    editable: true,
    eventDrop: function(info) {
      fetch('/api/events/' + info.event.id + '/', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
          start: info.event.startStr,
          end: info.event.endStr
        })
      }).catch(function() {
        info.revert();
      });
    },

    eventResize: function(info) {
      fetch('/api/events/' + info.event.id + '/', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ end: info.event.endStr })
      }).catch(function() {
        info.revert();
      });
    }
  });

  calendar.render();
});
</script>
```

### Backend JSON Endpoint (Django example)

```python
from django.http import JsonResponse

def events_api(request):
    start = request.GET.get("start")
    end = request.GET.get("end")
    events = Event.objects.filter(
        start__lt=end,
        end__gt=start,
    ).values("id", "title", "start", "end", "color")
    return JsonResponse(list(events), safe=False)
```

FullCalendar sends `?start=ISO8601&end=ISO8601` automatically. Filter your queryset accordingly.

### HTMX Detail View (Django template example)

The `eventClick` callback triggers an HTMX request. The server returns an HTML partial:

```html
{# templates/events/_detail.html #}
<div class="card">
  <div class="card-body">
    <h3>{{ event.title }}</h3>
    <p>{{ event.start|date:"d M Y H:i" }} — {{ event.end|date:"d M Y H:i" }}</p>
    <p>{{ event.description }}</p>
    <button hx-delete="/api/events/{{ event.id }}/"
            hx-target="#event-detail"
            hx-swap="innerHTML"
            hx-confirm="Delete this event?">
      Delete
    </button>
  </div>
</div>
```

### Refreshing Calendar After HTMX Mutation

When an HTMX action creates, updates, or deletes an event, the calendar doesn't know. Trigger a refetch:

```html
{# In the HTMX response, add a trigger header or use hx-on #}
<button hx-post="/events/create/"
        hx-target="#event-detail"
        hx-on::after-request="if(event.detail.successful) document.querySelector('#calendar').__calendar.refetchEvents()">
  Save Event
</button>
```

Or store the calendar instance globally:

```js
window.calendar = calendar;
// Then from HTMX events:
document.body.addEventListener('htmx:afterRequest', function(evt) {
  if (evt.detail.target.id === 'event-detail' && evt.detail.successful) {
    window.calendar.refetchEvents();
  }
});
```

### Key Pattern: Bridging FullCalendar Callbacks to HTMX

FullCalendar callbacks receive JS event data. HTMX sends HTML over the wire. The bridge is `htmx.ajax()`:

```js
htmx.ajax(method, url, { target: selector, swap: strategy });
```

This lets you trigger HTMX-style partial updates from FullCalendar callbacks without writing `hx-*` attributes.

## Approach 2: Server-Rendered Calendar Grid (No FullCalendar)

For simpler use cases — a monthly grid showing events, with server-side rendering — you can skip FullCalendar entirely and render the calendar grid on the server. HTMX handles navigation.

This approach gives you complete control over the HTML/CSS, eliminates a JS dependency, and fits the HTMX hypermedia philosophy. The tradeoff: you lose drag-and-drop, time-grid views, and the sophisticated event layout engine.

### Server-Side Calendar Grid (Python/Django/Jinja2)

```python
import calendar as cal
from datetime import date

def calendar_view(request):
    year = int(request.GET.get("year", date.today().year))
    month = int(request.GET.get("month", date.today().month))

    first_weekday, days_in_month = cal.monthrange(year, month)
    # first_weekday: 0=Monday ... 6=Sunday

    events = Event.objects.filter(
        start__year=year, start__month=month
    ).order_by("start")

    events_by_day = {}
    for event in events:
        day = event.start.day
        events_by_day.setdefault(day, []).append(event)

    # Calculate previous/next month
    if month == 1:
        prev_year, prev_month = year - 1, 12
    else:
        prev_year, prev_month = year, month - 1
    if month == 12:
        next_year, next_month = year + 1, 1
    else:
        next_year, next_month = year, month + 1

    context = {
        "year": year,
        "month": month,
        "month_name": cal.month_name[month],
        "days_in_month": days_in_month,
        "first_weekday": first_weekday,  # 0-based, Monday=0
        "events_by_day": events_by_day,
        "prev_year": prev_year,
        "prev_month": prev_month,
        "next_year": next_year,
        "next_month": next_month,
        "today": date.today(),
    }
    template = "_calendar_grid.html" if request.headers.get("HX-Request") else "calendar.html"
    return TemplateResponse(request, template, context)
```

### Template with HTMX Navigation

```html
{# _calendar_grid.html — this is the HTMX partial #}
<div id="calendar-grid">
  <div class="calendar-nav">
    <button hx-get="{% url 'calendar' %}?year={{ prev_year }}&month={{ prev_month }}"
            hx-target="#calendar-grid"
            hx-swap="outerHTML">
      &larr; Previous
    </button>
    <h2>{{ month_name }} {{ year }}</h2>
    <button hx-get="{% url 'calendar' %}?year={{ next_year }}&month={{ next_month }}"
            hx-target="#calendar-grid"
            hx-swap="outerHTML">
      Next &rarr;
    </button>
  </div>

  <ul class="calendar-weekdays">
    <li>Mon</li><li>Tue</li><li>Wed</li><li>Thu</li><li>Fri</li><li>Sat</li><li>Sun</li>
  </ul>

  <ol class="calendar-month-grid">
    {% for day in range_1_to_days %}
    <li class="calendar-day {% if today.year == year and today.month == month and today.day == day %}calendar-day-today{% endif %}"
        {% if forloop.first %}style="grid-column-start: {{ first_weekday_css }}"{% endif %}>
      <span class="day-number">{{ day }}</span>
      {% for event in events_by_day|get:day %}
        <a class="calendar-event"
           hx-get="/events/{{ event.id }}/detail/"
           hx-target="#event-detail"
           hx-swap="innerHTML">
          {{ event.title }}
        </a>
      {% endfor %}
    </li>
    {% endfor %}
  </ol>
</div>
```

### CSS for the Server-Rendered Grid

```css
.calendar-weekdays,
.calendar-month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  padding: 0;
  list-style: none;
}

.calendar-day {
  padding: 8px;
  min-height: 80px;
  background: var(--tblr-bg-surface, #f8f9fa);
  border-radius: 4px;
}

.calendar-day-today {
  background: rgba(var(--tblr-primary-rgb, 32, 107, 196), 0.1);
  border: 1px solid var(--tblr-primary, #206bc4);
}

.day-number {
  font-weight: 600;
  display: block;
  margin-bottom: 4px;
}

.calendar-event {
  display: block;
  font-size: 0.85em;
  padding: 2px 4px;
  margin-bottom: 2px;
  border-radius: 3px;
  background: var(--tblr-primary, #206bc4);
  color: white;
  text-decoration: none;
  cursor: pointer;
}
```

### `grid-column-start` Offset

The first day of the month may not be Monday. Offset it with `grid-column-start`:

- Python `calendar.monthrange()` returns `first_weekday` as 0=Monday.
- CSS `grid-column-start` is 1-based.
- So: `grid-column-start = first_weekday + 1` (if your grid starts on Monday).
- If your grid starts on Sunday, adjust accordingly: Sunday=0 needs to become column 1.

## Which Approach to Use?

| Factor | FullCalendar + HTMX | Server-Rendered Grid |
|--------|--------------------|--------------------|
| Drag-and-drop | Yes | No |
| Time-grid (hour slots) | Yes | No (monthly grid only) |
| Event overlap layout | Yes (automatic) | Manual |
| Bundle size | ~40KB gzipped | 0 JS (just HTMX) |
| Control over HTML | Limited (render hooks) | Complete |
| HTMX philosophy alignment | Partial (calendar is JS-driven) | Full |
| Complexity | Medium | Low |

**Recommendation:** Use FullCalendar when you need drag-and-drop, multiple view types, or time-slot views. Use the server-rendered grid for simple monthly calendars where events are read-only or interactions are handled via HTMX modals.
