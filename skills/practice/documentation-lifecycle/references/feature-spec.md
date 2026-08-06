# Feature Spec

A feature spec is the canonical statement of intended behavior. It exists so tests, implementation, operators, and future maintainers have one place to answer: **what should this feature do right now?**

Use a feature spec for non-trivial behavior changes. Do not create a brand-new spec if an active canonical spec already exists for the same capability. Update that document instead.

## What a Feature Spec Must Contain

### Status

Start with a visible status marker:

- Draft
- Active
- Superseded
- Deprecated

### Problem Statement

State the problem in concrete terms. Avoid generic fluff such as “improve UX” or “make it more scalable” without specifics.

### Goals

List the outcomes the change must achieve.

### Non-goals

State what the spec deliberately does **not** solve.

### Actors and Preconditions

Who uses or operates this feature? What must be true before the flow starts?

### Main Flows

Describe the normal happy-path behavior in sequence.

### Edge Cases

Describe failure paths, exceptional inputs, partial states, backward compatibility constraints, and recovery expectations.

### Acceptance Criteria

These must be testable. If a criterion cannot be translated into unit, integration, or E2E tests, it is probably too vague.

### Operational Impact

Call out deployment, migration, rollback, observability, alerting, or support implications.

## Writing Rules

1. Write behavior, not implementation gossip.
2. Keep the language normative and current-tense.
3. Prefer concrete actors, states, and transitions over slogans.
4. Make acceptance criteria specific enough to drive tests.
5. Link or name the other documents that must remain in sync: ADRs, reference docs, runbooks, user docs.
6. If the feature changes later, update the spec immediately or mark it superseded.

## Minimal Template

```markdown
# [Feature name]
Status: Draft | Active | Superseded | Deprecated

## Problem
[What problem exists now?]

## Goals
- ...

## Non-goals
- ...

## Actors
- ...

## Preconditions
- ...

## Main flows
1. ...
2. ...

## Edge cases
- ...

## Acceptance criteria
- ...

## Operational impact
- deploy:
- migrate:
- rollback:
- observability:

## Documents to keep aligned
- ADR:
- Reference docs:
- Runbook:
- User-facing docs:
```

## Smells

- Goals without non-goals.
- Happy path only.
- Acceptance criteria that say “works well”, “fast”, or “intuitive” without measurable meaning.
- No operational impact section even though the feature changes deploy, migrate, or on-call behavior.
- A spec that restates the implementation after the fact instead of defining the behavior before implementation.
