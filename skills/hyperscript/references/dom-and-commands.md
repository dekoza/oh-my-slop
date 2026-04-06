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
