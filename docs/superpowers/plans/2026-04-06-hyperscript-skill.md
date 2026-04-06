# Hyperscript Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a hyperscript reference skill that gives agents reliable syntax/behavior guidance and judgment rules for `_hyperscript` front-end scripting.

**Architecture:** Compact `SKILL.md` with judgment-oriented critical rules and setup/HTMX companion sections inline, plus 4 reference files (`core-language.md`, `dom-and-commands.md`, `events-and-async.md`, `advanced-and-interop.md`) and a cross-index (`REFERENCE.md`). Tests validate reference resolution, guardrails, and eval coverage.

**Tech Stack:** Markdown, JSON, Python (pytest), `scripts/validate_refs.py` for reference validation.

---

## File Structure

```
skills/hyperscript/
├── SKILL.md                           # Create
├── evals/
│   └── evals.json                     # Create
└── references/
    ├── REFERENCE.md                   # Create
    ├── core-language.md               # Create
    ├── dom-and-commands.md            # Create
    ├── events-and-async.md            # Create
    └── advanced-and-interop.md        # Create

tests/
└── test_hyperscript_skill.py          # Create
```

---

### Task 1: Write the test file

**Files:**
- Create: `tests/test_hyperscript_skill.py`

- [ ] **Step 1: Write the test file**

```python
from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "hyperscript"


def test_hyperscript_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "hyperscript"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_hyperscript_skill_version_is_present() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "0.9" in skill_text
    assert "last_verified" in skill_text


def test_hyperscript_skill_guardrails_cover_critical_rules() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "processNode" in skill_text
    assert "queue last" in skill_text
    assert "queue all" in skill_text
    assert "queue none" in skill_text
    assert "string" in skill_text.lower() and "@" in skill_text
    assert "parenthes" in skill_text.lower()
    assert "`js ... end`" in skill_text or "js ... end" in skill_text
    assert "local" in skill_text.lower() and "behavior" in skill_text.lower()
    assert "/dist/workers.js" in skill_text or "separate script" in skill_text.lower()
    assert "precede" in skill_text.lower() or "before" in skill_text.lower()


def test_hyperscript_skill_has_when_not_to_use_section() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "When NOT" in skill_text or "when not" in skill_text.lower()
    assert "htmx" in skill_text.lower()
    assert "JavaScript" in skill_text


def test_hyperscript_skill_has_setup_essentials() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "unpkg.com" in skill_text or "hyperscript.org" in skill_text
    assert "browserInit" in skill_text
    assert "processNode" in skill_text
    assert "text/hyperscript" in skill_text


def test_hyperscript_skill_has_htmx_companion_guidance() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "htmx:beforeRequest" in skill_text or "htmx:" in skill_text
    assert "htmx" in skill_text.lower()


def test_hyperscript_skill_reference_files_cover_key_topics() -> None:
    core_text = (SKILL_ROOT / "references" / "core-language.md").read_text(
        encoding="utf-8"
    )
    dom_text = (SKILL_ROOT / "references" / "dom-and-commands.md").read_text(
        encoding="utf-8"
    )
    events_text = (SKILL_ROOT / "references" / "events-and-async.md").read_text(
        encoding="utf-8"
    )
    advanced_text = (
        SKILL_ROOT / "references" / "advanced-and-interop.md"
    ).read_text(encoding="utf-8")

    assert "scope" in core_text.lower()
    assert "`$`" in core_text or "global" in core_text.lower()
    assert "`:`" in core_text or "element" in core_text.lower()
    assert "as" in core_text and "Int" in core_text
    assert "closure" in core_text.lower() or "\\" in core_text
    assert "catch" in core_text

    assert "put" in dom_text.lower()
    assert "toggle" in dom_text.lower()
    assert "closest" in dom_text.lower()
    assert "take" in dom_text.lower()
    assert "tell" in dom_text.lower()
    assert "settle" in dom_text.lower()

    assert "queue" in events_text.lower()
    assert "destructur" in events_text.lower()
    assert "filter" in events_text.lower()
    assert "async" in events_text.lower()
    assert "wait" in events_text.lower()
    assert "mutation" in events_text.lower() or "MutationObserver" in events_text

    assert "fetch" in advanced_text.lower()
    assert "behavior" in advanced_text.lower()
    assert "worker" in advanced_text.lower()
    assert "socket" in advanced_text.lower()
    assert "eventsource" in advanced_text.lower() or "event source" in advanced_text.lower()
    assert "/dist/" in advanced_text or "separate script" in advanced_text.lower()


def test_hyperscript_skill_evals_cover_core_risk_areas() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "hyperscript"
    evals = payload["evals"]
    assert len(evals) >= 7
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = [item["prompt"] for item in evals]
    all_prompts = "\n".join(prompts)

    assert any("processNode" in p or "dynamically" in p.lower() for p in prompts)
    assert any("queue" in p.lower() for p in prompts)
    assert any(
        "toggle" in p.lower() or "put" in p.lower() or "closest" in p.lower()
        for p in prompts
    )
    assert any("fetch" in p.lower() for p in prompts)
    assert any("htmx" in p.lower() for p in prompts)
    assert any("js" in p.lower() or "javascript" in p.lower() for p in prompts)
    assert any(
        "behavior" in p.lower() or "worker" in p.lower() or "socket" in p.lower()
        for p in prompts
    )

    assert all(item["expectations"] and item["expected_output"] for item in evals)


def test_hyperscript_evals_have_discriminating_expectations() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    evals = payload["evals"]

    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )

    assert "processNode" in expectations
    assert "queue" in expectations.lower()
    assert "finally" in expectations.lower() or "cleanup" in expectations.lower()
    assert "htmx" in expectations.lower()
    assert "js ... end" in expectations.lower() or "javascript" in expectations.lower()
    assert "/dist/" in expectations or "separate" in expectations.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_hyperscript_skill.py -v`
