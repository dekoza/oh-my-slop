# Examples

These examples mirror the ones shipped with Pyke 1.1.1 under
`examples/` and `doc/examples/`. They demonstrate the core workflows.

## Family relations (backward chaining)

Facts in `family.kfb` (fact base `family`):
```
son_of(bruce, thomas, norma)
daughter_of(shirley, david_r, sarah_r)
```

Rule base `bc_example.krb` defines rules like:
```
father_son
    use child_parent($child, $father, father, son)
    when
        family.son_of($child, $father, $mother)
```

Usage:
```python
from pyke import knowledge_engine
engine = knowledge_engine.engine(__file__)   # __file__ is in examples/family_relations
engine.activate('bc_example')
vars, plan = engine.prove_1_goal(
    'bc_example.how_related(bruce, $person2, $relationship)')
print(vars['person2'], vars['relationship'])
```

## Towers of Hanoi

```python
import sys, os
os.chdir("examples/towers_of_hanoi")
from driver import test
test(2)  # -> got 1: ((0, 1), (0, 2), (1, 2))
```

## Sqlgen (plan example)

Pyke can generate SQL SELECT statements and return a *plan* that is executed
later. The plan may be pickled and reused without re-running the rules.

## Knapsack

A Prolog-style knapsack solver rewritten in Pyke (`knapsack.krb`).

## Using `forall` / `notany` / `first`

```
python y_list = []
forall
    generate_x($x)
require
    compute_x($x, $y)
    python y_list.append($y)
$y_list = tuple(y_list)
```

## Special: `claim_goal`

```
one_dog
    use n_dogs(1, '1 dog')
    when
        special.claim_goal()

n_dogs
    use n_dogs($n, $phrase)
    when
        $phrase = "%d dogs" % $n
```

## Special: `command`

```
special.command($out, ('echo', 'hi'))
# $out -> ('hi',)
```

## Extending rule bases

```
extending parent_rb without goal3
```

This rule base inherits all backward-chaining rules from `parent_rb` except
`goal3`. Forward-chaining rules are not inherited.
