---
domain: Litestar App Structure and Layering
category: backend
priority: critical
---

# Litestar App Structure and Layering Reference

Use these patterns when the task is about how a Litestar application is assembled, how configuration flows through layers, or where state and hooks belong.

### 1. Put the application root in a real `Litestar(...)` object
**Why**: Litestar's constructor is the root of routing, layered config, startup, and plugin registration.

```python
from litestar import Litestar, get


@get("/")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


app = Litestar(route_handlers=[healthcheck])
```

**Warning**: Do not treat Litestar like generic Starlette wiring. Controllers, routers, DTOs, guards, and layered config are framework features, not optional add-ons.

### 2. Use the layer model deliberately: app -> router -> controller -> handler
**Why**: Many Litestar settings are layered. The closest layer to the handler wins.

```python
from litestar import Controller, Litestar, Router, get


class UserController(Controller):
    path = "/users"

    @get("/{user_id:int}")
    async def get_user(self, user_id: int) -> dict[str, int]:
        return {"user_id": user_id}


api = Router(path="/api", route_handlers=[UserController])
app = Litestar(route_handlers=[api])
```

**Warning**: Guards do not override by closeness. They accumulate across layers.

### 3. Know which settings are layered and which behavior follows closeness
**Why**: Misplacing a setting at the wrong layer is one of the easiest ways to get confusing behavior.

- Closest-layer-wins examples: `dependencies`, `dto`, `return_dto`, `exception_handlers`, `middleware`, `request_class`, `response_class`, `tags`, `type_encoders`, `type_decoders`
- Cumulative exception: `guards`

**Warning**: If a handler-level setting seems ignored, check whether a nearer layer already overrides it.

### 4. Use startup and shutdown hooks for simple boot or teardown work
**Why**: `on_startup` and `on_shutdown` are the direct fit for one-shot initialization and cleanup.

```python
from litestar import Litestar


def connect_cache(app: Litestar) -> None:
    app.state.cache_ready = True


def close_cache(app: Litestar) -> None:
    app.state.cache_ready = False


app = Litestar(on_startup=[connect_cache], on_shutdown=[close_cache], route_handlers=[])
```

**Warning**: Shutdown hooks run after lifespan context managers unwind. If resource ordering matters, use lifespan deliberately.

### 5. Use lifespan context managers for long-lived resources with structured teardown
**Why**: Lifespan is the right tool when a resource must exist across app lifetime and needs robust cleanup.

```python
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from litestar import Litestar


@asynccontextmanager
async def manage_resource(app: Litestar) -> AsyncGenerator[None, None]:
    app.state.resource = {"ready": True}
    try:
        yield
    finally:
        app.state.resource = None


app = Litestar(route_handlers=[], lifespan=[manage_resource])
```

**Warning**: Multiple lifespan managers unwind in reverse order.

### 6. Keep app state small and intentional
**Why**: `app.state` is easy to reach from requests, websockets, middleware, and hooks, which makes it useful but easy to abuse.

```python
from litestar import Litestar, Request, get
from litestar.datastructures import State


@get("/version")
def get_version(state: State, request: Request) -> dict[str, str]:
    return {"version": state.version, "same": request.app.state.version}


app = Litestar(route_handlers=[get_version])
app.state.version = "2026.03"
```

**Warning**: Shared mutable state across requests is easy to make unsafe or confusing. Prefer explicit dependencies for request-scoped work.

### 7. Use `ImmutableState` when mutation should be forbidden
**Why**: Immutable state makes accidental cross-context writes fail fast.

```python
from litestar import Litestar, get
from litestar.datastructures import ImmutableState


@get("/")
def read_only(state: ImmutableState) -> dict[str, int]:
    return state.dict()


app = Litestar(route_handlers=[read_only])
```

**Warning**: If code expects to assign into `state`, immutable typing will break it immediately. That is the point.

### 8. Put cross-cutting observability in app hooks, not business handlers
**Why**: `after_exception`, `before_send`, and `on_app_init` are instrumentation points.

```python
from litestar import Litestar
from litestar.config.app import AppConfig


def add_tag(app_config: AppConfig) -> AppConfig:
    app_config.tags = [*app_config.tags, "api"] if app_config.tags else ["api"]
    return app_config


app = Litestar(route_handlers=[], on_app_init=[add_tag])
```

**Warning**: `on_app_init` runs in `__init__`, not an async context. Do not make it async.

### 9. Use guards for authorization boundaries and remember they are cumulative
**Why**: Guards are the authorization mechanism tied to connection plus route metadata.

```python
from litestar import ASGIConnection, Controller, Litestar, get
from litestar.exceptions import NotAuthorizedException
from litestar.handlers.base import BaseRouteHandler


def require_admin(connection: ASGIConnection, _: BaseRouteHandler) -> None:
    if not getattr(connection.user, "is_admin", False):
        raise NotAuthorizedException()


class AdminController(Controller):
    path = "/admin"
    guards = [require_admin]

    @get("/stats")
    async def stats(self) -> dict[str, bool]:
        return {"ok": True}


app = Litestar(route_handlers=[AdminController])
```

**Warning**: App- or controller-level guards also run on `OPTIONS` requests.

### 10. Use route-handler `opt` only for metadata that guards or middleware must read
**Why**: `opt` is merged through layers and is intended for metadata, not primary application state.

```python
from litestar import ASGIConnection, Litestar, get
from litestar.exceptions import NotAuthorizedException
from litestar.handlers.base import BaseRouteHandler


def secret_guard(connection: ASGIConnection, route_handler: BaseRouteHandler) -> None:
    expected = route_handler.opt.get("secret")
    if expected and connection.headers.get("Secret-Header") != expected:
        raise NotAuthorizedException()


@get("/secret", guards=[secret_guard], opt={"secret": "token-123"})
async def secret() -> dict[str, str]:
    return {"status": "ok"}


app = Litestar(route_handlers=[secret])
```

**Warning**: `opt` values merge across layers. Reused keys can be overwritten by closer layers.

### 11. Use `route_reverse()` and `url_for()` only when route naming is stable and unique
**Why**: Litestar names handlers and allows reverse lookup, but ambiguous multi-path setups can produce surprising results.

```python
from litestar import Litestar, Request, get


@get("/users/{user_id:int}", name="user-detail")
async def user_detail(user_id: int) -> dict[str, int]:
    return {"user_id": user_id}


@get("/links")
def links(request: Request) -> dict[str, str]:
    return {"path": request.app.route_reverse("user-detail", user_id=5)}


app = Litestar(route_handlers=[user_detail, links])
```

**Warning**: Reversing a handler attached to multiple overlapping paths can become unpredictable.

### 12. Treat 2.x and 3.0 transition notes as real compatibility risk
**Why**: Current docs include deprecations while the repo metadata shows `3.0.0b0`. Some APIs still carry migration baggage.

- Prefer current documented APIs such as `create_static_files_router()`.
- Call out deprecated surfaces when editing older code.
- Do not invent upgrade rules from generic ASGI knowledge.

**Warning**: If the task touches deprecated APIs, say so explicitly instead of silently mixing old and new patterns.
