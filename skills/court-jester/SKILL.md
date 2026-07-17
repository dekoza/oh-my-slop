---
name: court-jester
description: One-pass adversarial critique of a plan or proposal — picks a critique mode (socratic, dialectic, pre-mortem, red-team, evidence audit) and delivers the 3–5 strongest challenges.
disable-model-invocation: true
license: Complete terms in LICENSE.txt
---

# Court Jester

Use this skill to challenge plans, decisions, proposals, and recommendations with structured critical reasoning. The goal is not performative disagreement. The goal is to find hidden assumptions, weak evidence, brittle tradeoffs, and failure modes early enough to improve the final decision. This is the default adversarial review skill for planning work.

## When To Use This Skill

- Stress-test a plan, architecture, strategy, or rollout before committing.
- Challenge technology, vendor, or approach choices.
- Review a proposal that sounds plausible but may rest on weak assumptions.
- Run a pre-mortem before implementation or migration work.
- Red-team a design, workflow, or incentive system.
- Audit whether evidence actually supports a conclusion.
- Force a planning pass to confront its best counter-arguments.

## Workflow

1. **Identify** — extract the user's real thesis, plan, or proposal from context and restate it in its strongest form (steelman).
2. **Select** — auto-pick the strongest mode from the table below and load only that one reference. Don't block on interactive selection; use the `question` tool only when the user explicitly wants to choose the critique style, or when two modes are equally plausible and the choice materially changes the result.
3. **Challenge** — apply the mode, delivering the 3–5 strongest challenges with concrete reasoning (failure chains, incentives, evidence standards) — not vague "what if" filler.
4. **Synthesize** — turn the critique into a stronger recommendation, decision rule, mitigation set, or next experiment.
5. **Escalate** — add a second mode only when it exposes a materially different risk.

## Modes

| Mode | Use when | Reference |
|------|----------|-----------|
| **Expose assumptions** (Socratic) | Hidden assumptions, vague goals, or undefined terms are the main gap | `references/socratic-questioning.md` |
| **Argue the other side** (dialectic + steelman) | A trade-off or approach choice needs its strongest opposing case | `references/dialectic-synthesis.md` |
| **Find the failure modes** (pre-mortem) | A plan, rollout, migration, or strategy could go wrong | `references/pre-mortem-analysis.md` |
| **Attack this** (red team) | The risk is security, abuse, gaming, sabotage, or hostile incentives | `references/red-team-adversarial.md` |
| **Test the evidence** (falsification) | A conclusion rests on studies, data, pilots, benchmarks, or claims | `references/evidence-audit.md` |

Unsure or mixed signals: load `references/mode-selection-guide.md`, then choose the strongest primary mode.

## Critical Rules

1. Steelman before critique. Attack the strongest version, not an easy caricature.
2. Default to one-pass output. Don't force a multi-turn challenge loop unless the user asks for it.
3. Limit the critique to the 3–5 strongest challenges. Depth beats laundry lists.
4. Drive toward synthesis or a better alternative. Don't dump objections and stop.
5. Say plainly when the plan is weak, brittle, unsupported, or overconfident — and concede what survives scrutiny. Skepticism without honesty is just noise.
6. Don't override domain-specific facts with generic skepticism. Pair with the relevant domain skill when the critique depends on local facts.

## Output Expectations

Every output includes these three; add the last two when they carry weight:

1. **Steelmanned thesis** — the user's position restated in its strongest form.
2. **Challenges** — the 3–5 strongest points from the selected mode.
3. **Synthesis** — a strengthened recommendation, alternative, or mitigation path.
4. **Highest-risk issue** — the single assumption, failure mode, or attack vector that matters most.
5. **Next steps** — concrete experiments, mitigations, or follow-up checks.
