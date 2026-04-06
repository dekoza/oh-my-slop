# Hyperscript Skill Design

## Summary

Create a new `skills/hyperscript` reference skill for the `///_hyperscript` front-end scripting language.

The skill should be a full language reference, but organized as a compact entrypoint plus focused reference files. It should cover the core language, DOM manipulation, events, async behavior, remote content, JavaScript interop, advanced features, debugging, and extension points. It should also include a narrow HTMX bridge section because hyperscript is commonly used as HTMX's companion, but it must not duplicate the existing `htmx` skill.

## Goals

1. Give agents a reliable reference for hyperscript syntax and behavior so they stop inventing commands, attributes, queue semantics, and lifecycle rules.
2. Cover the full practical language surface, including advanced features such as `behavior`, `eventsource`, `socket`, `worker`, debugging, and extension hooks.
3. Keep `SKILL.md` small enough to route effectively, with deeper material in `references/*.md`.
4. Fit the existing style of this repository: compact skill entrypoint, strong guardrails, reference map, task routing, evals, and tests.
5. Preserve a clean boundary with the existing `htmx` skill so each skill owns its own domain.

## Non-Goals

1. Do not mirror the entire hyperscript website verbatim.
2. Do not turn the skill into a cookbook dump of every example snippet.
3. Do not absorb HTMX ownership. HTMX request/response semantics, `hx-*` attributes, and swap patterns stay in the `htmx` skill.
4. Do not make this a Django- or Litestar-specific skill.

## Source Basis

The skill should be grounded in verified public sources reviewed during design:

1. Main site: `https://hyperscript.org/`
2. Docs: `https://hyperscript.org/docs/`
3. Reference index: `https://hyperscript.org/reference/`
4. Cookbook: `https://hyperscript.org/cookbook/`
5. Source repository README: `https://github.com/bigskysoftware/_hyperscript`

The docs currently advertise the public install snippet:

```html
<script src="https://unpkg.com/hyperscript.org@0.9.14"></script>
```

The skill should therefore target hyperscript `0.9.x`, with `0.9.14` noted as the currently verified install version.

## Repo Constraints

1. The repository prefers compact `SKILL.md` files with deeper material in `references/*.md`.
2. Reference integrity is validated by `scripts/validate_refs.py` and `tests/test_validate_refs.py`.
3. The project uses `uv`; tests should run with `uv run pytest`.
4. Existing higher-quality skills such as `htmx`, `drf`, `python-async`, and `full-calendar` should be treated as structural examples.

## Skill Boundary

### This skill owns

1. Hyperscript syntax and structure.
2. Event handlers, event queueing, filters, destructuring, synthetic events, and `init` blocks.
3. Variables, scope, special symbols, literals, comparisons, loops, math, conversions, functions, and exception handling.
4. DOM literals, DOM queries, DOM mutation commands, transitions, settle behavior, and measurement.
5. Async transparency, `wait`, `fetch`, `go`, and interoperability with JavaScript.
6. Advanced features such as `behavior`, `eventsource`, `socket`, `worker`, debugging, and extension hooks.
7. Hyperscript-specific integration rules when used alongside HTMX.

### This skill does not own

1. HTMX request model, `hx-*` attribute semantics, swap strategies, or extension APIs.
2. Django, Litestar, Tabler, or project-specific app architecture.
3. Generic JavaScript framework guidance outside hyperscript interop boundaries.

### Pairing guidance

`SKILL.md` should explicitly route users to:

1. `htmx` for HTMX attribute semantics and server interaction patterns.
2. `tabler` for UI classes and layout work.
3. Django or Litestar skills when the task belongs to server-side framework lifecycle rather than client-side scripting.

## Information Architecture

Use a modular structure with reference files sized to match the actual upstream doc depth. Thin topics (setup, HTMX companion) belong in `SKILL.md` as sections rather than standalone files. Topics with overlapping "beyond basic DOM scripting" scope (remote/JS interop, advanced features) belong in one combined file.

```text
skills/hyperscript/
├── SKILL.md
├── evals/
│   ├── evals.json
│   └── trigger-evals.json        # optional in first pass, but preferred
└── references/
    ├── core-language.md
    ├── dom-and-commands.md
    ├── events-and-async.md
    ├── advanced-and-interop.md
    └── REFERENCE.md
```

