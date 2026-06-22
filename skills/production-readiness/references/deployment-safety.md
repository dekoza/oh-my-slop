# Deployment Safety

From Release It! (Michael T. Nygard). Use when making deployments, migrations, or operational changes.

## Core Principle

**Make every operational change safe, auditable, and reversible.** If it can fail, it must have a rollback path.

## Deployment Rules

1. **Idempotent deploys:** Running the deploy twice should produce the same result as running it once.
2. **Health-gated traffic:** New instances should not receive traffic until they pass health checks.
3. **Gradual rollout:** Deploy to a small subset first. Monitor. Then expand.
4. **Automated rollback:** If error rate or latency exceeds a threshold after deploy, roll back automatically.
5. **Feature flags:** Use feature flags for risky changes. Enable gradually. Disable without redeploying.

## Migration Rules

1. **Backward-compatible first:** The old code must work with the new schema, and the new code must work with the old schema.
2. **Expand-contract pattern:**
   - **Expand:** Add the new column/table. Write to both old and new. Read from old.
   - **Migrate:** Backfill data. Switch reads to new.
   - **Contract:** Remove the old column/table. Stop writing to it.
3. **Reversible:** Every migration must have a down migration that restores the previous state.
4. **Idempotent:** Running a migration twice should be safe.

## Operational Automation

For scripts, one-time jobs, and admin tools:

| Property | Requirement |
|---|---|
| **Idempotent** | Running twice is safe |
| **Auditable** | Log what was done, when, by whom |
| **Stoppable** | Can be interrupted without corruption |
| **Recoverable** | State is durable; can resume after failure |
| **Authorized** | Requires appropriate permissions |
| **Observable** | Progress and results are visible |

## Configuration Validation

Validate configuration at startup, not at first use:

```python
# Bad: fails on first request
def handle_request():
    api_key = os.environ["API_KEY"]  # KeyError if missing

# Good: fails at startup with clear message
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    raise SystemExit("FATAL: API_KEY environment variable is required")
```

## Startup Order

1. Validate configuration.
2. Check required dependencies (DB, cache, message broker).
3. Run pending migrations.
4. Start accepting traffic (health check returns 200).

If any step fails, the process should exit with a clear error message — not start serving requests in a broken state.
