---
name: domain-driven-design
description: >
  Business complexity, model language, lifecycle rules, or cross-team/system boundaries
  shape the design more than generic technical organization. Synthesized from Domain-Driven
  Design (Evans), DDD Distilled (Vernon), and Implementing DDD (Vernon). Covers: strategic
  design (Bounded Contexts, Context Mapping, Subdomains), tactical patterns (Entities,
  Value Objects, Aggregates, Domain Events, Repositories, Factories), Ubiquitous Language
  discipline, integration patterns (Anticorruption Layer, Open Host Service), and when
  DDD is overkill. Triggers on: "DDD", "domain model", "bounded context", "aggregate",
  "ubiquitous language", "context mapping", "anticorruption layer", "domain event",
  "subdomain", or when modeling complex business domains.
  "domain event", "context mapping", "anticorruption layer", or when modeling complex business domains.
---

# Domain-Driven Design

## When This Skill Loads

If you are reading this, the user is working on a system where business complexity, language, or boundaries matter more than generic technical organization. **Model the domain first. Let the code follow the model.**

## Core Principle

**Keep domain behavior, code, tests, documents, and team language aligned inside explicit Bounded Contexts.**

Do not let persistence, UI, frameworks, integration formats, or DDD vocabulary replace an implementation-driving model.

## When DDD Is Warranted

DDD pays off when **three or more** of these are true:
- Business rules are complex (not just CRUD)
- Domain experts use specific terminology that differs from technical terms
- Multiple teams or systems share data but have different conceptual models
- The same word means different things in different parts of the business
- Invariants and lifecycle rules are non-trivial
- Integration with external/legacy systems requires translation

**When DDD is overkill:** Simple CRUD, generic subsystems, mainly technical problems, or projects where the domain is stable and well-understood. Use the lightest approach that works.

## Strategic Design

### Subdomains

Classify every business capability:

| Type | What it is | Modeling effort |
|---|---|---|
| **Core Domain** | Competitive advantage, strategic differentiation | Highest — rich model, best people, most iteration |
| **Supporting** | Needed for the business, but not a differentiator | Moderate — model honestly, but don't over-invest |
| **Generic** | Commodity (auth, notifications, logging) | Lowest — buy/build simple, no custom modeling |

### Bounded Contexts

Every meaningful model gets **one explicit Bounded Context**. The context owns:
- Its **language** (Ubiquitous Language — one term per concept, one meaning per term)
- Its **rules** and **semantics**
- Its **code structure**, **tests**, and **integration contracts**

**The same word in different contexts may mean different concepts.** "Order" in billing is not "Order" in fulfillment. Translate at boundaries.

### Context Relationships

Choose deliberately:

| Relationship | Meaning | When to use |
|---|---|---|
| **Partnership** | Teams coordinate closely, models evolve together | Same team, tightly coupled contexts |
| **Shared Kernel** | Small shared model, jointly owned and tested | Stable overlap both teams agree on |
| **Customer/Supplier** | Downstream depends on upstream; upstream prioritizes downstream's needs | Clear upstream/downstream dependency |
| **Conformist** | Downstream conforms to upstream's model exactly | No leverage to influence upstream |
| **Anticorruption Layer (ACL)** | Downstream translates upstream's model into its own language | Upstream model is messy, foreign, or legacy |
| **Open Host Service (OHS)** | Upstream provides a published protocol for multiple downstreams | Many consumers need standardized access |
| **Published Language** | Shared format (schema, API contract) for integration | Cross-organization or cross-team integration |
| **Separate Ways** | No integration; contexts are independent | No real dependency exists |

## Tactical Patterns

### Entities
Use when **identity and lifecycle** matter. An Entity is defined by its ID, not its attributes.
- Make identity explicit (e.g., `OrderId`, not a raw integer).
- Protect meaningful state transitions — don't expose unrestricted setters.
- Methods should reveal domain purpose, not just change fields.

### Value Objects
Use for **immutable descriptive concepts** where identity doesn't matter.
- Validate at construction — a Value Object is always valid.
- Compare by value, not by reference.
- Replace raw primitives for meaningful concepts: `Money`, `EmailAddress`, `DateRange`.

### Aggregates
Use as **immediate consistency boundaries** for invariants.
- **Small.** One root Entity, few internal objects. If it's large, the boundary is wrong.
- **Root-protected.** All invariant-changing behavior goes through the root.
- **Identity-referenced.** Reference other Aggregates by ID, not by object reference.
- **One per transaction.** Default to modifying one Aggregate per transaction. Use events for cross-Aggregate coordination.
- **Hide internals.** Mutable internals are not exposed to callers.

### Domain Events
Use for **meaningful past-tense business facts**.
- Name in past tense: `OrderPlaced`, `PaymentReceived`, `ShipmentDelivered`.
- Payload is local to the model — don't leak foreign schemas.
- Do NOT publish for every field change. Events represent business significance.
- Consumers must tolerate lag, duplicates, and ordering limits.