Expected: FAIL (all tests fail because `skills/hyperscript/` does not exist)

- [ ] **Step 3: Commit the test file**

```bash
git add tests/test_hyperscript_skill.py
git commit -m "test(hyperscript): add test file for hyperscript skill"
```

---

### Task 2: Create directory structure and evals.json

**Files:**
- Create: `skills/hyperscript/evals/evals.json`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p skills/hyperscript/evals
mkdir -p skills/hyperscript/references
```

- [ ] **Step 2: Write evals.json**

```json
{
  "skill_name": "hyperscript",
  "evals": [
    {
      "id": 1,
      "prompt": "I'm adding new DOM elements via JavaScript's appendChild after an AJAX call, and the hyperscript on those elements isn't firing. I used _=\"on click ...\" on the new elements but nothing happens when I click them. How do I make hyperscript recognize dynamically inserted DOM?",
      "expected_output": "The response explains that hyperscript needs to process dynamically inserted DOM via _hyperscript.processNode() and distinguishes this from HTMX swaps and hyperscript's own put command, which handle processing automatically.",
      "files": [],
      "expectations": [
        "It tells the user to call `_hyperscript.processNode()` on the newly inserted DOM element.",
        "It explains that HTMX swaps and hyperscript's `put` command process inserted fragments automatically, so processNode is only needed for manual JS DOM insertion.",
        "It does not suggest re-initializing the entire page or reloading the script tag."
      ]
    },
    {
      "id": 2,
      "prompt": "I have a button that fetches data on click. If the user clicks rapidly, I get duplicate requests piling up. I'm using `on click fetch /api/data then put it into #results`. What's happening and how do I control it?",
      "expected_output": "The response explains hyperscript's event queue semantics, identifies the default queue last behavior, and recommends the appropriate queue strategy for the use case.",
      "files": [],
      "expectations": [
        "It explains that `queue last` is the default, which drops intermediate events and keeps only the last pending one.",
        "It contrasts at least two queue strategies (e.g., `queue none` to drop all events during execution vs `queue all` to process sequentially).",
        "It mentions the `every` prefix as the parallel execution alternative with no queuing.",
        "It does not invent queue behavior that does not exist in hyperscript."
      ]
    },
    {
      "id": 3,
      "prompt": "I need to build a tab component in hyperscript: clicking a tab should add an .active class to the clicked tab, remove .active from all other tabs, and show the corresponding panel while hiding the others. The panels are divs with data-tab attributes.",
      "expected_output": "The response uses hyperscript DOM commands like toggle, take, add, remove, show, hide, or closest appropriately for a tab switching interaction.",
      "files": [],
      "expectations": [
        "It uses `take` for exclusive class ownership across tabs, or an equivalent combination of `remove` from siblings + `add` to the clicked tab.",
        "It uses DOM query expressions like `<div/>` or class/attribute selectors to find panels.",
        "It uses `show` and `hide` or class toggling to control panel visibility.",
        "It keeps the solution in hyperscript rather than falling back to JavaScript for DOM manipulation."
      ]
    },
    {
      "id": 4,
      "prompt": "Write hyperscript that fetches JSON from /api/status, updates a #status-text element with the response message field, and ensures a loading spinner is shown during the request and hidden afterward even if the fetch fails.",
      "expected_output": "The response uses the hyperscript fetch command with as json, updates the DOM with put, and uses a finally block for cleanup of the loading state.",
      "files": [],
      "expectations": [
        "It uses `fetch /api/status as json` or equivalent fetch with JSON conversion.",
        "It accesses the response via `it` or `result` and uses a property access to get the message field.",
        "It uses `finally` to guarantee the spinner is hidden regardless of success or failure.",
        "It does not use raw JavaScript fetch() or XMLHttpRequest."
      ]
    },
    {
      "id": 5,
      "prompt": "I'm using HTMX with hx-post for a form submission. I want to disable the submit button while the request is in flight and re-enable it when done. Should I use hyperscript or HTMX for this? Show me the code.",
      "expected_output": "The response recommends hyperscript for the local button state management around HTMX lifecycle events, keeps HTMX in charge of the request, and shows concise hyperscript code.",
      "files": [],
      "expectations": [
        "It uses hyperscript to listen to htmx lifecycle events like `htmx:beforeRequest` and `htmx:afterRequest`.",
        "It adds and removes the disabled attribute or class on the button element.",
        "It does not replicate HTMX request logic in hyperscript.",
        "It keeps the hyperscript focused on the button's own state, not on coordinating the request."
      ]
    },
    {
      "id": 6,
      "prompt": "I want to use hyperscript to read a value from localStorage, check if it's expired based on a timestamp, and conditionally show a banner. Should I use hyperscript for this or JavaScript?",
      "expected_output": "The response evaluates whether hyperscript is the right tool, uses call/get for localStorage access if appropriate, and warns against overusing js ... end blocks.",
      "files": [],
      "expectations": [
        "It uses `call` or `get` to access `localStorage.getItem()` from hyperscript rather than embedding a large `js ... end` block.",
        "It warns that if the solution becomes mostly `js ... end` blocks, JavaScript should be used directly instead.",
        "It does not invent hyperscript-native localStorage commands that do not exist.",
        "It acknowledges the boundary between hyperscript DOM glue and JavaScript for complex logic."
      ]
    },
    {
      "id": 7,
      "prompt": "I want to create a reusable Collapsible behavior in hyperscript that I can install on multiple elements. Each element should toggle a .collapsed class on click, and some elements need a custom trigger button passed as a parameter. Also, I want to use a Web Worker for an expensive calculation. What scripts do I need to include?",
      "expected_output": "The response shows correct behavior definition with parameters and init defaults, correct install syntax, and correctly identifies that workers require a separate script include.",
      "files": [],
      "expectations": [
        "It defines a `behavior` with a parameter for the trigger button and uses `init` to set a default.",
        "It uses `install Collapsible(...)` syntax with named arguments on the target elements.",
        "It states that `worker` requires `/dist/workers.js` or the 'Whole 9 Yards' bundle, not the default hyperscript include.",
        "It notes that behavior definitions must appear before elements that install them."
      ]
    }
  ]
}
```

- [ ] **Step 3: Run eval-related tests to check progress**

Run: `uv run pytest tests/test_hyperscript_skill.py::test_hyperscript_skill_evals_cover_core_risk_areas tests/test_hyperscript_skill.py::test_hyperscript_evals_have_discriminating_expectations -v`
Expected: PASS (both eval tests should pass now)

- [ ] **Step 4: Commit**

```bash
git add skills/hyperscript/evals/evals.json
git commit -m "test(hyperscript): add evals.json with 7 eval cases"
```

---

### Task 3: Create SKILL.md

**Files:**
- Create: `skills/hyperscript/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