### Why this structure, not seven reference files

Source verification against the actual hyperscript docs showed that three of the originally proposed files would be too thin for standalone reference files:

- `setup-and-processing.md` yields ~30-40 lines of condensed reference. That's a critical-rules section, not a file. Absorbed into `SKILL.md`.
- `htmx-companion-patterns.md` yields ~30-40 lines of guidance by design (narrow bridge). Absorbed into `SKILL.md`.
- `remote-and-js-interop.md` yields ~60-80 lines. Combined with `advanced-features.md` (~80-120 lines) into `advanced-and-interop.md` (~140-200 lines), since both cover "beyond basic DOM scripting" territory.

The three substantial reference files (`core-language.md` at ~150-200 lines, `dom-and-commands.md` at ~120-150 lines, `events-and-async.md` at ~120-150 lines) remain standalone because each covers a deep, distinct domain with enough content to justify a dedicated file.

## `SKILL.md` Design

### Frontmatter

Follow the newer repo style used by `htmx` and `python-async`:

```yaml
---
name: hyperscript
description: "Use when tasks involve ///_hyperscript or _hyperscript front-end scripting: `_=` attributes, `script=` / `data-script`, `text/hyperscript`, event handlers like `on click`, DOM commands like `toggle`/`put`, `send`/`trigger`, `behavior`, `worker`, `socket`, or HTMX companion scripting. Use this whenever the user is building, debugging, or reviewing hyperscript code, even if they only show inline `_=` snippets instead of naming the language."
scope: hyperscript
target_versions: "_hyperscript 0.9.x (verified against 0.9.14 public docs and README)"
last_verified: 2026-04-06
source_basis: official docs + reference + cookbook + README
---
```

The exact description can still be tightened during implementation, but it should remain trigger-oriented rather than workflow-oriented.

### Design emphasis

The highest-value content in the skill is the judgment rules in `SKILL.md`, not the reference file reorganization. Most agent failures with hyperscript stem from wrong tool choice, missing `processNode()` calls, queue confusion, or inventing syntax -- all judgment problems. The reference files are backup for when agents need syntax details. Design the skill accordingly: lead with judgment, route to references.

### Required sections

1. Short overview of what hyperscript is and when to use it.
2. Quick start telling agents to identify the task domain and open only the matching reference file.
3. When NOT to use this skill (and when NOT to use hyperscript).
4. Setup essentials (absorbed from the previously proposed `setup-and-processing.md`).
5. Critical rules.
6. HTMX companion guidance (absorbed from the previously proposed `htmx-companion-patterns.md`).
7. Reference map.
8. Task routing.

### "When NOT to use hyperscript" guidance in `SKILL.md`

The skill must include explicit decision criteria for when hyperscript is the wrong tool:

1. If the task requires complex client-side state shared across many unrelated elements, use JavaScript.
2. If the task is primarily HTMX request/response wiring (`hx-get`, `hx-swap`, etc.), use the `htmx` skill instead.
3. If the solution would be mostly `js ... end` blocks, skip hyperscript and write JavaScript directly.
4. If the task requires a full SPA router, state management library, or build-step framework, hyperscript is not the tool.

### Setup essentials in `SKILL.md`

The following setup material is too thin (~30-40 lines) for a standalone reference file. Include it directly in `SKILL.md`:

1. CDN script tag install: `<script src="https://unpkg.com/hyperscript.org@0.9.14"></script>`.
2. Build/import: `import _hyperscript from 'hyperscript.org'` then `_hyperscript.browserInit()`.
3. Attribute names: `_`, `script`, `data-script`.
4. `text/hyperscript` script tags for global features.
5. `_hyperscript.processNode()` for manually inserted DOM (HTMX swaps and hyperscript `put` handle this automatically).
6. Loading external `._hs` files must happen before the hyperscript script tag.

### Critical rules to include in `SKILL.md`

At minimum:

1. **Use `_hyperscript.processNode()` for manually inserted HTML** -- Newly injected DOM from manual JS APIs must be processed. HTMX swaps and the hyperscript `put` command already process inserted fragments automatically.
2. **Queue semantics matter** -- Event handlers default to `queue last`. Agents must make queue behavior explicit when correctness depends on it. `every` runs all events in parallel with no queuing. `queue all` runs them sequentially. `queue none` drops events during execution. `queue first` queues only the first pending event.
3. **Attribute storage is string-based** -- Values stored through `@attr` become strings. Convert explicitly (e.g., `@data-count as Int`) when numeric or structured behavior matters.
4. **Math expressions require full parenthesization** -- Hyperscript does not use normal operator precedence for mixed math expressions. `(x * x) + (y * y)` is required; `x * x + y * y` is a parse error.
5. **Use JS interop deliberately** -- If the solution becomes mostly `js ... end`, hyperscript is the wrong tool. Use `call` and `get` for JS function calls; reserve inline `js ... end` for cases where hyperscript genuinely cannot express the logic.
6. **Prefer local behavior, not global sprawl** -- Hyperscript is strongest for localized DOM/event behavior scoped to individual elements. Sprawling client application state shared across many elements belongs in JavaScript.
7. **HTMX ownership stays separate** -- Use hyperscript for local glue around HTMX events (e.g., disabling buttons during requests, toggling classes on lifecycle events), not as a replacement for HTMX request semantics.
8. **Advanced features require separate scripts** -- `worker`, `socket`, and `eventsource` are NOT in the default hyperscript bundle. They require either the "Whole 9 Yards" release or individual script includes (`/dist/workers.js`, `/dist/socket.js`, `/dist/eventsource.js`). Agents must emit the correct script includes when using these features.
9. **`behavior` definitions must precede `install`** -- Behaviors defined locally must appear before elements that install them. Behaviors loaded from external `._hs` files must be loaded before the hyperscript script tag.

### HTMX companion guidance in `SKILL.md`

The following HTMX bridge material is too thin (~30-40 lines) for a standalone reference file. Include it directly in `SKILL.md`:

1. Hyperscript excels at local UI glue around HTMX lifecycle events: disabling buttons during requests (`on htmx:beforeRequest ... on htmx:afterRequest`), toggling loading indicators, and managing local element state.
2. When hyperscript is handling `htmx:*` events, the hyperscript code should be short and focused on the element's own state. If the logic starts coordinating multiple remote elements or making its own HTTP requests, the task has moved into HTMX territory.
3. HTMX request/response semantics, `hx-*` attributes, swap strategies, and extension APIs stay in the `htmx` skill.
4. Route to the `htmx` skill when the question is about request configuration, swap targets, or server response format.

## Reference Files

### `references/core-language.md`

Purpose: language syntax and execution model.

Should cover:

1. Comments and separators (`--`, `then`, `end`).
2. Variables and scopes: local, element (`:` prefix), global (`$` prefix), and scope modifiers.
3. Special symbols: `it`/`result`, `me`/`my`/`I`, `event`, `target`, `detail`, `sender`, `body`, `cookies`.
4. The `the` whitespace keyword for readability.
5. Expressions, literals, comparisons, logical operators, `no` semantics, `matches`, `exists`, `is empty`.
6. Property access: dot notation, bracket notation, possessive (`'s`), `of` expression.
7. Flat mapping on arrays and null safety.
8. Loops (`repeat for`, `repeat while`, `repeat until`, `repeat N times`, `repeat forever`) and the `index` clause.
9. Aggregate operations and when explicit loops are unnecessary.
10. Math behavior: standard operators, `mod` keyword, required full parenthesization for mixed expressions.
11. Strings, template literals, `append` for string building.
12. Conversions via `as` operator: `Int`, `Float`, `Number`, `String`, `JSON`, `Object`, `Date`, `Array`, `Fragment`, `HTML`, `Values`, `Fixed`.
13. Closures: `\ arg -> expr` syntax for data structure manipulation callbacks.
14. Function definition with `def`, namespacing with dot-separated identifiers, `return`/`exit`.
15. Exception handling: `catch`/`finally` blocks, `throw`, and the `exception` event on unhandled errors.

### `references/dom-and-commands.md`

Purpose: DOM querying and DOM mutation.

Should cover:

