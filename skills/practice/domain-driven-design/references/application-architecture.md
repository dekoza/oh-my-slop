# Application Architecture

From DDD (Evans), DDD Distilled (Vernon), and Implementing DDD (Vernon). Use when structuring the layers and modules of a DDD application.

## Layered Architecture

A typical DDD application has four layers:

```
┌─────────────────────────────────────────────┐
│  Presentation / UI                          │  ← Controllers, views, API endpoints
├─────────────────────────────────────────────┤
│  Application                                │  ← Use case orchestration, DTOs
├─────────────────────────────────────────────┤
│  Domain                                     │  ← Entities, Value Objects, Aggregates,
│                                             │     Domain Events, Repository interfaces
├─────────────────────────────────────────────┤
│  Infrastructure                             │  ← Repository implementations, messaging,
│                                             │     persistence, external service clients
└─────────────────────────────────────────────┘
```

**Dependency rule:** Dependencies point inward. The Domain layer has no dependencies on outer layers. Infrastructure implements interfaces defined in the Domain layer.

## Package Structure

Organize by Bounded Context first, then by layer:

```
billing/                    # Bounded Context
  domain/                   # Domain layer
    model/
      invoice.py            # Entity / Aggregate Root
      line_item.py          # Entity
      money.py              # Value Object
      events.py             # Domain Events
    repository.py           # Repository interface
    service.py              # Domain Services (if needed)
  application/              # Application layer
    submit_invoice.py       # Application Service
    dtos.py                 # DTOs for input/output
  infrastructure/           # Infrastructure layer
    postgres_repo.py        # Repository implementation
    stripe_client.py        # External service adapter
    messaging.py            # Event publisher
  api/                      # Presentation layer
    routes.py               # API endpoints
    serializers.py          # Request/response serialization

fulfillment/                # Another Bounded Context
  domain/
  application/
  infrastructure/
  api/
```

**Avoid:** A single `models/` package shared across contexts, or a `common/` package that becomes a dumping ground.

## Application Service Pattern

Application Services are the entry point for use cases. They:
1. **Load** Aggregates from Repositories
2. **Invoke** domain behavior (on Aggregates/Entities)
3. **Persist** results back through Repositories
4. **Publish** Domain Events
5. **Coordinate** transactions

```python
class CancelOrderService:
    def __init__(
        self,
        order_repo: OrderRepository,
        event_bus: EventBus,
        payment_gateway: PaymentGateway,
    ):
        self._order_repo = order_repo
        self._event_bus = event_bus
        self._payment_gateway = payment_gateway

    def execute(self, command: CancelOrder) -> None:
        order = self._order_repo.get(command.order_id)

        # Domain logic lives in the Aggregate
        order.cancel(reason=command.reason)

        # Infrastructure concerns live in the Application Service
        if order.has_payment():
            self._payment_gateway.refund(order.payment_id)

        self._order_repo.save(order)
        self._event_bus.publish(order.domain_events())
```

**Rules:**
- Application Services are **thin.** If they contain complex business logic, the domain model is anemic.
- Application Services **don't make domain decisions.** They coordinate; domain objects decide.
- One use case per Application Service method.

## Repository Pattern

Repositories provide collection-like access to Aggregate Roots:

```python
# Domain layer — interface
class OrderRepository(Protocol):
    def get(self, id: OrderId) -> Order: ...
    def save(self, order: Order) -> None: ...
    def find_by_customer(self, customer_id: CustomerId) -> list[Order]: ...
    def next_id(self) -> OrderId: ...

# Infrastructure layer — implementation
class PostgresOrderRepository:
    def get(self, id: OrderId) -> Order:
        row = self._session.execute(
            select(OrderTable).where(OrderTable.c.id == id)
        ).fetchone()
        return self._to_domain(row)

    def save(self, order: Order) -> None:
        row = self._to_persistence(order)
        self._session.merge(row)
```

**Rules:**
- Repository interfaces live in the **Domain** layer.
- Repository implementations live in the **Infrastructure** layer.
- Repositories return **domain objects**, not ORM rows or DTOs.
- Don't create generic `Repository[T]` base classes. Each Aggregate's repository has methods specific to its domain needs.

## CQRS (Command Query Responsibility Segregation)

When read and write needs diverge significantly:

```
Commands (writes) ──▶ Domain Model ──▶ Write DB
                                        │
                                        ▼ (events)
                                   Read Model ──▶ Queries (reads)
```

**When to use CQRS:**
- Read and write traffic have very different scale requirements
- The query model needs different projections than the write model
- You need optimized read models (search indexes, materialized views)

**When NOT to use CQRS:**
- Simple CRUD with standard read/write patterns
- The added complexity isn't justified by the problem

## Event Sourcing

When the event sequence is the source of truth:

```python
class EventSourcedOrder:
    def __init__(self, events: list[DomainEvent]):
        self._pending_events: list[DomainEvent] = []
        for event in events:
            self._apply(event)

    def submit(self):
        if self._status != OrderStatus.DRAFT:
            raise InvalidOperation("Already submitted")
        self._apply(OrderSubmitted(self._id, self._customer_id))

    def _apply(self, event: DomainEvent):
        # State is derived by replaying events
        match event:
            case OrderCreated():
                self._id = event.order_id
                self._status = OrderStatus.DRAFT
            case OrderSubmitted():
                self._status = OrderStatus.SUBMITTED
        self._pending_events.append(event)
```

**Requirements for Event Sourcing:**
- Event streams match Aggregate identity
- Replay is deterministic
- Event schema changes are versioned (upcasters/translators)
- Snapshots for Aggregates with long event histories

**When to use Event Sourcing:**
- Audit trail is a first-class requirement
- You need to reconstruct past states
- The domain naturally thinks in terms of state transitions

**When NOT to use Event Sourcing:**
- Simple CRUD
- The team doesn't understand event sourcing well
- You're doing it because it seems "advanced"