````markdown
---
name: hyperscript
description: "Use when tasks involve _hyperscript front-end scripting: `_=` attributes, `script=` / `data-script`, `text/hyperscript` script tags, event handlers like `on click`, DOM commands like `toggle`/`put`/`take`, `send`/`trigger`, `behavior`, `worker`, `socket`, or HTMX companion scripting. Use this whenever the user is building, debugging, or reviewing hyperscript code, even if they only show inline `_=` snippets instead of naming the language."
scope: hyperscript
target_versions: "_hyperscript 0.9.x (verified against 0.9.14 public docs)"
last_verified: 2026-04-06
source_basis: official docs + reference + cookbook + README
---

# Hyperscript

Use this skill for `_hyperscript` implementation, debugging, and code review. Read only the reference file(s) needed for the task.

## Quick Start

1. Identify the domain of the task (syntax/scope, DOM manipulation, events/async, advanced features/JS interop).
2. Open the matching file from `references/`.
3. Implement using hyperscript's natural-language command syntax.
4. Validate that the solution stays within hyperscript's sweet spot: localized DOM/event behavior on individual elements.

## When NOT to Use Hyperscript

1. If the task requires complex client-side state shared across many unrelated elements, use JavaScript.
2. If the task is primarily HTMX request/response wiring (`hx-get`, `hx-swap`, etc.), use the `htmx` skill.
3. If the solution would be mostly `js ... end` blocks, skip hyperscript and write JavaScript directly.
4. If the task requires a full SPA router, state management library, or build-step framework, hyperscript is not the tool.

