# Architecture Decision Record (ADR)

Use an ADR when a decision changes the system’s structure, quality attributes, operational model, or long-term reversibility. If the decision is trivial, local, and cheap to undo, an ADR is probably documentation theater.

## When an ADR Is Warranted

Create or update an ADR when the change affects:

- service boundaries or module boundaries
- persistence or data flow shape
- infrastructure or runtime model
- security or compliance posture
- deployment topology or failure domains
- a hard-to-reverse dependency or protocol choice

## What an ADR Must Capture

### Status

Use an explicit status:

- Proposed
- Accepted
- Superseded
- Deprecated

### Context

What situation made this decision necessary? Include constraints, system pressures, and facts that matter.

### Options Considered

List the serious alternatives, not a fake token alternative for appearances.

### Decision

State the chosen path plainly.

### Tradeoffs

Name the wins and losses. If the decision gives up flexibility, speed, simplicity, or cost, say so.

### Consequences

Describe immediate and downstream effects on implementation, testing, operations, compatibility, and future work.

### Supersession

If a new ADR replaces an older one, mark the old record **Superseded** and link the relationship. Do not rewrite history until the rationale disappears.

## Minimal Template

```markdown
# ADR: [Decision title]
Status: Proposed | Accepted | Superseded | Deprecated

## Context
- ...

## Options considered
1. Option A
2. Option B
3. Option C

## Decision
- ...

## Tradeoffs
- Benefits:
- Costs:
- Risks:

## Consequences
- Implementation:
- Testing:
- Operations:
- Compatibility:

## Related docs
- Feature spec:
- Reference docs:
- Runbook:
- Superseded by / Supersedes:
```

## Rules

1. Be honest about why the rejected options lost.
2. Do not hide uncertainty; if confidence is low, say so.
3. Do not put raw implementation steps here; ADRs record rationale, not runbooks.
4. If the system changes direction later, write a new ADR and mark the old one as superseded.

## Smells

- “Options considered” contains only the chosen option.
- “Tradeoffs” lists only benefits.
- The decision is really a feature behavior question that belongs in the feature spec.
- The ADR is being used to avoid writing a runbook, migration plan, or exact reference docs.
