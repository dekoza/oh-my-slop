---
domain: reference-index
category: documentation
priority: high
description: "Index and routing guide for the Docker reference skill"
---

# Docker Reference Index

Use this index to pick the smallest Docker reference file that matches the task. Start with one reference, add a second only when the task clearly crosses domains, and decide the boundary first: client vs daemon, build vs runtime, local vs remote daemon.

## Route Elsewhere

- Kubernetes manifests, Helm charts, or cluster scheduling -> use Kubernetes or Helm docs
- Cloud-vendor-specific registry IAM and auth flows -> use vendor docs after grounding the Docker side here
- Desktop-only GUI or subscription features -> use Docker Desktop docs if the issue is not about core Docker behavior
- Generic OCI runtime internals -> use lower-level OCI, containerd, or kernel docs

## Reference Guides

| Domain | File | Use For |
|---|---|---|
| Boundaries | `references/overview-boundaries.md` | Classifying the task correctly before solving it |
| Engine config and contexts | `references/engine-config-contexts.md` | `dockerd`, `daemon.json`, contexts, sockets, SSH and TLS, proxies, mirrors, validation |
| Dockerfile and images | `references/dockerfile-images.md` | Dockerfile instructions, layering, multi-stage builds, `.dockerignore`, image contracts |
| BuildKit and Buildx | `references/buildkit-buildx.md` | Modern build features, cache mounts, secrets, builders, multi-platform builds |
| Compose CLI | `references/compose-cli.md` | `docker compose` lifecycle, file merging, project naming, profiles, dry runs |
| Compose file spec | `references/compose-spec.md` | Services, env, healthchecks, `depends_on`, networks, volumes, build and image wiring |
| Networking | `references/networking.md` | Bridge networks, user-defined networks, DNS, aliases, published ports, host access |
| Storage | `references/storage.md` | Bind mounts, volumes, tmpfs, lifecycle, permissions, backup and restore |
| Registries and auth | `references/registries-auth.md` | Image names, tags vs digests, `docker login`, credential stores, private registries |
| Security | `references/security.md` | Daemon exposure, rootless, namespaces, capabilities, seccomp, AppArmor, SELinux, TLS |
| Troubleshooting | `references/troubleshooting.md` | Symptom-driven diagnosis across daemon, build, networking, storage, auth, and config |

## Common Task Routing

1. Identify the failing boundary.
2. Open the single best-matching reference file.
3. Add a second file only when the task clearly crosses domains.
4. State the verification command or behavior that proves the fix.

- `docker build` or Dockerfile review -> `references/dockerfile-images.md`
- Build secrets, cache, builders, multi-platform output -> `references/buildkit-buildx.md`
- `compose.yaml` design or `docker compose` command behavior -> `references/compose-cli.md` or `references/compose-spec.md`
- `dockerd`, `daemon.json`, contexts, SSH, TLS, or rootless daemon targeting -> `references/engine-config-contexts.md`
- Published ports, DNS, aliases, host access, or multiple networks -> `references/networking.md`
- Bind mounts, volumes, tmpfs, or persistence -> `references/storage.md`
- Login, pull, push, tagging, digests, or insecure registry confusion -> `references/registries-auth.md`
- Hardening or privilege review -> `references/security.md`
- Vague or broken Docker behavior -> `references/troubleshooting.md`
- Unsure which part of Docker owns the problem -> `references/overview-boundaries.md`

- `Cannot connect to the Docker daemon` -> `references/troubleshooting.md` then `references/engine-config-contexts.md`
- Build can reach the internet locally but not in CI -> `references/buildkit-buildx.md` and `references/engine-config-contexts.md`
- Compose service starts before its database is ready -> `references/compose-spec.md` and `references/troubleshooting.md`
- Bind mount path works locally but fails against remote Docker host -> `references/storage.md` and `references/overview-boundaries.md`

## Suggested Reading Order

1. Start with this index when the domain is not obvious.
2. If the boundary is unclear, read `references/overview-boundaries.md` next.
3. Open the single most relevant domain file.
4. Open additional files only if the task spans multiple domains.
5. When answering, name the references used and give a concrete verification step.
