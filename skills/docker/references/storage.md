---
domain: Docker Storage and Mounts
category: runtime
priority: high
description: "Bind mounts, volumes, tmpfs, persistence, and mount failure patterns"
---

# Docker Storage and Mounts Reference

Use this file for bind mounts, named volumes, tmpfs, data persistence, and filesystem-sharing behavior.

### 1. Choose the mount type by ownership and lifecycle
**Why**: Bind mounts, volumes, and tmpfs solve different problems.

Use:

- **bind mounts** when the host path is part of the workflow
- **volumes** when Docker-managed persistence is the goal
- **tmpfs** when data must be ephemeral and memory-backed on Linux

**Warning**: Treating these as interchangeable causes portability, security, and performance bugs.

### 2. Bind mounts are tied to the daemon host, not the CLI machine
**Why**: A bind source path must exist on the machine running the daemon.

```console
$ docker run --mount type=bind,src=/srv/app,dst=/app alpine
```

**Warning**: With a remote daemon, your laptop path is irrelevant. This is one of the most common Docker misconceptions.

### 3. Prefer `--mount` over `-v` for non-trivial storage explanations
**Why**: `--mount` is explicit and supports more options cleanly.

```console
$ docker run --mount type=bind,src="$(pwd)",dst=/workspace,readonly alpine
$ docker run --mount type=volume,src=mydata,dst=/data postgres:18
```

**Warning**: `-v` is terse but easier to misread and easier to misuse in explanations involving options.

### 4. Bind mounts default to read-write and can mutate the host
**Why**: A process inside the container can create, modify, or delete files on the mounted host path.

```console
$ docker run --mount type=bind,src=.,dst=/app,readonly alpine
```

**Warning**: If the container only needs read access, say so explicitly with `readonly` or `ro`.

### 5. Volumes are the default choice for durable application data
**Why**: Volumes are Docker-managed, portable across Docker hosts more cleanly than bind mounts, and persist beyond individual containers.

```console
$ docker volume create my-vol
$ docker run --mount source=my-vol,target=/var/lib/postgresql/data postgres:18
```

**Warning**: Removing a container does not remove its named volume. Volume lifecycle is separate.

### 6. Empty volumes can be pre-populated; mounted data can also obscure files
**Why**: Mounting behavior changes what the container sees.

- mount a non-empty volume over existing container files -> container files are obscured
- mount an empty volume over existing container files -> Docker copies the existing files into the volume by default

```console
$ docker run --mount type=volume,src=myvolume,dst=/data,volume-nocopy nginx
```

**Warning**: Obscured files do not become accessible again inside that container unless you recreate it without the mount.

### 7. Bind mounts also obscure existing container files
**Why**: Mounting a host directory over a non-empty container directory hides whatever was originally there.

```console
$ docker run --mount type=bind,source=/tmp,target=/usr nginx
```

**Warning**: Mounting over system paths like `/usr` can make the container fail to start because required binaries disappear from view.

### 8. Bind-mount source-path behavior differs between `--mount` and `-v`
**Why**: Docker is stricter with `--mount`.

- `--mount type=bind,...` -> errors if the source path does not exist
- `-v host:container` -> automatically creates the missing source path as a directory

```console
$ docker run --mount type=bind,src=/dev/noexist,dst=/mnt/foo alpine
docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist
```

**Warning**: This difference explains many "why did Docker create a weird empty directory?" surprises.

### 9. Tmpfs is ephemeral Linux memory-backed storage
**Why**: tmpfs keeps non-persistent data out of the container writable layer and out of Docker-managed volumes.

```console
$ docker run --mount type=tmpfs,dst=/tmp/cache,tmpfs-size=268435456 alpine
```

Good uses:

- temporary caches
- sensitive ephemeral files
- high-write transient state on Linux

**Warning**: tmpfs disappears when the container stops. Also, kernel swap can still write tmpfs-backed pages to disk on the host.

### 10. Compose named volumes belong in top-level `volumes`
**Why**: This makes lifecycle, reuse, and external references explicit.

```yaml
services:
  db:
    image: postgres:18
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

**Warning**: `external: true` means Compose will not create the volume and will fail if it does not already exist.

### 11. Compose bind mounts should be deliberate and portable
**Why**: Bind mounts couple the service to host filesystem structure.

```yaml
services:
  frontend:
    image: node:lts
    volumes:
      - type: bind
        source: ./static
        target: /opt/app/static
        read_only: true
```

**Warning**: Relative bind paths are good for local app code; absolute host paths often hurt portability and reviewability.

### 12. SELinux labels on bind mounts are powerful and dangerous
**Why**: `:z` and `:Z` modify host-side SELinux labeling.

```console
$ docker run -v "$(pwd)"/target:/app:z nginx
```

- `z` -> shared label for multiple containers
- `Z` -> private label for one container

**Warning**: Labeling system paths incorrectly can damage the host's SELinux expectations. Use with extreme care.

### 13. Bind propagation is advanced and usually not needed
**Why**: Propagation controls whether nested mounts under a bind mount propagate between replicas of the mount.

Default:

```text
rprivate
```

Other values include `shared`, `slave`, `rshared`, `rslave`, and `private`.

**Warning**: Bind propagation is Linux-only and does not work on Docker Desktop the same way. Do not prescribe it casually.

### 14. Back up and restore volumes with helper containers
**Why**: Volumes are easier to back up or migrate than bind mounts.

```console
$ docker run --rm --volumes-from dbstore -v $(pwd):/backup ubuntu \
    tar cvf /backup/backup.tar /dbdata
```

**Warning**: Volume backup is a separate operational concern from container backup. Deleting a container does not snapshot its volume contents.

### 15. `/var/lib/docker` bind mounts are a known footgun
**Why**: Mounting Docker's internal storage tree into other containers can make container cleanup fail due to busy filesystem handles.

```text
Error: Unable to remove filesystem
```

**Warning**: If something bind-mounts `/var/lib/docker`, suspect it first when removal or cleanup behaves strangely.

## Storage Decision Table

| Need | Best fit |
|---|---|
| Live-edit source code from host | Bind mount |
| Durable database state | Named volume |
| Fast temporary cache on Linux | tmpfs |
| Share persistent data between containers | Named volume |
| Use host config file directly | Bind mount |

## When To Read Another File Too

- Build-time bind mounts, cache mounts, or secret mounts -> also read `references/buildkit-buildx.md`
- Compose service and top-level volume semantics -> also read `references/compose-spec.md`
- Permission, path, or disappearing-data failures -> also read `references/troubleshooting.md`
- Security implications of host path exposure -> also read `references/security.md`
