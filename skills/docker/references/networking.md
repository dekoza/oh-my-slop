---
domain: Docker Networking
category: runtime
priority: high
description: "Container networking, Compose networks, DNS, and published port behavior"
---

# Docker Networking Reference

Use this file for container-to-container communication, DNS, network topology, published ports, and Compose network design.

### 1. Prefer user-defined bridge networks over the default bridge
**Why**: Containers on user-defined networks can resolve each other by name and are easier to isolate intentionally.

```console
$ docker network create -d bridge my-net
$ docker run --network=my-net --name web -d nginx:alpine
$ docker run --network=my-net --rm -it busybox ping web
```

**Warning**: The default bridge network does not give the same clean service-discovery behavior as user-defined bridge networks.

### 2. Understand the built-in drivers before choosing one
**Why**: Driver choice changes the network boundary and expected behavior.

Core Linux drivers:

- `bridge` -> local single-host network, default for most app stacks
- `host` -> removes network isolation between container and host
- `none` -> disables networking
- `overlay` -> multi-host, swarm-oriented
- `ipvlan` and `macvlan` -> integrate containers more directly into external network layouts

**Warning**: If the user is not using Swarm, do not drift into overlay-network guidance.

### 3. Distinguish internal service discovery from host publication
**Why**: Containers on the same network can talk over internal ports without those ports being published to the host.

```text
Internal access  -> service name + container port
Host access      -> published port mapping
```

```console
$ docker run -p 8080:80 nginx
```

**Warning**: `EXPOSE` and shared networks do not publish ports to the host. `-p` or Compose `ports:` does.

### 4. User-defined networks give embedded DNS
**Why**: Containers on custom networks use Docker's embedded DNS server and can resolve each other by service or container name.

```text
Embedded DNS server address: 127.0.0.11
```

**Warning**: DNS behavior differs between the default bridge and custom networks. If names do not resolve, verify the network type before blaming the app.

### 5. Compose defaults every service onto the implicit `default` network
**Why**: Without explicit `networks:` declarations, services in a Compose project share one default network and can resolve each other by service name.

```yaml
services:
  web:
    image: nginx
  db:
    image: postgres:18
```

**Warning**: If you expected isolation and did not define separate networks, you created a shared trust zone by default.

### 6. Use multiple networks to model trust boundaries
**Why**: A frontend often needs host access and backend access, while the database should only sit on the backend network.

```yaml
services:
  proxy:
    image: nginx
    networks: [frontend]
  app:
    image: example/api
    networks: [frontend, backend]
  db:
    image: postgres:18
    networks: [backend]

networks:
  frontend: {}
  backend:
    internal: true
```

**Warning**: If two services do not share at least one network, name-based communication between them will fail.

### 7. Use aliases sparingly and only when they clarify topology
**Why**: Aliases create additional hostnames on a specific network.

```yaml
services:
  backend:
    image: example/api
    networks:
      backend:
        aliases:
          - database
```

**Warning**: Aliases are network-scoped, and shared aliases are ambiguous if multiple containers or services claim them.

### 8. `network_mode` bypasses ordinary Compose network attachment
**Why**: `network_mode: host`, `none`, `service:...`, or `container:...` changes the container's network namespace behavior and cannot be combined with `networks:`.

```yaml
services:
  debug:
    image: alpine
    network_mode: host
```

**Warning**: `network_mode: host` removes the normal container/host network boundary. Treat it as a deliberate tradeoff, not a default shortcut.

### 9. Internal networks block ordinary external access
**Why**: Docker can create networks with no default route for external connectivity while still allowing communication between attached containers.

```console
$ docker network create --internal app-backend
```

```yaml
networks:
  backend:
    internal: true
```

**Warning**: Internal networks are good for data-plane isolation, but they will break package downloads or third-party API calls if you attach the wrong service to them.

### 10. Published ports are a routing decision, not a service-discovery mechanism
**Why**: `-p` or Compose `ports:` makes a container reachable outside the host's local bridge network.

```yaml
services:
  web:
    image: nginx
    ports:
      - "127.0.0.1:8080:80"
```

**Warning**: Bind only to the interface you actually want. `0.0.0.0` exposes more than `127.0.0.1`.

### 11. Default address pools matter on crowded hosts
**Why**: Docker allocates subnets from daemon-managed pools. Conflicts with corporate VPNs or host routing are common.

```json
{
  "default-address-pools": [
    {"base": "172.30.0.0/16", "size": 24}
  ]
}
```

**Warning**: If Docker networks clash with the host's existing routes, fix address pools at the daemon layer instead of hardcoding random subnets in every project.

### 12. Multi-network containers have a default gateway decision
**Why**: A container can be attached to multiple networks, but only one network gateway becomes the default route.

```yaml
services:
  app:
    image: busybox
    networks:
      app-net:
      egress-net:
        gw_priority: 1
```

**Warning**: If outbound traffic takes the wrong path, inspect gateway priority rather than only checking service connectivity.

### 13. DNS troubleshooting starts with the host and the network type
**Why**: Containers inherit host DNS differently depending on network type, and loopback-only host resolvers such as `dnsmasq` can break container resolution.

Common checks:

```console
$ docker run --rm alpine ping -c1 example.com
$ docker run --rm alpine cat /etc/resolv.conf
```

**Warning**: A host using loopback DNS in `/etc/resolv.conf` can trigger Docker's fallback to public resolvers, which often breaks internal-name resolution.

### 14. Host access from containers should be explicit
**Why**: Reaching services on the host from a container is a special case.

Options:

- publish and call the host externally
- use `host.docker.internal` / `host-gateway` where supported or configured
- use `network_mode: host` only when the tradeoff is acceptable

**Warning**: Hardcoding host LAN IPs into app configs is brittle and usually the wrong long-term pattern.

## High-Value Networking Checklist

- Are the communicating services on a shared network?
- Is the problem internal service discovery or host publication?
- Is the stack relying on the default bridge instead of a user-defined network?
- Did `network_mode` disable normal Compose networking?
- Is DNS being inherited or overridden in a surprising way?
- Are address pool or route conflicts involved?

## When To Read Another File Too

- Compose service-level network declarations -> also read `references/compose-spec.md`
- Daemon DNS defaults, host-gateway, or address-pool config -> also read `references/engine-config-contexts.md`
- Published-port or DNS failures -> also read `references/troubleshooting.md`
- Privilege or exposure review for `host` networking -> also read `references/security.md`
