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

## What Goes Where

| Layer | Contains | Must Not Import |
|---|---|---|
| **Domain** | Entities, value objects, domain services, invariants | Frameworks, DB, web, UI |
| **Application** | Use cases, orchestration, DTOs | Frameworks, DB, web, UI |
| **Adapters** | Controllers, presenters, repository implementations, API clients | Nothing (they implement inner interfaces) |
| **Frameworks** | Web server, ORM, config, wiring | Nothing outer (there is nothing outer) |

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

## When Full Separation Is Too Expensive

For small projects or simple CRUD, full layered architecture may be overkill. The lightest enforceable boundary is:

- Business rules in domain objects (not in views/controllers).
- Domain objects don't import framework types.
- Tests for business rules don't need the framework.

This gives you 80% of the benefit at 20% of the cost. Add more structure only when the project's complexity justifies it.