1. DOM literals: class (`.foo`), id (`#bar`), query (`<div.tabs/>`), attribute (`@name`), style (`*width`), measurement (`35px`, `1em`).
2. Template syntax for dynamic DOM literals: `#{expr}`, `.{expr}`, `<${expr}/>`.
3. `in` expression for scoped queries.
4. `closest` expression including `closest parent` variant.
5. Positional expressions: `first`, `last`, `random`.
6. Relative positional expressions: `next`, `previous` (with wrapping support).
7. `set` vs `put`: `set` assigns to variables and properties; `put` is more flexible with `into`, `before`, `after`, `at start of`, `at end of` placement. `put` into an element defaults to `innerHTML`.
8. `add`, `remove`, `toggle` for classes and attributes (including `toggle between`, `for <time>`, `until <event>`).
9. `show` and `hide` with display/visibility/opacity strategies.
10. `take` for exclusive class ownership across a set of elements.
11. `tell` for temporarily changing the implicit target.
12. `make` for creating class instances and DOM elements (`make a <p/> called para`).
13. `measure` for element measurements.
14. `append` for adding to strings, arrays, and DOM elements.
15. `transition` and `settle` behavior for CSS transitions.
16. Collection-friendly commands: most commands (`add`, `remove`, `toggle`, `put`, etc.) operate on collections automatically without explicit loops.

### `references/events-and-async.md`

Purpose: event-driven control flow and async transparency.

Should cover:

1. `on` handlers: full syntax including `every` prefix, parameter destructuring, filters, count modifiers, `from <expr>`/`from elsewhere`, `debounced at`/`throttled at`.
2. Chaining multiple events with `or`.
3. `init` blocks for element initialization logic.
4. Event queueing in detail: `queue last` (default), `queue all`, `queue first`, `queue none`, `every` (parallel, no queuing). Common mistake: not realizing `queue last` drops intermediate events.
5. Event destructuring: properties resolved from `event` then `event.detail`.
6. Event filters: bracketed boolean expressions resolved against event properties first, then global scope.
7. `send` and `trigger` for dispatching events with arguments via `event.detail`.
8. Synthetic events: `on mutation of @attr` (MutationObserver), `on intersection having threshold` (IntersectionObserver).
9. `wait` command: wait for a time expression or an event.
10. Async transparency: hyperscript automatically awaits promises. Loops, conditionals, and command chains all work across async boundaries without explicit `await`.
11. Caveat: `and`/`or` short-circuit evaluation does not await promises on the left side. If the left operand returns a Promise, it is truthy regardless of what the promise resolves to. Move promise-based values to a separate `get` statement before the conditional.
12. `halt` (stop event propagation + preventDefault + exit handler), `halt the event` (stop propagation but continue handler).
13. `break`, `continue` in loops.
14. `return` and `throw`.
15. Exception handling in event handlers: unhandled exceptions trigger an `exception` event on the element.

### `references/advanced-and-interop.md`

Purpose: remote operations, JavaScript interop, and advanced language features. Combines the previously separate "remote and JS interop" and "advanced features" domains because both cover territory beyond basic DOM scripting and together yield a single solid reference file.

Should cover:

**Remote and JS interop:**

1. `fetch` command: URL (naked or string literal), `as json`/`as html`/`as response` modifiers, `with` form for method/headers/body, result stored in `it`.
2. `fetch` timeouts (`with timeout:300ms`) and cancellation (`send fetch:abort to <element>`).
3. `fetch` events: `fetch:beforeRequest`, `fetch:afterResponse`, `fetch:afterRequest`, `fetch:error`.
4. Dynamic URLs with template literals.
5. `go` command for navigation.
6. `call`/`get` for invoking JavaScript functions and storing results in `result`/`it`.
7. Pseudo-command syntax: method name first for readability (`reload() the location of the window`).
8. Inline `js ... end` blocks for embedding JavaScript.
9. Accessing JS globals and browser APIs from hyperscript (`window`, `localStorage`, `navigator`).
10. Interop boundary rule: if the solution is mostly `js ... end`, the task should use JavaScript directly. `call`/`get` for isolated JS function invocations is fine; inline JS blocks for entire features is a code smell.

**Advanced features:**

