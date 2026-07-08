---
description: Practical gotchas, common pitfalls, and field-tested guidance for Docker + Docker Compose with Python/uvs projects.
globs: "Dockerfile* compose*.yml docker-compose*.yml"
scope: docker
target_versions: "Docker 24+, docker-compose v2+"
last_verified: 2026-07-03
source_basis: production experience
---

# Docker Gotchas & Practical Guidance


Hard-won lessons from production Docker projects. Use this reference to avoid common pitfalls and make informed architectural decisions.

## Contents

- Bind Mounts Override Build Artifacts
- uv run Does Implicit Sync
- Volume Mount Ordering
- Non-Root User UID Mismatch
- Healthcheck Timing
- Network Namespace Confusion
- Build Cache Invalidation
- Environment Variable Precedence

## Bind Mounts Override Build Artifacts

**The problem**: `volumes: - .:/app` in docker-compose.yml overwrites everything in `/app/`, including `.venv/` created during Dockerfile build.

```dockerfile
# ✅ Correct: Install deps in image
RUN uv sync --frozen --no-dev
```

```yaml
# ❌ Wrong: Mounts entire host dir, discards .venv/
volumes:
  - .:/app
```

```yaml
# ✅ Correct: Mount only source dirs, preserve .venv/
volumes:
  - ./apps:/app/apps
  - ./config:/app/config
  - ./templates:/app/templates
  - ./static:/app/static
```

**Why it matters**: With `- .:/app`, dependencies are installed twice — once during build (wasted), once at runtime (wasted again). The image is no longer self-contained.

**Hot-reload still works**: Mounting only source directories preserves hot-reload for code changes while keeping the container's `.venv/` intact.

## uv run Does Implicit Sync

**The problem**: `uv run python manage.py migrate` does an implicit `uv sync` at runtime, installing dev dependencies even if the image was built with `--no-dev`.

```bash
# ❌ Wrong: uv run syncs at runtime, installs dev deps
uv run python manage.py migrate
```

```bash
# ✅ Correct: Use --no-sync to use existing .venv/
uv run --no-sync python manage.py migrate
```

**Why it matters**: If your Dockerfile runs `uv sync --no-dev`, but the container command uses `uv run` without `--no-sync`, uv will install dev dependencies (pytest, ruff, etc.) at runtime. This wastes time and may cause permission issues.

**Solution**: Add `--no-sync` to all `uv run` commands in docker-compose.yml or Dockerfile CMD/ENTRYPOINT.

```yaml
# docker-compose.yml
command: >
  sh -c "uv run --no-sync python manage.py migrate &&
         uv run --no-sync python manage.py runserver 0.0.0.0:8000"
```

## Volume Mount Ordering

**The problem**: Docker volume mount order matters when the same path is mounted multiple times.

```yaml
# ❌ Wrong: Later mount overrides earlier
volumes:
  - ./host-dir:/app/data
  - named-volume:/app/data  # This overwrites host-dir!
```

```yaml
# ✅ Correct: Named volumes before bind mounts
volumes:
  - named-volume:/app/data
  - ./host-dir:/app/other
```

**Rule of thumb**: Bind mounts (host directories) override named volumes when they target the same path. Order matters.

## Non-Root User UID Mismatch

**The problem**: Container user UID doesn't match host user UID, causing permission errors on bind mounts.

```dockerfile
# ❌ Wrong: Hardcoded UID that may not match host
USER 1000
```

```dockerfile
# ✅ Correct: Match host UID with build arg
ARG HOST_UID=1000
RUN groupadd -g ${HOST_UID} app && \
    useradd -u ${HOST_UID} -g app -s /bin/sh -m app
USER app
```

**Why it matters**: If host user is UID 1000 and container user is UID 1001, files created in the container will be owned by 1001 and you won't be able to edit them on the host without `sudo`.

**Check your UID**: Run `id -u` on the host. Use that value in the Dockerfile.

## Healthcheck Timing

**The problem**: Service depends on another service's health, but healthcheck isn't configured or is too slow.

```yaml
# ❌ Wrong: No healthcheck, depends_on just waits for container start
services:
  app:
    depends_on:
      - db
```

```yaml
# ✅ Correct: Configure healthcheck and use condition
services:
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U skrytka"]
      interval: 5s
      timeout: 5s
      retries: 5
  app:
    depends_on:
      db:
        condition: service_healthy
```

**Why it matters**: Without healthchecks, `depends_on` only waits for the container to start, not for the service to be ready. Database migrations may fail if the DB isn't accepting connections yet.

## Network Namespace Confusion

**The problem**: Services can't reach each other because they're on different networks or using wrong hostnames.

```yaml
# ❌ Wrong: Services on different networks can't communicate
services:
  app:
    networks:
      - app-net
  db:
    networks:
      - db-net
```

```yaml
# ✅ Correct: Same network for services that need to communicate
services:
  app:
    networks:
      - shared-net
  db:
    networks:
      - shared-net

networks:
  shared-net:
    driver: bridge
```

**Hostname rule**: Services reach each other by service name (not `localhost`). `db:5432` works if both are on the same network.

## Build Cache Invalidation

**The problem**: Docker build cache isn't invalidated when it should be, leading to stale images.

```dockerfile
# ❌ Wrong: COPY . . invalidates cache for all subsequent layers
COPY . .
RUN uv sync --frozen  # Re-run every time any file changes
```

```dockerfile
# ✅ Correct: Copy dependency files first, sync, then copy source
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
```

**Why it matters**: If you `COPY . .` before `RUN uv sync`, any file change (even a comment) invalidates the cache and re-runs `uv sync`. This makes builds slower.

**Rule of thumb**: Copy only dependency manifests first, install deps, then copy the rest.

## Environment Variable Precedence

**The problem**: Environment variables from different sources override each other in confusing ways.

```yaml
# Sources of env vars (in priority order, lowest to highest):
# 1. Dockerfile ENV
# 2. docker-compose.yml environment:
# 3. docker-compose.yml env_file:
# 4. Host environment (if not overridden)
```

```yaml
# ❌ Confusing: Multiple sources with same variable
services:
  app:
    environment:
      DJANGO_DEBUG: "false"  # Set here
    env_file:
      - .env  # May also set DJANGO_DEBUG
```

```yaml
# ✅ Clear: Use env_file for secrets, environment: for overrides
services:
  app:
    env_file:
      - .env
    environment:
      DJANGO_DEBUG: "${DJANGO_DEBUG:-false}"  # Explicit override with default
```

**Rule of thumb**: Use `env_file:` for most variables, `environment:` for explicit overrides. Document which variables come from which source.
