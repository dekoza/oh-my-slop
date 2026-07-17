---
name: enterprise-patterns
description: >
  Use when an enterprise app's infrastructure decisions are in play — where business
  logic lives, transaction and identity coordination, application-level (offline)
  concurrency, session-state placement, or remote/distribution boundaries. Domain
  modeling defers to domain-driven-design and database isolation/transactions to
  data-intensive; based on Patterns of Enterprise Application Architecture (Fowler).
  Triggers on: "Transaction Script vs Domain Model",
  "Unit of Work", "Identity Map", "optimistic vs pessimistic offline lock",
  "session-state placement", "Remote Facade", "generic repository everywhere".
---

# Enterprise Patterns

Persistence, concurrency, session, and distribution structure for enterprise apps — the
infrastructure *around* a domain, not the domain model itself. Reach for a small set of
named patterns under concrete pressure; do not invent architecture for every feature.

## Defer before you pattern

**Domain modeling belongs to [domain-driven-design](../domain-driven-design/SKILL.md).**
When rich domain rules, aggregates, or ubiquitous language are the question, that skill
owns it. This skill owns where logic *lives* and how it reaches storage, concurrency,
sessions, and remote callers. When both are loaded, keep DDD primary — decide the domain
model there, then choose the persistence and workflow patterns here. Do not oscillate
between "rich domain model" and "a Transaction Script is fine."

**Cross-link the ground other skills already own — never restate it:**

| Ground | Owner |
|---|---|
| N+1 / Lazy Load in the ORM (`select_related`/`prefetch_related`) | [django](../django/SKILL.md) |
| DTO / serializer at the HTTP boundary | [drf](../drf/SKILL.md) |
| DB transactions, isolation levels, lost-update/write-skew, derived data | [data-intensive](../data-intensive/SKILL.md) |
| Repository / Service Layer as *domain* access, Aggregates | [domain-driven-design](../domain-driven-design/SKILL.md) |
| Latency budgets, timeouts, partial failure at remote calls | [production-readiness](../production-readiness/SKILL.md) |

## Forbidden patterns — treat as review blockers

Stop and reshape when you see any of these; each is a structural defect, not a style nit:

- **Generic CRUD repository everywhere** — one `save/get/list/delete<T>` abstraction shaped
  by tables instead of use cases. Shape repositories by what the application asks for.
- **ORM model doubling as aggregate, service, and DTO** — one persistence class carrying
  domain rules, workflow, and transport shape at once. Split by responsibility.
- **Controller owning the workflow** — a request handler coordinating transactions, SQL,
  domain rules, and external calls. Move coordination into an application/service operation.
- **Layering theater** — layers that only forward calls, earning no reduction in coupling.
  Delete the pass-through or give the layer a real job.

## Choose the business-logic pattern by force

The central decision. Pick by the actual complexity, not by habit or ORM convenience, and
**escalate when the forces below appear** — do not start heavy:

| Pattern | Fits when | Escalate when |
|---|---|---|
| **Transaction Script** | Each use case is short, mostly independent, few rules | Decisions or validation duplicate across scripts; invariants or lifecycle appear |
| **Table Module** | Logic is set-oriented around tabular data; identity isn't the organizing force | The real model is about individual objects with behavior and identity, not tables |
| **Domain Model** | Significant rules, invariants, identity, lifecycle, collaboration | (Terminal — hand the modeling to [domain-driven-design](../domain-driven-design/SKILL.md)) |

Keep each honest: Transaction Scripts stay use-case-focused (not dumping grounds), Table
Modules stay tabular (don't fake entities), Domain Models carry the behavior (not anemic).
**Active Record** is acceptable only for simple domains that accept persistence coupling —
Django's ORM *is* Active Record, so lean on [django](../django/SKILL.md) for its costs.

## Coordinate identity and writes explicitly

- **Unit of Work** — commit a logical change as one transaction with a clear owner. Keep
  transaction boundaries explicit in the workflow, short, and out of hidden helpers.
- **Identity Map** — one in-memory object per identity per scope, so duplicate instances
  don't fight inside one unit of work.
- Make loading behavior visible: when lazy loading, hidden auto-persistence, N+1, or ad-hoc
  saves could happen inside one work scope, decide identity scope and loading up front.

## Choose application-level (offline) concurrency deliberately

Concurrency that spans a *user think-time gap* — a read-render-edit-save cycle across
requests — is **not** the same as DB isolation (that's [data-intensive](../data-intensive/SKILL.md)).
Name the semantics instead of relying on developer discipline:

- **Optimistic Offline Lock** — conflicts possible but uncommon; detect on write (version
  check) and surface merge/conflict resolution intentionally. Default choice.
- **Pessimistic Offline Lock** — contention expected and the block-others cost is justified.
- **Coarse-Grained Lock** — lock a set of related objects together to protect one user-level
  edit as a unit.
- **Implicit Lock** — acquire locks in shared infrastructure so callers can't forget; only
  when it keeps ownership, contention, and stale-lock cleanup diagnosable.

Keep transactions short and remote calls outside transaction spans.

## Place session state deliberately

Choose storage by its forces, not by default:

| Placement | Choose when | Watch |
|---|---|---|
| **Client** | Server statelessness / scaling matters | Integrity + security of client-held data |
| **Server** | Simple, single-node, or sticky-session | Memory cost, cleanup, server-farm sharing |
| **Database** | Durability or server-farm sharing outweighs the cost | Added DB load, cleanup of stale rows |

Every session needs a clear owner, lifetime, and cleanup story before features pile on it.

## Keep remote boundaries coarse; don't distribute by default

- **Do not distribute** objects or services across a process boundary by default — in-process
  is faster, simpler, and safer. Distribute only when a real boundary forces it.
- When a boundary is genuinely remote, put a **Remote Facade** in front: coarse, batched
  operations translated to/from DTOs (transport shape, not domain objects), so callers make
  few round-trips. A chatty remote interface that mirrors local object collaboration is the
  smell. Budget latency, serialization, versioning, and partial failure at the seam.

## Base patterns — reach only under concrete pressure

Name these when the specific pressure appears, never speculatively:

| Pattern | Pressure |
|---|---|
| **Gateway** | Isolate access to an external resource or subsystem behind one interface |
| **Mapper** | Move data between two sides that must stay independent (neither knows the other) |
| **Layer Supertype** | Real, stable shared behavior across a layer's types |
| **Separated Interface** | Client must depend on an interface in a different package than its impl |
| **Registry** | A few well-known objects need controlled lookup (sparingly — not global state) |
| **Value Object / Money** | Value-equality + immutability; Money for explicit currency/rounding/arithmetic |
| **Special Case** | Replace repeated null/exceptional checks with a named object |
| **Plugin** | Select or extend an implementation without editing core code |
| **Service Stub** | Run or test without a real remote service |
| **Record Set** | Tabular data is the natural interchange shape and object behavior isn't needed |

## Reference

| File | Use when |
|---|---|
| [Business logic & persistence](references/business-logic-and-persistence.md) | Choosing/escalating the business-logic pattern, Repository vs Data Mapper vs Gateway vs Active Record, Unit of Work, Identity Map, O-R mapping index |
| [Concurrency & sessions](references/concurrency-and-sessions.md) | Offline locking semantics, transaction-boundary rules, session-state placement forces |
| [Distribution & base patterns](references/distribution-and-base-patterns.md) | Remote Facade/DTO design, don't-distribute rules, the base-pattern catalog, the forbidden-pattern review checklist |
