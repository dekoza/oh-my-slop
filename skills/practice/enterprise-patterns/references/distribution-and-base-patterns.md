# Distribution & base patterns

Depth behind the SKILL.md decisions on remote boundaries, the base-pattern catalog, and the
forbidden-pattern review checklist.

## Don't distribute by default

The first rule of distributing objects: don't. An in-process call is orders of magnitude
faster, simpler, and more reliable than a remote one. Distribute only when a real boundary
forces it (separate deployables, separate teams, separate scaling needs) — not for tidiness.

When distribution is genuinely required:

1. **Coarse-grained boundaries.** A remote interface must not mirror local object
   collaboration. Chatty fine-grained remote calls (a getter per field, a call per item in a
   loop) are the smell.
2. **Separate local object design from the remote contract.** The network contract is its own
   artifact; don't leak domain internals through remote endpoints.
3. **Budget explicitly** for latency, serialization, versioning, and partial failure at the
   seam. Failure-aware remote contracts and timeout/retry behavior are
   [production-readiness](../../production-readiness/SKILL.md)'s ground — cross-link, don't
   duplicate.

## Remote Facade + DTO

- **Remote Facade** — a coarse-grained face over a fine-grained object model, placed at a
  remote boundary. It exposes a few batched, use-case-shaped operations and translates
  between the remote contract and the internal model, keeping transport concerns at the edge.
- **Data Transfer Object** — a structure that carries batched data across a process or layer
  boundary in one round-trip. **DTOs are transport, not domain models:** keep the mapping
  explicit, and never move business behavior into a DTO. At the HTTP boundary specifically,
  DRF serializers embody this — [drf](../../../reference/drf/SKILL.md) owns that ground.

## Base-pattern catalog

Reach for a base pattern only when its specific pressure appears — naming one speculatively
is the over-engineering this catalog is meant to discipline, not license.

| Pattern | Concrete pressure that justifies it |
|---|---|
| **Gateway** | Isolate access to an external resource or subsystem behind one interface |
| **Mapper** | Move data between two sides that must stay independent (neither side references the other) |
| **Layer Supertype** | A layer's types share behavior that is real and stable |
| **Separated Interface** | A client must depend on an interface defined in a different package from its implementation (dependency break) |
| **Registry** | A few well-known objects need controlled lookup — used sparingly, never as a global hidden dependency |
| **Value Object** | A small value where equality-by-value and immutability simplify the code |
| **Money** | Currency amounts, so rounding, currency, and arithmetic rules stay explicit |
| **Special Case** | Replace repeated null/exceptional handling with a named object (a Null Object is one) |
| **Plugin** | An implementation must be selected or extended at runtime without editing core code |
| **Service Stub** | Run or test without a real remote service |
| **Record Set** | Tabular data is the natural interchange shape and object behavior isn't needed |

## Forbidden patterns — review blockers

When reviewing enterprise code, actively look for these and reshape before shipping:

- **Layering theater** — layers that only forward method calls, earning no reduction in
  coupling.
- **Generic repository everywhere** — one CRUD abstraction for all access, with APIs shaped
  by tables instead of use cases.
- **ORM-driven everything** — all design dictated by ORM convenience; aggregates, services,
  and DTOs collapsed into one persistence model.
- **Controller-centric enterprise app** — request handlers coordinating transactions, SQL,
  domain rules, and external calls.
- **Distributed object fantasy** — pretending network calls have local method-call semantics.
- **Unclear transaction ownership** — random save calls across layers, no clear transaction
  owner, long-running workflows treated as one immediate transaction.

## Review checklist

- Did we choose the right business-logic pattern for the *actual* complexity?
- Are presentation, workflow, domain logic, and persistence responsibilities distinct?
- Is transaction ownership explicit, short, and outside remote-call spans?
- Are repositories/gateways shaped by use cases or aggregates rather than raw tables?
- Is mapping isolated from domain logic?
- Are remote boundaries coarse-grained, translated, version-aware, and failure-aware?
- Are concurrency (offline locks), identity scope, and loading behavior visible?
- Is session state owned, protected, scalable, durable enough, and cleaned up?
- Are tests aligned to the responsibility that owns each behavior (domain apart from UI and
  persistence; repositories/mappers/gateways as infrastructure; services for workflow;
  locking where concurrency matters; DTO/facade mapping at boundaries)?
