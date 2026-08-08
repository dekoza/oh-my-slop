# Pyke Rules Syntax (KRB files)

This file describes the syntax of backward- and forward-chaining rules written
in `.krb` files, plus the `compound_premise` constructs (`first`, `forall`,
`notany`) and `python_premise`. The grammar below is taken verbatim from the
official Pyke 1.1.1 docs and verified against the `pyke/krb_compiler` source.

## Keywords

`as`, `assert`, `bc_extras`, `check`, `extending`, `False`, `foreach`, `in`,
`None`, `plan_extras`, `step`, `taking`, `True`, `use`, `when`, `with`,
`without`, `fc_extras`.

## File structure

```
file ::= [NL]
         ['extending' IDENTIFIER ['without' {IDENTIFIER,}] NL]
         [{fc_rule} ['fc_extras' NL INDENT {<python_statement> NL} DEINDENT]]
         [{bc_rule} ['bc_extras' NL INDENT {<python_statement> NL} DEINDENT]
          ['plan_extras' NL INDENT {<python_statement> NL} DEINDENT]]
```

The filename minus `.krb` is the rule base name (must be a legal Python
identifier). The optional `extending` clause defines the parent rule base this
rule base inherits from (and optionally excludes backward-chaining goals).

## Forward-chaining rule (`fc_rule`)

```
fc_rule ::= IDENTIFIER NL INDENT
               [fc_foreach]
               fc_assert
            DEINDENT

fc_foreach ::= 'foreach' NL INDENT {fc_premise NL} DEINDENT

fc_premise ::= fact_pattern | compound_premise | python_premise

fact_pattern ::= IDENTIFIER '.' IDENTIFIER '(' [{pattern,}] ')'

fc_assert ::= 'assert' NL INDENT {assertion NL} DEINDENT

assertion ::= fact_pattern | python_statements
```

Forward-chaining rules fire automatically when the rule base is activated.
`foreach` iterates over matching facts; `assert` adds new facts / runs Python.

## Backward-chaining rule (`bc_rule`)

```
bc_rule ::= IDENTIFIER NL INDENT
               use [when] [with]
            DEINDENT

use ::= 'use' IDENTIFIER '(' {pattern,} ')' ['taking' '(' <python_arg_spec> ')'] NL
      | 'use' IDENTIFIER '(' {pattern,} ')' NL
         INDENT 'taking' '(' <python_arg_spec> ')' NL
         DEINDENT
```

`use` is the *then* part (the goal this rule proves); `when` is the *if* part
(premises that must be true). If `when` is omitted the rule succeeds whenever
the `use` pattern matches the goal.

### Taking clause

`taking` defines parameters of the plan function produced by this rule (used
only when the rule has a plan). Do **not** put `$` on these names — they are
plain Python parameters, copied verbatim into the generated plan function.

### When clause

```
when ::= 'when' NL INDENT {bc_premise NL} DEINDENT

bc_premise ::= ['!'] [ name '.' ] name '(' {pattern,} ')' [ plan_spec ]
             | compound_premise
             | python_premise

name ::= IDENTIFIER | '$'IDENTIFIER
```

`!` raises `AssertionError` if the premise fails on the *first* try (not on
backtracking). A single `name` assumes the current rule base's category; two
`name`s name a category / knowledge base then an entity.

### plan_spec

A `plan_spec` says what to do with a subordinate plan returned by a premise.

```
plan_spec ::= [ 'step' NUMBER ] NL INDENT {<python_statement> NL} DEINDENT
            | 'as' '$'IDENTIFIER NL
```

`$$` refers to the subordinate plan function inside a `python_statement`.
`as` binds the plan to a pattern variable without executing it. Premises with
`python_statement` plan_specs (without `step`) run first; then named `step`
plans run in ascending number order.

### With clause

`with` contains Python statements included in the plan produced by this rule.
Pattern variables are cooked into the statements. A plan is generated whenever
the rule has a `with` clause or any plan_spec with a `python_statement`.

## Pattern

```
pattern ::= 'None' | 'True' | 'False'
          | NUMBER | IDENTIFIER | STRING | variable
          | '(' [{pattern,}] ['*' variable] ')'
```

`IDENTIFIER` is treated as a literal string. Variables start with `$`.
Anonymous variables start with `$_`. Rest variable `*$var` at the end of a
tuple pattern matches the rest of the tuple (always bound to a tuple).

### Tuple patterns / pathologies

`($a, *$b)` matches a tuple of length ≥ 1, binding `$a` to the head and `$b`
to the tail. `() *$var` is pathological — see docs.

## Compound premises

```
compound_premise ::= first_premise | forall_premise | notany_premise

first_premise ::= ['!'] 'first' premise
                | ['!'] 'first' NL INDENT {premise NL} DEINDENT
```
`first` prevents backtracking from finding later solutions (succeeds once).

```
forall_premise ::= 'forall' NL INDENT {premise NL} DEINDENT
                 [ 'require' NL INDENT {premise NL} DEINDENT ]
```
`forall` processes *all* solutions before succeeding; on backtracking it fails.
`require` premises are tried for each `forall` solution; the `forall` only
succeeds if all `require` premises hold for every solution. If `require` is
omitted, `forall` always succeeds (useful for gathering results).

```
notany_premise ::= 'notany' NL INDENT {premise NL} DEINDENT
```
`succeeds` only if no solution exists; fails on backtracking.

Notes:
- Bindings made inside `forall`/`notany` are undone before subsequent premises.
- Within backward-chaining rules, only `as` plan_specs are allowed in nested
  premises.
- Use `python y_list = []` + `y_list.append($y)` inside `forall` to gather
  values into a Python tuple, then assign `$result = tuple(y_list)`.

## python_premise

A line beginning with `python` followed by Python statements. The statements
can read/write pattern variables and use the `context` object. Used for
computations, assertions, and value construction inside `when` / `foreach` /
`assert` clauses.

## Backtracking

When a rule fails, Pyke backtracks to the most recent choice point (a premise
that had alternative matches) and tries the next alternative. This continues
until a complete proof is found or all alternatives are exhausted. `first` and
`notany` control this explicitly.
