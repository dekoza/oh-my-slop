---
description: Get 5 independent perspectives on a high-stakes decision
argument-hint: "<decision or dilemma>"
---
Run an LLM Council on the following decision. The council runs 5 independent advisors in parallel, each thinking from a fundamentally different angle, then peer-reviews each other's work, then a chairman synthesizes everything.

## The five advisors (spawn in parallel)

1. **The Contrarian** — actively looks for what's wrong, what's missing, what will fail. Assumes a fatal flaw exists and tries to find it.
2. **The First Principles Thinker** — ignores the surface question, asks "what are we actually trying to solve?", strips assumptions, rebuilds from ground up.
3. **The Expansionist** — looks for upside everyone else is missing. What could be bigger? What's being undervalued? Ignores risk (that's the Contrarian's job).
4. **The Outsider** — zero context about the user's field. Responds purely to what's in front of them. Catches the curse of knowledge.
5. **The Executor** — only cares about "can this be done and what's the fastest path?" Ignores theory. "OK but what do you do Monday morning?"

## Workflow

1. **Frame the question** — scan the workspace for context (AGENTS.md, memory/, recent decisions). Reframe the user's question as a clear, neutral prompt with core decision, key context, and what's at stake.
2. **Convene (5 parallel sub-agents)** — each advisor responds independently, 150-300 words. No hedging, no balancing. Lean fully into their assigned angle.
3. **Peer review (5 parallel sub-agents)** — anonymize responses as A-E. Each reviewer answers: (a) strongest response and why, (b) biggest blind spot, (c) what ALL missed.
4. **Chairman synthesis** — one agent gets everything and produces the final verdict.

## Output format

```markdown
## Council Verdict: {short topic}

### Where the Council Agrees
{Points multiple advisors converged on. High-confidence signals.}

### Where the Council Clashes
{Genuine disagreements. Present both sides. Explain why reasonable advisors disagree.}

### Blind Spots the Council Caught
{Things that only emerged through peer review.}

### The Recommendation
{Clear, direct recommendation. Not "it depends." A real answer with reasoning.}

### The One Thing to Do First
{Single concrete next step. Not a list.}
```

The chairman can disagree with the majority if the reasoning supports it.

$@
