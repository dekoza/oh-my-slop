# Consistency Models

From Designing Data-Intensive Applications (Martin Kleppmann). Use when choosing the consistency guarantees for a data system.

## The Spectrum

```
Strong ◄──────────────────────────────────────────► Weak
Linearizability → Sequential → Causal → Eventual
```

## Linearizability

**What it feels like:** A single copy of the data. After a write completes, all subsequent reads see that write.

**Cost:** High. Requires coordination. Sacrifices availability during partitions (CAP theorem).

**When to use:** Leader election, distributed locks, uniqueness constraints, cross-shard invariants.

**When NOT to use:** High-throughput reads, cross-region replication, anything where latency matters more than strict ordering.

## Sequential Consistency

**What it feels like:** All operations appear in some sequential order, and each process's operations appear in program order.

**Cost:** Moderate. Less strict than linearizability — no real-time constraint.

**When to use:** When you need a consistent order across processes but don't need real-time recency.

## Causal Consistency

**What it feels like:** Causally related operations are seen in the same order by all processes. Concurrent operations may be seen in different orders.

**Cost:** Lower. No coordination for independent operations.

**When to use:** Comment threads (replies must appear after the comment they reply to), social feeds, chat. Most applications that need "strong" consistency actually need causal consistency.

## Eventual Consistency

**What it feels like:** If no new writes are made, eventually all reads will return the same value.

**Cost:** Lowest. Maximum availability and performance.

**When to use:** Caches, CDNs, DNS, recommendation systems, analytics — anywhere stale data is acceptable for a short period.

## Read-Your-Writes Consistency

**What it feels like:** After a user writes data, their subsequent reads see that write (but other users may not yet).

**Cost:** Moderate. Requires routing the user's reads to the same replica that processed their write.

**When to use:** User profile updates, shopping carts, any user-facing write-then-read flow.

## Monotonic Reads

**What it feels like:** If a user reads a value, they will never see an older value on subsequent reads.

**Cost:** Moderate. Requires session affinity or version tracking.

**When to use:** Preventing confusing UI where data appears to go "backwards."

## Consistent Prefix Reads

**What it feels like:** If a sequence of writes happens in a certain order, they are read in that order.

**Cost:** Moderate. Requires causal tracking.

**When to use:** Conversation threads, ordered event streams — preventing out-of-order display.

## Choosing a Model

| Requirement | Model |
|---|---|
| Single global order, real-time recency | Linearizability |
| Consistent order, no real-time requirement | Sequential consistency |
| Causally related operations in order | Causal consistency |
| Stale data acceptable briefly | Eventual consistency |
| User sees their own writes | Read-your-writes |
| Data never goes "backwards" for a reader | Monotonic reads |
| Ordered events stay ordered | Consistent prefix reads |

## Common Mistake: Assuming Strong Consistency

Most distributed databases default to eventual or causal consistency. If your code assumes linearizability but the database provides eventual consistency, you have a bug that only appears under network partitions or high load.

**Always verify** what consistency model your database actually provides for the operations you're using.
