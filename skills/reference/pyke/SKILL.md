---
name: pyke
description: >
  Use when building, reviewing, or debugging Pyke (Python Knowledge Engine,
  scitools-pyke) expert-system / logic-programming code — writing .krb/.kfb/.kqb
  source files, using the knowledge_engine.engine API, pattern matching, rules,
  plans, the special knowledge base, or question bases. Triggers on: "Pyke",
  "scitools-pyke", ".krb", ".kfb", ".kqb", "knowledge_engine", "backward
  chaining", "expert system", "forward chaining".
scope: pyke
target_versions: "Pyke 1.1.1"
last_verified: 2026-08-08
source_basis: official docs (pyke.sourceforge.net) + PyPI source tree
---

# Pyke (Python Knowledge Engine) Reference

Use this skill for Pyke work. Pyke introduces logic programming (inspired by
Prolog) to Python via a knowledge-based inference engine written in 100% Python.
You write Python functions and Pyke *rules* that assemble them into customized
call graphs ("plans") for specific use cases.

Read only the reference file(s) needed for the task.

## Critical Gotchas

1. **Rule base activation runs forward-chaining rules** — `engine.activate()`
   fires all forward-chaining rules in the activated rule bases. Assert your
   facts *before* activating, or use universal facts / `.kfb` files loaded at
   engine creation.
2. **`reset()` erases case-specific facts and deactivates rule bases** — call
   `engine.reset()` between cases, then re-assert facts and re-activate.
3. **Goals are strings with `$` pattern variables** — e.g.
   `family.how_related($p1, $p2, $rel)`. Pattern variables start with `$`.
4. **`prove_1_goal` returns `(vars, plan)`** — `vars` is a dict (without `$`)
   of pattern-variable bindings; `plan` is a callable (or `None`). Plans can be
   pickled.
5. **`prove_goal` returns a context-manager generator** — use `with` and iterate
   to get all solutions. Raises no exception when there are no solutions.
6. **`CanNotProve` is raised only by `prove_1_goal`** — `prove_goal` returns an
   empty generator instead.
7. **`IDENTIFIER` in patterns is a literal** — to use a variable, write `$name`.
8. **Duplicate facts are silently ignored** — a fact with the same name and
   arguments cannot be asserted twice.
9. **`assert_` is case-specific** — use `add_universal_fact` for persistent
   facts, or put facts in `.kfb` files.
10. **`engine` constructor scans recursively** — `.kfb`/`.krb`/`.kqb` files are
    found anywhere under the search path; the knowledge-base name is the
    filename minus its suffix.

## Routing

| File | Use for |
|------|---------|
| `references/api-engine.md` | `knowledge_engine.engine` API, lifecycle, asserting facts, proving goals, tracing, stats |
| `references/rules-syntax.md` | `.krb` syntax: `fc_rule`, `bc_rule`, `use`/`when`/`with`/`taking`, `plan_spec`, `first`/`forall`/`notany`, compound premises, Python premises |
| `references/facts-kb.md` | facts, fact bases, knowledge bases, special KB, question bases |
| `references/pyke-syntax.md` | KFB/KRB/KQB source-file syntax, lexical rules, data types |
| `references/pattern-matching.md` | pattern syntax, pattern/anonymous/rest variables, matching semantics, `context` API |
| `references/using-pyke.md` | operational workflow: create engine, assert facts, activate, prove goals, plans, tracing, compiled goals |
| `references/special-qbase.md` | `special.claim_goal`/`check_command`/`command`/`general_command`, question-base details |
| `references/examples.md` | concrete examples mirroring the shipped `examples/` |
| `references/REFERENCE.md` | cross-file routing (this is it) |

## When NOT to Use This Skill

- **Prolog itself** — this skill is Pyke-specific (Python integration).
- **Generic rule-engine libraries** (e.g. `rules_engine`, `jsonrules`) — only
  Pyke's `scitools-pyke` package.
- **Pyke 0.x / legacy 0.6** — the 1.1.1 API differs (e.g. `engine`
  constructor, `prove_goal`/`prove_1_goal`).

## Output Expectations

- Name the source file(s) and knowledge-base name(s) used.
- State which rule base must be activated and in what order facts are asserted.
- If a plan is involved, explain how it is produced (`with`/`plan_spec`/`taking`)
  and how it is called/pickled.
- State the minimum verification: create an engine, activate, and run a
  `prove_1_goal` smoke test against a tiny `.kfb`/`.krb` pair.
