---
domain: Docker Troubleshooting
category: operations
priority: critical
description: "Symptom-driven diagnosis across daemon, build, network, storage, auth, and config failures"
---

# Docker Troubleshooting Reference

Use this file when Docker is broken, vague, or behaving in a way the user cannot classify confidently.

## Diagnostic Order

Work from the outermost boundary inward:

1. Is the CLI talking to the expected daemon?
2. Is the daemon running and reachable?
3. Is `daemon.json` valid and non-conflicting?
4. Is the problem build-time, runtime, networking, storage, or registry auth?
5. What is the smallest reproducible failing command?

### 1. `Cannot connect to the Docker daemon`
**Why**: This usually means one of three things: the daemon is down, the client points at the wrong host, or the socket path is wrong.

Start here:

```console
$ docker context ls
$ env | grep '^DOCKER_'
$ docker info
```

Then verify daemon status on the host:

```console
$ systemctl status docker
$ systemctl is-active docker
```

If using rootless:

```console
$ systemctl --user status docker
```

**Warning**: Do not assume the local default socket. `DOCKER_CONTEXT`, `DOCKER_HOST`, and rootless sockets often explain the failure immediately.

### 2. `daemon.json` and startup flags conflict
**Why**: Docker refuses to start if the same option is specified both in config and on the command line or service unit.

Typical error:

```text
unable to configure the Docker daemon with file /etc/docker/daemon.json:
the following directives are specified both as a flag and in the configuration file
```

Validate first:

```console
$ dockerd --validate --config-file=/etc/docker/daemon.json
```

On `systemd` hosts, `hosts` conflicts are especially common because `-H` may already be baked into the unit.

**Warning**: Restarting repeatedly without validating the config is just chaos with extra steps.

### 3. Build is slow, huge, or mysteriously missing files
**Why**: The build context is often wrong.

Check for:

- missing or weak `.dockerignore`
- `COPY . .` too early
- wrong build context path
- remote builder fetching context from a different host

High-value fixes:

- trim `.dockerignore`
- copy dependency metadata before source
- use named contexts intentionally
- use `--progress=plain`

**Warning**: If files are not in the build context, no amount of Dockerfile cleverness can copy them in.

### 4. Private dependency access fails during build
**Why**: The builder may lack registry, Git, SSH, or secret access.

Check whether the failure is:

- private base image pull -> registry auth
- private Git context -> `--ssh` or `GIT_AUTH_TOKEN`
- private artifact download in `RUN` -> BuildKit secret mount

```console
$ docker buildx build --ssh default .
$ docker buildx build --secret id=GIT_AUTH_TOKEN ...
```

**Warning**: If the build uses `ARG TOKEN=...`, the secret handling is already wrong.

### 5. Compose starts services, but the app still fails on startup
**Why**: Startup order is not readiness.

Symptoms:

- app container starts before db is ready
- `depends_on` exists but app still crashes

Fix pattern:

```yaml
services:
  web:
    depends_on:
      db:
        condition: service_healthy
  db:
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
```

Also consider:

```console
$ docker compose up --wait
```

**Warning**: Short-form `depends_on` never meant "wait until ready".

### 6. Service names do not resolve or cross-service networking fails
**Why**: Containers may not share a network, or DNS may be broken.

Checks:

```console
$ docker network ls
$ docker network inspect <network>
$ docker compose config
```

Look for:

- services on different networks
- accidental `network_mode`
- internal network where egress was expected
- DNS resolver fallback due to host `dnsmasq` or loopback resolver

**Warning**: If the containers are not on a shared network, Docker DNS is not the culprit. Topology is.

### 7. Hostname resolution works on the host but fails in containers
**Why**: Host loopback resolvers such as `dnsmasq` can appear in `/etc/resolv.conf`, but containers cannot use the host's loopback addresses the same way.

Common warning:

```text
WARNING: Local (127.0.0.1) DNS resolver found in resolv.conf and containers can't use it.
```

Typical responses:

- set daemon `dns` explicitly
- disable or reconfigure the host-side loopback resolver

**Warning**: If the container needs internal corporate DNS, Docker's fallback to public resolvers will not be enough.

