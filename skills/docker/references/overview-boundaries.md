---
domain: Docker Boundaries
category: routing
priority: critical
description: "Use this file first when the failing Docker layer is unclear"
---

# Docker Boundaries Reference

Use this file to classify the task before reading deeper references. Most bad Docker answers come from solving the wrong layer.

## Fast Boundary Questions

Ask these in your own head before answering:

1. Is the failure in the Docker client, the Docker daemon, the image build, the running container, or the registry?
2. Am I talking to the local daemon or a remote daemon?
3. Is the user defining one image or an entire multi-container application?
4. Is this a filesystem problem, a network problem, or a credential problem?
5. Does the task belong to Docker at all, or is it really Kubernetes, cloud IAM, or generic Linux?

### 1. Separate the Docker client from the Docker daemon

**Why**: `docker` CLI commands can fail even when Docker itself is healthy if the client points at the wrong daemon or context.

```console
$ docker context ls
$ docker context inspect default
$ docker info
```

**Warning**: `DOCKER_CONTEXT` and `DOCKER_HOST` can redirect the CLI away from the default local daemon. Do not assume `docker` means `unix:///var/run/docker.sock`.

### 2. Local vs remote daemon changes filesystem behavior completely

**Why**: Bind mounts are created on the daemon host, not on the client machine that runs the CLI.

```text
Local CLI + local daemon  -> bind mounts see local host paths
Local CLI + remote daemon -> bind mounts see remote host paths
```

**Warning**: A path that exists on the laptop running `docker` is irrelevant if the active context targets a remote daemon.

### 3. Separate build-time from run-time

**Why**: Dockerfile and BuildKit explain how an image is created. Compose, networking, and storage explain how containers behave after startup.

```text
Build-time: Dockerfile, BuildKit, build args, build secrets, cache
Run-time: compose.yaml, ports, networks, volumes, restart, health
```

**Warning**: Fixing a runtime port or volume problem inside a Dockerfile is usually the wrong abstraction.

### 4. Separate a single image from a multi-container application

**Why**: A Dockerfile defines one image. Compose defines application topology, dependency ordering, shared networks, and shared volumes.

```text
Dockerfile -> one image contract
Compose    -> multiple services and their relationships
```

**Warning**: If the user asks for `compose.yaml`, do not answer with Dockerfile-only advice and pretend the job is done.

### 5. Separate daemon defaults from per-project configuration

**Why**: `daemon.json` sets host-wide defaults such as DNS, registry mirrors, default address pools, log driver defaults, or socket listeners. Compose and `docker run` set application-level behavior.

```text
Daemon scope   -> affects every workload on that daemon
Project scope  -> affects one app or one container invocation
```

**Warning**: Do not put per-app concerns like environment variables or host port choices into `daemon.json`.

### 6. Separate registry problems from image-definition problems

**Why**: Login, pull, push, tags, digests, mirrors, CA trust, and insecure registries belong to the distribution layer.

```text
Dockerfile concern -> what the image contains
Registry concern   -> how the image is named, fetched, trusted, or published
```

**Warning**: A `docker login` or TLS problem is not a Dockerfile bug.

### 7. Treat Docker daemon access as the security boundary

**Why**: Access to the Docker daemon socket or API is effectively host-level control.

```text
docker socket access ~= root-equivalent host power
```

**Warning**: Do not recommend unauthenticated TCP or broad socket exposure as a convenience shortcut.

### 8. Compose vs Dockerfile command ownership

**Why**: Compose `command` and `entrypoint` can override Dockerfile `CMD` and `ENTRYPOINT`, so the right fix may live in `compose.yaml` rather than the image.

**Warning**: If the user says "my container runs the wrong command under Compose", inspect the Compose service before rewriting the Dockerfile.

### 9. Route non-Docker tasks away early

**Why**: Docker questions often smuggle in other domains.

Use another source of truth when the task is really about:

- Kubernetes manifests, Helm, services, or ingress
- Cloud IAM for registry access
- Linux host firewalling unrelated to Docker configuration
- OCI runtime or kernel internals beyond Docker's surface

## Quick Routing Table

| If the user says... | Primary file |
|---|---|
| "Cannot connect to the Docker daemon" | `references/troubleshooting.md` |
| "Which daemon am I even talking to?" | `references/engine-config-contexts.md` |
| "Containerize this app" | `references/dockerfile-images.md` |
| "Use cache mounts and secrets during build" | `references/buildkit-buildx.md` |
| "Write or fix compose.yaml" | `references/compose-spec.md` |
| "Why can't my services resolve each other?" | `references/networking.md` |
| "This bind mount or volume is wrong" | `references/storage.md` |
| "Login or private registry access is failing" | `references/registries-auth.md` |
| "Review the security posture" | `references/security.md` |

## Default When Unsure

If the failure is vague, start with `references/troubleshooting.md` and then load the domain file that matches the first verified symptom.
