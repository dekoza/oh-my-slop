# Tactical Patterns

From DDD (Evans), DDD Distilled (Vernon), and Implementing DDD (Vernon). Use when choosing which domain modeling construct to apply.

## Pattern Selection

| When you need... | Use... | Key property |
|---|---|---|
| Something with a stable identity that changes over time | **Entity** | Identity persists across state changes |
| An immutable descriptive concept | **Value Object** | Validated at construction, compared by value |
| A consistency boundary for invariants | **Aggregate** | Small, root-protected, identity-referenced |
| To capture a meaningful business fact | **Domain Event** | Past-tense, significant, not every field change |
| A named, combinable business rule (predicate) | **Specification** | Combinable with and/or/not; domain language, not query language |
| To hide complex creation logic | **Factory** | Prevents partially formed objects |
| To access Aggregate Roots | **Repository** | Domain-oriented, not table-oriented |
| A domain operation that spans multiple objects | **Domain Service** | Domain-meaningful, not technical |
| To coordinate a use case | **Application Service** | Loads, invokes, persists — no business rules |

## Entities

**When:** The domain cares about identity and lifecycle. A `User` is the same user even when their email changes.

**Rules:**
- Give every Entity a meaningful identity type (`UserId`, not raw `int`).
- Make methods protect meaningful state transitions, not just change fields.
- Avoid generic setters (`set_email`, `set_status`). Use intention-revealing methods (`change_email`, `activate`, `suspend`).

```python
# Bad
class User:
    def set_email(self, email): ...
    def set_status(self, status): ...

# Good
class User:
    def change_email(self, email): ...
    def activate(self): ...
    def suspend(self, reason): ...
```

## Value Objects

**When:** The concept is defined by its attributes, not by identity. Two `Money(10, USD)` values are the same.

**Rules:**
- **Immutable.** Once created, never changed. Return new instances instead of mutating.
- **Self-validating.** Validate at construction. A Value Object is always valid.
- **Compared by value.** `Money(10, USD) == Money(10, USD)` is true.

```python
@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str

    def __post_init__(self):
        if self.amount < 0:
            raise ValueError("Money amount cannot be negative")

    def add(self, other: "Money") -> "Money":
        if self.currency != other.currency:
            raise ValueError("Cannot add different currencies")
        return Money(self.amount + other.amount, self.currency)
```

**Replace primitives with Value Objects for domain-meaningful concepts:** `EmailAddress`, `PhoneNumber`, `DateRange`, `Weight`, `OrderId`.

## Aggregates

**When:** You need to enforce invariants across multiple objects. An `Order` with its `OrderLines` must always have a total that matches the sum of lines.

**Rules:**
- **Small.** One root Entity, few internal objects. If you're tempted to put 20 entities in one Aggregate, the boundary is wrong.
- **Root-protected.** All invariant-changing operations go through the root.
- **Identity-referenced.** Reference other Aggregates by identity (`order.customer_id`), not by object reference (`order.customer`).
- **One per transaction.** Default to modifying one Aggregate per transaction. Use Domain Events or process coordination for cross-Aggregate changes.

```python
class Order:  # Aggregate Root
    def __init__(self, id: OrderId, customer_id: CustomerId):
        self._id = id
        self._customer_id = customer_id
        self._lines: list[OrderLine] = []
        self._status = OrderStatus.DRAFT

    def add_line(self, product_id: ProductId, quantity: int, price: Money):
        if self._status != OrderStatus.DRAFT:
            raise InvalidOperation("Cannot modify a submitted order")
        self._lines.append(OrderLine(product_id, quantity, price))
        self._events.append(OrderLineAdded(self._id, product_id, quantity))

    def submit(self):
        if not self._lines:
            raise InvalidOperation("Cannot submit an empty order")
        self._status = OrderStatus.SUBMITTED
        self._events.append(OrderSubmitted(self._id, self._customer_id))
```

## Domain Events

**When:** Something meaningful happened that other parts of the system (or other Bounded Contexts) need to know about.

