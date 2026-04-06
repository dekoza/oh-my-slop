# Advanced Features and Interop

Remote content, JavaScript interop, behaviors, workers, sockets, event sources, debugging, and extension hooks.

## fetch Command

Issues a `fetch` request. URL can be naked or a string literal:

```hyperscript
fetch /api/data
fetch `/users/${userId}` as json
```

### Response Handling

| Modifier | Result type |
|----------|-------------|
| (none) | Text |
| `as json` | Parsed JSON object |
| `as html` | Parsed HTML |
| `as response` | Raw Response object |

Result is stored in `it` / `result`.

### Request Configuration

Use `with` for method, headers, body, and timeout:

```hyperscript
fetch /api/data as json with method:"POST", headers:{"X-Custom": "value"}, body:payload
fetch /api/data with timeout:300ms
```

### Cancellation

Send a `fetch:abort` event to the element that triggered the request:

```hyperscript
send fetch:abort to #fetchButton
```

### fetch Events

| Event | When |
|-------|------|
| `fetch:beforeRequest` | Before request sends (configure headers here) |
| `fetch:afterResponse` | After response received, before processing |
| `fetch:afterRequest` | After response has been processed |
| `fetch:error` | On error |

Example — adding auth headers globally:

```hyperscript
-- on a parent element or body
on fetch:beforeRequest(headers)
  set headers['X-AuthToken'] to getAuthToken()
```

### Dynamic URLs

Use template literals:

```hyperscript
set userId to @data-user-id
fetch `/users/${userId}/profile` as json
```

## `go` Command

Navigate to pages or scroll positions:

```hyperscript
go to url "/dashboard"
go to the top of the body smoothly
```

## JavaScript Interop

### `call` and `get`

Invoke JavaScript functions and store results:

```hyperscript
call alert('Hello!')
get localStorage.getItem('key')
log it
```

Both store the return value in `it` / `result`.

### Pseudo-Command Syntax

Put the method name first for readability:

```hyperscript
reload() the location of the window
writeText('text') into the navigator's clipboard
reset() the #contact-form
```

### Inline `js ... end` Blocks

Embed JavaScript directly:

```hyperscript
js
  alert('This is JavaScript');
end
```

**Interop boundary rule**: if the solution is mostly `js ... end` blocks, the task should use JavaScript directly. Use `call`/`get` for isolated JS function invocations; inline JS blocks for entire features is a code smell.

### Accessing JS Globals

`window`, `localStorage`, `navigator`, `document`, and other browser globals are directly accessible from hyperscript.

## Behavior

Reusable bundles of hyperscript that can be installed on elements:

```html
<script type="text/hyperscript">
  behavior Removable(removeButton)
    init
      if no removeButton set the removeButton to me
    end
    on click from removeButton
      remove me
    end
  end
</script>
```

Install on elements:

```html
<div _="install Removable(removeButton: #close-btn)">...</div>
```

### Parameters and Defaults

Behaviors accept named arguments via `install`. Use `init` blocks to set parameter defaults:

```hyperscript
behavior Collapsible(triggerButton)
  init
    if no triggerButton set the triggerButton to me
  end
  on click from triggerButton
    toggle .collapsed on me
  end
end
```

### Ordering Constraints

- Locally defined behaviors must appear BEFORE elements that `install` them in the DOM order.
- Behaviors in external `._hs` files: the `<script type="text/hyperscript" src="...">` tag must appear BEFORE the main hyperscript `<script>` tag.

## Worker

**Requires separate script**: `/dist/workers.js` or the "Whole 9 Yards" bundle. NOT included in the default hyperscript.

Creates a Web Worker. Functions declared with `def` inside the worker are exposed to the main thread and return Promises (transparently awaited by hyperscript callers):

```html
<script src="https://unpkg.com/hyperscript.org/dist/workers.js"></script>

<script type="text/hyperscript">
  worker Computation
    def factorial(n)
      if n <= 1 return 1 end
      return n * factorial(n - 1)
    end
  end
</script>
```

Call from hyperscript:

```hyperscript
on click
  set answer to factorial(20)
  put answer into me
```

Worker bodies cannot access DOM or `window`. Use `importScripts` for external dependencies.

## Socket

**Requires separate script**: `/dist/socket.js` or the "Whole 9 Yards" bundle. NOT included in the default hyperscript.

Creates a WebSocket connection:

```html
<script src="https://unpkg.com/hyperscript.org/dist/socket.js"></script>

<script type="text/hyperscript">
  socket MySocket ws://localhost:8080
    on message as json
      put it.text into #messages
    end
  end
</script>
```

Send messages:

```hyperscript
send myEvent to MySocket
```

### RPC Mechanism

```hyperscript
call MySocket.rpc.functionName(args)
```

RPC uses JSON protocol: `{iid, function, args}` / `{iid, return}` / `{iid, throw}`. Configurable timeout.

## EventSource

**Requires separate script**: `/dist/eventsource.js` or the "Whole 9 Yards" bundle. NOT included in the default hyperscript.

Subscribes to Server-Sent Events:

```html
<script src="https://unpkg.com/hyperscript.org/dist/eventsource.js"></script>

<script type="text/hyperscript">
  eventsource Updates /api/events
    on message as json
      put it.text into #updates
    end
    on open
      log "Connected"
    end
  end
</script>
```

Named event handlers with `as json` or `as string` decoding. Connection lifecycle events: `open`, `close`, `error`. Dynamic connections via `open(url)`. Auto-reconnect on failure.

## Debugging

### `beep!`

Debug print — logs the expression value and triggers a `hyperscript:beep` event on the `body`:

```hyperscript
set x to 42
beep! x     -- logs 42 to console, triggers hyperscript:beep
```

Can be inserted anywhere in a pipeline: `beep! <.foo/>`.

### HDB (Hyperscript Debugger)

A built-in debugger that can be activated to step through hyperscript execution. Upstream docs are limited; verify behavior against the source.

## Extension Hooks

`_hyperscript.addCommand(...)` allows defining custom commands in JavaScript. Upstream documentation for this API is thin; verify behavior against the hyperscript source repository.

## Security

Hyperscript evaluates code embedded in HTML attributes. The same security considerations as inline JavaScript apply:

- Never put untrusted user content into hyperscript attributes
- Server-side escape all user-supplied content
- CSP headers that restrict inline scripts will also affect hyperscript
