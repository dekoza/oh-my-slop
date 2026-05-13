# Runbook

A runbook is maintenance documentation for operating, changing, diagnosing, and recovering a system. If the change affects deploy, migrate, rollback, observability, or incident handling, the runbook is part of the definition of done.

## When a Runbook Is Required

Create or update a runbook when the task changes:

- deployment or rollout steps
- migrations or data backfills
- rollback procedure
- alert meanings or observability signals
- failure modes and troubleshooting paths
- on-call recovery actions
- operational prerequisites or access requirements

## What a Runbook Must Contain

### Scope and Owners

What system or component does this runbook cover, and who owns it?

### Preconditions and Access

What credentials, environment access, tools, or approvals are needed?

### Normal Operation

How is the system deployed, started, stopped, or verified under normal conditions?

### Migration and Rollback

How do you apply the change safely, and how do you reverse it if needed?

### Observability

What logs, metrics, dashboards, traces, or alerts matter?

### Troubleshooting

What are the common failure modes, symptoms, and diagnosis steps?

### Recovery

What actions restore service, data correctness, or operator confidence?

### Verification

How do you confirm the system is healthy again after change or recovery?

## Minimal Template

```markdown
# [System / component] runbook
Status: Active | Superseded | Deprecated
Owner: ...

## Scope
- ...

## Preconditions and access
- ...

## Normal operation
- Deploy:
- Start / stop:
- Health checks:

## Migration
- ...

## Rollback
- ...

## Observability
- Metrics / dashboards:
- Logs:
- Alerts:

## Troubleshooting
| Symptom | Likely cause | Check | Action |
|---|---|---|---|
| ... | ... | ... | ... |

## Recovery
- ...

## Verification
- ...
```

## Rules

1. Be procedural and concrete.
2. Prefer exact commands, systems, dashboards, and signals where known.
3. Do not bury rollback inside generic prose.
4. Update troubleshooting when new failure modes are introduced.
5. If a migration consumes data or changes irreversible state, call that out explicitly.

## Smells

- No rollback section for a risky change.
- “Check the logs” without saying which logs or what signal matters.
- Recovery steps that stop before verification.
- A runbook that reads like an ADR or a feature spec instead of an operator procedure.
