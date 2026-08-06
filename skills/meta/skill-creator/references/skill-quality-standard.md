# oh-my-slop skill-quality standard

The library-wide standard every skill refinement and every new skill is checked against.
Decided 2026-07-17 on [Define the shared skill-quality standard](http://192.168.129.37:30008/minder/oh-my-slop/issues/2).
Prose-craft vocabulary (**leading words**, **context load** vs **cognitive load**, the
info-hierarchy ladder, the no-op test, the failure-mode taxonomy) lives only in the
`writing-great-skills` skill and its GLOSSARY.md — this file cites those terms, never
redefines them.

## 1. Invocation mode

Every skill is explicitly one of:

- **User-invoked** (`disable-model-invocation: true`): the skill starts a
  session-shaped ritual the human must consciously choose — an interview, a council,
  an audit, a handoff. Misfiring is annoying and its description earns no context
  budget.
- **Model-invoked** (default): the skill encodes knowledge or discipline the model
  must apply spontaneously without being asked — domain references (django, htmx),
  discipline rules (tdd, english-only), and workflow skills that trigger off natural
  requests.

**Exception:** a ritual stays model-invoked when another skill invokes it as a
primitive (`grilling` and `prototype` — wayfinder calls both; `ponytail-audit` —
improve-codebase-architecture invokes it mid-flow). `grill-me` converted because it
is only a human entry point to `grilling`. A mere file-path cross-reference
("See `../other/SKILL.md`") is not an invocation — the agent Reads the file directly,
which the flag doesn't block — so it doesn't force this exception.

## 2. Description standard

**Model-invoked skills** — all of:

- Starts with "Use when" (or "Use whenever"), third person.
- Contains ONLY triggering conditions: situations, symptoms, verbatim user phrases.
  No workflow summaries, no feature lists.
- ≤ 3 sentences / ~75 words.
- Any "Triggers on:" list has ≤ 8 items, each something a user would actually type or
  a symptom actually observed — never a domain-vocabulary dump. Keyword-stuffed,
  encyclopedic descriptions *under*trigger (observed on ui-design-direction, caveman).

**User-invoked skills**: the description is purely human-facing — one plain line
saying what invoking it does. No trigger language; it is dead weight there.

## 3. Body-structure checklist

Apply to every SKILL.md touched:

- [ ] SKILL.md is a **decision layer**, not a table of contents — it tells the agent
      what to do and when, and points at references for depth (the info-hierarchy
      ladder: in-skill step → in-skill reference → external reference).
- [ ] Critical rules sit at the **top** of the body, never buried mid-file.
- [ ] **Positive framing**: say what to do, not lists of prohibitions. Reserve
      negation for the few traps that genuinely need it.
- [ ] Every instruction passes the **no-op test** — deleting it would change agent
      behavior; if not, delete it.
- [ ] Any proposed addition names which **failure mode** it prevents (premature
      completion, duplication, sediment, sprawl, negation — see writing-great-skills
      GLOSSARY.md); an addition that prevents none is sediment.
- [ ] **Leading words** open each instruction — imperative verbs the agent can act on.

## 4. Trigger-eval policy

Risk-based, not universal. A trigger eval (skill-creator's benchmark tooling) is
required in exactly three cases:

1. A model-invoked skill with a **known triggering failure** in session history — the
   eval reproduces the failure before the fix and gates the fix.
2. A refinement that **materially rewrites** a model-invoked skill's description —
   the eval verifies the rewrite didn't break triggering.
3. A **new model-invoked skill** — it enters the library with eval coverage from day
   one.

User-invoked skills never need trigger evals (they cannot misfire). Format-only
description trims (no semantic change) don't force one either.