11. `behavior`: defining reusable behaviors with parameters, `install` syntax, parameter defaults via `init` blocks, ordering constraints (local behaviors must precede elements that install them, remote `._hs` files must load before the hyperscript script tag).
12. `worker`: Web Worker feature. Requires `/dist/workers.js` or "Whole 9 Yards" bundle. Functions declared with `def` are exposed to the main thread and return promises (transparent to hyperscript callers). Worker body cannot access DOM or `window`. External scripts via `importScripts`.
13. `socket`: WebSocket feature. Requires `/dist/socket.js` or "Whole 9 Yards" bundle. Message handlers with optional `as json`. Sending via `send event to SocketName`. RPC mechanism: `call SocketName.rpc.functionName(args)` with configurable timeout. RPC protocol uses JSON `{iid, function, args}` / `{iid, return}` / `{iid, throw}`.
14. `eventsource`: Server-Sent Events feature. Requires `/dist/eventsource.js` or "Whole 9 Yards" bundle. Named event handlers with `as json`/`as string` decoding. Connection lifecycle events (`open`, `close`, `error`). Dynamic connections via `open(url)` method. Auto-reconnect on failure.
15. Debugging: `beep!` for debug printing (triggers `hyperscript:beep` event), HDB (Hyperscript Debugger) if documented.
16. Extension hooks: `_hyperscript.addCommand(...)` for custom commands.
17. Security considerations as called out by the official docs.

This file must make clear which features require extra script includes and cannot be assumed available by default.

### `references/REFERENCE.md`

Purpose: cross-index for quick lookup.

Should include a table-oriented index grouped by:

1. syntax and variables,
2. DOM queries and updates,
3. events and async behavior,
4. remote content, JS interop, and advanced features.

## Task Routing

`SKILL.md` should route requests approximately like this:

1. Installing or initializing hyperscript -> setup essentials in `SKILL.md`
2. Understanding syntax, scope, conversions, functions, or exceptions -> `core-language.md`
3. Querying or mutating the DOM -> `dom-and-commands.md`
4. Event handlers, queueing, filters, or waits -> `events-and-async.md`
5. `fetch`, navigation, JS calls, inline JS, interop boundaries, `behavior`, `worker`, sockets, eventsource, or extending the language -> `advanced-and-interop.md`
6. HTMX plus hyperscript patterns -> HTMX companion section in `SKILL.md`
7. Unsure where to start -> `REFERENCE.md`

## Testing Strategy

Because this repository treats skill work as real engineering work, the skill should ship with tests and evals.

### Repository tests

Add `tests/test_hyperscript_skill.py`.

It should follow the style of `tests/test_python_async_skill.py` and include at least:

1. A reference-resolution isolation test that copies `skills/hyperscript` into a temporary repo and checks `validate_repo(...)` returns no broken links.
2. A guardrail test that asserts critical rules remain present in `SKILL.md` and key references.
3. An eval coverage test that asserts `evals/evals.json` exists, IDs are unique, and coverage spans the major language risk areas.
4. If trigger evals are added immediately, a trigger coverage test similar to `test_python_async_trigger_evals_cover_trigger_and_near_miss_cases()`.

### Evals

Add `skills/hyperscript/evals/evals.json` before writing the final skill content.

Evals should ideally be calibrated against real agent failure modes. Before writing the final eval set, run 5-7 hyperscript prompts through an agent without the skill and catalog the specific failure modes. Use those failures to weight the eval set toward the most common problems (judgment failures vs. syntax lookup failures). If this calibration step is skipped due to time constraints, note it as a gap and revisit after the first round of real usage.

Initial eval set should cover at least these cases:

1. A user asking how to process hyperscript on dynamically inserted DOM after manual JavaScript insertion.
2. A bug involving `queue last` versus `queue all` or `every` for repeated user events.
3. A DOM-mutation task using `toggle`, `put`, `closest`, or `tell`.
4. A task involving `fetch` plus DOM update and cleanup in `finally`.
5. An HTMX companion scenario such as disabling a button during a request.
6. A JS interop boundary case where the answer should allow some JS but also warn against turning the whole solution into `js ... end`.
7. An advanced feature case covering `behavior`, `worker`, or `socket`.

Each eval should include:

1. `id`
2. `prompt`
3. `expected_output`
4. `files` if needed
5. `expectations`

### Trigger evals

Preferred, but lower priority than the main eval set.

