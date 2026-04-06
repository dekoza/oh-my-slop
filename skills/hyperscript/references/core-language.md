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
