# Documentation Lifecycle Reference Index

Use this index when the task touches more than one documentation type or when you are not yet sure which document should own the answer.

## Two Documentation Families

| Family | Purpose | Typical outputs |
|---|---|---|
| Engineering documentation | Keep builders and operators aligned with how the system should work and why it is shaped that way | Feature specs, ADRs, exact reference docs, runbooks, maintenance docs |
| User-facing documentation | Help users learn, accomplish tasks, look up facts, and understand concepts | Tutorials, how-to guides, reference, explanation |

## Core Routes

| Need | File | Use for |
|---|---|---|
| Clarify a vague request before writing docs | `references/specification-interview.md` | Interview flow, assumption surfacing, tradeoff synthesis, spec-ready notes |
| Write or revise canonical behavior intent | `references/feature-spec.md` | Goals, non-goals, flows, edge cases, acceptance criteria, operational impact |
| Record a significant design choice | `references/adr.md` | Context, options considered, decision, tradeoffs, consequences, supersession |
| Update exact interfaces and contracts | `references/reference-docs.md` | APIs, schemas, settings, env vars, CLI flags, feature flags, compatibility notes |
| Write maintenance and recovery docs | `references/runbook.md` | Deployment, migration, rollback, observability, troubleshooting, recovery |
| Produce public-facing docs | `references/user-facing-docs.md` | Diátaxis routing for tutorial, how-to, reference, explanation |

## Fast Decision Rules

- **The task changes what the feature should do** -> start with `references/feature-spec.md`
- **The user request is fuzzy or conflicted** -> start with `references/specification-interview.md`
- **The task changes why the system is built this way** -> start with `references/adr.md`
- **The task changes exact public or internal interfaces** -> start with `references/reference-docs.md`
- **The task changes deploy, migrate, rollback, alerts, or recovery** -> start with `references/runbook.md`
- **The task is about helping users learn or use the feature** -> start with `references/user-facing-docs.md`

## Mixed Cases

Some changes require multiple documents. Use this order:

1. Clarify with `references/specification-interview.md` if the request is vague.
2. Freeze intended behavior in `references/feature-spec.md`.
3. Add or update `references/adr.md` if there is a significant design decision.
4. Update `references/reference-docs.md` for exact contracts.
5. Update `references/runbook.md` for operational consequences.
6. Update `references/user-facing-docs.md` if end-user workflows changed.

## Drift Audit Checklist

When auditing documentation drift, check:

- whether the canonical spec still matches tests and shipped behavior
- whether an ADR was superseded but never linked
- whether reference docs still reflect real APIs, schemas, flags, and defaults
- whether the runbook still matches current deploy and rollback procedures
- whether README or overview docs point at stale canonical sources
- whether user-facing docs mix tutorial, how-to, reference, and explanation into one confused page
