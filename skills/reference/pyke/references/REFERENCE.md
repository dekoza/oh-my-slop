# Pyke Reference — Cross-File Routing

This is the entry point. Route the task to the matching file below and read
only what the task needs.

| File | Use for |
|------|---------|
| `api-engine.md` | `knowledge_engine.engine` API, lifecycle, asserting facts, proving goals, tracing, stats |
| `rules-syntax.md` | `.krb` syntax: `fc_rule`, `bc_rule`, `use`/`when`/`with`/`taking`, `plan_spec`, `first`/`forall`/`notany`, compound premises, Python premises |
| `facts-kb.md` | facts, fact bases, knowledge bases, special KB, question bases |
| `pyke-syntax.md` | KFB/KRB/KQB source-file syntax, lexical rules, data types |
| `pattern-matching.md` | pattern syntax, pattern/anonymous/rest variables, matching semantics, `context` API |
| `using-pyke.md` | operational workflow: create engine, assert facts, activate, prove goals, plans, tracing, compiled goals |
| `special-qbase.md` | `special.claim_goal`/`check_command`/`command`/`general_command`, question-base details |
| `examples.md` | concrete examples mirroring the shipped `examples/` |

## Quick decision tree

- **API / Python driver / proving goals** → `api-engine.md` + `using-pyke.md`
- **Writing rules (.krb)** → `rules-syntax.md` + `pattern-matching.md`
- **Writing facts (.kfb)** → `facts-kb.md` + `pyke-syntax.md`
- **Question bases (.kqb)** → `special-qbase.md` + `facts-kb.md`
- **Special functions (commands, cut)** → `special-qbase.md`
- **Debugging / stats / tracing** → `api-engine.md`
- **Examples to copy** → `examples.md`

## Source basis

Official Pyke 1.1.1 documentation (https://pyke.sourceforge.net/) and the
`scitools-pyke` PyPI source tree (1.1.1).
