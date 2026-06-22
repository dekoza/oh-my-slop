---
name: data-intensive
description: >
  Use for systems where correctness depends on data ownership, consistency, durability,
  replication, partitioning, schema evolution, event flow, replay, or derived-data
  maintenance. Based on Designing Data-Intensive Applications (Martin Kleppmann).
  Covers consistency models, replication, partitioning, transactions, schema evolution,
  event sourcing, stream processing, and distributed system failure modes. Use when the
  user says "data-intensive", "distributed data", "consistency", "replication",
  "partitioning", "schema evolution", "event sourcing", "stream processing",
  "idempotency", "exactly-once", or when designing systems with multiple data stores.
---

# Designing Data-Intensive Systems

## When This Skill Loads

If you are reading this, the user is designing or changing a system where data correctness, consistency, or durability matters. **Do not design distributed data behavior as if every write, read, queue, cache, replica, clock, and downstream side effect were local, ordered, fresh, and exactly once.**

## Core Principle

**Make core trade-offs explicit.** For every data flow, state:
- **Source of truth** — which system owns this data?
- **Consistency expectation** — strong, eventual, causal, read-your-writes?
- **Durability point** — when is a write considered permanent?
- **Failure behavior** — what happens on timeout, crash, duplicate, or unknown success?

## Decision Rules

### Write Semantics
Define explicitly for every write path:
- When is a write **accepted** vs **persisted** vs **visible** vs **durable**?
- What happens on timeout? (Unknown success — the write may or may not have applied.)
- Is the write idempotent? Can it be safely retried?
- What conflicts can happen, and how are they detected/resolved?

### Idempotency and Replay Safety
- Make commands, jobs, events, and stream processors safe under retry and replay.
- Use **deduplication keys**, **naturally idempotent transitions**, or **explicit transactional recovery contracts**.
- Never assume exactly-once delivery. At-least-once is the realistic model; build idempotency on top.

### Ordering
- Preserve only the ordering the business logic **actually needs**.
- Scope ordering per key, stream, partition, or entity history — not globally.
- Keep ordering-sensitive logic close to the scope where ordering is guaranteed.

### Derived Data
- Treat indexes, caches, search copies, read models, materialized views, and denormalized copies as **derived data**.
- Define explicit **propagation**, **lag**, **observability**, **repair**, and **rebuild** paths.
- If the primary data store fails, can you rebuild the derived data?

### Schema Evolution
- Design schemas, APIs, messages, events, and database changes as **evolving contracts**.
- Plan compatibility for old readers, old writers, old data, in-flight messages, rolling upgrades, and cross-service formats.
- Use forward-compatible and backward-compatible encoding (e.g., Avro, Protobuf with field numbers).

### Replication
Choose replication topology based on:
- Write topology (single leader, multi-leader, leaderless)
- Latency requirements
- Failure tolerance and failover behavior
- Consistency needs (read-your-writes, monotonic-read, consistent-prefix)
- Conflict handling and convergence

### Partitioning
- Partition by workload-relevant locality and consistency keys.
- Make hot-key, skew, routing, secondary-index, rebalancing, and cross-partition-operation costs explicit.
- Don't partition a tightly consistent business concept across shards.

### Transactions and Isolation
- Match transaction isolation to the invariants you need to protect.
- Make atomicity scope, commit behavior, recovery, and side-effect repair semantics explicit.
- Use serializable isolation, locks, compare-and-set, versioning, or reconciliation where anomalies would break invariants.

### Coordination
- Use linearizability, total order broadcast, atomic commit, or consensus **only** where the coordination problem truly requires agreement.
- These have availability and latency costs. Don't use them for performance; use them for correctness.

### Batch and Stream Processing
- Make processing **recomputable** and **recoverable**: define inputs, outputs, checkpoints, and external side effects.
- Define event time vs processing time vs ingestion time.
- Handle late data, windows, joins, and source-to-sink guarantees explicitly.

### Service Boundaries
- Align service boundaries with **data ownership** and **update semantics**.
- Don't casually split one tightly consistent business concept across services.
- Don't put chatty cross-service joins on hot paths.

## Trigger Rules

- **Changing a write path:** State source of truth, consistency boundary, durability point, visibility point, downstream effects, rollback/repair path, and timeout behavior.
- **Adding a cache/index/projection:** Define ownership, propagation, staleness, write cost, lag visibility, rebuild, and repair.
- **Changing a schema/API/message/event:** Plan compatibility for old readers, old writers, old data, in-flight messages, rollout, and migration.
- **Adding retries/jobs/consumers/queues/CDC/stream processors:** Prove duplicate safety, replay safety, ordering, retention, side-effect safety, and recovery.
- **Routing reads to replicas:** Identify read-your-writes, monotonic-read, consistent-prefix, staleness, catch-up, failover, and conflict expectations.
- **Partitioning data:** Test for locality, skew, hot keys, routing, rebalancing cost, secondary-index behavior, and cross-partition coordination.
- **Choosing transaction isolation:** Map each anomaly to the invariant it can break. Add compensating design where needed.
- **Using timestamps/leases/locks/consensus:** Define clock assumptions, quorum/session semantics, stale-authority behavior, and fencing.
- **Reviewing data-intensive code:** Look for hidden source-of-truth ownership, missing idempotency, accidental exactly-once assumptions, unscoped ordering, schema drift, unrebuildable projections, unclear multi-writes, and unobservable lag or failure.

## Final Checklist

- [ ] Source of truth and derived representations explicit?
- [ ] Consistency expectations, durability points, visibility points, staleness, and conflict rules concrete?
- [ ] Retries, duplicate delivery, replay, reordering, timeouts, crashes, and unknown success handled?
- [ ] Schemas, APIs, messages, events, enums, statuses evolve safely across mixed versions?
- [ ] Storage, indexing, replication, partitioning, routing, and analytical layouts match the actual workload?
- [ ] Transaction isolation and coordination choices protect the named invariants?
- [ ] Events, logs, streams, batch jobs, and projections are replayable or have explicit repair paths?
- [ ] Service boundaries follow data ownership and update semantics?
- [ ] Lag, retries, failures, rebuilds, and repair paths are observable?
- [ ] Design avoids exactly-once wishful thinking and hidden distributed-system contracts?

## Reference

| File | Use When |
|---|---|
| [Consistency Models](references/consistency-models.md) | Choosing between strong, eventual, causal, read-your-writes consistency |
| [Replication and Partitioning](references/replication-partitioning.md) | Designing replication topology or partitioning strategy |
| [Schema Evolution](references/schema-evolution.md) | Changing schemas, APIs, messages, or events across versions |
| [Stream Processing](references/stream-processing.md) | Designing event sourcing, CDC, or stream processing pipelines |
