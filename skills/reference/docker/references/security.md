---
domain: Docker Security
category: security
priority: critical
description: "Daemon exposure, rootless mode, privilege boundaries, and core hardening guidance"
---

# Docker Security Reference

Use this file for security reviews, hardening, access control, and privilege-boundary decisions.

### 1. Treat Docker daemon access as root-equivalent
**Why**: Anyone who can control the Docker daemon can usually control the host.

```text
docker socket access ~= root-equivalent host power
```

Reasons include:

- mounting host paths into containers
- starting privileged containers
- accessing devices
- changing runtime isolation and networking

**Warning**: Do not describe daemon socket access as harmless local convenience. It is a host-control boundary.

### 2. Prefer the local Unix socket, SSH, or mutual TLS
**Why**: Docker supports Unix sockets, SSH, or TLS-secured TCP. SSH and TLS are the right ways to protect remote access.

```console
$ docker context create --docker host=ssh://docker-user@host1.example.com remote
$ docker context use remote
```

```console
$ dockerd --tlsverify --tlscacert=ca.pem --tlscert=server-cert.pem --tlskey=server-key.pem -H=0.0.0.0:2376
```

**Warning**: Exposing the daemon over unauthenticated or plaintext TCP is a security failure, not an operational shortcut.

### 3. Prefer rootless mode when it fits the workload
**Why**: Rootless mode runs both the daemon and containers as a non-root user inside a user namespace, reducing blast radius.

```console
$ dockerd-rootless-setuptool.sh install
$ docker info
```

Security signal to look for:

```text
Security Options:
  rootless
```

**Warning**: Rootless mode changes sockets, setup, and sometimes feature availability. It is not a free drop-in, but it is a real hardening improvement.

### 4. `userns-remap` and rootless are different tools
**Why**: Rootless runs the daemon itself without root privileges. `userns-remap` keeps a rootful daemon but maps container root to an unprivileged host UID range.

**Warning**: Do not conflate these modes when explaining risk reduction.

### 5. Run application containers as non-root when feasible
**Why**: Even inside a container, running as non-root reduces damage from app compromise.

```dockerfile
RUN useradd --create-home --uid 10001 appuser
USER appuser
```

**Warning**: Non-root inside the container does not magically make a rootful daemon safe, but it still reduces the container's internal privilege level.

### 6. Prefer narrow capabilities over `--privileged`
**Why**: Docker drops many Linux capabilities by default and lets you add only what is necessary.

```console
$ docker run --cap-add=NET_ADMIN ubuntu ip link add dummy0 type dummy
```

**Warning**: `--privileged` grants all capabilities, broad device access, and relaxes AppArmor or SELinux restrictions. Use it only when you can defend it.

### 7. Device access should be explicit
**Why**: `--device` can grant targeted hardware access without opening everything.

```console
$ docker run --device=/dev/snd:/dev/snd ...
```

**Warning**: If the answer recommends `--privileged` when `--device` and a specific capability would suffice, the answer is sloppy.

### 8. Do not store secrets in image layers, build args, or env without need
**Why**: Build args and env vars are poor secret channels. BuildKit secret and SSH mounts exist specifically to avoid that leak.

```dockerfile
RUN --mount=type=secret,id=aws,target=/root/.aws/credentials \
    aws s3 cp s3://private/artifact /tmp/artifact
```

**Warning**: If a Dockerfile uses `ARG TOKEN=...` or `ENV API_KEY=...` for real secrets, treat it as a bug.

### 9. Secure registry communication with CA trust, not insecure fallback
**Why**: Private registries should present trusted TLS certificates.

```text
/etc/docker/certs.d/myregistry:5000/ca.crt
```

Fallback:

```json
{"insecure-registries": ["myregistry:5000"]}
```

**Warning**: `insecure-registries` expands attack surface and should not be the default recommendation.

### 10. Docker's kernel hardening story depends on Linux primitives
**Why**: Namespaces, cgroups, capabilities, seccomp, AppArmor, SELinux, and user namespaces define much of Docker's real isolation.

High-value hardening layers:

- default capability drop
- seccomp
- AppArmor or SELinux
- user namespace isolation
- rootless mode where feasible

**Warning**: Saying "containers are secure by default" without qualification is lazy. The daemon attack surface and runtime configuration still matter.

### 11. Default capability set is not the same as full root
**Why**: Docker defaults to an allowlist of capabilities instead of giving the container everything.

Commonly withheld sensitive capabilities include:

- `SYS_ADMIN`
- `NET_ADMIN`
- `SYS_MODULE`
- `SYS_PTRACE`

**Warning**: Adding `SYS_ADMIN` casually is often security malpractice in miniature.

### 12. Socket, key, and certificate hygiene matters
**Why**: TLS keys and client certs grant daemon control.

```console
$ chmod 0400 ca-key.pem key.pem server-key.pem
$ chmod 0444 ca.pem server-cert.pem cert.pem
```

**Warning**: Anyone with the client keys for a TLS-secured Docker daemon may have host-level control. Guard them like root credentials.

### 13. Bind mounts expand the host attack surface
**Why**: A writable bind mount gives the container direct write access to host files.

```console
$ docker run --mount type=bind,src=/srv/config,dst=/config,readonly alpine
```

**Warning**: Recommending broad writable host-path mounts without justification is a security review failure.

### 14. Internal networks and limited exposure are part of hardening
**Why**: Networking choices affect blast radius.

Good patterns:

- publish only what must be reachable from outside
- keep backend-only services on internal or private networks
- avoid `network_mode: host` unless clearly justified

**Warning**: If a database does not need host reachability, publishing its port is needless exposure.

## Security Review Questions

- Who can access the daemon socket or API?
- Is remote daemon access protected with SSH or TLS?
- Can the workload run rootless or as a non-root container user?
- Is `--privileged` being used where narrower controls would work?
- Are secrets handled with BuildKit mounts instead of args or env?
- Are bind mounts writable only where truly needed?
- Is registry trust configured with proper CA material?

## When To Read Another File Too

- Daemon sockets, contexts, TLS flags, or rootless setup -> also read `references/engine-config-contexts.md`
- Build secret handling -> also read `references/buildkit-buildx.md`
- Host-path exposure and mount semantics -> also read `references/storage.md`
- Symptom-driven diagnosis of security-related failures -> also read `references/troubleshooting.md`
