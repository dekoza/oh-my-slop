---
domain: Docker Registries and Authentication
category: distribution
priority: high
description: "Image naming, login, tags vs digests, push and pull workflows, and registry trust"
---

# Docker Registries and Authentication Reference

Use this file when the task is about image names, login, pull or push behavior, tags vs digests, and private registry access.

### 1. Understand the image-reference shape first
**Why**: Most registry confusion starts with malformed names.

```text
[HOST[:PORT]/]NAMESPACE/REPOSITORY[:TAG]
```

Examples:

- `alpine`
- `docker.io/library/alpine:latest`
- `registry.example.com/team/myapp:1.2.3`

**Warning**: If the registry host is omitted, Docker assumes Docker Hub.

### 2. Tags are mutable names; digests are immutable content identifiers
**Why**: Tags are convenient references, but digests pin a specific image version.

```console
$ docker pull ubuntu:24.04
$ docker pull ubuntu@sha256:2e863c44...
```

Use tags when you want:

- human-readable version labels
- rolling updates to a named version stream

Use digests when you want:

- reproducibility
- controlled rollout pinning
- exact base-image identity in a Dockerfile

```dockerfile
FROM ubuntu@sha256:2e863c44...
```

**Warning**: Pinning by digest also means you do not automatically receive newer upstream security updates.

### 3. `docker login` stores credentials through a credential store when possible
**Why**: External credential stores are more secure than keeping base64-encoded credentials in `config.json`.

```console
$ docker login registry.example.com
```

Credential-store config:

```json
{
  "credsStore": "secretservice"
}
```

Per-registry helpers:

```json
{
  "credHelpers": {
    "myregistry.example.com": "secretservice"
  }
}
```

**Warning**: Without a configured credential store, Docker may store credentials in `~/.docker/config.json` in a less secure form.

### 4. Use `--password-stdin` for non-interactive logins
**Why**: This keeps secrets out of shell history and avoids leaking them in process lists.

```console
$ cat ~/my_password.txt | docker login --username foo --password-stdin registry.example.com
```

**Warning**: Do not put registry passwords directly on the command line with `-p` in automated environments.

### 5. Docker Hub login behavior differs from self-hosted registries
**Why**: Docker Hub defaults to a web-based device-code flow unless `--username` is specified.

```console
$ docker login
```

For self-hosted registries:

```console
$ docker login registry.example.com
$ docker login registry.example.com:1337
```

**Warning**: Registry addresses should be `host[:port]` only. Path components such as `registry.example.com/foo/` are wrong.

### 6. Tag locally before pushing to a private registry
**Why**: The pushed reference must include the target registry hostname and optional port.

```console
$ docker image tag myapp:latest registry-host:5000/team/myapp:1.0
$ docker image push registry-host:5000/team/myapp:1.0
```

**Warning**: If the registry host is missing from the tag, Docker will push to Docker Hub instead.

### 7. Pull and push behavior is daemon-mediated
**Why**: The daemon handles layer transfers, concurrency, and trust configuration.

- pull concurrency default: 3 layers at a time
- push concurrency default: 5 layers at a time

Relevant daemon knobs:

- `max-concurrent-downloads`
- `max-concurrent-uploads`
- `registry-mirrors`
- proxy config

**Warning**: If pull or push timeouts happen on low-bandwidth links, the daemon settings may need tuning more than the CLI command.

### 8. Secure private registries by trusting their CA, not by disabling trust
**Why**: Docker assumes registries are secure by default.

CA trust path on Linux:

```text
/etc/docker/certs.d/myregistry:5000/ca.crt
```

Fallback daemon setting:

```json
{
  "insecure-registries": ["myregistry:5000"]
}
```

**Warning**: `insecure-registries` weakens security and should be a last resort for constrained local environments or testing.

### 9. Mirrors and insecure registries are daemon concerns, not project concerns
**Why**: Registry mirrors, insecure registry allowlists, and trust stores belong to the daemon host configuration.

**Warning**: Do not try to solve a host-wide registry-trust issue by rewriting project Dockerfiles or Compose files.

### 10. Builds may need registry auth too
**Why**: `docker build`, `docker buildx build`, `docker scout`, and related commands may need authentication to pull private bases or access restricted features.

```console
$ docker buildx build -t registry.example.com/team/myapp:1.0 --push .
```

**Warning**: If a build cannot pull a private base image, the failure is often registry auth, not a Dockerfile syntax problem.

### 11. Use `docker image pull` semantics intentionally
**Why**: Pulling by tag updates to the latest image for that tag; pulling by digest pins an immutable object.

```console
$ docker image pull debian:bookworm
$ docker image pull debian@sha256:...
```

**Warning**: `latest` is a default tag, not a guarantee of quality or suitability.

### 12. Use `docker image push --all-tags` only when you mean it
**Why**: It pushes every local tag for the referenced repository.

```console
$ docker image push --all-tags registry-host:5000/myname/myimage
```

**Warning**: This can publish tags you forgot were present locally.

## Distribution Review Checklist

- Is the image reference correctly scoped to the intended registry?
- Does the workflow require mutable tags or immutable digests?
- Are credentials stored via a proper helper or store?
- Is the registry failing because of CA trust, insecure registry config, or wrong hostname?
- Is the daemon, not the Dockerfile, the actual place to configure mirrors or trust?

## When To Read Another File Too

- Dockerfile base-image pinning and image contract -> also read `references/dockerfile-images.md`
- Daemon mirrors, proxy config, or insecure registry settings -> also read `references/engine-config-contexts.md`
- Build failures while pulling private bases -> also read `references/buildkit-buildx.md`
- Security review of registry trust and exposed credentials -> also read `references/security.md`
