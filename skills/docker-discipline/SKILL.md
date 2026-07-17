---
name: docker-discipline
description: >
  Use whenever creating or modifying Dockerfiles, compose files, or deployment
  configs — any change to how a project builds or runs in containers. This is
  the discipline skill — for Docker behavior lookups and troubleshooting, use
  docker instead.
license: MIT
---

# Docker Discipline

Rules for authoring Docker configs. Every rule traces to a real production issue.
For how Docker itself behaves (networking, storage, BuildKit, registries,
diagnosis), load the `docker` skill — it owns reference and troubleshooting.

## Dockerfile Rules

### Non-Root User, UID-Matched (Critical)

**Match the container user's UID to the host user** to avoid bind-mount permission issues.

```dockerfile
# ✅ Correct: Match host UID
ARG HOST_UID=1000
RUN groupadd -g ${HOST_UID} app && \
    useradd -u ${HOST_UID} -g app -m app
USER app

# ❌ Forbidden: Hardcoded root or mismatched UID
USER 1001  # Won't match host, causes permission errors
```

**Place the `USER` directive AFTER all `RUN`/`COPY` commands** in the Dockerfile.

### Multi-Stage Builds

Keep build dependencies out of the runtime image: build in one stage, copy the
artifacts into a slim runtime stage that runs as the non-root user above.

### Secrets Never in ARG or ENV

`ARG` and `ENV` values persist in image history and layer metadata. Pass
build-time secrets with BuildKit mounts instead:

```dockerfile
RUN --mount=type=secret,id=pypi_token uv sync --frozen
```

Build with `docker build --secret id=pypi_token,src=...`; use `--ssh` with
`RUN --mount=type=ssh` for private git dependencies.

### .dockerignore Before the First Build

Create `.dockerignore` before building anything. Oversized or accidental build
contexts slow builds, break layer caches, and leak secrets (`.env`, `.git`,
local artifacts) into images.

## Docker Compose Rules

### Port Arrays Merge, They Don't Replace

In `docker-compose.override.yml`, a `ports:` list is **appended** to the base file's list — not replaced.

```yaml
# base compose.yml
services:
  web:
    ports:
      - "8000:8000"

# override (this ADDS port 8001, doesn't replace 8000)
services:
  web:
    ports:
      - "8001:8000"
```

**To change a port binding**, either:
1. Edit the base file directly
2. Create a standalone compose file passed with `-f` instead of relying on override merge

### Readiness Is Explicit

`depends_on` short syntax only orders startup — it says nothing about the
dependency being *ready*. When readiness matters, give the dependency a
healthcheck and depend with `condition: service_healthy` (see the test compose
below for the full pattern).

### Test Infrastructure: Separate Compose File

Test infrastructure **MUST** use a separate `compose.test.yml` — profiles do NOT provide lifecycle independence.

```yaml
# compose.test.yml
services:
  testdb:
    image: postgres:16
    environment:
      POSTGRES_DB: test_db
      POSTGRES_USER: test_user
      POSTGRES_PASSWORD: test_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test_user -d test_db"]
      interval: 2s
      timeout: 5s
      retries: 10
    networks:
      - test-net
    # NO ports — intentionally not exposed

  tests:
    build:
      context: .
      dockerfile: Dockerfile.test
    depends_on:
      testdb:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://test_user:test_password@testdb:5432/test_db
    volumes:
      - .:/app
    networks:
      - test-net
    # NO ports — intentionally not exposed

networks:
  test-net:
    driver: bridge
```

### Lifecycle Independence

- `docker compose down` (dev) **MUST NOT** affect tests
- `docker compose -f compose.test.yml down` (tests) **MUST NOT** affect dev

### Profiles for Variants, Files for Lifecycles

Use profiles for configuration variants within one stack. **Exception**: test
infrastructure MUST use a separate `compose.test.yml` (above) — profiles do not
give it an independent lifecycle.

## References

- [Gotchas & Practical Guidance](references/gotchas.md) — Common pitfalls: bind mounts overriding build artifacts, `uv run` implicit sync, volume mount ordering, non-root UID mismatch, healthcheck timing, network namespace confusion, build cache invalidation, environment variable precedence.

## Task Routing

- Dockerfile structure, non-root user, secrets, multi-stage -> This SKILL.md (main content)
- Build cache optimization, COPY ordering -> `references/gotchas.md` (Build Cache Invalidation section)
- Volume mount issues, bind mount overrides -> `references/gotchas.md` (Bind Mounts Override Build Artifacts section)
- `uv run` behavior, implicit sync -> `references/gotchas.md` (uv run Does Implicit Sync section)
- Healthcheck configuration, depends_on -> `references/gotchas.md` (Healthcheck Timing section)
- Network configuration, service communication -> `references/gotchas.md` (Network Namespace Confusion section)
- Environment variables, env_file vs environment -> `references/gotchas.md` (Environment Variable Precedence section)
- Volume mount ordering, named vs bind mounts -> `references/gotchas.md` (Volume Mount Ordering section)
- How Docker behaves, troubleshooting, boundary questions -> load the `docker` skill