## Setup Essentials

**CDN install** (dependency-free, no build step):

```html
<script src="https://unpkg.com/hyperscript.org@0.9.14"></script>
```

**Build/import**:

```js
import _hyperscript from 'hyperscript.org';
_hyperscript.browserInit();
```

**Attribute names**: `_`, `script`, or `data-script` on elements.

**Global features** via `<script type="text/hyperscript">` tags (behaviors, functions, init blocks). Features in script tags apply to `body`.

**External `.\_hs` files** must load before the hyperscript script tag:

```html
<script type="text/hyperscript" src="/behaviors._hs"></script>
<script src="https://unpkg.com/hyperscript.org@0.9.14"></script>
```

**Processing dynamically inserted DOM**: call `_hyperscript.processNode(element)` on elements inserted via manual JavaScript DOM APIs. HTMX swaps and hyperscript's own `put` command process inserted fragments automatically.

## Critical Rules

1. **Use `_hyperscript.processNode()` for manually inserted HTML.** Newly injected DOM from manual JS APIs (appendChild, innerHTML assignment) must be processed. HTMX swaps and the hyperscript `put` command handle this automatically.

2. **Queue semantics matter.** Event handlers default to `queue last`. Make queue behavior explicit when correctness depends on it:
   - `queue last` (default): drops intermediate events, keeps only the last pending one
   - `queue all`: runs all events sequentially in order
   - `queue first`: queues only the first pending event, drops the rest
   - `queue none`: drops all events while the handler is active
   - `every` prefix: runs handlers in parallel with no queuing

3. **Attribute storage is string-based.** Values stored through `@attr` become strings. Convert explicitly (e.g., `@data-count as Int`) when numeric or structured behavior is needed.

4. **Math expressions require full parenthesization.** Hyperscript does not use normal operator precedence for mixed math. `(x * x) + (y * y)` is required; `x * x + y * y` is a parse error.

5. **Use JS interop deliberately.** Use `call` and `get` for JS function calls; reserve inline `js ... end` for cases where hyperscript genuinely cannot express the logic. If the solution becomes mostly `js ... end`, use JavaScript directly.

6. **Prefer local behavior, not global sprawl.** Hyperscript is strongest for localized DOM/event behavior scoped to individual elements. State shared across many unrelated elements belongs in JavaScript.

7. **HTMX ownership stays separate.** Use hyperscript for local glue around HTMX events (disabling buttons, toggling classes on lifecycle events), not as a replacement for HTMX request semantics.