### 8. Networks disappear or behave inconsistently on Linux hosts
**Why**: Network managers sometimes meddle with Docker interfaces.

Suspects include:

- `NetworkManager`
- `systemd-networkd`
- Netplan
- other host network-management tools

Response pattern:

- mark Docker interfaces as unmanaged
- restart the host network manager
- restart Docker

**Warning**: If `docker0` or custom bridge interfaces keep vanishing, suspect host network management before suspecting Docker itself.

### 9. Bind mount works locally but fails in CI or against remote Docker
**Why**: Bind mounts resolve on the daemon host and require the source path to exist there.

Checks:

- active context
- remote vs local daemon
- source-path existence on daemon host
- whether `--mount` vs `-v` changed behavior

**Warning**: This is not a "Docker forgot my file" problem. It is usually a daemon-host path problem.

### 10. Container sees the wrong files after mounting
**Why**: The mount obscured whatever was already in that container path.

Common scenarios:

- bind-mount over `/app` hides the image's packaged app files
- volume mount over seeded content copies or obscures data depending on volume state

**Warning**: Recreating the container without the mount is often the only honest way to verify what was hidden.

### 11. Volume cleanup or container removal fails with "device or resource busy"
**Why**: Another process may still hold a handle under Docker's storage tree, especially if some utility mounted `/var/lib/docker`.

Useful check:

```console
$ sudo lsof /var/lib/docker/containers/<id>/shm
```

**Warning**: Bind-mounting `/var/lib/docker` into containers is a known footgun.

### 12. Registry pull or push fails
**Why**: The usual root causes are wrong image name, wrong registry host, missing login, CA trust failure, or insecure-registry mismatch.

Check:

```console
$ docker login registry.example.com
$ docker image pull registry.example.com/team/app:1.0
```

Inspect for:

- forgot to include registry hostname in the tag
- self-signed or private CA not installed
- registry requires insecure allowlist but daemon treats it as secure

**Warning**: If the registry hostname is wrong, every downstream auth or TLS diagnosis is noise.

### 13. Buildx output "succeeded" but the image is not where expected
**Why**: Output mode determines result placement.

Common mismatch:

- expected local image, but forgot `--load`
- expected registry image, but forgot `--push`
- expected multi-platform manifest locally, but local image store cannot load it

**Warning**: Successful build execution is not the same thing as successful image export.

### 14. Exit codes from `docker run` tell you where the failure lives
**Why**: Docker differentiates between CLI or daemon failure and in-container command failure.

- `125` -> Docker itself failed to run the container
- `126` -> command exists but cannot be invoked
- `127` -> command not found
- anything else -> actual container command exit code

**Warning**: If the exit code is `125`, stop debugging app code.

### 15. Disk pressure and cache sprawl are first-class Docker failures
**Why**: Image layers, stopped containers, local volumes, and BuildKit cache all consume daemon storage and cause slow builds, failed pulls, and host instability.

Start with:

```console
$ docker system df
$ docker system df -v
$ docker buildx prune --verbose
```

Look for:

- large reclaimable image sets
- abandoned build cache on the active builder
- oversized local volumes
- runaway `data-root` growth on the daemon host

Practical responses:

- prune build cache intentionally
- remove obsolete images and stopped containers
- inspect large volumes before deleting anything
- move or resize daemon storage only as a host-level change

**Warning**: Do not treat disk pressure as a random host problem. Docker and BuildKit have their own storage behaviors and cleanup tools.

## Always Useful Commands

```console
$ docker context ls
$ docker info
$ docker compose config
$ dockerd --validate --config-file=/etc/docker/daemon.json
$ docker network inspect <network>
$ docker inspect <container>
$ docker system df -v
$ docker buildx ls
$ docker buildx inspect --bootstrap
```

## When To Read Another File Too

- Daemon sockets, config, or contexts -> `references/engine-config-contexts.md`
- Build graph, cache, or secrets -> `references/buildkit-buildx.md`
- Compose startup or service modeling -> `references/compose-cli.md` and `references/compose-spec.md`
- DNS, ports, or network topology -> `references/networking.md`
- Mounts or persistence -> `references/storage.md`
- Registry auth and naming -> `references/registries-auth.md`
