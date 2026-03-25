---
name: docker
description: "Use this skill for Docker-specific work: containerizing an app, writing or fixing a `Dockerfile` or `compose.yaml`, troubleshooting `docker build` or `docker compose`, and resolving problems at the Docker boundary between client, daemon, build context, image, container runtime, network, storage, or registry. Use it when the user is confused about local vs remote daemons, contexts, Docker Desktop VM behavior, bind mounts, DNS or hostname resolution inside containers, build context bloat, `.dockerignore`, secret handling during builds, image publishing, or daemon connectivity and security. Reach for this skill when the task is to explain why Docker behaves differently across machines or environments, or to produce concrete Docker config and commands. Do not use it for Kubernetes, Helm, or non-Docker container runtimes unless the question is explicitly about Docker compatibility or migration."
---

# Docker Reference

Use this skill for core Docker implementation, configuration, and troubleshooting. It covers product boundaries, daemon and context configuration, Dockerfile authoring, BuildKit and Buildx, Compose CLI and file semantics, networking, storage, registries, security, and troubleshooting. Read only the reference files needed for the task.

## Quick Start

1. Identify the boundary first: client vs daemon, build vs runtime, local vs remote daemon, Dockerfile vs Compose.
2. Decide whether the task has a real local file to inspect or only a described scenario.
3. Open the single best-matching file from `references/`.
4. Add a second reference only when the task clearly crosses domains.
5. Verify whether the problem is configuration, build graph, runtime networking or storage, registry auth, or security.
6. State which references you used and what commands or checks should verify the answer.

## When Not To Use This Skill

- **Kubernetes, Helm, or cluster schedulers** - Do not use this skill as the source of truth for Kubernetes manifests, Helm charts, or higher-level orchestration.
- **Cloud-vendor registry specifics** - Use vendor docs for ECR, GCR, GAR, ACR, or IAM-specific auth flows after grounding the Docker side here.
- **Desktop-only GUI workflows** - This skill mentions Docker Desktop only when it changes core behavior. It is not a full Desktop manual.
- **Generic OCI internals** - For runtime internals that are not Docker-specific, route to lower-level OCI, containerd, or kernel docs.

## Critical Rules

1. **Boundary first** - Decide whether the issue is client, daemon, build, runtime, registry, or Compose before suggesting commands.
2. **Context and host checks first** - For daemon connectivity, inspect `docker context`, `DOCKER_CONTEXT`, and `DOCKER_HOST` before deeper debugging.
3. **`.dockerignore` is mandatory hygiene** - Large or accidental build contexts cause slow builds, broken caches, and secret leaks.
4. **Secrets do not belong in `ARG` or `ENV`** - Use BuildKit `--secret` or `--ssh` with `RUN --mount=type=secret|ssh`.
5. **Prefer multi-stage images** - Keep build dependencies out of the runtime image and run as a non-root user when feasible.
6. **Mount types are not interchangeable** - Bind mounts couple you to the daemon host, volumes are Docker-managed persistence, tmpfs is ephemeral Linux memory storage.
7. **Socket or TCP daemon access is privileged** - Treat Docker daemon access as root-equivalent. Prefer SSH contexts or TLS, never casual unauthenticated TCP.
8. **Compose readiness is explicit** - `depends_on` short syntax only starts dependencies first; use healthchecks plus `condition: service_healthy` when readiness matters.
9. **Tags are mutable; digests are immutable** - Use tags for convenience, digests for reproducibility and controlled rollouts.
10. **Troubleshooting is symptom-driven** - Start with the smallest failing boundary: daemon reachability, config conflicts, build context, network and DNS, mounts, registry auth, or security.
11. **Do not block on a missing sample file when the task is hypothetical** - If the user describes a broken Dockerfile, Compose file, or command but did not attach the file, answer from the described facts, state the assumptions, and provide a corrected example.
12. **Do not go file hunting for hypothetical review tasks** - At most, check the current task directory once for an obvious local file. If it is not there, stop searching. Do not widen the search to `$HOME`, parent directories, `/tmp`, or broad filesystem globs.