8. **Advanced features require separate scripts.** `worker`, `socket`, and `eventsource` are NOT in the default hyperscript bundle. They require either the "Whole 9 Yards" release or individual script includes (`/dist/workers.js`, `/dist/socket.js`, `/dist/eventsource.js`). Always emit the correct script includes when using these features.

9. **`behavior` definitions must precede `install`.** Behaviors defined locally (in `<script type="text/hyperscript">`) must appear before elements that install them. Behaviors loaded from external `._hs` files must load before the hyperscript script tag.

## HTMX Companion Guidance

Hyperscript excels at local UI glue around HTMX lifecycle events:

- Disable buttons during requests: `on htmx:beforeRequest add @disabled then on htmx:afterRequest remove @disabled`
- Toggle loading indicators on HTMX lifecycle events
- Manage local element state in response to `htmx:afterSwap`, `htmx:beforeSend`, etc.

When hyperscript handles `htmx:*` events, the code should be short and focused on the element's own state. If the logic starts coordinating multiple remote elements or making its own HTTP requests, the task has moved into HTMX territory.

HTMX request/response semantics, `hx-*` attributes, swap strategies, and extension APIs stay in the `htmx` skill. Route to it when the question is about request configuration, swap targets, or server response format.

## Reference Map

- Syntax, variables, scope, conversions, functions, exceptions: `references/core-language.md`
- DOM queries, DOM mutation, transitions, measurement: `references/dom-and-commands.md`
- Event handlers, queueing, filters, async transparency, waits: `references/events-and-async.md`
- `fetch`, JS interop, `behavior`, `worker`, `socket`, `eventsource`, extensions: `references/advanced-and-interop.md`
- Cross-file index and quick lookup: `references/REFERENCE.md`

## Task Routing

- Installing or initializing hyperscript -> Setup Essentials above
- Understanding syntax, scope, conversions, functions, or exceptions -> `references/core-language.md`
- Querying or mutating the DOM -> `references/dom-and-commands.md`
- Event handlers, queueing, filters, or waits -> `references/events-and-async.md`
- `fetch`, navigation, JS calls, inline JS, `behavior`, `worker`, sockets, eventsource, or extending the language -> `references/advanced-and-interop.md`
- HTMX + hyperscript patterns -> HTMX Companion Guidance above
- Unsure where to start -> `references/REFERENCE.md`
- HTMX attribute semantics, swap strategies, server interaction -> `htmx` skill
- UI component classes and layout -> `tabler` skill
- Server-side framework lifecycle -> `django` or `litestar` skill
````

- [ ] **Step 2: Run guardrail and version tests**

Run: `uv run pytest tests/test_hyperscript_skill.py::test_hyperscript_skill_version_is_present tests/test_hyperscript_skill.py::test_hyperscript_skill_guardrails_cover_critical_rules tests/test_hyperscript_skill.py::test_hyperscript_skill_has_when_not_to_use_section tests/test_hyperscript_skill.py::test_hyperscript_skill_has_setup_essentials tests/test_hyperscript_skill.py::test_hyperscript_skill_has_htmx_companion_guidance -v`
Expected: PASS (all five tests should pass)

- [ ] **Step 3: Commit**

```bash
git add skills/hyperscript/SKILL.md
git commit -m "feat(hyperscript): add SKILL.md with critical rules and setup guidance"
```

---

### Task 4: Create core-language.md

**Files:**
- Create: `skills/hyperscript/references/core-language.md`

- [ ] **Step 1: Write core-language.md**

````markdown
# Core Language

Hyperscript syntax, variables, scope, control flow, conversions, functions, and exception handling.

## Comments and Separators

- Comments: `-- comment` (also `//` and `/* */` for JS migration)
- Command separator: `then` (optional between commands on the same line)
- Block terminator: `end` (can be omitted when the script ends or another feature starts)

## Variables and Scope

Three scopes: `local`, `element`, `global`.

| Prefix | Scope | Example |
|--------|-------|---------|
| (none) | local | `set x to 10` |
| `:` | element (shared across features on the same element) | `set :count to 0` |
| `$` | global | `set $appState to "ready"` |

