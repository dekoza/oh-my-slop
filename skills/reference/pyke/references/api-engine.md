# The `knowledge_engine.engine` API

This is the single entry point to Pyke. All reasoning is driven through an
`engine` instance. The module is imported as `from pyke import knowledge_engine`.

## Constructor

```
engine(*search_paths, **kws)
```

`search_paths` are directories (or modules / `(path, target_package)` tuples)
where Pyke recursively scans for `.kfb`, `.krb`, `.kqb` source files. The
compiled artifacts (`.fbc` pickles, `.py` rule files, `.qbc` pickles) are placed
in a target package (default `.compiled_krb`, a sibling of the source package).

Keyword args (all boolean, default `True`):
- `load_fb` — load fact bases
- `load_fc` — load forward-chaining rules
- `load_bc` — load backward-chaining rules and plans
- `load_qb` — load question bases

Pass `(path, None)` to load precompiled artifacts without scanning source files
(target package must be absolute).

## Lifecycle methods

| Method | Effect |
|--------|--------|
| `engine.reset()` | Erases all case-specific facts and deactivates all rule bases |
| `engine.activate(*rb_names)` | Activates rule bases; runs forward-chaining rules |
| `engine.get_kb(kb_name)` | Returns the fact base / knowledge base (raises KeyError) |
| `engine.get_rb(rb_name)` | Returns the rule base (any, active or not) |

## Asserting facts

| Method | Scope | Notes |
|--------|-------|-------|
| `engine.add_universal_fact(kb_name, fact_name, args)` | persists across resets | `args` must be a tuple/iterable, not a string |
| `engine.add_case_specific_fact(kb_name, fact_name, args)` | deleted by `reset()` | |
| `engine.assert_(kb_name, fact_name, args)` | deleted by `reset()` | alias of add_case_specific_fact |

## Proving goals

A *goal* is a statement string, optionally with `$` pattern variables, e.g.
`family.how_related($person1, $person2, $relationship)`.

| Method | Returns | Raises |
|--------|---------|--------|
| `engine.prove_1_goal(goal, **args)` | `(vars, plan)` first solution | `CanNotProve` if none |
| `engine.prove_goal(goal, **args)` | context manager → generator of `(vars, plan)` | nothing; empty if none |

`args` are bound to pattern variables (keyword). `vars` is a dict mapping
`$var` → value (without the `$`). `plan` is a callable Python function (or
`None` if no plan was produced); call it to execute the cooked plan. Plans may
be pickled and restored (only imports one small Pyke module to run).

Compiled goals: `from pyke import goal; my_goal = goal.compile(goal_str)` then
`my_goal.prove_1(engine, **args)` / `my_goal.prove(engine, **args)`.

## Tracing

- `engine.trace('rb_name', 'rule_name')` — trace a single rule (prints match/success).
- `engine.untrace('rb_name', 'rule_name')` — stop tracing.
- `engine.print_stats(f)` — print per-kb statistics (facts asserted, FC rules
  fired, BC goals tried, rules matched/succeeded/failed). Reset by `engine.reset()`.
- `engine.get_kb('rb_name').get_stats()` — programmatic stats.

## `krb_traceback`

`from pyke import krb_traceback` provides `print_exc()`, `print_tb()` etc. that
convert generated Python stack frames back to `.krb` file line numbers.

## Key exception

`knowledge_engine.CanNotProve` — raised by `prove_1_goal` when no proof exists.
