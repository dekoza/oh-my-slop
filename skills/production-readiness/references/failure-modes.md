# Failure Modes

From Release It! (Michael T. Nygard). Use when designing how a service, integration, or critical path should behave when things go wrong.

## Core Mindset

Every dependency can fail. Every caller can retry. Every queue can fill. Every cache can go stale. Design for these realities explicitly — don't hope they won't happen.

## Dependency Failure Modes

| Failure | Symptom | Defense |
|---|---|---|
| **Timeout** | Call hangs indefinitely | Set explicit timeouts. Fail fast. |
| **Slow degradation** | Latency increases gradually | Monitor latency percentiles. Set timeouts below user-visible SLA. |
| **Partial failure** | Some requests succeed, some fail | Retry with backoff. Circuit breaker after threshold. |
| **Cascading failure** | One slow dependency blocks all threads | Bulkhead: separate thread pools per dependency. |
| **Thundering herd** | Many callers retry simultaneously | Jitter on retry backoff. |
| **Stale data** | Cache serves old data after backend changes | TTL + invalidation on write. Versioned cache keys. |
| **Silent corruption** | Dependency returns wrong data without error | Validate response shape and semantics. Don't trust. |

## Designing Failure Semantics

For every outbound call, define:

1. **Timeout:** How long to wait before giving up. (Not "library default.")
2. **Retry eligibility:** Is this operation safe to retry? (Idempotent reads: yes. Non-idempotent writes: no.)
3. **Retry bounds:** Max attempts, max total time, backoff strategy.
4. **Fallback:** What happens on total failure? (Degraded mode, cached value, error response, queue for later.)
5. **Caller survival:** Does the caller's request fail, or does it degrade gracefully?

## Retry Safety Matrix

| Operation Type | Retry Safe? | Notes |
|---|---|---|
| Read by ID | Yes | Idempotent |
| Read with filters | Yes | Idempotent |
| Create (with idempotency key) | Yes | Key prevents duplicates |
| Create (no idempotency key) | No | Will create duplicates |
| Update (full replace) | Yes | Idempotent |
| Update (increment/decrement) | No | Will double-apply |
| Delete | Usually yes | Second delete is a no-op |
| Validation error response | No | Will fail again |
| Permission denied | No | Will fail again |
| Rate limited (429) | Yes (with backoff) | Respect Retry-After header |

## Circuit Breaker States

```
CLOSED (normal) ──[failure threshold exceeded]──▶ OPEN (failing fast)
OPEN (failing fast) ──[timeout elapsed]──▶ HALF-OPEN (testing)
HALF-OPEN (testing) ──[success]──▶ CLOSED (normal)
HALF-OPEN (testing) ──[failure]──▶ OPEN (failing fast)
```

- **CLOSED:** Normal operation. Count failures.
- **OPEN:** Fail immediately without calling the dependency. After a timeout, move to HALF-OPEN.
- **HALF-OPEN:** Allow one test request. Success → CLOSED. Failure → OPEN.

## Bulkhead Patterns

Isolate failures by partitioning resources:

| Resource | Bulkhead Strategy |
|---|---|
| Thread pool | Separate pool per dependency. One slow dep can't starve others. |
| Connection pool | Separate pool per database/service. |
| Memory | Bound queues and caches. Reject when full. |
| Workers | Separate worker pools for critical vs background work. |

## Load Shedding

When the system is overloaded, drop work intentionally:

1. **Prioritize:** Critical traffic (payments, health checks) over low-priority (analytics, batch reports).
2. **Reject early:** At the edge, before the request consumes resources.
3. **Return 503:** Tell the caller to retry later. Include `Retry-After` header.
4. **Degrade:** Serve cached data, reduced functionality, or static fallbacks.

## Backpressure

When a downstream system is slow, propagate the pressure upstream:

- **Bounded queues:** Don't buffer infinitely. Reject when full.
- **Blocking calls:** Let the caller wait (with timeout) rather than buffering.
- **Rate limiting:** Slow down producers to match consumer capacity.
- **Load shedding:** As a last resort when backpressure can't propagate fast enough.
