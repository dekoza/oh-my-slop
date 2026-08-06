# Events and Async

Event handlers, event queueing, filters, destructuring, async transparency, and waiting.

## `on` Handler Syntax

```ebnf
on [every] <event-name>[(<params>)][\[<filter>\]] [<count>] [from <expr>] [<debounce>|<throttle>]
   { or [every] <event-name>[(<params>)][\[<filter>\]] [<count>] [from <expr>] [<debounce>|<throttle>] }
    [queue (all | first | last | none)]
    {<command>}
[end]
```

### Key Modifiers

- `every` prefix: run handler for every event in parallel, no queuing
- `from <expr>`: listen to events from another element
- `from elsewhere`: listen for the event from outside the current element (click-away patterns)
- `debounced at <time>`: wait until no events for the specified duration
- `throttled at <time>`: fire at most once per time interval
- Count filters: `on click 1` (first click only), `on click 2 to 10`, `on click 11 and on`

### Chaining Events with `or`

One handler for multiple events:

```hyperscript
on click or touchstart
  fetch /example then put it into my innerHTML
```

## `init` Blocks

Run logic when an element is first loaded:

```hyperscript
init
  transition my opacity to 100% over 3 seconds
```

## Event Queueing

| Strategy | Behavior |
|----------|----------|
| `queue last` (default) | Drops intermediate events, queues only the last one |
| `queue all` | Queues all events, processes sequentially |
| `queue first` | Queues the first pending event, drops the rest |
| `queue none` | Drops all events while handler is running |
| `every` prefix | No queue — runs every event in parallel |

Common mistake: not realizing `queue last` drops intermediate events. If every event matters (e.g., logging), use `queue all`. If you want to ignore events during processing, use `queue none`.

## Event Destructuring

Parameters are resolved from `event` properties first, then `event.detail`:

```hyperscript
on mousedown(button)
  put the button into the next <output/>
```

```hyperscript
on showMessage(message)
  put message into me
```

## Event Filters

Bracketed boolean expressions after the event name. Symbols resolve against event properties first, then global scope:

```hyperscript
on keyup[key is 'Escape']
  hide me

on mousedown[button==1]
  add .clicked
```

## Sending Events

`send` and `trigger` dispatch events (they are equivalent):

```hyperscript
send foo to the next <output/>
trigger bar on #target
```

Pass arguments via `event.detail`:

```hyperscript
send showMessage(message: 'Hello!') to #banner
```

## Synthetic Events

### Mutation Events

Use `MutationObserver` API as an event handler:

```hyperscript
on mutation of @foo
  put "Mutated" into me

on mutation of anything
  increment :mutationCount
```

### Intersection Events

Use `IntersectionObserver` API as an event handler:

```hyperscript
on intersection(intersecting) having threshold 0.5
  if intersecting transition opacity to 1
  else transition opacity to 0
```

## `wait` Command

Wait for a duration or an event:

```hyperscript
wait 2s then remove me
wait for transitionend
```

## Async Transparency

Hyperscript automatically awaits Promises. Loops, conditionals, and command chains all work across async boundaries without explicit `await`:

```hyperscript
on click
  fetch /api/data as json    -- returns a Promise, automatically awaited
  put it into me             -- runs after fetch completes
```

### Promise Short-Circuit Caveat

`and`/`or` short-circuit evaluation does NOT await promises on the left side. If the left operand returns a Promise, it is truthy regardless of what the promise resolves to:

```hyperscript
-- WRONG: promise is always truthy, foo() always executes
if returnsPromise() and foo() ...

-- CORRECT: resolve the promise first
get returnsPromise()
if the result and foo() ...
```

## Halting Events

- `halt` — stops propagation, calls `preventDefault()`, and exits the handler
- `halt the event` — stops propagation but continues executing the handler
- `exit` — exits the handler without affecting event propagation

## Loop Control

- `break` — exits the current loop
- `continue` — skips to the next iteration
- `return` — returns a value from a function
- `throw` — raises an exception

## Exception Handling in Event Handlers

Unhandled exceptions in event handlers trigger an `exception` event on the element:

```hyperscript
on exception(error)
  log "Error: " + error
```

Both `catch` and `finally` blocks work on event handlers and respect async transparency:

```hyperscript
on click
  add @disabled to me
  fetch /api/action
  put it into #result
catch e
  put "Error occurred" into #result
finally
  remove @disabled from me
```

## Listener Lifecycle

When an element is removed from the DOM, its event listeners are removed automatically — even if listening to another element via `from`.
