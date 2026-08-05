# pi forces model-invocation on any skill another skill must reach

`handoff` and `wayfinder` are conceptually **user-invoked** skills — a human types
their name — and upstream `mattpocock/skills` ships both that way. In pi they are
**model-invoked**, and the `disable-model-invocation: true` line is commented out in
both frontmatters rather than deleted. That is deliberate, not leftover debris.

## The constraint

`disable-model-invocation: true` strips a skill's `description` from the model's
`<available_skills>` listing. A skill with no description is reachable *only* by the
human typing its name — nothing in the agent's context can fire it, including another
skill. (This is the invocation axis as
[`writing-great-skills/GLOSSARY.md`](../../skills/writing-great-skills/GLOSSARY.md)
defines it: model-invocation always *includes* user reach, so it is strictly the more
reachable of the two.)

`improve-codebase-architecture` is the sharp case. It is itself user-invoked, and at
`SKILL.md:160` it hands the entire charting step to `wayfinder`: *"Chart a wayfinder
map per the wayfinder skill, following its charting mode."* If `wayfinder` were
user-invoked, that instruction would name a skill the running agent cannot reach —
the flow would silently degrade into the agent improvising tracker operations that
`wayfinder` explicitly owns.

## The trade-off

Model-invocation buys reachability and pays a permanent **context load**: both
descriptions sit in every context window, every turn, competing for attention. We pay
it. The alternative — inlining wayfinder's tracker operations into every caller —
duplicates the one thing `wayfinder` is the single source of truth for.

## The convention

A **commented-out** `#disable-model-invocation: true` means: *upstream ships this
user-invoked, and it would be user-invoked here too if pi allowed a skill to reach
one.* Deleting the line loses that; uncommenting it breaks the callers. Leave it, and
read it as a marker rather than a mistake.

This applies only to skills something else must reach. The other eleven user-invoked
skills (`triage`, `to-spec`, `to-tickets`, `implement`, `teach`, …) set the flag
normally — they are entry points, and nothing fires them but a human.

Set by `e8f2701` ("Enable model-invocation - required when used inside conversation");
the reasoning was recorded nowhere until this ADR.
