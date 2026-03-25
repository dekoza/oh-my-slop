---
domain: Litestar Handlers and Requests
category: backend
priority: critical
---

# Litestar Handlers and Requests Reference

Use this file for HTTP handlers, reserved kwargs, path declarations, request parsing, uploads, route naming, and custom request classes.

### 1. Prefer semantic HTTP decorators over `@route()`
**Why**: Litestar documents `@route()` as the lower-level multi-method form and discourages it for ordinary endpoints.

```python
from litestar import get, post


@get("/users")
async def list_users() -> list[dict[str, str]]:
    return [{"name": "Ada"}]


@post("/users")
async def create_user(data: dict[str, str]) -> dict[str, str]:
    return data
```

**Warning**: Use `@route()` only when one callable truly needs multiple methods. Separate operations are usually clearer and fit OpenAPI better.

### 2. Annotate every handler argument and return value
**Why**: Litestar builds signature models at startup and fails fast when annotations are missing.

```python
from litestar import get


@get("/items/{item_id:int}")
async def get_item(item_id: int) -> dict[str, int]:
    return {"item_id": item_id}
```

**Warning**: Missing annotations cause `ImproperlyConfiguredException` during boot, not a soft runtime fallback.

### 3. Make sync execution mode explicit
**Why**: Sync handlers can block the event loop. Litestar warns unless you choose `sync_to_thread=True` or `False`.

```python
from litestar import get


@get("/fast-sync", sync_to_thread=False)
def fast_sync() -> str:
    return "ok"
```

**Warning**: `sync_to_thread=False` is only correct for fast, non-blocking sync code. File I/O, network I/O, or heavy CPU work need different treatment.

### 4. Know the reserved injected kwargs
**Why**: Litestar can inject `request`, `state`, `headers`, `query`, `cookies`, `body`, `scope`, and websocket `socket` by name.

```python
from litestar import Request, get
from litestar.datastructures import State


@get("/")
async def inspect_request(request: Request, state: State, headers: dict[str, str]) -> dict[str, str]:
    return {"path": request.url.path, "version": state.version, "host": headers.get("host", "")}
```

**Warning**: Parameter-name collisions with reserved kwargs need alternative names via parameter helpers.

### 5. Use multi-path handlers only when optional path shapes are genuinely needed
**Why**: Litestar accepts a list of paths on one handler, which is useful for optional path params.

```python
from litestar import get


@get(["/reports", "/reports/{year:int}"])
async def report(year: int = 2026) -> dict[str, int]:
    return {"year": year}
```

**Warning**: Multi-path handlers make reverse URL behavior harder to reason about. Prefer explicit handlers unless the shapes are tightly coupled.

### 6. Keep runtime type names available for signature parsing
**Why**: Handler annotations are resolved at runtime, so `TYPE_CHECKING`-only imports can break them.

```python
from __future__ import annotations

from litestar import Controller, Litestar, post


class Payload:
    def __init__(self, name: str) -> None:
        self.name = name


class UserController(Controller):
    path = "/users"

    @post(sync_to_thread=False)
    def create_user(self, data: Payload) -> Payload:
        return data


app = Litestar(route_handlers=[UserController])
```

**Warning**: If linting pushes the type import behind `TYPE_CHECKING`, you must expose the type at runtime another way such as `signature_types` or `signature_namespace`.

### 7. Use `data` for parsed request bodies and remember JSON is the default
**Why**: HTTP request bodies are injected through the special `data` parameter.

```python
from dataclasses import dataclass

from litestar import post


@dataclass
class UserCreate:
    name: str


@post("/users")
async def create_user(data: UserCreate) -> UserCreate:
    return data
```

**Warning**: If you expect form or multipart input and forget `Body(media_type=...)`, Litestar will still try JSON parsing.

### 8. Use `Body(...)` to declare form, multipart, or MessagePack input
**Why**: Non-JSON payloads require explicit media type declaration for parsing and schema generation.

```python
from dataclasses import dataclass
from typing import Annotated

from litestar import post
from litestar.enums import RequestEncodingType
from litestar.params import Body


@dataclass
class UserForm:
    name: str


@post("/users/form")
async def create_user(data: Annotated[UserForm, Body(media_type=RequestEncodingType.URL_ENCODED)]) -> UserForm:
    return data
```

**Warning**: Do not fake form handling with raw body parsing unless the endpoint truly needs custom low-level behavior.

### 9. Type file uploads as `UploadFile`
**Why**: Litestar converts multipart files into `UploadFile`, which supports async and sync access patterns.

```python
from typing import Annotated

from litestar import MediaType, post
from litestar.datastructures import UploadFile
from litestar.enums import RequestEncodingType
from litestar.params import Body


@post("/upload", media_type=MediaType.TEXT)
async def upload(data: Annotated[UploadFile, Body(media_type=RequestEncodingType.MULTI_PART)]) -> str:
    content = await data.read()
    return f"{data.filename}:{len(content)}"
```

**Warning**: If you type uploads as plain `bytes` or `dict` without intent, you throw away Litestar's file abstraction and validation help.

### 10. Choose the right multipart shape: single file, model, dict, or list
**Why**: Litestar supports structured multipart parsing when filenames are known and looser containers when they are not.

- Single upload -> `UploadFile`
- Named multipart fields -> dataclass or pydantic model with `UploadFile` fields
- Arbitrary named files -> `dict[str, UploadFile]`
- File collection -> `list[UploadFile]`

**Warning**: Do not use a loose dictionary when the API contract has fixed fields. That weakens validation for no gain.

### 11. Keep request size limits on unless an upstream boundary already enforces them
**Why**: `request_max_body_size` defaults to 10 MB and protects memory use.

```python
from litestar import Litestar, post


@post("/ingest")
async def ingest(data: dict[str, str]) -> dict[str, str]:
    return data


app = Litestar(route_handlers=[ingest], request_max_body_size=10_000_000)
```

**Warning**: Setting `request_max_body_size=None` is explicitly discouraged because it opens a DoS path for huge bodies.

### 12. Use custom `request_class` only when request behavior truly belongs on the request object
**Why**: Litestar supports custom request classes and layering, which is useful for enriched request helpers.

```python
from litestar import Litestar, Request, get


class AppRequest(Request):
    __slots__ = ("tenant_name",)

    def __init__(self, scope, receive, send) -> None:
        super().__init__(scope=scope, receive=receive, send=send)
        self.tenant_name = scope.get("method", "GET")


@get("/tenant", sync_to_thread=False)
def tenant(request: AppRequest) -> str:
    return request.tenant_name


app = Litestar(route_handlers=[tenant], request_class=AppRequest)
```

**Warning**: Do not create a custom request class just to avoid writing one dependency or helper function.

### 13. Use named handlers only when reverse lookup matters
**Why**: Unique names let you call `route_reverse()` or `request.url_for()` safely.

```python
from litestar import Request, get


@get("/users/{user_id:int}", name="user-detail")
async def user_detail(user_id: int) -> dict[str, int]:
    return {"user_id": user_id}


@get("/links")
def links(request: Request) -> dict[str, str]:
    return {"href": request.url_for("user-detail", user_id=1)}
```

**Warning**: Handler names must be unique. Duplicate names fail startup.

### 14. Use `opt` for route metadata that other framework features consume
**Why**: `opt` is the place for handler metadata inspected by guards, middleware, or request-time logic.

```python
from litestar import Request, get


@get("/reports", opt={"audit": True})
def reports(request: Request) -> dict[str, bool]:
    return {"audit": bool(request.route_handler.opt.get("audit"))}
```

**Warning**: `opt` is not a substitute for response content or domain state.
