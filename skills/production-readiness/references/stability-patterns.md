# Stability Patterns

From Release It! (Michael T. Nygard). Use when choosing a specific resilience pattern for a production system.

## Circuit Breaker

**Problem:** A failing dependency wastes resources and blocks threads while waiting for timeouts.

**Solution:** Stop calling the dependency after a failure threshold is reached.

```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=30):
        self._state = "CLOSED"
        self._failures = 0
        self._threshold = failure_threshold
        self._recovery_timeout = recovery_timeout

    def call(self, operation, fallback):
        if self._state == "OPEN":
            if self._recovery_elapsed():
                self._state = "HALF_OPEN"
            else:
                return fallback()

        try:
            result = operation()
            self._on_success()
            return result
        except Exception:
            self._on_failure()
            return fallback()

    def _on_failure(self):
        self._failures += 1
        if self._failures >= self._threshold:
            self._state = "OPEN"
            self._opened_at = time.time()

    def _on_success(self):
        self._failures = 0
        self._state = "CLOSED"
```

**When to use:** Any outbound call to a dependency that can fail (HTTP, DB, external service).

## Bulkhead

**Problem:** One slow dependency consumes all shared resources (threads, connections), starving other work.

**Solution:** Partition resources so one failure can't exhaust everything.

```python
# Separate thread pools per dependency
payment_pool = ThreadPoolExecutor(max_workers=10)
notification_pool = ThreadPoolExecutor(max_workers=5)
analytics_pool = ThreadPoolExecutor(max_workers=2)

# Payment can't starve notifications or analytics
```

**When to use:** Multiple dependencies share a process. Critical vs non-critical work in the same service.

## Backpressure

**Problem:** Producers are faster than consumers. Unbounded queues grow until memory is exhausted.

**Solution:** Propagate pressure upstream. Slow down or reject when downstream is full.

```python
# Bounded queue — reject when full
queue = asyncio.Queue(maxsize=100)

async def produce(item):
    try:
        queue.put_nowait(item)  # raises QueueFull if full
    except asyncio.QueueFull:
        raise ServiceUnavailable("Server is busy, retry later")
```

**When to use:** Any queue, buffer, or stream between components with different processing speeds.

## Load Shedding

**Problem:** System is overloaded. Serving all requests slowly is worse than serving some requests fast.

**Solution:** Drop low-priority work to protect core functions.

```python
async def handle_request(request):
    if is_overloaded() and is_low_priority(request):
        return Response(status=503, headers={"Retry-After": "10"})
    return await process(request)
```

**When to use:** Any service that receives more traffic than it can handle. Prioritize critical paths.

## Governor

**Problem:** Expensive operations (report generation, bulk exports, complex queries) can overwhelm shared resources.

**Solution:** Rate-limit or throttle expensive operations independently.

```python
# Rate limiter for expensive operations
expensive_limiter = RateLimiter(max_per_minute=5)

async def generate_report(request):
    if not expensive_limiter.acquire():
        return Response(status=429, body="Too many report requests, try later")
    return await _generate_report(request)
```

**When to use:** Expensive operations that share resources with normal request processing.

## Fail Fast

**Problem:** Continuing to process when a required resource is unavailable wastes time and resources.

**Solution:** Check prerequisites immediately. Fail at the edge.

```python
async def handle_request(request):
    if not await db.is_healthy():
        return Response(status=503, body="Service temporarily unavailable")
    # ... normal processing ...
```

**When to use:** Startup checks, health checks, any operation with hard prerequisites.

## Pattern Selection

| Situation | Pattern |
|---|---|
| Dependency is failing repeatedly | **Circuit breaker** |
| One slow dep starving others | **Bulkhead** |
| Producer faster than consumer | **Backpressure** |
| System overloaded, need to prioritize | **Load shedding** |
| Expensive operation threatening normal traffic | **Governor** |
| Required resource unavailable | **Fail fast** |