Add `skills/hyperscript/evals/trigger-evals.json` with realistic near-miss prompts involving:

1. plain JavaScript,
2. HTMX-only questions,
3. Alpine-like inline behavior,
4. explicit `_="on click ..."` snippets,
5. requests mentioning `behavior`, `worker`, or `text/hyperscript`.

## Quality Bar

The resulting skill should satisfy these standards:

1. `SKILL.md` is judgment-oriented and route-oriented, not a reference dump. Setup essentials and HTMX companion guidance live directly in `SKILL.md` as sections, not as separate files.
2. The reference files collectively cover the full practical language surface described by the docs and reference index.
3. HTMX integration is present but narrow, confined to a single `SKILL.md` section.
4. The skill explicitly warns about the most failure-prone hyperscript behaviors: processing inserted DOM, queue semantics, string attributes, math parentheses, JS overreach, and separate script requirements for advanced features.
5. All local markdown references resolve.
6. Tests and eval files exist and verify the intended scope.
7. The target version (`0.9.x`) and `last_verified` date are prominently displayed and tested.

## Risks and Mitigations

### Risk: version drift and staleness (highest risk)

Hyperscript is pre-1.0 software (`0.9.x`). The language surface could change between minor versions. A stale skill is worse than no skill -- it actively teaches agents wrong syntax with the authority of a "verified reference."

Mitigation: the `last_verified` field in frontmatter tracks the verification date. See the Maintenance section below for the version-drift protocol.

### Risk: upstream doc incompleteness

Source verification confirmed that extension hooks (`_hyperscript.addCommand(...)`) are thinly documented upstream. Some advanced features (`worker`, `socket`, `eventsource`) have adequate docs but are less battle-tested than the core language. The skill cannot fill gaps that don't exist upstream.

Mitigation: where upstream docs are thin, the reference file must say so explicitly rather than inventing behavior. Mark thinly-documented features with a note like "upstream docs are limited; verify behavior against the source."

### Risk: scope bloat

If the skill turns into a passive mirror of the official docs, it will be large and weak.

Mitigation: keep `SKILL.md` judgment-oriented, split references by job-to-be-done, and use `REFERENCE.md` as the lookup layer. The 5-file structure (down from the originally proposed 8) was chosen specifically to prevent thin files from being padded to justify their existence.

### Risk: HTMX duplication

If HTMX guidance is repeated everywhere, the new skill will compete with `htmx` instead of complementing it.

Mitigation: HTMX companion guidance lives in a single `SKILL.md` section (~30-40 lines) and routes ownership back to the `htmx` skill. No reference file duplicates HTMX semantics.

### Risk: false confidence from comprehensive-looking reference

A well-structured skill for a pre-1.0 language may make agents more confident in generated hyperscript code even when the skill content has drifted from the current version.

Mitigation: the skill must include the target version prominently and note that behavior may differ in newer releases. Tests should assert that the version string is present.

### Risk: agent context window cost

Loading `SKILL.md` + the wrong reference file + retrying with the right one burns context. This cost is justified for frequently-needed skills (htmx, Django) but may not be for a niche language.

Mitigation: the 5-file structure (3 reference files + REFERENCE.md) reduces the chance of misrouting compared to 7 reference files. Task routing in SKILL.md must be unambiguous.

## Maintenance

### Version-drift protocol

1. The `last_verified` field in `SKILL.md` frontmatter records when the skill was last verified against upstream docs.
2. When hyperscript ships a new minor version (e.g., `0.9.15`, `0.10`), the skill owner must:
   - Review the upstream changelog and release notes.
   - Check whether any changed behavior affects the critical rules or reference content.
   - Update affected reference files and the `last_verified` date.
   - Run tests to verify reference links still resolve and guardrail assertions still pass.
3. If no one performs this verification within a reasonable window after a new release, the skill's `target_versions` field should be updated to note the gap (e.g., "verified against 0.9.14; not yet verified against 0.9.15").
4. The evals should be re-run against agent output after any version update to catch behavioral regressions.

## Out of Scope for This Spec

1. Final wording of every rule and example snippet.
2. Description-optimization loop details for trigger tuning.
3. Packaging and release workflow.

Those belong to implementation and later refinement.
