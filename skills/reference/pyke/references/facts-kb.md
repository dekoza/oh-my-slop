# Facts, Fact Bases, and Knowledge Bases

Pyke stores knowledge as *statements* (facts). A fact is a name plus ordered
arguments: `name(arg1, arg2, ...)`. The position of each argument matters.

## Statement (fact) data types

Arguments may be:
- strings (proper identifiers need no quotes: `Fred` == `'Fred'`);
- numbers (integers/floats; complex numbers not supported);
- `None`, `True`, `False`;
- tuples of any of the above, nested arbitrarily;
- **not** dicts, lists, or user-defined objects (facts are treated as
  immutable).

Singleton tuples need no comma: `(1)` == `(1,)`.

## Duplicate facts

Duplicate facts (same name and same arguments) are silently ignored. There is
never a need to state the same fact twice.

## Knowledge bases

Knowledge is organized into named repositories called *knowledge bases*.
Knowledge bases cannot be nested; entities have a two-level name:
`knowledge_base_name.knowledge_entity_name`.

There are four kinds of knowledge base:

| Kind | Files | How truth is determined |
|------|-------|--------------------------|
| fact base | `.kfb` | statement is in its list of known facts |
| rule base | `.krb` | if-then rules construct a proof |
| question base | `.kqb` | poses the statement to an end user |
| special | (built-in) | `special.claim_goal`, `check_command`, `command`, `general_command` |

All knowledge bases share one namespace — no two may have the same name.

## Fact bases

A fact base holds facts. It supports:
- **universal facts**: never deleted by `engine.reset()`; established once at
  init via `engine.add_universal_fact(kb_name, fact_name, args)` or loaded from
  `.kfb` files;
- **case-specific facts**: deleted by `engine.reset()`; asserted per case via
  `engine.assert_(kb_name, fact_name, args)` / `add_case_specific_fact`.

`engine.get_kb(kb_name)` returns the fact base; use
`kb.dump_universal_facts()` / `kb.dump_specific_facts()` to inspect them.

## Rule bases

A rule base holds backward- and/or forward-chaining rules. It is *activated*
with `engine.activate('rb_name')`; activation runs the forward-chaining rules.
Only activated rule bases are used to prove goals.

## Special knowledge base

Only one instance, called `special`. It provides:
- `special.claim_goal()` — acts like the Prolog cut operator; prevents further
  rules from being tried for the current goal on backtracking.
- `special.check_command(cmd, [cwd], [stdin])` — returns success/failure based
  on the command exit code (0 = success).
- `special.command($out, cmd, [cwd], [stdin])` — runs a command and yields its
  stdout lines as a tuple bound to `$out` (only if exit code == 0).
- `special.general_command($result, cmd, [cwd], [stdin])` — runs a command and
  yields `($retcode, stdout, stderr)`.

## Question bases

`.kqb` files define questions for end users. Answers are remembered (cached)
per run and erased on `engine.reset()`. A question has a name, parameters, an
answer parameter, and optional review text. Referenced in premises as
`qbase.question($param, $ans)`.

## KFB syntax (fact base source files)

```
file ::= [NL] {fact NL}
fact ::= IDENTIFIER '(' [{data,}] ')'
data ::= 'None' | 'True' | 'False' | NUMBER | IDENTIFIER | STRING
       | '(' [{data,}] ')'
```

The name of the fact base is the filename minus `.kfb`. Comments start with
`#`.

Example (`family.kfb`):
```
son_of(bruce, thomas, norma)
daughter_of(shirley, david_r, sarah_r)
```
