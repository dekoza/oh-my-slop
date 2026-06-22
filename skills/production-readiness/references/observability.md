# Observability

From Release It! (Michael T. Nygard). Use when building diagnostics into a production system.

## Core Principle

**Build observability into boundaries and failure points.** If something can fail, it must be visible when it does.

## What to Log

At every boundary (inbound request, outbound call, queue consume, job execution):

| Signal | Why |
|---|---|
| **Correlation ID** | Trace a request across services |
| **Latency** | How long did this operation take? |
| **Error** | What failed and why? |
| **Dependency health** | Which dependencies are up/down/slow? |
| **Retry count** | How many retries before success/failure? |
| **Breaker state** | Is the circuit breaker open? |

## What NOT to Log

- **Secrets:** API keys, passwords, tokens, PII
- **Retry storms:** Don't log every retry at ERROR level — log the final failure
- **Health check noise:** Health checks should be DEBUG level, not INFO

## Structured Logging

Use structured (JSON) logs, not free-form text:

```python
# Bad
logger.info(f"Payment failed for order {order_id}: {error}")

# Good
logger.info("payment_failed", extra={
    "order_id": order_id,
    "error": str(error),
    "dependency": "stripe",
    "retry_count": retry_count,
    "correlation_id": correlation_id,
})
```

## Metrics to Track

| Category | Metrics |
|---|---|
| **Traffic** | Requests/sec, by endpoint and status code |
| **Latency** | p50, p95, p99 by endpoint |
| **Errors** | Error rate by type and dependency |
| **Saturation** | CPU, memory, thread pool usage, connection pool usage |
| **Queue** | Depth, age of oldest item, processing rate |
| **Retries** | Count by dependency, success rate after retry |
| **Circuit breaker** | State (open/closed/half-open), transitions |
| **Dependencies** | Health status, latency, error rate |

## Health Checks

A health check should reflect the service's **real ability to serve traffic**:

```python
async def health_check():
    checks = {
        "database": await check_database(),
        "cache": await check_cache(),
        "disk_space": check_disk_space(),
    }
    all_healthy = all(c["healthy"] for c in checks.values())
    status = 200 if all_healthy else 503
    return Response(status=status, body=json.dumps(checks))
```

**Rules:**
- Check all dependencies the service needs to function.
- Don't check optional dependencies (analytics, non-critical caches).
- Return 503 if any required dependency is down.
- Include per-dependency status in the response body.

## Correlation IDs

Every request should carry a correlation ID that flows through all downstream calls:

```python
# Inbound: extract or generate correlation ID
correlation_id = request.headers.get("X-Correlation-ID", str(uuid4()))

# Outbound: propagate to downstream services
response = await httpx.post(
    url,
    headers={"X-Correlation-ID": correlation_id},
    json=payload,
)

# Logging: include in every log message
logger.info("processing_order", extra={"correlation_id": correlation_id, "order_id": order_id})
```

This lets you trace a single request across service boundaries in your log aggregator.
