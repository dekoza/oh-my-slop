# Using Pyke from Python

This is the operational workflow: create an engine, assert facts, activate
rule bases, and prove goals. Plans can be executed, pickled, and reused.

## Simplest usage (three steps)

```python
from pyke import knowledge_engine

my_engine = knowledge_engine.engine(__file__)   # 1. compile + load KBs
my_engine.activate('bc_related')                # 2. activate rule bases (runs FC rules)
my_engine.prove_1_goal('bc_related.father_son(bruce, $son, ())')  # 3. prove a goal
```

Returns: `({'son': 'david'}, None)` — a tuple of (pattern-variable bindings,
plan). `None` plan means no plan was generated.

## Dynamic (case-specific) facts

```python
my_engine = knowledge_engine.engine(__file__)
my_engine.assert_('family2', 'son_of', ('spike_the_dog', 'david'))
my_engine.activate('bc_related')
my_engine.prove_1_goal('bc_related.father_son(bruce, $grandson, (grand))')
```

Universal facts are established once (`add_universal_fact` or `.kfb` files);
case-specific facts are asserted per case (`assert_`).

## Different facts for different cases

```python
my_engine.assert_('family2', 'son_of', ('spike_the_dog', 'david'))
my_engine.activate('bc_related')
my_engine.prove_1_goal(...)
my_engine.reset()  # erases case-specific facts + deactivates rule bases
my_engine.assert_('family2', 'son_of', ('felix_the_cat', 'david'))
my_engine.activate('bc_related')
my_engine.prove_1_goal(...)
```

## Plans

A plan is a Python function assembled by backward-chaining rules. Once obtained
from `prove_1_goal` / `prove_goal`, call it like a normal function. Plans can be
pickled and unpickled (only one small Pyke module is needed to run them).

```python
with engine.prove_goal('example.how_related($person1, $person2)') as gen:
    for vars, plan in gen:
        print(vars['person2'], '->', plan())  # execute the plan
```

A plan is generated when a rule has a `with` clause or a `plan_spec` with
Python statements. The `taking` clause of the rule defines the plan's
parameters.

## Tracing

```python
my_engine.trace('bc_related0', 'grand_father_son')
my_engine.prove_1_goal('bc_related0.father_son(thomas, david, $depth)')
my_engine.untrace('bc_related0', 'grand_father_son')
```

Use `krb_traceback.print_exc()` in `except` blocks to get `.krb`-line tracebacks.

## Compiled goals

```python
from pyke import goal
my_goal = goal.compile('bc_related0.father_son($father, $son, $depth)')
vars, plan = my_goal.prove_1(my_engine, father='thomas', son='david')
```

## Multiple answers

```python
with my_engine.prove_goal('bc_related0.father_son(thomas, $son, $depth)') as gen:
    for vars, plan in gen:
        print(vars['son'], vars['depth'])
```