**Rules:**
- **Past tense:** `OrderSubmitted`, `PaymentReceived`, `UserDeactivated`.
- **Meaningful:** Not every field change warrants an event. Ask: "Would another part of the system care about this?"
- **Local payload:** Events carry domain-meaningful data, not foreign schemas or persistence artifacts.
- **Not commands:** An event says "this happened." A command says "do this." Don't blur the line.

```python
@dataclass(frozen=True)
class OrderSubmitted:
    order_id: OrderId
    customer_id: CustomerId
    total: Money
    submitted_at: datetime
```

## Specifications

**When:** A business rule answers whether something satisfies a criterion — eligibility, matching, validation — and deserves a name instead of living as an anonymous boolean expression duplicated across services.

**Rules:**
- **Named rule.** Encapsulate the predicate as an explicit domain object with an intention-revealing name.
- **Combinable.** Combine with and/or/not — but only while each component's meaning stays readable.
- **Three uses:** validation (does this object satisfy the rule?), selection (which objects match?), and building to order (create an object that satisfies the rule).
- **Domain language, not query language.** A Specification that is just a persistence query builder isn't one. Keep querying mechanics separate unless the project deliberately provides translation.

```python
class OverdueInvoiceSpecification:
    def __init__(self, as_of: date):
        self._as_of = as_of

    def is_satisfied_by(self, invoice: Invoice) -> bool:
        return not invoice.is_paid and invoice.due_date < self._as_of

# Validation: check a single candidate
if overdue_spec.is_satisfied_by(invoice):
    dunning.notify(invoice)

# Selection: express query criteria as a domain rule
invoices = invoice_repo.matching(overdue_spec)
```

**Prefer named Specifications over boolean flags or repeated conditionals** when the condition carries domain meaning: `EligibleForRefund`, `RouteSpecification`, `OverbookingPolicy`.

## Repositories

**When:** You need to load and save Aggregates.

**Rules:**
- Define interfaces by **domain needs**, not by persistence mechanics.
- Return **domain objects**, not ORM rows or database DTOs.
- **Don't leak persistence** into the domain model. The domain shouldn't know about tables or queries.

```python
# Domain layer — interface
class OrderRepository(Protocol):
    def get(self, id: OrderId) -> Order: ...
    def save(self, order: Order) -> None: ...
    def next_id(self) -> OrderId: ...

# Infrastructure layer — implementation
class PostgresOrderRepository:
    def get(self, id: OrderId) -> Order:
        row = self._db.execute("SELECT * FROM orders WHERE id = %s", id)
        return self._to_domain(row)
```

## Application Services

**When:** You need to coordinate a use case that involves loading Aggregates, invoking domain behavior, and persisting results.

**Rules:**
- **Coordinate, don't decide.** Business rules belong in domain objects, not in Application Services.
- **One use case per service method.** Don't create a god service with `do_everything()`.
- **Keep thin.** If an Application Service has complex branching logic, the domain model is anemic — move the decisions into Entities or Value Objects.

```python
class SubmitOrderService:
    def __init__(self, order_repo: OrderRepository, event_bus: EventBus):
        self._order_repo = order_repo
        self._event_bus = event_bus

    def execute(self, command: SubmitOrder) -> None:
        order = self._order_repo.get(command.order_id)
        order.submit()  # domain logic lives here
        self._order_repo.save(order)
        self._event_bus.publish(order.domain_events())
```

## Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|---|---|---|
| **Anemic domain model** | Entities are data bags with getters/setters; all logic in services | Move behavior into Entities and Value Objects |
| **God Aggregate** | One Aggregate references 20 others and is modified in every transaction | Split into smaller Aggregates, use events for coordination |
| **Generic Repository** | `Repository.find_by_any_field(*args)` that exposes the database schema | Define repository methods by domain needs |
| **Domain objects with framework annotations** | Entities with `@Entity`, `@Table`, `@Column` decorators | Keep persistence annotations in the infrastructure layer |
| **Events for everything** | Domain Event emitted for every field change | Publish only meaningful business facts |
| **Shared domain classes** | Same `Order` class used in billing, fulfillment, and shipping | Separate models per Bounded Context, translate at boundaries |