## Reference Map

Use `references/REFERENCE.md` as the canonical cross-file index. Do not maintain a second routing table in parallel here.

## Task Routing

1. Choose the primary reference from the routes below.
2. Add one secondary reference only when the task clearly crosses domains.
3. Keep the answer grounded in the references actually used.
4. Call out the verification command, expected behavior, or highest-risk misconfiguration.

- **Containerize an app, review a Dockerfile, or explain image structure** -> `references/dockerfile-images.md`
- **Optimize builds, multi-platform output, cache, secrets, or builders** -> `references/buildkit-buildx.md`
- **Write or debug `compose.yaml`, service wiring, or local stack lifecycle** -> `references/compose-cli.md` and/or `references/compose-spec.md`
- **Fix daemon connectivity, remote access, contexts, or `daemon.json`** -> `references/engine-config-contexts.md`
- **Fix DNS, published ports, host access, or network topology** -> `references/networking.md`
- **Fix bind mounts, volumes, tmpfs, or data persistence** -> `references/storage.md`
- **Authenticate to registries, tag, pull, or push images, or reason about digests** -> `references/registries-auth.md`
- **Harden Docker usage or review security posture** -> `references/security.md`
- **Diagnose a broken Docker setup or vague failure** -> `references/troubleshooting.md`
- **Clarify whether the problem belongs to Docker at all** -> `references/overview-boundaries.md`

- **`Cannot connect to the Docker daemon`** -> `references/troubleshooting.md` + `references/engine-config-contexts.md`
- **Compose stack starts but the app still fails because the database is not ready** -> `references/compose-spec.md` + `references/troubleshooting.md`
- **Bind mount behaves differently on CI or a remote Docker host** -> `references/storage.md` + `references/overview-boundaries.md`
- **Private dependency access during `docker buildx build`** -> `references/buildkit-buildx.md` + `references/security.md`
- **Need reproducible image rollout** -> `references/dockerfile-images.md` + `references/registries-auth.md`

## Output Expectations

Use this answer shape unless the user explicitly asks for a different format:

- `Primary boundary:` one of client, daemon, build, runtime, registry, or Compose.
- `References used:` exact `references/*.md` files you relied on.
- `What is happening:` shortest accurate explanation of the failure, design issue, or tradeoff.
- `Recommended fix:` commands, config, file content, or decision.
- `Verification:` the minimum command or check that proves the fix.
- `Highest-risk footgun:` the one mistake most likely to waste time or create an unsafe setup.

Additional expectations:

- If the task is a review or rewrite and no real file was provided, say that you are working from the described scenario, then still provide the corrected example.
- For hypothetical review tasks, do at most one narrow file check in the current task directory. If nothing is there, stop searching immediately and continue from the prompt itself.
- Never broaden a hypothetical file search into `$HOME`, parent directories, or other external paths just because the first local check found nothing.
- For Dockerfile or Compose authoring tasks, prefer showing a concrete file body rather than only describing what should exist.
- For troubleshooting tasks, keep the checklist ordered from boundary checks to deeper daemon or runtime checks.
- Say explicitly when behavior changes between local and remote daemons.

## Hypothetical Review Mode

Use this mode when the user says things like "review this Dockerfile" or "fix this compose file" but only describes the problem in prose.

1. Treat the prose description as the source of truth.
2. Optionally do one narrow local file check in the current task directory if a real file may exist there.
3. If no file is present, do not ask for the file unless the exact contents materially change the answer.
4. Explicitly say you are working from the described scenario.
5. Produce the corrected Dockerfile, Compose file, or command anyway.
6. Include the verification step and the highest-risk footgun as usual.

## Content Ownership

This skill owns core Docker usage and troubleshooting: boundaries, daemon configuration, contexts, Dockerfiles, BuildKit and Buildx, Compose, networking, storage, registries, security, and operational diagnosis.

Kubernetes, Helm, Desktop UI walkthroughs, and cloud-vendor-specific registry IAM flows are outside the core scope. Use dedicated docs or skills for those.