Explicit scope modifiers override the prefix convention:

```hyperscript
set global myGlobal to true
set element myElementVar to true
set local x to true
```

Local scope is flat (like JavaScript `var`), not block-scoped.

## Special Symbols

| Symbol | Meaning |
|--------|---------|
| `result` / `it` / `its` | Result of the last command (e.g., `call`, `fetch`) |
| `me` / `my` / `I` | Current element |
| `event` | Triggering event |
| `target` | `event.target` (original event target, not necessarily `me`) |
| `detail` | `event.detail` |
| `sender` | Element that sent the current event |
| `body` | `document.body` |
| `cookies` | Cookie access API |

The `the` keyword is whitespace before any expression — used purely for readability.

JavaScript globals like `window`, `localStorage`, `navigator` are also accessible.

## Expressions and Literals

Standard: numbers (`1`, `3.14`), strings (`"hello"`, `'world'`), template literals (`` `${name}` ``), arrays (`[1, 2, 3]`), objects (`{foo: "bar"}`), booleans (`true`, `false`), `null`.

## Comparisons and Logical Operators

| Expression | Meaning |
|-----------|---------|
| `a is b` | `a == b` |
| `a is not b` | `a != b` |
| `no a` | `a == null` or `a == undefined` or `a.length == 0` |
| `a exists` | `not (no a)` |
| `a matches <selector/>` | CSS selector test |
| `a is empty` | Collection emptiness test |
| `a is greater than b` | `a > b` |
| `a is less than b` | `a < b` |

`I am` can replace `I is` for readability.

`and` / `or` short-circuit normally. **Caveat**: if the left operand returns a Promise, it is treated as truthy regardless of what it resolves to. Move promise-based values to a separate `get` statement before the conditional.

`not` negates boolean expressions.

## Property Access

- Dot notation: `x.name`
- Bracket notation: `x['name']`
- Possessive: `x's name` (also `my innerHTML`, `its length`)
- `of` expression: `the name of x`

### Flat Mapping

Property access on an Array flat-maps the results: `the parent of <div/>` returns an array of all parents. Only `length` is excluded from flat mapping.

### Null Safety

All property access is null-safe: `null.prop` returns `null` without error.

## Loops

```hyperscript
repeat for x in collection           -- for-in
for x in collection                  -- short form (omit repeat)
repeat in collection                 -- implicit `it`
repeat while condition               -- while
repeat until condition               -- until
repeat 5 times                       -- fixed count
repeat forever                       -- infinite (use break to exit)
```

The `index` clause binds the loop index: `for x in items index i`.

`break` and `continue` are supported.

## Aggregate Operations

Many commands operate on collections automatically without explicit loops:

```hyperscript
add .foo to .bar     -- adds class to ALL elements with class .bar
remove <.hidden/>    -- removes all matching elements
```

Prefer aggregate operations over explicit loops when possible.

## Math

Standard operators: `+`, `-`, `*`, `/`. Modulo uses the `mod` keyword.

**Full parenthesization is required** for mixed math expressions. `(x * x) + (y * y)` works; `x * x + y * y` is a parse error.

`increment` and `decrement` commands handle string-to-number conversion automatically (useful with DOM attributes).

## Strings

Single or double quotes. Template literals with backticks and `${expr}`.

`append` command appends to strings: `append " world" to myString`.

## Conversions (the `as` Operator)

| Target | Effect |
|--------|--------|
| `Int` | Parse as integer |
| `Float` | Parse as float |
| `Number` | Parse as number |
| `String` | Convert to string |
| `JSON` | Serialize to JSON string |
| `Object` | Parse JSON string to object |
| `Date` | Convert to Date |
| `Array` | Convert to array |
| `Fragment` | Parse string as HTML DocumentFragment |
| `HTML` | Convert NodeList/array to HTML string |
| `Values` | Convert form to `{name: value}` object |
| `Fixed<:N>` | Fixed precision string (`N` decimal places) |

Use parentheses to control binding: `(value of the next <input/>) as Int`.

## Closures

Haskell-inspired syntax: `\ arg -> expr`

```hyperscript
set lengths to strings.map(\ s -> s.length)
```

