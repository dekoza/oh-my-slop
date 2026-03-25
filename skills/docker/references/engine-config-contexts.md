---
domain: Docker Engine Config and Contexts
category: operations
priority: high
description: "Daemon configuration, context targeting, sockets, remote access, and validation"
---

# Docker Engine Config and Contexts Reference

Use this file for `dockerd`, `daemon.json`, context targeting, socket exposure, SSH or TLS access, and host-wide Docker defaults.

### 1. Use contexts for repeatable daemon targeting

**Why**: Contexts give the CLI a named target with endpoint and TLS metadata instead of relying on fragile shell state.

```console
$ docker context create \
    --docker host=ssh://docker-user@host1.example.com \
    --description="Remote engine" \
    my-remote-engine

$ docker context use my-remote-engine
$ docker info
```

**Warning**: Contexts are safer than ad-hoc `DOCKER_HOST` exports for recurring workflows because they are inspectable and reusable.

### 2. Check which daemon the client is targeting before debugging anything else

**Why**: The active context, `DOCKER_CONTEXT`, and `DOCKER_HOST` can all change the daemon the CLI talks to.

```console
$ docker context ls
$ docker context inspect default
$ env | grep '^DOCKER_'
$ docker info
```

**Warning**: `DOCKER_CONTEXT` overrides the default context selected with `docker context use`, and the Docker CLI documents `DOCKER_CONTEXT` as overriding `DOCKER_HOST` as well.

### 3. Prefer SSH contexts or TLS over raw TCP sockets

**Why**: The daemon can listen on Unix sockets, TCP, or SSH-backed endpoints. Unauthenticated or plaintext TCP access is a security failure, not a convenience feature.

```console
$ docker context create --docker host=ssh://docker-user@host1.example.com prod
$ docker context use prod
```

```console
$ dockerd \
    --tlsverify \
    --tlscacert=ca.pem \
    --tlscert=server-cert.pem \
    --tlskey=server-key.pem \
    -H=0.0.0.0:2376
```

**Warning**: Port `2375` is conventionally insecure plain TCP. Port `2376` is the TLS-secured convention.

### 4. Keep daemon settings in `daemon.json` and validate before restart

**Why**: Docker supports a structured config file and can validate it without starting the daemon.

```console
$ dockerd --validate --config-file=/etc/docker/daemon.json
configuration OK
```

```json
{
  "features": {"buildkit": true},
  "registry-mirrors": ["https://mirror.example.com"],
  "dns": ["10.0.0.2", "1.1.1.1"],
  "default-address-pools": [
    {"base": "172.30.0.0/16", "size": 24}
  ]
}
```

**Warning**: Validate first. Restarting a daemon with invalid JSON or conflicting options is a self-inflicted outage.

### 5. Avoid conflicts between `daemon.json` and startup flags

**Why**: Docker fails to start if the same option is configured in both the config file and startup flags, even if the values match.

```text
unable to configure the Docker daemon with file /etc/docker/daemon.json:
the following directives are specified both as a flag and in the configuration file
```

On `systemd` hosts, `-H` is commonly already provided by the service unit. If you need `hosts` in `daemon.json`, remove the default `ExecStart` flags with a drop-in:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd
```

**Warning**: This `hosts` conflict is especially common on Debian and Ubuntu systems using `systemd`.

### 6. Use daemon scope only for host-wide defaults

**Why**: `daemon.json` is the right place for settings that should affect every workload on the daemon.

Good daemon-scope examples:

- `dns`, `dns-search`, `dns-opts`
- `registry-mirrors`
- `default-address-pools`
- `proxies`
- `log-driver` and `log-opts`
- `live-restore`
- `features`
- `data-root`

**Warning**: Per-project concerns like service environment variables, bind mount paths, or host port choices do not belong here.

### 7. Rootless mode changes the daemon socket, lifecycle, and active context

**Why**: Rootless mode runs both the daemon and containers as a non-root user inside a user namespace.

```console
$ dockerd-rootless-setuptool.sh install
...
[INFO] Creating CLI context "rootless"
Successfully created context "rootless"
```

```console
$ docker info
Client:
 Context:    rootless
...
Server:
 Security Options:
  rootless
```

**Warning**: Rootless often uses `unix:///run/user/<uid>/docker.sock`, not `/var/run/docker.sock`. Confusing the sockets causes bogus "daemon not running" conclusions.

### 8. Configure storage and data-root deliberately

**Why**: Storage driver and data root are host-level decisions with operational consequences.

```text
Linux preferred storage driver: overlay2
Windows storage driver:        windowsfilter
Persistent daemon data:        data-root
```

**Warning**: Storage driver choice is not a per-project optimization knob. Treat it as host infrastructure.

### 9. Configure private registries securely

**Why**: Docker assumes registries are secure by default. If a private registry uses a custom CA, install the CA instead of falling back to insecure mode.

```text
/etc/docker/certs.d/myregistry:5000/ca.crt
```

```json
{
  "insecure-registries": ["myregistry:5000"]
}
```

**Warning**: `insecure-registries` is for testing or constrained local environments. Prefer CA trust whenever possible.

### 10. Use `host-gateway` when containers need stable access to host services

**Why**: Docker can resolve a special host alias through daemon configuration and `--add-host`.

```console
$ docker run -it --add-host host.docker.internal:host-gateway busybox ping host.docker.internal
```

```json
{
  "host-gateway-ips": ["192.0.2.1", "2001:db8::1111"]
}
```

**Warning**: This is a targeted host-access mechanism, not a substitute for proper network design.

## Recommended Verification Commands

```console
$ docker context ls
$ docker info
$ dockerd --validate --config-file=/etc/docker/daemon.json
$ docker context inspect <name>
```

Use these before editing services, Dockerfiles, or registry settings. A surprising number of "Docker bugs" are just the wrong daemon target or a broken `daemon.json`.
