---
domain: Dockerfile and Images
category: build
priority: critical
description: "High-signal Dockerfile, image, and layer design guidance"
---

# Dockerfile and Images Reference

Use this file when the task is about authoring, reviewing, or fixing Dockerfiles and image contracts.

### 1. Start with an explicit, intentional base image
**Why**: `FROM` defines the filesystem, package manager, default shell behavior, and security surface for the entire stage.

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim AS runtime
```

**Warning**: Tags are mutable. Prefer stable version tags for convenience and digests for strict reproducibility.

### 2. Use multi-stage builds by default
**Why**: Multiple `FROM` instructions let you keep compilers and build tools out of the final runtime image.

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /out/app ./cmd/app

FROM debian:bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /out/app /usr/local/bin/app
ENTRYPOINT ["/usr/local/bin/app"]
```

**Warning**: Each `FROM` clears prior stage state. If you need artifacts from an earlier stage, copy them explicitly with `COPY --from=<stage>`.

### 3. Use `COPY` by default; use `ADD` only when you need its extra behavior
**Why**: `COPY` is the plain, predictable file-transfer instruction. `ADD` also supports remote URLs, Git sources, and automatic local tar extraction.

```dockerfile
# Prefer this
COPY pyproject.toml uv.lock ./

# Use ADD only when you intentionally need remote fetch or archive extraction
ADD https://example.com/assets.tar.gz /tmp/
```

**Warning**: Reaching for `ADD` casually makes builds harder to reason about. If you are not intentionally using remote fetch or auto-extraction, use `COPY`.

### 4. Control build context aggressively with `.dockerignore`
**Why**: Docker sends the build context to the builder. Large contexts slow builds, break cache efficiency, and leak files you never meant to ship.

```text
# .dockerignore
.git
node_modules
.venv
dist
coverage
*.env
```

**Warning**: `.dockerignore` is evaluated before the context is sent. Files excluded there are unavailable to `COPY` and `ADD`.

### 5. Order layers for cache reuse, not for aesthetics
**Why**: Dependency metadata changes less often than application code. Copying it first keeps expensive dependency-install steps cached.

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
```

**Warning**: `COPY . .` too early invalidates cache on every source change and makes rebuilds slow.

### 6. Understand shell form vs exec form
**Why**: `RUN`, `CMD`, and `ENTRYPOINT` support both forms, but they behave differently.

```dockerfile
# Exec form: no shell auto-start, better signal behavior
ENTRYPOINT ["/usr/local/bin/app"]

# Shell form: runs through the default shell
RUN echo "building in $PWD"
```

Use exec form when you need:

- predictable argument boundaries
- no implicit shell expansion
- cleaner signal handling for the main process

**Warning**: Exec form does not do shell variable expansion unless you explicitly invoke a shell such as `sh -c`.

### 7. Use exec-form `ENTRYPOINT` with exec-form `CMD`
**Why**: This is the cleanest pattern for a stable executable plus overridable default arguments.

```dockerfile
ENTRYPOINT ["gunicorn"]
CMD ["config.wsgi:application", "--bind=0.0.0.0:8000"]
```

Runtime behavior:

```console
$ docker run myapp                   # uses ENTRYPOINT + CMD
$ docker run myapp --workers 4      # appends args to ENTRYPOINT, replacing CMD
```

**Warning**: Shell-form `ENTRYPOINT` is brittle. It runs under `/bin/sh -c`, can swallow runtime args, and often breaks signal delivery to the real process.

### 8. Treat `CMD` as defaults, not as the image's identity
**Why**: `CMD` sets a default command or default args. Only the last `CMD` applies.

```dockerfile
CMD ["python", "-m", "app"]
```

**Warning**: `CMD` does nothing at build time. If the container should always execute a specific binary, that belongs in `ENTRYPOINT`.

### 9. Use `WORKDIR` explicitly
**Why**: `WORKDIR` sets the working directory for later `RUN`, `CMD`, `ENTRYPOINT`, `COPY`, and `ADD`, and Docker creates it automatically if missing.

```dockerfile
WORKDIR /app
COPY . .
```

**Warning**: Do not rely on whatever working directory a base image happened to define. Set it yourself.

### 10. Switch to a non-root runtime user intentionally
**Why**: `USER` sets the default user and group for the rest of the stage and for the runtime entrypoint.

```dockerfile
RUN useradd --create-home --uid 10001 appuser
USER appuser
```

**Warning**: If you switch to a non-root user too early, later package installs or file ownership changes will fail. Do privileged setup first, then switch.

### 11. Use `ARG` for build-time configuration and `ENV` for runtime defaults
**Why**: `ARG` does not persist into the final image the way `ENV` does.

```dockerfile
ARG APP_VERSION=dev
ENV APP_HOME=/app
```

**Warning**: Neither `ARG` nor `ENV` is a secret-management mechanism. Secrets belong in BuildKit secret or SSH mounts.

### 12. `EXPOSE` documents intended container ports; it does not publish them
**Why**: `EXPOSE` helps readers and tooling understand which port the image expects to listen on.

```dockerfile
EXPOSE 8000
```

**Warning**: Host publication still requires `docker run -p` or Compose `ports:`. `EXPOSE` alone changes no host networking.

### 13. Add a meaningful `HEALTHCHECK` when readiness matters
**Why**: Healthchecks give Docker a real signal beyond mere process existence.

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["curl", "-f", "http://localhost:8000/health"]
```

**Warning**: Only the last `HEALTHCHECK` applies. `HEALTHCHECK NONE` disables one inherited from the base image.

### 14. Keep the image contract small and explicit
**Why**: Dockerfiles are not shell scripts for an entire host. They define a container image contract: filesystem, default user, working directory, entrypoint, default args, exposed ports, and health.

Good image-contract fields to make explicit:

- base image
- `WORKDIR`
- copied artifacts
- runtime `USER`
- `ENTRYPOINT` and `CMD`
- `EXPOSE` if applicable
- `HEALTHCHECK` when the service supports one

### 15. Common high-value review checklist

Use this when reviewing a Dockerfile:

- Is the base image appropriate and pinned intentionally?
- Is `.dockerignore` trimming the build context?
- Are dependency-install layers copied before application code?
- Is `COPY` used instead of `ADD` unless extra behavior is needed?
- Does the final image exclude compilers and package caches?
- Does the container run as non-root when feasible?
- Are `ENTRYPOINT` and `CMD` using exec form?
- Does `EXPOSE` match actual listening ports?
- Is any secret being smuggled through `ARG` or `ENV`?

## When To Read Another File Too

- Build cache mounts, build secrets, SSH mounts, builders, or multi-platform output -> also read `references/buildkit-buildx.md`
- Compose overrides of `command`, `entrypoint`, ports, or healthchecks -> also read `references/compose-spec.md`
- Image pulling, tagging, digests, or registry publishing -> also read `references/registries-auth.md`