Closures are primarily for data structure manipulation callbacks. Prefer async transparency over callbacks for control flow.

## Functions

Defined with `def`, can take parameters and return values:

```hyperscript
def increment(i)
  return i + 1
end
```

Namespace with dot-separated identifiers: `def utils.increment(i)`.

Functions defined in `<script type="text/hyperscript">` are global. Functions defined on elements are available to that element and its children.

`return` returns a value; `exit` exits without a return value.

Hyperscript functions are callable from JavaScript (they return Promises if async).

## Exception Handling

`catch` and `finally` blocks work on both event handlers and functions:

```hyperscript
on click
  call mightThrow()
catch e
  log e
finally
  remove @disabled from me
end
```

Unhandled exceptions in event handlers trigger an `exception` event on the element:

```hyperscript
on exception(error)
  log "Error: " + error
```

`throw` raises exceptions: `throw "Bad value"`.

Exception handling respects async transparency — it works correctly across async boundaries.
````

- [ ] **Step 2: Run reference resolution test**

Run: `uv run pytest tests/test_hyperscript_skill.py::test_hyperscript_skill_references_resolve_in_isolation -v`
Expected: FAIL (other reference files not yet created)

- [ ] **Step 3: Run topic coverage test for core-language assertions**

Run: `uv run pytest tests/test_hyperscript_skill.py::test_hyperscript_skill_reference_files_cover_key_topics -v`
Expected: FAIL (other reference files not yet created, but core-language assertions should match if isolated)

- [ ] **Step 4: Commit**

```bash
git add skills/hyperscript/references/core-language.md
git commit -m "feat(hyperscript): add core-language.md reference"
```

---

### Task 5: Create dom-and-commands.md

**Files:**
- Create: `skills/hyperscript/references/dom-and-commands.md`

- [ ] **Step 1: Write dom-and-commands.md**

````markdown
# DOM and Commands

DOM querying, DOM mutation commands, transitions, and measurement.

## DOM Literals

| Syntax | Meaning | Example |
|--------|---------|---------|
| `.className` | Class reference (all matching elements) | `.tabs` |
| `#id` | ID reference (single element) | `#myDiv` |
| `<selector/>` | CSS query (all matching) | `<div.active/>` |
| `@attrName` | Attribute value on current element | `@data-count` |
| `*styleProp` | Style property value | `*width` |
| `35px`, `1em`, `0%` | Measurement literal (appends unit as string) | `set my *width to 35px` |

### Template Syntax for Dynamic Literals

- `#{expr}` — dynamic ID: `add .disabled to #{idVar}`
- `.{expr}` — dynamic class: `add .highlight to .{classVar}`
- `<${expr}/>` — dynamic query: `remove <${elementType}.hidden/>`

## Scoped Queries

### `in` Expression

Find elements within a specific parent:

```hyperscript
add .highlight to <p/> in me
```

### `closest` Expression

Find the closest matching ancestor:

```hyperscript
add .highlight to the closest <tr/>
```

`closest parent` excludes the current element and starts from the parent:

```hyperscript
add .highlight to the closest parent <div/>
```

## Positional Expressions

`first`, `last`, `random` extract from collections:

```hyperscript
add .highlight to the first <p/> in me
log random in myArr
```

## Relative Positional Expressions

`next` and `previous` find elements relative to the current position in a forward/backward DOM scan:

```hyperscript
add .highlight to the next <p/>
put "clicked" into the previous <output/>
```

`next` and `previous` support wrapping (cycling past the end/start of the collection).

## set and put

`set` assigns to variables and properties:

```hyperscript
set x to 10
set my innerHTML to "hello"
```

`put` is more flexible — supports placement modifiers:

| Form | Effect |
|------|--------|
| `put value into target` | Sets target (defaults to `innerHTML` for elements) |
| `put value before target` | Inserts before |
| `put value after target` | Inserts after |
| `put value at start of target` | Prepends |
| `put value at end of target` | Appends |

`put` into an element defaults to setting `innerHTML`. Elements inserted by `put` are automatically processed by hyperscript (no `processNode()` needed).

### Setting Attributes

```hyperscript
set @my-attr to 10
```

