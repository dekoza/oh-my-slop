---
domain: Docker Compose Specification
category: orchestration
priority: high
description: "High-signal service, network, volume, and dependency semantics for compose.yaml"
---

# Docker Compose Specification Reference

Use this file when the task is about the contents of `compose.yaml`, not just how to invoke the CLI.

### 1. A Compose file defines services first, then shared resources
**Why**: The core model is `services`, optionally backed by top-level `networks`, `volumes`, `configs`, and `secrets`.

```yaml
services:
  web:
    image: nginx:latest
  db:
    image: postgres:18

volumes:
  db-data:
```

**Warning**: Do not confuse a service definition with a single container instance. A service is an abstract template from which containers are created.

### 1.1 Use top-level `name` intentionally and ignore top-level `version`
**Why**: `name` is a real project-scoping input. `version` is only retained for backward compatibility and is obsolete.

```yaml
name: myapp

services:
  foo:
    image: busybox
    command: echo "${COMPOSE_PROJECT_NAME}"
```

Semantics:

- `name` provides the project name if no stronger override is supplied by the CLI or environment
- `COMPOSE_PROJECT_NAME` becomes available for interpolation
- `version` is informative only and Compose always validates against the latest schema it supports

**Warning**: If a review argues about Compose schema version numbers in modern Docker Compose, it is already anchored to stale mental models.

### 2. Distinguish `image` from `build`
**Why**: `image` answers "what image should run?" while `build` answers "how should Compose create the image from source?"

```yaml
services:
  api:
    build:
      context: ./api
    image: registry.example.com/myapp/api:dev
```

Rules:

- `image` may be omitted if `build` is present
- if an image is missing locally, Compose attempts to pull it by default
- build support is optional in the Compose specification, but Docker Compose implements it

**Warning**: If the problem is image publication or naming, route to registry guidance. If the problem is build graph or secrets, route to BuildKit guidance.

### 3. `command` overrides Dockerfile `CMD`
**Why**: Compose lets you replace the default command without rebuilding the image.

```yaml
services:
  web:
    image: myapp
    command: ["gunicorn", "config.wsgi:application", "--bind=0.0.0.0:8000"]
```

Semantics:

- `null` -> use the image default
- `[]` or `''` -> clear the image default

**Warning**: Compose `command` does not implicitly run through the image shell. If you need shell expansion, invoke a shell explicitly.

### 4. `entrypoint` overrides Dockerfile `ENTRYPOINT`
**Why**: This changes the executable itself, not just its default args.

```yaml
services:
  migrate:
    image: myapp
    entrypoint: ["python", "manage.py"]
    command: ["migrate"]
```

Semantics:

- non-null `entrypoint` causes Compose to ignore the image's default `CMD`
- `null` -> use the image default
- `[]` or `''` -> clear the image default

**Warning**: If you override `entrypoint`, verify that you did not accidentally discard required default args.

### 5. `environment` beats `env_file`
**Why**: Compose resolves both, but explicit service-level environment wins.

```yaml
services:
  web:
    env_file:
      - .env
      - .env.local
    environment:
      DEBUG: "true"
```

Rules:

- later `env_file` entries override earlier ones
- `environment` overrides `env_file`, even when the override is empty or unresolved
- `env_file` paths resolve relative to the Compose file's parent directory

**Warning**: Absolute `env_file` paths reduce portability and Compose warns about them.

### 6. `depends_on` short syntax is only startup ordering
**Why**: It starts dependency services first, but it does not wait for readiness or health.

```yaml
services:
  web:
    depends_on:
      - db
      - redis
```

**Warning**: If the app needs a ready database, short-form `depends_on` is insufficient.

### 7. Use long-form `depends_on` for readiness-aware dependencies
**Why**: Long syntax adds dependency conditions and restart behavior.

```yaml
services:
  web:
    depends_on:
      db:
        condition: service_healthy
        restart: true
      redis:
        condition: service_started
```

Available conditions:

- `service_started`
- `service_healthy`
- `service_completed_successfully`

**Warning**: `service_healthy` is meaningless without a real healthcheck on the dependency.

### 8. `healthcheck` in Compose can override the image healthcheck
**Why**: Healthchecks belong close to the service definition when the deployment context changes the right readiness probe.

```yaml
services:
  web:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

Forms:

- list beginning with `CMD`, `CMD-SHELL`, or `NONE`
- string form, equivalent to `CMD-SHELL`
- `disable: true` to disable an image-defined healthcheck

**Warning**: A container can be "running" while still failing healthchecks. Model both concepts separately.

### 9. Avoid `container_name` unless you truly need it
**Why**: Explicit container names fight Compose's scaling and project scoping model.

```yaml
services:
  web:
    container_name: my-web
