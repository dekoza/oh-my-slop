---
domain: BuildKit and Buildx
category: build
priority: high
description: "Modern Docker build behavior, builders, cache, secrets, and multi-platform guidance"
---

# BuildKit and Buildx Reference

Use this file when the task is about modern Docker builds rather than generic Dockerfile syntax.

### 1. Assume BuildKit is the modern default
**Why**: BuildKit is the default builder on Docker Desktop and Docker Engine 23.0+, and `buildx` always uses BuildKit.

```console
$ DOCKER_BUILDKIT=1 docker build .
$ docker buildx build .
```

**Warning**: Features such as `RUN --mount`, advanced caching, multi-platform builds, and builder instances are BuildKit territory.

### 2. Use BuildKit for performance, not just fancy syntax
**Why**: BuildKit skips unused stages, parallelizes independent work, transfers only needed context, and tracks cache more precisely than the legacy builder.

**Warning**: If a build feels slow or unpredictable, the fix may be build graph or context design, not raw CPU.

### 3. Use `RUN --mount=type=cache` for package-manager and compiler caches
**Why**: Cache mounts persist build caches between invocations without baking them into the image.

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt
```

```dockerfile
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y curl
```

**Warning**: Cache mounts improve speed only. The build must still be correct if the cache is empty or pruned.

### 4. Use build secrets instead of `ARG` or `ENV`
**Why**: Build arguments and environment variables persist too easily. Build secrets are exposed only for the relevant build instruction.

```console
$ docker buildx build --secret id=aws,src=$HOME/.aws/credentials .
```

```dockerfile
RUN --mount=type=secret,id=aws,target=/root/.aws/credentials \
    aws s3 cp s3://private-bucket/artifact.tar.gz /tmp/artifact.tar.gz
```

**Warning**: The Docker docs are explicit: do not use `--build-arg` for secrets.

### 5. Use SSH mounts for private Git or SSH-based dependencies
**Why**: SSH mounts forward agent sockets or keys into the build without embedding them in the image.

```console
$ docker buildx build --ssh default=$SSH_AUTH_SOCK .
```

```dockerfile
RUN --mount=type=ssh git clone git@github.com:org/private-repo.git /src/private
```

**Warning**: SSH mounts solve authentication for build steps. They are different from runtime SSH access and different from registry login.

### 6. Distinguish build contexts from copied files
**Why**: The build context is the universe of files the builder can access. You can add named contexts to separate local files, images, or remote repositories.

```console
$ docker buildx build --build-context docs=./docs .
```

```dockerfile
COPY . /app/src
RUN --mount=from=docs,target=/app/docs make manpages
```

**Warning**: Remote tarballs and Git contexts are fetched by the builder host. With a remote builder, that may not be the machine invoking the command.

### 7. Use `buildx` builders intentionally
**Why**: `buildx` adds named builder instances with their own drivers and supported platforms.

Useful commands:

```console
$ docker buildx ls
$ docker buildx create --name mybuilder --use
$ docker buildx inspect --bootstrap
$ docker buildx rm mybuilder
```

**Warning**: Different builders may support different platforms, outputs, and entitlements. Do not assume every builder can run every `RUN` step for every architecture.

### 7.1 Builder drivers have materially different behavior
**Why**: The active driver changes what BuildKit can do and where the result ends up.

Core drivers:

- `docker` -> bundled into the Docker daemon, simplest path, automatically loads images, limited advanced features
- `docker-container` -> dedicated BuildKit container, better for advanced outputs and multi-platform work
- `remote` -> externally managed BuildKit daemon
- `kubernetes` -> BuildKit pods in a Kubernetes cluster

Important consequence:

- non-`docker` drivers do not automatically load images into the local image store unless `--load` or equivalent output is used

**Warning**: If the builder driver changed, the same command may produce a valid build with no locally visible image.

### 8. Multi-platform builds need a builder strategy
**Why**: `--platform` can build one or more platforms, but the builder must support them.

```console
$ docker buildx build --platform=linux/amd64,linux/arm64 --push -t registry.example.com/app:1.0 .
```

Inside the Dockerfile, automatic platform args exist:

```dockerfile
ARG TARGETPLATFORM
ARG BUILDPLATFORM
```

**Warning**: The default Docker image store does not load multi-platform manifest lists locally. For multi-platform output, push to a registry or use an image store that supports it.

### 9. Know what `--load`, `--push`, and `--output` actually do
**Why**: Build success is not the same as result availability.

- `--load` -> loads a single-platform result into local Docker images
- `--push` -> pushes result to a registry
- `--output=type=local|tar|docker|image|registry|oci` -> controls explicit export behavior

```console
$ docker buildx build --load -t myapp:dev .
$ docker buildx build --push -t registry.example.com/myapp:1.0 .
```

**Warning**: `--load` is not the right tool for multi-platform manifest output.

### 9.1 Attestations are part of modern build output
**Why**: BuildKit can attach provenance and SBOM metadata to build results for supply-chain review.

```console
$ docker buildx build --sbom=true --provenance=mode=max --push -t registry.example.com/myapp:1.0 .
```

Key facts:

- minimal provenance is added by default unless disabled
- `--sbom` enables SBOM attestations
- `--provenance` customizes or disables provenance
- attestations persist most naturally with image outputs pushed to registries

**Warning**: If the output is only a local tarball or directory export, attestation handling differs and may not land where image-index metadata normally would.

### 10. Use cache import and export for CI and remote builders
**Why**: External cache backends let fresh builders reuse prior work.

```console
$ docker buildx build \
    --cache-from=type=registry,ref=registry.example.com/myapp:buildcache \
    --cache-to=type=registry,ref=registry.example.com/myapp:buildcache,mode=max \
    --push \
    -t registry.example.com/myapp:1.0 .
