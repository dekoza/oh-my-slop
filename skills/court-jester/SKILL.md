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

## Quick Start

1. Extract the user's actual thesis, proposal, or plan from context.
2. Restate it in its strongest form.
3. Auto-select the strongest critique mode from the routing guide below.
4. Load only the reference file for that mode.
5. Deliver a one-pass critique with the 3-5 strongest challenges, then synthesize a stronger path forward.
6. Offer a second pass only if another mode would materially improve the answer.

## Default Mode Selection

- Hidden assumptions or vague goals -> `references/socratic-questioning.md`
- Need the strongest opposing case or tradeoff analysis -> `references/dialectic-synthesis.md`
- Need failure analysis for a plan, migration, rollout, or strategy -> `references/pre-mortem-analysis.md`
- Need adversarial, security, abuse, or gaming analysis -> `references/red-team-adversarial.md`
- Need to test whether claims are actually supported by evidence -> `references/evidence-audit.md`
- Unsure or mixed signals -> `references/mode-selection-guide.md`, then choose the strongest primary mode

Use the `question` tool only if the user explicitly wants to choose the critique style or if two modes are equally plausible and the choice materially changes the result.

## 5 Reasoning Modes

| Mode | Method | Best For | Output |
|------|--------|----------|--------|
| Expose Assumptions | Socratic questioning | Surfacing unstated assumptions, vague terms, and missing constraints | Assumption inventory, probing questions, suggested experiments |
| Argue The Other Side | Hegelian dialectic plus steel manning | Strong counter-arguments and tradeoff decisions | Thesis, antithesis, synthesis, confidence |
| Find The Failure Modes | Pre-mortem plus second-order thinking | Plans, rollouts, migrations, and strategies | Ranked failure narratives, warning signs, mitigations |
| Attack This | Red teaming | Adversaries, abuse, incentive gaming, and hostile environments | Adversary profiles, attack vectors, defenses |
| Test The Evidence | Falsificationism plus evidence weighting | Claims supported by research, benchmarks, or anecdotes | Claims, falsification criteria, evidence grades, competing explanations |

## Core Workflow

1. **Identify** - Extract the user's real position from context and restate it in its strongest form.
2. **Select** - Auto-pick the best critique mode. Do not block on interactive mode selection by default.
3. **Challenge** - Apply the selected mode using concrete reasoning, not vague "what if" filler.
4. **Synthesize** - Turn the critique into a stronger recommendation, decision rule, mitigation set, or next experiment.
5. **Escalate** - Add a second mode only when it exposes a materially different risk.

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Socratic questioning | `references/socratic-questioning.md` | Assumptions, definitions, evidence basis, or perspective shifts are the main gap |
| Dialectic and synthesis | `references/dialectic-synthesis.md` | The plan needs the strongest opposing argument or tradeoff framing |
| Pre-mortem analysis | `references/pre-mortem-analysis.md` | The user asks what could go wrong or the plan has rollout risk |
| Red team adversarial | `references/red-team-adversarial.md` | The issue is security, abuse, gaming, sabotage, or hostile incentives |
| Evidence audit | `references/evidence-audit.md` | The conclusion depends on studies, data, pilots, benchmarks, or claims |
| Mode selection guide | `references/mode-selection-guide.md` | The right critique mode is unclear or multiple modes compete |

## Critical Rules

1. Steelman before critique. Attack the strongest version, not an easy caricature.
2. Default to one-pass output. Do not force a multi-turn challenge loop unless the user asks for it.
3. Limit the critique to the 3-5 strongest challenges. Depth beats laundry lists.
4. Ground every challenge in specific reasoning, failure chains, incentives, or evidence standards.
5. Drive toward synthesis or a better alternative. Do not dump objections and stop.
6. Say plainly when the plan is weak, brittle, unsupported, or overconfident.
7. Concede what survives scrutiny. Skepticism without honesty is just noise.
8. Do not override domain-specific facts with generic skepticism. Pair with the relevant domain skill when needed.

## Output Expectations

Every output should include:

1. **Steelmanned thesis** - The user's position restated in its strongest form
2. **Challenges** - The 3-5 strongest points from the selected mode
3. **Synthesis** - A strengthened recommendation, alternative, or mitigation path
4. **Highest-risk issue** - The single assumption, failure mode, or attack vector that matters most
5. **Next steps** - Concrete experiments, mitigations, or follow-up checks

## Content Ownership

This skill owns adversarial reasoning for plans, proposals, strategies, architectures, and recommendations.

This skill does not own domain-specific implementation guidance. Pair it with the relevant stack, framework, product, or project skill when the critique depends on local facts.
