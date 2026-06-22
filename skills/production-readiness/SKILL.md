---
name: production-readiness
description: >
  Use for services, APIs, jobs, queues, deployment paths, and critical flows that must
  survive production failures, overload, latency, bad data, and operational mistakes.
  Based on Release It! (Michael T. Nygard). Covers timeouts, retries, circuit breakers,
  bulkheads, backpressure, load shedding, observability, deployment safety, and failure
  mode design. Use when the user says "production", "reliability", "resilience",
  "timeout", "retry", "circuit breaker", "deployment", "health check", "observability",
  "failure mode", "overload", or when building any service that will run in production.
---

# Production Readiness

## When This Skill Loads

If you are reading this, the user is building or changing something that must survive production. **A passing happy path is not production readiness.** Design the failure semantics before production defines them for you.

## Core Principle

**Assume every dependency, queue, cache, timeout, caller retry, and degraded state can fail in slow, partial, or prolonged ways.**

Code must assume production mess instead of merely tolerating it by accident. Prefer designs that:
- Fail visibly (don't hide errors)
- Limit blast radius (one failure doesn't cascade)
- Shed load (drop low-value work before core functions collapse)
- Preserve core service (degrade gracefully, don't go fully down)
- Make diagnosis possible (structured logs, correlation IDs, metrics)

## Decision Rules

### Timeouts and Retries
- Put **explicit, intentional time limits** on every outbound call and wait. Never rely on library defaults or allow infinite waits.
- Retry **only** when the operation is safe for caller and provider. Bound count and total time. Use backoff or jitter.
- **Do not retry** validation errors, permanent failures, or non-idempotent operations.
- Do not duplicate retry logic across layers — if the caller retries, the callee shouldn't also retry.

### Isolation
- Isolate dependency and workload failures with **circuit breakers**, **fast failure**, **bulkheads**, and **separate resource pools**.
- One outage must not consume all threads, connections, or workers.
- Use **slow-work isolation** — don't let slow dependencies block fast paths.

### Overload Behavior
- Design overload behavior **explicitly**: back pressure, finite queues, demand limits, capacity reserved for critical traffic.
- **Load shedding**: drop lower-value work before core functions collapse.
- Bound every queue, buffer, pool, cache, and result set. Define what happens when each is full.

### External Input Validation
- Treat **external input and external responses as untrusted**: validate syntax, shape, business plausibility, status, content type, and semantics.
- Prevent malformed data from poisoning caches, queues, or downstream systems.

### Observability
- Build observability into **boundaries and failure points**: structured context, correlation identifiers, latency, throughput, error counts, saturation, queue depth, retry counts, breaker state, dependency health, version, configuration.
- Avoid secrets in logs. Avoid retry-storm log spam.

### Deployment and Operations
- Make startup, health checks, migrations, one-time jobs, and operational automation **idempotent or restartable** where practical.
- Give operational changes durable state, auditability, verification, and rollback/roll-forward paths.
- Ensure health signals reflect real ability to serve — traffic should only reach ready components.

### Resource Budgeting
- Budget scarce resources explicitly. Release them deterministically.
- Avoid holding locks or expensive connections across slow remote calls.
- Stream or paginate large payloads instead of defaulting to huge in-memory batches.

## Trigger Rules

- **Adding an outbound call:** Define timeout, retry eligibility, retry bounds, fallback/degraded mode, validation, and caller-survival behavior.
- **Adding a queue/buffer/pool/cache/job:** Define capacity, full behavior, cleanup, miss/stampede/staleness behavior, pacing, pagination/streaming, and saturation monitoring.
- **Touching deployment/config/startup/migrations:** Make it idempotent or restartable. Give it durable state, auditability, verification, and rollback.
- **Adding health checks/routing/handshakes:** Ensure traffic reaches only ready components. Health signals must reflect real ability to serve.
- **Designing API/integration contracts:** Make failure modes explicit. Distinguish retryable from non-retryable. Prefer coarse-grained resilient interactions. Document timeout, retry, version, compatibility.
- **Reviewing an incident:** Identify the failure chain, missing defenses, detection gaps, demand, saturation, latency distribution, queue age, dependency behavior, traffic concentration.
- **Adding admin controls/chaos testing:** Require authorization, auditability, safe defaults, clear stop mechanisms, bounded blast radius, recovery paths.

## Stability Patterns

| Pattern | When to Use |
|---|---|
| **Circuit breaker** | Dependency is failing — stop calling it fast, probe for recovery |
| **Bulkhead** | Isolate resource pools so one failure can't exhaust all capacity |
| **Fail fast** | Continuing hides unrecoverable trouble or holds scarce resources |
| **Backpressure** | Upstream needs to slow down — propagate pressure, don't buffer infinitely |
| **Load shedding** | System is overloaded — drop low-priority work to protect core functions |
| **Governor** | Expensive behavior needs rate-limiting to protect shared resources |
| **Handshaking** | Components must signal readiness before receiving traffic |

## Final Checklist

Before shipping to production:
- [ ] Explicit timeouts on all outbound calls — no infinite waits?
- [ ] Retries safe, bounded, backed off/jittered, not duplicated across layers?
- [ ] Queues, buffers, pools, caches, payloads, jobs bounded?
- [ ] Failure isolated with breakers, bulkheads, fast failure, degradation, or load shedding?
- [ ] External input and dependency responses validated before they affect state?
- [ ] Diagnostics cover logs, metrics, health, correlation, dependencies, saturation, queue depth, retries, breaker state?
- [ ] Startup, deployment, migration, automation restartable, observable, authorized, auditable?
- [ ] API contracts document failure modes, timeouts, retry expectations?

## Reference

| File | Use When |
|---|---|
| [Failure Modes](references/failure-modes.md) | Designing specific failure semantics for a service or integration |
| [Stability Patterns](references/stability-patterns.md) | Choosing between circuit breaker, bulkhead, backpressure, load shedding, governor |
| [Observability](references/observability.md) | Building diagnostics into boundaries and failure points |
| [Deployment Safety](references/deployment-safety.md) | Making deployments, migrations, and operational changes safe and reversible |