```

**Warning**: Cache backends improve build times, not image correctness. Treat them as acceleration, not state.

### 11. Use `--progress=plain` and `--check` when diagnosing builds
**Why**: Fancy TTY output hides details. Plain logs and build checks are better for debugging.

```console
$ docker buildx build --progress=plain .
$ docker buildx build --check .
```

`--check` evaluates Dockerfile build checks without executing the build.

**Warning**: If a build fails mysteriously in CI, switch to `--progress=plain` before guessing.

### 12. Treat entitlements as privileged exceptions
**Why**: `--allow security.insecure`, `--allow network.host`, and device access are deliberate expansions of builder power.

```console
$ docker buildx create --use --name insecure-builder \
    --buildkitd-flags '--allow-insecure-entitlement security.insecure'
$ docker buildx build --allow security.insecure .
```

**Warning**: If a build needs privileged entitlements, that is a security review event, not an ordinary optimization.

### 13. Use remote Git contexts carefully
**Why**: BuildKit can build directly from Git URLs, shallow clone by default, and optionally keep `.git` metadata.

```console
$ docker buildx build 'https://github.com/user/myrepo.git?branch=main&subdir=docker'
```

For private repos:

```console
$ docker buildx build --ssh default git@github.com:user/private.git
```

**Warning**: Private Git authentication for remote contexts is a build-input problem, not a runtime container problem.

## Common BuildKit Triage Questions

- Is the builder using BuildKit at all?
- Is the wrong builder active?
- Is the build context too large or missing needed files?
- Are secrets being passed incorrectly via args or env?
- Is the output mode wrong (`--load` vs `--push`)?
- Is the target platform unsupported by the builder?
- Is the cache missing, poisoned, or ignored?

## When To Read Another File Too

- Dockerfile instruction behavior or image contract -> also read `references/dockerfile-images.md`
- Remote daemon targeting, mirrors, proxies, or registry daemon config -> also read `references/engine-config-contexts.md`
- Registry naming and publishing strategy -> also read `references/registries-auth.md`
- Security review of secrets or entitlements -> also read `references/security.md`
