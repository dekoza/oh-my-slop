# Pattern Matching and Pattern Variables

Patterns are used in `.krb` rules to match facts and goals. They are the same
syntax used in `use`, `when`, `foreach`, `assert`, and goal strings.

## Pattern syntax

```
pattern ::= 'None' | 'True' | 'False'
          | NUMBER | IDENTIFIER | STRING | variable
          | '(' [{pattern,}] ['*' variable] ')'
```

- `IDENTIFIER` acts like a `STRING` — it is a literal value (not a variable).
  To use an identifier as a variable, prefix it with `$`.
- `NUMBER`, `STRING`, `None`, `True`, `False` are literal data values.
- A tuple pattern `(...)` matches a tuple value element-wise.
- `*$var` (rest variable) at the end of a tuple pattern binds `$var` to the
  remainder of the tuple (always a tuple, possibly empty).

## Pattern variables

A pattern variable starts with `$` followed by an identifier: `$son`.

- A pattern variable is **bound** to a value or **unbound**.
- When Pyke finds a match, it *binds* the variable to the matched value.
- On backtracking, the variable is *unbound* so another value can be tried.
- Variables are output parameters: Pyke binds them and returns them to the
  caller.

### Anonymous variables

A variable whose identifier begins with `_` (e.g. `$_`) is an anonymous
"don't care" variable. Multiple uses of the same anonymous variable may stand
for different values. The name is ignored.

### Rest variables

`*$var` at the end of a tuple pattern matches the rest of the tuple:
`($head, *$rest)` binds `$head` to the first element and `$rest` to a tuple of
the remaining elements (possibly empty).

## Matching semantics

- A pattern **matches** a data value if they are the same shape and all
  sub-patterns match.
- A pattern variable matches any value and binds to it.
- `IDENTIFIER` matches only itself (literal).
- Tuples match element-wise.
- `None`/`True`/`False`/`NUMBER`/`STRING` match by equality.
- Two pattern variables with the same name must bind to the same value within a
  single proof attempt.

## Pathological cases

- `($a, *$b)` where `$b` is also used elsewhere: `$b` is always a tuple.
- The empty tuple `()` only matches the empty tuple.
- A singleton tuple `(x)` (no trailing comma) is the same as `x` — to match a
  singleton tuple use `(x,)` with a comma, or `(x)` where `x` is itself a tuple
  pattern.

## Context API (used inside rules)

Inside `when`/`with`/`bc_extras`/`python` clauses, the `context` object is
available:

- `context.is_bound(variable)` — True if the variable is currently bound.
- `context.lookup_data(name)` — return the bound value of a pattern variable.
- `context.bind(name, value)` — bind a name to a value in the current context.
- `context.mark()` / `context.undo_to_mark(mark)` — save/restore point for
  backtracking (used internally by `forall`/`notany`).
