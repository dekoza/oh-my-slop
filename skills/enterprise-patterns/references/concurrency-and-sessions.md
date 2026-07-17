# Concurrency & sessions

Depth behind the SKILL.md decisions on application-level concurrency and session-state
placement. Both are **application-workflow** concerns — distinct from database isolation,
which is [data-intensive](../../data-intensive/SKILL.md)'s ground.

## Offline concurrency vs database isolation

The distinction that makes this its own topic: a database transaction holds only for the
span of one unit of work. A **business transaction** often spans a user think-time gap — a
record is read and rendered, the user edits for minutes, then saves in a *later* request.
No database lock survives that gap. **Offline concurrency** is how you protect that
cross-request edit. DB isolation levels, lost update, and write skew *within* a transaction
belong to [data-intensive](../../data-intensive/SKILL.md); reach for these patterns only for
the across-requests case.

## Offline locking patterns

- **Optimistic Offline Lock** *(default)* — assume conflicts are possible but uncommon.
  Carry a version (timestamp or counter) on the record; on save, check it hasn't changed and
  reject the write if it has. Detect the conflict, fail safely and explicitly, and surface a
  merge or re-edit path to the user intentionally — a silent last-writer-wins is the failure
  mode this prevents.
- **Pessimistic Offline Lock** — acquire an exclusive lock at read time so no one else can
  edit until you release. Use **only** when contention is genuinely expected and the cost of
  blocking others (plus lock management) is justified. Needs a lock table, an owner, an
  expiry, and a cleanup story.
- **Coarse-Grained Lock** — lock a set of related objects as a single unit so a user-level
  edit that touches several objects stays consistent. One lock guards the group (often keyed
  on a shared root or version) instead of one lock per object.
- **Implicit Lock** — acquire locks in shared framework/infrastructure code so individual
  developers can't forget to. Acceptable only when it stays diagnosable: ownership,
  contention, and stale-lock cleanup must remain visible to maintainers. An implicit lock
  that makes concurrency invisible is worse than no convention.

## Transaction boundary rules

1. Transaction boundaries are **explicit** in the application workflow — usually owned by the
   Service Layer / Unit of Work, not scattered.
2. Keep transactions **short**.
3. Avoid transactions that span **remote calls**; do the remote work outside the transaction
   span.
4. Don't bury transaction ownership deep in helper classes — a reader should see where a
   transaction begins and commits.

## Session-state placement

A stateful business transaction across multiple requests has to keep its in-progress state
somewhere. Choose by forces, and give every session an explicit owner, lifetime, and cleanup:

| Placement | Choose when | Costs / risks to weigh |
|---|---|---|
| **Client Session State** | You want server statelessness and easy horizontal scaling | Integrity and security of client-held data; payload size on every request |
| **Server Session State** | Simple, single-node, or sticky-session deployments | Memory footprint; cleanup of abandoned sessions; sharing across a server farm |
| **Database Session State** | Durability or server-farm sharing outweighs the extra load | Added database load; cleanup of stale session rows; serialization of session data |

Decide placement, ownership, lifetime, security, failover, and cleanup **before** piling
features onto a session — an unowned session with no cleanup story is a slow leak and a
security surface.
