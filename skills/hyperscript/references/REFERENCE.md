# Hyperscript Quick Reference

Cross-file index for fast lookup. Find the topic, then open the linked reference file.

## Syntax and Variables

| Topic | Reference |
|-------|-----------|
| Comments (`--`), separators (`then`, `end`) | [core-language.md](core-language.md) |
| Variables: local, element (`:`), global (`$`) | [core-language.md](core-language.md) |
| Scope modifiers (`local`, `element`, `global`) | [core-language.md](core-language.md) |
| Special symbols (`it`, `me`, `event`, `target`, `detail`, `sender`) | [core-language.md](core-language.md) |
| Comparisons (`is`, `matches`, `exists`, `no`, `is empty`) | [core-language.md](core-language.md) |
| Loops (`repeat for`, `while`, `until`, `times`, `forever`) | [core-language.md](core-language.md) |
| Math (operators, `mod`, parenthesization rules) | [core-language.md](core-language.md) |
| Strings, template literals, `append` | [core-language.md](core-language.md) |
| Conversions (`as Int`, `as JSON`, `as Fragment`, etc.) | [core-language.md](core-language.md) |
| Closures (`\ arg -> expr`) | [core-language.md](core-language.md) |
| Functions (`def`, namespacing, `return`, `exit`) | [core-language.md](core-language.md) |
| Exception handling (`catch`, `finally`, `throw`) | [core-language.md](core-language.md) |

## DOM Queries and Updates

| Topic | Reference |
|-------|-----------|
| DOM literals (`.class`, `#id`, `<query/>`, `@attr`, `*style`) | [dom-and-commands.md](dom-and-commands.md) |
| Template syntax (`#{expr}`, `.{expr}`, `<${expr}/>`) | [dom-and-commands.md](dom-and-commands.md) |
| `in` expression (scoped queries) | [dom-and-commands.md](dom-and-commands.md) |
| `closest` and `closest parent` | [dom-and-commands.md](dom-and-commands.md) |
| Positional (`first`, `last`, `random`) | [dom-and-commands.md](dom-and-commands.md) |
| Relative positional (`next`, `previous`) | [dom-and-commands.md](dom-and-commands.md) |
| `set` vs `put` (placement: `into`, `before`, `after`, `at start of`, `at end of`) | [dom-and-commands.md](dom-and-commands.md) |
| `add`, `remove`, `toggle` (classes and attributes) | [dom-and-commands.md](dom-and-commands.md) |
| `show`, `hide` (display/visibility/opacity) | [dom-and-commands.md](dom-and-commands.md) |
| `take` (exclusive class ownership) | [dom-and-commands.md](dom-and-commands.md) |
| `tell` (temporary implicit target) | [dom-and-commands.md](dom-and-commands.md) |
| `make` (create instances and DOM elements) | [dom-and-commands.md](dom-and-commands.md) |
| `measure` (element dimensions) | [dom-and-commands.md](dom-and-commands.md) |
| `transition`, `settle` (CSS transitions) | [dom-and-commands.md](dom-and-commands.md) |

## Events and Async

| Topic | Reference |
|-------|-----------|
| `on` handlers (syntax, `every`, `from`, `debounced at`, `throttled at`) | [events-and-async.md](events-and-async.md) |
| Event chaining (`or`) | [events-and-async.md](events-and-async.md) |
| `init` blocks | [events-and-async.md](events-and-async.md) |
| Event queueing (`queue last/all/first/none`, `every`) | [events-and-async.md](events-and-async.md) |
| Event destructuring (parameters from `event`/`event.detail`) | [events-and-async.md](events-and-async.md) |
| Event filters (`[key is 'Escape']`) | [events-and-async.md](events-and-async.md) |
| `send` / `trigger` (dispatching events) | [events-and-async.md](events-and-async.md) |
| Synthetic events (`on mutation`, `on intersection`) | [events-and-async.md](events-and-async.md) |
| `wait` (duration or event) | [events-and-async.md](events-and-async.md) |
| Async transparency (automatic Promise awaiting) | [events-and-async.md](events-and-async.md) |
| Promise short-circuit caveat (`and`/`or` with Promises) | [events-and-async.md](events-and-async.md) |
| `halt`, `halt the event`, `exit` | [events-and-async.md](events-and-async.md) |

## Remote Content, JS Interop, and Advanced Features

| Topic | Reference |
|-------|-----------|
| `fetch` (URL, `as json/html/response`, `with`, timeout, cancellation) | [advanced-and-interop.md](advanced-and-interop.md) |
| `fetch` events (`fetch:beforeRequest`, etc.) | [advanced-and-interop.md](advanced-and-interop.md) |
| `go` (navigation) | [advanced-and-interop.md](advanced-and-interop.md) |
| `call` / `get` (JS function invocation) | [advanced-and-interop.md](advanced-and-interop.md) |
| Pseudo-command syntax | [advanced-and-interop.md](advanced-and-interop.md) |
| Inline `js ... end` blocks | [advanced-and-interop.md](advanced-and-interop.md) |
| `behavior` (definition, `install`, parameters, ordering) | [advanced-and-interop.md](advanced-and-interop.md) |
| `worker` (requires `/dist/workers.js`) | [advanced-and-interop.md](advanced-and-interop.md) |
| `socket` (requires `/dist/socket.js`, RPC) | [advanced-and-interop.md](advanced-and-interop.md) |
| `eventsource` (requires `/dist/eventsource.js`) | [advanced-and-interop.md](advanced-and-interop.md) |
| `beep!` (debug printing) | [advanced-and-interop.md](advanced-and-interop.md) |
| Extension hooks (`_hyperscript.addCommand(...)`) | [advanced-and-interop.md](advanced-and-interop.md) |
| Security considerations | [advanced-and-interop.md](advanced-and-interop.md) |

## Debugging

| Topic | File |
|---|---|
| Silent no-ops (unprocessed DOM, attribute typos, queue-dropped events) | [debugging.md](debugging.md) |
| Parse errors (math parenthesization, missing `end`, JS syntax reflexes) | [debugging.md](debugging.md) |
| Inspection tools (`log`, `beep!`, hdb debugger, event-listener panel) | [debugging.md](debugging.md) |