```

**Warning**: A service with `container_name` cannot scale beyond one container. Compose errors if you try.

### 10. `network_mode` and `networks` are mutually exclusive
**Why**: `network_mode` takes direct control of the container's network namespace, so Compose rejects configs that also specify `networks`.

```yaml
services:
  job:
    network_mode: none
```

Available modes include:

- `none`
- `host`
- `service:{name}`
- `container:{name}`

**Warning**: If you set `network_mode: none`, the service is attached to no network at all. That is different from simply omitting `ports`.

### 11. The default network is implicit unless you opt out
**Why**: Services without explicit network declarations are connected to the implicit `default` network.

```yaml
services:
  app:
    image: foo
```

Equivalent to:

```yaml
services:
  app:
    image: foo
    networks:
      default: {}
```

**Warning**: If you expected network isolation but did not define networks, you probably created more connectivity than intended.

### 12. Service discovery is name-based on shared networks
**Why**: On a shared Compose network, services can reach each other by service name.

```yaml
services:
  frontend:
    image: example/web
  backend:
    image: example/api
```

On the default network, `frontend` can reach `backend` by the hostname `backend`.

**Warning**: If two services are not on a shared network, Compose names do not magically bridge that gap.

### 13. Use network aliases for alternate names, but keep them unambiguous
**Why**: Aliases are network-scoped and can make topology clearer.

```yaml
services:
  backend:
    image: example/api
    networks:
      back-tier:
        aliases:
          - database
```

**Warning**: If multiple containers or services share the same alias, resolution is ambiguous.

### 14. Static IPs require matching IPAM config
**Why**: Compose only accepts `ipv4_address` or `ipv6_address` when the target network declares matching subnets.

```yaml
services:
  app:
    image: busybox
    networks:
      app-net:
        ipv4_address: 172.16.238.10

networks:
  app-net:
    ipam:
      config:
        - subnet: 172.16.238.0/24
```

**Warning**: Static IPs increase coupling and should be rare in ordinary Compose setups.

### 15. Named volumes belong in top-level `volumes`
**Why**: This makes persistence explicit, reusable, and inspectable.

```yaml
services:
  db:
    image: postgres:18
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

**Warning**: Bind mounts and named volumes are different storage models. Do not blur them in reviews.

### 16. Use top-level `configs` for non-secret mounted configuration
**Why**: Configs let services consume configuration as files without rebuilding the image.

```yaml
services:
  web:
    image: nginx
    configs:
      - http_config

configs:
  http_config:
    file: ./httpd.conf
```

Top-level config sources include:

- `file`
- `environment`
- `content`
- `external`

**Warning**: If `external: true` is set, attributes other than `name` become invalid noise.

### 17. Use top-level `secrets` for sensitive service-mounted data
**Why**: Secrets are a special flavor of config with stronger intent and handling expectations.

```yaml
services:
  web:
    image: nginx
    secrets:
      - server-certificate

secrets:
  server-certificate:
    file: ./server.cert
```

Top-level secret sources include:

- `file`
- `environment`

**Warning**: If sensitive material is sitting in `environment:` for the running service when a mounted secret would do, call that out.

### 18. Merge rules are not uniform across all fields
**Why**: Compose merges mappings, sequences, shell commands, and unique resources differently.

High-value merge facts:

- maps merge key-by-key
- ordinary sequences append
- `command`, `entrypoint`, and `healthcheck.test` are replaced by the latest file, not appended
- `ports`, `volumes`, `configs`, and `secrets` obey uniqueness rules instead of naive appends
- `!reset` can clear inherited values
- `!override` can replace them wholesale

**Warning**: If an override file changes `ports` or `volumes`, do not assume append semantics without checking uniqueness rules.

### 19. `include` imports other Compose application models after local merge
**Why**: `include` is for modularity across teams or domains, not just local override stacking.

```yaml
include:
  - ../commons/compose.yaml

services:
  app:
    depends_on:
      - shared-db
```

Semantics:

- included files are loaded with their own project-directory defaults
- included resources are copied into the current model
- conflicts warn and do not follow normal merge behavior
- `include` applies recursively

**Warning**: If the composition problem is modular reuse rather than local override, `include` may be cleaner than piling on more `-f` files.

## High-Value Compose Review Checklist

- Are `image` and `build` being used intentionally?
- Does `command` or `entrypoint` accidentally override required image defaults?
- Is environment precedence clear between `env_file` and `environment`?
- Are dependencies modeling startup only or real readiness?
- Are healthchecks meaningful?
- Is `container_name` blocking scaling?
- Are services on the right networks?
- Are static IPs really necessary?

## When To Read Another File Too

- Command workflow, file merging, or project naming -> also read `references/compose-cli.md`
- Network behavior and published port semantics -> also read `references/networking.md`
- Mount and persistence semantics -> also read `references/storage.md`
- Troubleshooting ambiguous startup behavior -> also read `references/troubleshooting.md`