Attributes are always strings. Use `as Int` or `as Number` when reading them for numeric operations.

## add, remove, toggle

Operate on classes and attributes:

```hyperscript
add .active to me
remove .hidden from #panel
toggle .visible on me
add @disabled to me
remove @disabled from me
```

`toggle` variants:

- `toggle .cls on element` — standard toggle
- `toggle between .cls1 and .cls2` — alternate between two classes
- `toggle .cls on element for 2s` — toggle for a duration, then revert
- `toggle .cls on element until eventName` — toggle until an event fires

### Removing Content

`remove` can also remove elements from the DOM:

```hyperscript
remove me
remove <.old-items/>
```

## show and hide

```hyperscript
hide me
show #panel
hide me with display
show me with visibility
hide me with opacity
```

Default strategy is `display: none` / restoring original display value.

## take

Exclusive class ownership — removes the class from all elements in a set and adds it to the target:

```hyperscript
take .active from .tabs for me
```

This removes `.active` from all `.tabs` elements and adds it to `me`.

## tell

Temporarily changes the implicit target (`me`) within a block:

```hyperscript
tell <p/> add .highlight
```

Inside `tell`, commands operate on the specified elements instead of the current element.

## make

Creates class instances or DOM elements:

```hyperscript
make a Set from a, b, c
make a <p/> called para
make a URL from "/path", "https://origin.example.com" called myURL
```

The `called` modifier assigns the result to a variable.

## measure

Gets element measurements:

```hyperscript
measure me
log it.width
```

Returns an object with dimensional properties.

## append

Appends to strings, arrays, and DOM elements:

```hyperscript
append " world" to myString
append item to myArray
append newElement to #container
```

## Transitions and Settle

`transition` animates CSS properties:

```hyperscript
transition my opacity to 0 over 500ms
transition my *font-size to 150%
```

`settle` waits for any in-progress CSS transition to complete:

```hyperscript
add .fade-out then settle then remove me
```

Class-based transitions: add a class that triggers a CSS transition, then `settle` to wait for it to finish.

## Collection-Friendly Commands

Most commands operate on collections automatically:

```hyperscript
add .highlight to <p/>          -- adds to ALL paragraphs
remove .old from <div.stale/>   -- removes from all matching divs
toggle .visible on <.panel/>    -- toggles on all panels
```

No explicit loops needed for batch DOM operations.
````

- [ ] **Step 2: Commit**

```bash
git add skills/hyperscript/references/dom-and-commands.md
git commit -m "feat(hyperscript): add dom-and-commands.md reference"
```

---

### Task 6: Create events-and-async.md

**Files:**
- Create: `skills/hyperscript/references/events-and-async.md`

- [ ] **Step 1: Write events-and-async.md**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add skills/hyperscript/references/events-and-async.md
git commit -m "feat(hyperscript): add events-and-async.md reference"
```

---

### Task 7: Create advanced-and-interop.md

**Files:**
- Create: `skills/hyperscript/references/advanced-and-interop.md`

- [ ] **Step 1: Write advanced-and-interop.md**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add skills/hyperscript/references/advanced-and-interop.md
git commit -m "feat(hyperscript): add advanced-and-interop.md reference"
```

---

### Task 8: Create REFERENCE.md

**Files:**
- Create: `skills/hyperscript/references/REFERENCE.md`

- [ ] **Step 1: Write REFERENCE.md**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add skills/hyperscript/references/REFERENCE.md
git commit -m "feat(hyperscript): add REFERENCE.md cross-index"
```

---

### Task 9: Run full test suite and final verification

**Files:**
- Verify: `tests/test_hyperscript_skill.py` (all tests)

- [ ] **Step 1: Run all hyperscript skill tests**

Run: `uv run pytest tests/test_hyperscript_skill.py -v`
Expected: PASS (all tests green)

- [ ] **Step 2: Run full repository validation**

Run: `uv run pytest tests/ -v`
Expected: PASS (no regressions in existing tests)

- [ ] **Step 3: Fix any test failures**

If any tests fail, review the assertion messages, fix the content in the relevant file(s), and rerun until all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(hyperscript): complete hyperscript skill with tests and evals"
```
