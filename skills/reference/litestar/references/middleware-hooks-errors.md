---
domain: Litestar Middleware Hooks and Errors
category: backend
priority: high
---

# Litestar Middleware, Hooks, and Errors Reference

Use this file for ASGI middleware factories, call order, lifecycle hooks, exception handlers, and the special behavior of 404 and 405.

### 1. Write middleware as a factory that accepts `app` and returns an `ASGIApp`
**Why**: Litestar middleware is ASGI middleware with a specific registration pattern.

```python
from litestar.types import ASGIApp, Receive, Scope, Send


def audit_middleware(app: ASGIApp) -> ASGIApp:
    async def wrapped(scope: Scope, receive: Receive, send: Send) -> None:
        await app(scope, receive, send)

    return wrapped
```

**Warning**: The `app` argument is the next ASGI app in the chain, not the `Litestar` instance.

### 2. Remember middleware order: app -> router -> controller -> handler, left to right
**Why**: Layer plus list order determines the stack and is fully deterministic.

```python
from litestar import Controller, Litestar, Router, get


def one(app):
    return app


class DemoController(Controller):
    path = "/demo"
    middleware = [one]

    @get("/", middleware=[one])
    async def index(self) -> dict[str, bool]:
        return {"ok": True}


router = Router(path="/api", route_handlers=[DemoController], middleware=[one])
app = Litestar(route_handlers=[router], middleware=[one])
```

**Warning**: If ordering matters for auth, logging, body access, or headers, do not guess. Litestar will preserve the declared order.

### 3. Exception responses still travel through middleware, except router-generated 404 and 405
**Why**: Most handler and dependency exceptions become responses inside the normal flow, but `NotFound` and `MethodNotAllowed` are raised before the middleware stack.

- Regular handler or dependency error -> middleware still sees the response
- Router-generated `404` or `405` -> middleware does not get a chance to alter them first

**Warning**: If custom middleware seems to miss 404 or 405 responses, that is expected framework behavior.

### 4. Handle 404 and 405 at the app layer only
**Why**: Litestar documents these router-level errors as app-layer exception-handler concerns.

```python
from litestar import Litestar, Request, Response
from litestar.status_codes import HTTP_404_NOT_FOUND, HTTP_405_METHOD_NOT_ALLOWED


def not_found_handler(request: Request, exc: Exception) -> Response:
    return Response(content={"detail": "missing"}, status_code=HTTP_404_NOT_FOUND)


def method_not_allowed_handler(request: Request, exc: Exception) -> Response:
    return Response(content={"detail": "bad method"}, status_code=HTTP_405_METHOD_NOT_ALLOWED)


app = Litestar(route_handlers=[], exception_handlers={404: not_found_handler, 405: method_not_allowed_handler})
```

**Warning**: Handler-, controller-, or router-level exception handlers will not affect router-generated 404 or 405 responses.

### 5. Use exception handlers for response shaping, not `after_exception`
**Why**: `after_exception` is for side effects like logging or metrics; it does not replace exception handling.

```python
from litestar import Litestar, MediaType, Request, Response, get
from litestar.exceptions import HTTPException
from litestar.status_codes import HTTP_500_INTERNAL_SERVER_ERROR


def plain_text_handler(_: Request, exc: Exception) -> Response:
    status_code = getattr(exc, "status_code", HTTP_500_INTERNAL_SERVER_ERROR)
    detail = getattr(exc, "detail", "")
    return Response(content=detail, media_type=MediaType.TEXT, status_code=status_code)


@get("/")
async def boom() -> None:
    raise HTTPException(detail="failure", status_code=400)


app = Litestar(route_handlers=[boom], exception_handlers={HTTPException: plain_text_handler})
```

**Warning**: If you want to alter the actual error response, use `exception_handlers`, not only app hooks.

### 6. Map handlers by exception type or by status code intentionally
**Why**: Litestar supports both, and the two approaches solve different problems.

- Exception class mapping -> consistent behavior for one error family like `ValidationException`
- Status-code mapping -> catch all responses with a specific status such as 500

**Warning**: Mixed mappings can be hard to reason about if you are not clear about whether you are targeting a type or a status code.

### 7. Use `before_request` when the handler should sometimes be bypassed
**Why**: Returning a value from `before_request` short-circuits the handler.

```python
from litestar import Litestar, Request, get


async def require_name(request: Request) -> dict[str, str] | None:
    if "name" not in request.query_params:
        return {"detail": "name required"}
    return None


@get("/")
async def hello(name: str) -> dict[str, str]:
    return {"name": name}


app = Litestar(route_handlers=[hello], before_request=require_name)
```

**Warning**: `before_request` is a request-flow tool, not a generic replacement for middleware.

### 8. Use `after_request` when you want to replace or mutate the resolved response
**Why**: `after_request` gets a `Response` and returns a `Response`.

```python
from litestar import Litestar, MediaType, Response, get


async def normalize_text(response: Response) -> Response:
    if response.media_type == MediaType.TEXT:
        return Response(content={"message": response.content})
    return response


@get("/hello")
async def hello() -> str:
    return "hello"


app = Litestar(route_handlers=[hello], after_request=normalize_text)
```

**Warning**: This hook runs after the handler returns, so it cannot help with early request rejection.

### 9. Use `after_response` only for side effects after the response is gone
**Why**: It runs after the server has sent the response.

```python
from collections import defaultdict

from litestar import Litestar, Request, get


COUNTS: dict[str, int] = defaultdict(int)


async def record(request: Request) -> None:
    COUNTS[request.url.path] += 1


@get("/metrics")
async def metrics() -> dict[str, int]:
    return COUNTS


app = Litestar(route_handlers=[metrics], after_response=record)
```

**Warning**: The response already left the server. Do not expect `after_response` changes to appear in the current response body.

### 10. Use `before_send` to touch low-level ASGI messages such as headers
**Why**: This hook sees outgoing ASGI messages directly.

```python
from litestar import Litestar, get
from litestar.datastructures import MutableScopeHeaders


@get("/")
async def index() -> dict[str, str]:
    return {"ok": "yes"}


async def add_header(message, scope) -> None:
    if message["type"] == "http.response.start":
        headers = MutableScopeHeaders.from_message(message=message)
        headers["X-App"] = "litestar"


app = Litestar(route_handlers=[index], before_send=[add_header])
```

**Warning**: `before_send` runs for every ASGI message. Filter by message type or you will mutate the wrong events.

### 11. Use `after_exception` for metrics and logging only
**Why**: It receives the exception and scope after failure, which is perfect for telemetry.

```python
from litestar import Litestar, get


@get("/")
async def explode() -> None:
    raise ValueError("bad")


async def log_exception(exc: Exception, scope) -> None:
    _ = (type(exc).__name__, scope["path"])


app = Litestar(route_handlers=[explode], after_exception=[log_exception])
```

**Warning**: This hook does not swallow or rewrite the exception.

### 12. Keep validation error exposure deliberate
**Why**: Litestar's default validation errors include detail data that may be useful or may leak too much.

- `ValidationException` defaults to status 400
- The `extra` data can expose parser or validation details to clients

**Warning**: If the API should not reveal raw validation detail, replace or sanitize the exception response explicitly.