### Repositories
Provide access to **Aggregate Roots**, not tables.
- Define interfaces by domain needs, not by persistence mechanics.
- Return domain objects, not ORM rows or DTOs.
- Keep business rules out of repository implementations.

### Factories
Hide **complex creation** logic.
- Use when constructing an Aggregate requires multi-step validation or assembly.
- Prevent partially formed objects from escaping.

### Domain Services
Use for **domain-significant operations** that involve multiple domain objects and don't fit naturally on any single Entity or Value Object.
- Keep technical transformation, serialization, transport, and persistence mapping OUT of the domain model.

### Application Services
Coordinate **use cases**:
1. Load Aggregates (via Repositories)
2. Invoke domain behavior (on Aggregates/Entities)
3. Persist results
4. Publish resulting Domain Events
5. Own transaction/integration coordination

**Application Services must NOT become the real domain model.** If they accumulate branching business rules, move the decisions into the domain objects.

## Ubiquitous Language Discipline

- One concept gets **one term** inside a context.
- One term does **not carry multiple meanings** inside a context.
- Code, tests, commands, events, repositories, services, and packages must **speak the local language**.
- Rename code when understanding improves — don't let technical names drift from domain meaning.
- When terminology is awkward, ambiguous, or inconsistent — **pause coding and sharpen the language first**.

## Integration and Translation

- **Translate foreign models** into the local language. Keep foreign schemas, statuses, and contract models out of local domain objects.
- **Anticorruption Layer:** When integrating with a messy/legacy/external model, add a translation layer before modeling locally.
- **Keep integration contracts separate** from internal models. Test translations wherever meanings cross a boundary.
- **Integration style matters:**
  - RPC: Requires acceptable request/response coupling
  - REST: Resources must not expose Aggregate internals
  - Messaging: Must tolerate lag, duplicates, and ordering limits

## Package Structure

Organize by **Bounded Context first**, then by domain or use-case ownership within the context:
```
context-name/
  domain/          # Entities, Value Objects, Domain Events, Repositories (interfaces)
  application/     # Application Services, DTOs, Command handlers
  infrastructure/  # Repository implementations, messaging, persistence adapters
```

Avoid giant `shared` or `common` packages for domain concepts.

## When to Use Event Sourcing

Only when the **event sequence is the right persistence model**:
- Audit trail is a first-class requirement
- Replay/reconstruction is a core feature
- The domain naturally thinks in terms of state transitions

Requirements:
- Streams match Aggregate identity and versioning
- Replay is deterministic
- Event meaning changes need versioning, upcasters, or translators

## Trigger Rules

- **Ambiguous terminology:** When a term is fuzzy, overloaded, or imported from another context — sharpen the Ubiquitous Language before coding.
- **Cross-context coupling:** When code wants to import another context's domain package or share enums — add explicit translation instead.
- **Foreign model leakage:** When legacy/vendor/API/persistence shapes appear in domain code — add an Anticorruption Layer.
- **Large Aggregate:** When one transaction wants multiple Aggregates — list the invariants that require it. Otherwise coordinate by identity and events.
- **Anemic domain:** When Application Services or controllers accumulate branching business rules — move decisions into domain objects.
- **Generic Repository:** When a Repository becomes table-shaped or starts enforcing business rules — reshape around Aggregate access.
- **Noisy events:** When an event reads like a command, exposes framework artifacts, or describes a minor property change — rename, narrow, or remove it.
- **Representation pressure:** When client rendering or query speed pressures the model shape — use projections, DTOs, or adapters instead of exposing Aggregate internals.
- **Simple subdomain:** When a subdomain is simple CRUD — keep it simple. Don't add DDD ceremony.

## Final Checklist

- [ ] Bounded Context explicit before interpreting names, modules, events, repositories, APIs?
- [ ] One local term per concept across tests, commands, events, repositories, services, packages?
- [ ] Core Domain effort protected while supporting/CRUD areas stay simpler?
- [ ] Context relationships, translation responsibilities, and upstream/downstream pressures visible?
- [ ] Aggregates small, root-protected, invariant-driven, identity-linked, usually one per transaction?
- [ ] Entities behavior-bearing and Value Objects immutable, validated, and value-equal?
- [ ] Repositories are Aggregate-root access points, not generic DAOs or ORM leaks?
- [ ] Domain Events are meaningful past-tense facts, not noisy field-change notifications?
- [ ] Application Services coordinate use cases instead of owning domain decisions?
- [ ] Client, foreign, persistence, and infrastructure representations kept outside the domain model?
- [ ] Tests read like executable examples of the model and cover invalid transitions?

## Reference

| File | Use When |
|---|---|
| [Strategic Design](references/strategic-design.md) | Defining Bounded Contexts, subdomains, and context relationships |
| [Tactical Patterns](references/tactical-patterns.md) | Choosing between Entities, Value Objects, Aggregates, Events, Repositories |
| [Integration Patterns](references/integration-patterns.md) | Designing cross-context integration, ACL, OHS, published language |
| [Application Architecture](references/application-architecture.md) | Structuring Application Services, repositories, package organization |
