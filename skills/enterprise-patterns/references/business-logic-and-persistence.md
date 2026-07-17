# Business logic & persistence

Depth behind the SKILL.md decisions on *where logic lives* and *how it reaches storage*.
Domain modeling itself stays in [domain-driven-design](../../domain-driven-design/SKILL.md);
this file is about the persistence-and-workflow structure around it.

## Choosing and escalating the business-logic pattern

Start at the lightest pattern the complexity allows and escalate when the listed forces
actually appear — escalation is evidence-driven, not anticipatory.

### Transaction Script

- **Use when:** logic is simple, each use case is mostly independent, rich modeling is
  unnecessary.
- **Keep honest:** scripts stay short and use-case-focused; a script is not a dumping
  ground for all business logic.
- **Escalate to Domain Model when:** the same decisions, validations, or invariants start
  duplicating across scripts, or objects grow real lifecycle and collaboration.

### Table Module

- **Use when:** logic is naturally organized around tabular data sets, calculations are
  set-oriented, and object identity is not the organizing force.
- **Keep honest:** behavior stays centered on the table abstraction; don't fake per-object
  entities when the model is fundamentally tabular; keep tabular logic out of presentation.
- **Escalate when:** the domain is really about individual objects with identity, behavior,
  and lifecycle rather than table-shaped sets.

### Domain Model

- **Use when:** domain complexity is significant — rules, invariants, lifecycles, identity,
  and collaboration belong in the model.
- **Keep honest:** rich behavior lives in model objects; application coordination stays
  separate from domain decisions; avoid anemic models in behavior-rich domains.
- **Terminal:** once you're here, the modeling questions (aggregates, boundaries,
  ubiquitous language) belong to [domain-driven-design](../../domain-driven-design/SKILL.md).

### Service Layer

Above whichever pattern you chose, a Service Layer defines application operations: it
coordinates use cases, owns transaction boundaries and orchestration, and exposes an
application-oriented API. It must **not** absorb all domain logic by default — that pushes
you back toward an anemic model. (Service Layer as *domain* access is DDD's ground.)

### Default map

| Situation | Default |
|---|---|
| Simple CRUD | Transaction Script or a thin service layer |
| Rich invariants | Domain Model + Repository + Data Mapper |
| Table-oriented calculations | Table Module or Table Gateway |
| Remote boundary | Remote Facade + DTO |

Avoid by default: Domain Model everywhere regardless of complexity; a generic repository
for everything; exposing persistence models directly to callers; one class holding
transactions, validation, rendering, and SQL.

## Persistence patterns

Choose deliberately by how much the domain must stay decoupled from storage:

- **Repository** — a collection-like interface over aggregate/domain access. Speaks domain
  terms; interface reflects application access needs, not table shape; implementation hides
  query/mapping/storage. Must not degrade into a generic "everything" gateway (see the
  forbidden-pattern review blocker in the SKILL.md).
- **Data Mapper** — moves data between domain objects and the database while keeping domain
  objects ignorant of SQL, record formats, and mapping mechanics. Use when the O-R mismatch
  is real and persistence logic deserves isolation.
- **Row Data Gateway / Table Data Gateway** — centralize record-oriented or table-oriented
  access behind one interface when behavior is simple.
- **Active Record** — object wraps a row and its persistence. Acceptable **only** for simple
  domains that accept persistence coupling; do not default to it for complex domains.
  Django's ORM is Active Record — its N+1 / Lazy Load consequences are owned by
  [django](../../django/SKILL.md).

## Identity, writes, and loading

- **Identity Map** — keep one in-memory representation per identity per scope; avoid
  duplicate instances of the same record fighting each other inside one unit of work.
- **Unit of Work** — track what changed and commit it as one logical transaction with a
  clear owner. Make transaction boundaries explicit in the workflow; keep them short; don't
  bury transaction ownership in helper classes.
- **Lazy Load** — deliberate, not everywhere. Know where a traversal triggers database or
  remote chatter; avoid lazy-load surprises inside loops and serialization paths.

Anti-patterns to catch: invisible N+1 behavior everywhere; hidden auto-persistence with
surprising write timing; each object saved ad hoc from random callers.

## Object-relational mapping index

Reach for the mapping that fits identity, lifecycle, query needs, schema shape, and
evolution cost — keep the choice explicit rather than accidental:

- **Identity Field** — give in-memory objects stable database identity; keep the mapping
  explicit.
- **Foreign Key Mapping** — object references to relational keys; don't hide expensive joins
  behind innocent-looking traversal.
- **Association Table Mapping** — many-to-many via a separate relational table.
- **Dependent Mapping** — child objects with no identity outside their owner.
- **Embedded Value** — a small value object living inside the owning row (no independent
  lifecycle).
- **Serialized LOB** — only when you never need to query *inside* the value and versioning
  is controlled.
- **Inheritance:** Single Table (nullable columns, simplest), Class Table (normalized
  subtype data worth the joins), Concrete Table (each concrete type owns its table); use
  **Inheritance Mappers** to isolate these decisions from domain logic.
- **Metadata Mapping** — centralize regular mapping rules; avoid when metadata would obscure
  exceptional behavior.
- **Query Object** — a composable object model for queries instead of scattered SQL strings.

DB transactions, isolation levels, and derived-data maintenance stay with
[data-intensive](../../data-intensive/SKILL.md).
