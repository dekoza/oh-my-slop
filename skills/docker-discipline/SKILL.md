---
name: docker-discipline
description: >
  Docker and Docker Compose best practices for production and testing. Triggers on: "Docker",
  "docker-compose", "compose.yml", "Dockerfile", "container", "image", "build", "deploy",
  "non-root user", "UID", "bind mount", "port mapping", "network", "volume", "healthcheck",
  "compose.test.yml", "test environment", or when writing Dockerfiles, compose files, or deployment configs.
  Use when: creating Dockerfiles, compose files, deployment configs, or making Docker decisions.
license: MIT
---

# Docker Discipline

## Non-Root User (Critical)

**Docker non-root user UID must match host user** to avoid bind-mount permission issues.

```dockerfile
# ✅ Correct: Match host UID
ARG HOST_UID=1000
RUN groupadd -g ${HOST_UID} app && \
    useradd -u ${HOST_UID} -g app -m app
USER app

# ❌ Forbidden: Hardcoded root or mismatched UID
USER 1001  # Won't match host, causes permission errors
```

**`USER` directive must come AFTER all `RUN`/`COPY` commands** in Dockerfile.

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

## Dockerfile Best Practices

### System Dependencies for Playwright/Chromium

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# System deps for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen

# Install Playwright browsers
RUN uv run playwright install chromium

COPY . .
```

### WhiteNoise Ordering (Django)

`WhiteNoiseMiddleware` must be second in `MIDDLEWARE`, directly after `SecurityMiddleware`.

## Docker Compose Profiles

Profiles allow multiple service configs in a single file — use them instead of separate compose files for configuration variants.

**Exception**: test infrastructure MUST use a separate `compose.test.yml`.
