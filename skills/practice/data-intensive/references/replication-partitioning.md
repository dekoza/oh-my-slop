# Replication and Partitioning

From Designing Data-Intensive Applications (Martin Kleppmann). Use when designing how data is replicated across nodes or partitioned across shards.

## Replication Topologies

### Single Leader (Primary-Replica)

```
Writes ──▶ Leader ──▶ Replica 1
                    ──▶ Replica 2
                    ──▶ Replica 3
Reads  ──▶ Any replica
```

**Pros:** Simple. All writes go to one place. No write conflicts.
**Cons:** Leader is a single point of failure. Write throughput limited to one node. Replicas lag behind.

**Consistency options:**
- Synchronous: Write waits for replicas. Strong consistency, higher latency.
- Asynchronous: Write returns immediately. Lower latency, but replicas may lag.

### Multi-Leader

```
Writes ──▶ Leader A ◀──▶ Leader B
Writes ──▶ Leader C ◀──▶ Leader B
```

**Pros:** Write availability during partitions. Lower write latency (write to nearest leader).
**Cons:** Write conflicts when the same data is written to two leaders simultaneously. Conflict resolution is hard.

**When to use:** Multi-datacenter deployments, offline-first applications.

### Leaderless (Quorum)

```
Writes ──▶ Node 1, Node 2, Node 3 (write to W nodes)
Reads  ──▶ Node 1, Node 2, Node 3 (read from R nodes)
Quorum: W + R > N
```

**Pros:** No single point of failure. Tolerates node failures.
**Cons:** Quorum reads are slower. Stale reads possible if W + R ≤ N. Conflict resolution needed.

**When to use:** High-availability systems (Dynamo-style: Cassandra, Riak, DynamoDB).

**Caution:** Sloppy quorums and hinted handoff improve write availability but weaken quorum guarantees — W + R > N no longer ensures a read overlaps the latest write.

## Replication Lag Problems

| Problem | Symptom | Mitigation |
|---|---|---|
| **Read-your-writes violation** | User writes, then reads stale data | Route user's reads to leader for a window after their write |
| **Monotonic reads violation** | User sees data go "backwards" | Route reads to the same replica for a session |
| **Consistent prefix violation** | Causally related writes appear out of order | Track causal dependencies; route related reads consistently |

## Partitioning Strategies

### Range Partitioning

Data is split by key range (A-M on shard 1, N-Z on shard 2).

**Pros:** Range queries are efficient. Easy to understand.
**Cons:** Hot spots if access is skewed (e.g., recent timestamps all go to one shard).

### Hash Partitioning

Data is split by `hash(key) % num_shards`.

**Pros:** Even distribution. No hot spots from key patterns.
**Cons:** Range queries must scan all shards. Resharding is expensive.

### Consistent Hashing

Data is placed on a ring. Each node owns a range of the ring.

**Pros:** Adding/removing nodes only affects adjacent ranges. Minimal data movement.
**Cons:** Requires virtual nodes for even distribution.

## Partitioning and Secondary Indexes

| Approach | Pros | Cons |
|---|---|---|
| **Document-partitioned (local) index** | Writes are fast (index on same shard) | Reads must query all shards |
| **Term-partitioned (global) index** | Reads are fast (one shard has all matches) | Writes must update multiple shards |

## Reconfiguration

Failover, rebalancing, and resharding need the same scrutiny as steady-state behavior — most guarantee violations happen during membership changes, not normal operation.

## Choosing a Strategy

| Situation | Recommendation |
|---|---|
| Single datacenter, read-heavy | Single leader + async replicas |
| Multi-datacenter, write availability matters | Multi-leader with conflict resolution |
| Maximum availability, tolerate eventual consistency | Leaderless with quorum |
| Even distribution, no range queries | Hash partitioning |
| Range queries needed | Range partitioning + careful hot-spot monitoring |
| Need both write availability and consistency | Single leader per partition, route writes to the leader |
