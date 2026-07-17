# Debugging and Troubleshooting

Symptoms, causes, and tools for hyperscript that fails to parse or silently does nothing.

## Silent no-ops — nothing happens, no console error

Work through these causes in order:

1. **Library not loaded, or loaded too late.** The hyperscript `<script>` must be present and must run before user interaction; external `._hs` files must load *before* the hyperscript script tag or their contents are never compiled.
2. **Element inserted by manual JS without processing.** DOM added via `appendChild`/`innerHTML` is inert until `_hyperscript.processNode(element)` runs. HTMX swaps and hyperscript's own `put` process fragments automatically — manual insertion does not.
3. **Attribute name typo.** Only `_`, `script`, and `data-script` are scanned. `data-hs`, `hs`, or `hyperscript` attributes are silently ignored.
4. **Events dropped by queue semantics.** The default `queue last` drops intermediate events while a handler is running. If clicks "randomly" do nothing during long handlers, make queueing explicit (`queue all`, `every`) — see `events-and-async.md`.
5. **`behavior` installed before it was defined.** Locally defined behaviors must appear before the elements that `install` them; behaviors in external `._hs` files must load before the library script tag.

## Parse errors — console error at page load

Hyperscript compiles all attributes at init. A parse failure throws in the console at load time, naming the offending token and source — the element's other handlers still on that attribute are lost with it.

Most common causes:

- **Mixed math without parentheses.** `x * x + y * y` is a parse error; hyperscript requires `(x * x) + (y * y)`.
- **Missing `end`.** Multi-command features in `<script type="text/hyperscript">` blocks (functions, behaviors, `init` blocks) need explicit `end` terminators.
- **JS syntax reflexes.** `===`, `&&`, `!` and friends are not hyperscript; use `is`, `and`, `not`, `no`.
- **Reserved names.** Naming variables after commands/keywords (`put`, `set`, `end`, `it`) confuses the parser; pick different names.

Fix strategy: cut the expression in half until the error disappears, then rebuild with explicit parentheses and `end` markers.

## Inspection tools

- **`log`** — the built-in print command: `log me`, `log its value`. Logs to the browser console mid-script.
- **`beep!`** — debugging operator: prefix any expression (`set x to beep! <div.foo/>`) and hyperscript logs the expression source, its value, and its type to the console *without changing the expression's result*. Remove after use.
- **hdb (hyperscript debugger)** — include `dist/hdb.js` alongside the library, then place a `breakpoint` command in a handler. Execution pauses with an in-page console to step through commands and inspect variables. Development only — never ship hdb includes.
- **Browser event listeners panel** — compiled handlers register as normal DOM listeners; the Elements → Event Listeners tab confirms whether a handler attached at all (if absent, the element was never processed — see silent no-ops above).

## Runtime errors mid-handler

A command that throws (e.g. `call` into a failing JS function) stops that handler run; the exception surfaces in the console. Use `throw` and `catch` blocks (see `core-language.md`) where a fallback matters, and remember async transparency: an uncaught rejection in an awaited promise surfaces the same way.
