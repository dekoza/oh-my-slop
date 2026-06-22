# Integration Patterns

From DDD (Evans), DDD Distilled (Vernon), and Implementing DDD (Vernon). Use when designing how Bounded Contexts communicate with each other or with external systems.

## Core Principle

**Keep foreign models out of your domain.** Translate at boundaries. Your domain objects should never contain types from another context's model or from external APIs.

## Anticorruption Layer (ACL)

**When:** Integrating with a legacy system, external API, or any context whose model doesn't fit yours.

**Pattern:**
```
External System ──[foreign model]──▶ ACL (translator) ──[local model]──▶ Your Domain
```

**Rules:**
- The ACL translates the foreign model into your domain's language.
- Your domain objects never reference foreign types.
- The ACL is owned by the downstream (receiving) context.
- Test the translation layer independently.

```python
# Foreign model (from external payment gateway)
@dataclass
class StripeEvent:
    id: str
    type: str
    data: dict

# Your domain model
@dataclass(frozen=True)
class PaymentReceived:
    payment_id: PaymentId
    order_id: OrderId
    amount: Money
    received_at: datetime

# ACL translates
class StripeEventTranslator:
    def to_domain(self, event: StripeEvent) -> PaymentReceived:
        if event.type != "payment_intent.succeeded":
            raise UnsupportedEventType(event.type)
        return PaymentReceived(
            payment_id=PaymentId(event.data["id"]),
            order_id=OrderId(event.data["metadata"]["order_id"]),
            amount=Money(Decimal(event.data["amount"]) / 100, "USD"),
            received_at=datetime.fromtimestamp(event.data["created"]),
        )
```

## Open Host Service (OHS)

**When:** Multiple downstream contexts need access to your model.

**Pattern:**
```
Your Domain ──[published protocol]──▶ API / Event Stream ──▶ Multiple Consumers
```

**Rules:**
- Publish a well-defined, versioned protocol (API schema, event schema).
- Don't expose your internal domain model directly. Create dedicated DTOs/projections for external consumers.
- Version carefully. Prefer additive changes. When breaking changes are necessary, version the API.

## Published Language

**When:** Cross-organization or cross-team integration where a shared format is needed.

**Rules:**
- Use a schema registry for events (e.g., Confluent Schema Registry).
- Schemas must be forward and backward compatible.
- Version schemas explicitly. Don't reuse field numbers/IDs for different meanings.

## Integration Style Comparison

| Style | Coupling | Latency | Failure Mode | When to Use |
|---|---|---|---|---|
| **Synchronous RPC** | Tight — caller blocks | Low | Caller fails if callee is down | Real-time requirements, simple request/response |
| **REST** | Moderate — shared resource model | Low-Medium | Caller handles HTTP errors | Public APIs, CRUD-like operations |
| **Async messaging** | Loose — fire and forget | Higher (lag) | Messages queue, retry | Event-driven, cross-context, tolerance for lag |
| **Event streaming** | Loose — consumers are independent | Higher (lag) | Consumers catch up | Multiple consumers, audit trail, event sourcing |

## Messaging Integration Rules

When using messages/events for cross-context integration:
- **Consumers must tolerate duplicates.** At-least-once delivery is the realistic model.
- **Consumers must tolerate lag.** The event may arrive milliseconds or seconds after the fact.
- **Consumers must tolerate out-of-order delivery.** Unless you use per-key partitioning.
- **Include correlation IDs** so consumers can trace the event back to its source.
- **Version event schemas.** Old consumers must be able to read new events (or you must support both versions during rollout).

## Shared Kernel

**When:** Two contexts genuinely share a small, stable part of the model.

**Rules:**
- Keep it **small.** If the Shared Kernel grows beyond a handful of concepts, it's not a kernel — it's a shared dependency problem.
- **Joint ownership.** Both teams must agree on changes. Shared tests enforce this.
- **No uncoordinated changes.** A change to the Shared Kernel without both teams' agreement will break integration.
- **When in doubt, don't share.** Prefer an Anticorruption Layer over a Shared Kernel.

## Separate Ways

**When:** Two contexts have no real dependency.

**Rule:** Don't force integration. If contexts don't need to share data, don't connect them. Resist the urge to create a "unified model" that serves no real integration need.

## Integration Testing

Test translations at boundaries:
- **ACL tests:** Verify that foreign models are correctly translated to local models.
- **Contract tests:** Verify that your published API/event schema matches what consumers expect.
- **End-to-end tests:** Verify the full flow from one context to another (but don't rely on these alone — they're slow and flaky).
