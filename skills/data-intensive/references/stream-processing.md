# Stream Processing

From Designing Data-Intensive Applications (Martin Kleppmann). Use when designing event sourcing, CDC, or stream processing pipelines.

## Core Concepts

### Events vs Commands
- **Command:** A request to do something (`CreateOrder`). May be rejected.
- **Event:** A fact that something happened (`OrderCreated`). Immutable, append-only.
- Events need **stable identifiers** (for deduplication), **correlation metadata** (to trace causality across consumers), and **versioned payloads** (so consumers can evolve).

### Event Log
An append-only log of events is the source of truth. State is derived by replaying events. The log is a durable history, not merely a transport pipe — retain it for replay and rebuild, not just delivery.

```
Event Log: [OrderCreated, PaymentReceived, OrderShipped, OrderDelivered]
              ↓
         Materialized View: {order_id: "123", status: "delivered"}
```

## Stream Processing Guarantees

| Guarantee | Meaning | Cost |
|---|---|---|
| **At-most-once** | Events may be lost. No retries. | Lowest latency, lowest reliability. |
| **At-least-once** | Events are never lost but may be delivered twice. | Requires idempotency on the consumer. |
| **Exactly-once** | Events are delivered exactly once. | Highest cost. Often faked via idempotency + at-least-once. |

**Reality:** True exactly-once is extremely expensive. Build for at-least-once and make consumers idempotent.

## Idempotency Patterns

| Pattern | How It Works |
|---|---|
| **Deduplication key** | Each event has a unique ID. Consumers track processed IDs and skip duplicates. |
| **Idempotent transitions** | State transitions are designed so applying them twice has the same effect as applying them once. |
| **Upsert** | Write operations use `INSERT ... ON CONFLICT UPDATE` or equivalent. |

## Time in Stream Processing

| Time Type | Definition | When to Use |
|---|---|---|
| **Event time** | When the event actually occurred (embedded in the event). | Correctness — when you need to know when things happened. |
| **Processing time** | When the event is processed by the system. | Simplicity — when exact timing doesn't matter. |
| **Ingestion time** | When the event arrived at the streaming system. | Compromise — when you can't trust event time but need consistent ordering. |

## Windowing

When aggregating events over time:

| Window Type | Definition | Use For |
|---|---|---|
| **Tumbling** | Fixed, non-overlapping windows (e.g., every 5 minutes). | Regular reports, metrics. |
| **Sliding** | Overlapping windows (e.g., last 5 minutes, updated every 1 minute). | Moving averages, trend detection. |
| **Session** | Activity-based windows (events within X minutes of each other). | User sessions, activity bursts. |

## Handling Late Data

Events may arrive after the window they belong to has been processed:

1. **Grace period:** Wait N minutes after the window closes before emitting results.
2. **Recompute:** When late data arrives, recompute and emit updated results.
3. **Side output:** Route late data to a separate "late events" stream for manual handling.

## Change Data Capture (CDC)

Capture every change to a database as an event stream:

```
Database ──[CDC]──▶ Event Stream ──▶ Consumers (search index, cache, analytics)
```

**Pros:** Decouples consumers from the primary database. Enables event sourcing.
**Cons:** Adds complexity. CDC lag means consumers see stale data.

## Stream Processing Checklist

- [ ] Events are immutable facts, not commands.
- [ ] Consumers are idempotent (handle duplicate delivery).
- [ ] Event time vs processing time is explicit.
- [ ] Late data handling is defined (grace period, recompute, or side output).
- [ ] Windows are defined (tumbling, sliding, session).
- [ ] The event log is the source of truth; materialized views are derived.
- [ ] Schema evolution is planned (forward/backward compatibility).
- [ ] Lag is observable (monitoring for consumer lag, processing delay).
