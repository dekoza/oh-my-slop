# Clean Architecture Principles

From Robert C. Martin's *Clean Architecture*. Framework-agnostic rules for keeping business policy independent of volatile details. Assumes the vocabulary in [SKILL.md](../SKILL.md) — **module**, **interface**, **seam**, **adapter**, **depth**.

## The Dependency Rule

Source dependencies must point **inward** toward higher-level policy:

```
┌──────────────────────────────────────┐
│  Frameworks & Drivers (outermost)    │  ← DB, web, UI, external services
│  ┌────────────────────────────────┐  │
│  │  Interface Adapters            │  │  ← Controllers, presenters, gateways
│  │  ┌──────────────────────────┐  │  │
│  │  │  Application (use cases) │  │  │  ← Orchestration, workflows
│  │  │  ┌────────────────────┐  │  │  │
│  │  │  │  Domain (entities) │  │  │  │  ← Business rules, invariants
│  │  │  └────────────────────┘  │  │  │
│  │  └──────────────────────────┘  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**Inner layers must not know about outer layers.** Domain code must not import from the web framework, the database, or the UI. If it does, the dependency direction is violated.

## Module Dependency Graphs

Keep the source-dependency graph **acyclic**. A cycle makes the participating modules one change, test, and release unit even if their directories suggest independence. Break a cycle by moving shared policy inward, inverting one dependency through a policy-owned interface, or merging modules that genuinely have the same change reason.

Direct dependencies toward **stability**: a volatile outer module may depend on stable policy, while stable policy must not import a volatile mechanism. Keep stable modules abstract only where real implementations need substitution; an abstraction with no concrete pressure is another shallow interface.

## What Goes Where

| Layer | Contains | Must Not Import |
|---|---|---|
| **Domain** | Entities, value objects, domain services, invariants | Frameworks, DB, web, UI |
| **Application** | Use cases, orchestration, DTOs | Frameworks, DB, web, UI |
| **Adapters** | Controllers, presenters, repository implementations, API clients | Nothing (they implement inner interfaces) |
| **Frameworks** | Web server, ORM, config, wiring | Nothing outer (there is nothing outer) |

## Keep Use Cases Separate by Actor

Give each use case one application action and one coherent change reason. Keep use cases separate when they serve different **actors**, team ownership, deployment needs, or release pressure, even if their orchestration currently looks alike. Duplication is cheaper than coupling independent **change reasons**.

Extract only the stable policy or invariant that the use cases genuinely share. Sharing an entire workflow to remove surface duplication makes unrelated actors negotiate every later change.

## Dependency Inversion at Seams

When an inner layer needs something from an outer layer:

1. **Inner layer defines the interface** (port) it needs.
2. **Outer layer implements** that interface (adapter).
3. **Concrete wiring** happens at the composition root (main, app config, DI container).

The inner layer owns the seam. The outer layer is a plugin.

## Boundary Testing

Test inner layers without outer layers:

- **Domain tests** run without a database, web server, or framework. Pure in-memory objects.
- **Use case tests** run with fake/stub adapters, not real infrastructure.
- **Adapter tests** verify translation between external formats and inner-layer models.
- **Integration tests** verify the wiring at the seams.

If a business rule test needs the framework, database, or network to pass, the boundary is leaking.

## Recognizing Violations

Flag these as dependency direction bugs:

- Domain model imports from `django.db.models`, `flask`, `fastapi`, `sqlalchemy`, or any framework package.
- Business logic in controllers, views, or request handlers.
- Use cases that return ORM objects, framework request/response types, or database rows.
- Domain code that knows about HTTP status codes, URL routing, or serialization formats.

## Incremental Extraction

When you find a violation in existing code:

1. Don't rewrite. Extract the business rule behind an interface.
2. Move the concrete implementation to an adapter.
3. Wire the adapter at the composition root.
4. Update tests to use the new boundary.

Preserve behavior at each step. This is refactoring, not rearchitecture.

## Choosing a Cost-Effective Seam

Choose seams by policy importance, **volatility**, **substitution value**, testability, and lifecycle cost. Preserve independence where a framework, database, vendor, delivery mechanism, actor, or deployment shape is likely to change; avoid a runtime or deployment split whose operating cost exceeds the option it preserves.

Use the lightest enforceable form:

- A **partial seam** keeps the interface and dependency direction explicit while the participating modules remain in the same package or process.
- A source or package seam adds visibility or dependency checks when imports need enforcement.
- A process or deployment seam earns its cost only when independent operation, scaling, ownership, or release pressure requires it.

For small projects or simple CRUD, start with business rules outside views/controllers, no framework types in domain objects, and business-rule tests that run without the framework. Revisit the seam when change shape, team ownership, deployment needs, or operational constraints raise the cost of coupling.
