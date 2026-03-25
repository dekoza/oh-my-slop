---
domain: Docker Compose CLI
category: orchestration
priority: high
description: "Operational guidance for docker compose commands and workflow behavior"
---

# Docker Compose CLI Reference

Use this file when the task is about `docker compose` commands, project lifecycle, file merging, or command-line workflow.

### 1. Treat Compose as application lifecycle, not just YAML parsing
**Why**: `docker compose` defines and runs a multi-container application as a project: services, networks, volumes, and shared lifecycle.

```console
$ docker compose up --build
$ docker compose logs -f
$ docker compose down
```

**Warning**: If the user needs only a single image, Compose is probably the wrong layer. Route to Dockerfile or BuildKit guidance instead.

### 2. Know how Compose finds and merges files
**Why**: File selection changes the actual model being applied.

```console
$ docker compose -f compose.yaml -f compose.override.yaml up
```

Rules:

- if no `-f` is given, Compose searches for `compose.yaml` or `compose.yml`, and also supports `docker-compose.yaml` or `docker-compose.yml` for backward compatibility
- if both canonical and legacy names exist, Compose prefers `compose.yaml`
- by default, Compose reads `compose.yaml` and an optional `compose.override.yaml` together when both are present
- multiple files are merged in the order provided
- later files override or extend earlier ones
- paths in all files resolve relative to the first file unless `--project-directory` overrides the base

**Warning**: Misunderstanding merge order creates phantom bugs where the wrong service definition wins.

### 2.1 Distinguish merge from include
**Why**: Merge and include solve different composition problems.

- `-f` / multiple files -> build one Compose application model by merge order
- top-level `include:` -> import other Compose application models after local parsing and merging

```yaml
include:
  - ../commons/compose.yaml
```

Key `include` behavior:

- included files keep their own project-directory semantics for relative paths
- resource conflicts produce warnings instead of normal field-by-field merges
- `include` is recursive

**Warning**: Do not describe `include` as just another `-f` merge. It is a different composition boundary.

### 3. Use `docker compose config` before `up` when debugging configuration
**Why**: `docker compose config` renders the canonical model after merges, interpolation, and short-form expansion.

```console
$ docker compose config
$ docker compose config --format json
$ docker compose config -q
```

Useful sub-modes:

- `--services`
- `--networks`
- `--volumes`
- `--images`
- `--profiles`
- `--variables`

**Warning**: If you are reasoning about raw YAML instead of the rendered config, you may be debugging fiction.

### 4. Understand `up` recreation behavior
**Why**: `docker compose up` builds, creates, starts, attaches, and may recreate containers when the image or service config changed.

```console
$ docker compose up --build -d
```

Key flags:

- `--build` build images first
- `-d` detached mode
- `--force-recreate` recreate even without detected changes
- `--no-recreate` keep existing containers
- `--remove-orphans` remove containers for deleted services
- `--wait` wait for services to be running or healthy

**Warning**: Recreated containers preserve mounted volumes, but anonymous-volume behavior can still surprise people.

### 5. Project naming controls resource scoping
**Why**: Compose namespaces resources by project name.

Precedence order:

1. `-p` / `--project-name`
2. `COMPOSE_PROJECT_NAME`
3. top-level `name:` from config
4. basename of project directory containing the first Compose file
5. basename of current directory if no file is specified

```console
$ docker compose -p myproject ps
```

**Warning**: Resource names, orphan detection, and reused volumes all change when the project name changes.

### 6. Use `run` and `exec` for different jobs
**Why**: These commands solve different operational problems.

- `docker compose exec <service> ...` -> run a command in an existing running container
- `docker compose run <service> ...` -> start a one-off container for the service

**Warning**: Using `run` when you meant `exec` can create extra containers and bypass the state you expected.

### 7. Profiles are the right way to make optional services conditional
**Why**: Profiles let you include debug, admin, or local-only services without splitting everything into separate Compose files.

```console
$ docker compose --profile debug up
```

Or via environment:

```console
$ export COMPOSE_PROFILES=debug
```

**Warning**: Do not create unnecessary file sprawl when profiles express the optionality cleanly.

### 8. Use `--env-file` and environment variables intentionally
**Why**: Compose itself uses environment variables for file paths, project naming, profiles, and interpolation.

```console
$ docker compose --env-file .env.local up
```

Useful CLI-related environment variables:

- `COMPOSE_FILE`
- `COMPOSE_PROJECT_NAME`
- `COMPOSE_PROFILES`
- `COMPOSE_PARALLEL_LIMIT`
- `COMPOSE_IGNORE_ORPHANS`

**Warning**: Shell environment and Compose variable interpolation can change behavior without any YAML diff.

### 9. Dry run is valuable for change review
**Why**: `--dry-run` shows what Compose would do without mutating the stack.

```console
$ docker compose --dry-run up --build -d
```

**Warning**: Use this when you are unsure whether Compose will recreate containers, pull images, or build unexpectedly.

### 10. Use lifecycle commands deliberately

Common commands and their role:

- `up` -> create and start
- `down` -> stop and remove containers and networks for the project
- `start` / `stop` -> start or stop existing service containers
- `restart` -> restart service containers
- `logs` -> aggregate service logs
- `ps` -> list project containers
- `pull` / `push` -> image distribution
- `images` / `volumes` -> inspect related resources

**Warning**: `down` is not the same as `stop`. `down` removes containers and networks; `stop` leaves them in place.

### 11. Control noisy stacks with attach behavior
**Why**: Attached `up` streams logs from containers and can flood the terminal.

Useful flags:

- `--attach <service>`
- `--no-attach <service>`
- `--attach-dependencies`
- `--timestamps`
- `--no-log-prefix`

**Warning**: If logs are chaotic, fix attach strategy before assuming the application itself is noisy.

### 12. Use `--wait` for automation that needs readiness, not just startup
**Why**: `docker compose up --wait` waits for services to be running or healthy and implies detached mode.

```console
$ docker compose up --wait --wait-timeout 60
```

**Warning**: `--wait` is only as meaningful as the healthchecks backing it.

## Operational Review Checklist

- Did the correct Compose files get merged?
- Did `docker compose config` confirm the expected model?
- Is the project name stable and intentional?
- Are profiles or env files changing behavior unexpectedly?
- Is the user using `run` when they meant `exec`?
- Does `up` need `--build`, `--wait`, or `--remove-orphans`?

## When To Read Another File Too

- Service field semantics, dependencies, healthchecks, env precedence, networks, or volumes -> also read `references/compose-spec.md`
- Daemon or context targeting problems -> also read `references/engine-config-contexts.md`
- Networking behavior after startup -> also read `references/networking.md`
- Persistence or mount issues -> also read `references/storage.md`
