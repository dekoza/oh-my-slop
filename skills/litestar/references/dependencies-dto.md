---
domain: Litestar Dependencies and DTOs
category: backend
priority: critical
---

# Litestar Dependencies and DTOs Reference

Use this file for dependency injection, `Provide`, `Dependency`, yield cleanup, dependency overrides, and DTO configuration.

### 1. Wrap dependencies in `Provide`
**Why**: Litestar's DI system requires `Provide(...)`; raw callables are not the declaration format.

```python
from litestar import Litestar, get
from litestar.di import Provide


def provide_flag() -> bool:
    return True


@get("/")
def index(flag: bool) -> dict[str, bool]:
    return {"flag": flag}


app = Litestar(route_handlers=[index], dependencies={"flag": Provide(provide_flag)})
```

**Warning**: If the dependency key is `flag` but the handler argument is `enabled`, Litestar will not magically map it.

### 2. Match the dependency key to the injected kwarg name exactly
**Why**: Dependency lookup is string-keyed and kwarg-driven.

```python
from litestar import Router, get
from litestar.di import Provide


def provide_org_id() -> int:
    return 7


@get("/org")
def read_org(org_id: int) -> dict[str, int]:
    return {"org_id": org_id}


router = Router(path="/api", route_handlers=[read_org], dependencies={"org_id": Provide(provide_org_id)})
```

**Warning**: A mismatched key is a configuration bug, not a stylistic nit.

### 3. Remember dependency scope follows the declaring layer
**Why**: App, router, controller, and handler dependencies are isolated to their layer scope.

```python
from litestar import Controller, Litestar, Router, get
from litestar.di import Provide


def provide_app_name() -> str:
    return "main"


class PingController(Controller):
    path = "/ping"

    @get("/")
    def ping(self, app_name: str) -> dict[str, str]:
        return {"app_name": app_name}


router = Router(path="/api", route_handlers=[PingController])
app = Litestar(route_handlers=[router], dependencies={"app_name": Provide(provide_app_name)})
```

**Warning**: Handler-local dependencies do not leak upward or sideways.

### 4. Make sync dependency execution explicit too
**Why**: Sync DI providers have the same blocking risk and warning behavior as sync handlers.

```python
from litestar import Litestar, get
from litestar.di import Provide


def provide_counter() -> int:
    return 1


@get("/")
def index(counter: int) -> dict[str, int]:
    return {"counter": counter}


app = Litestar(route_handlers=[index], dependencies={"counter": Provide(provide_counter, sync_to_thread=False)})
```

**Warning**: If the provider does blocking I/O, `sync_to_thread=False` is wrong and will hurt the event loop.

### 5. Use yield dependencies for setup plus teardown
**Why**: Generator-style dependencies give a structured cleanup phase.

```python
from collections.abc import Generator

from litestar import Litestar, get
from litestar.di import Provide


def provide_resource() -> Generator[dict[str, bool], None, None]:
    resource = {"open": True}
    try:
        yield resource
    finally:
        resource["open"] = False


@get("/")
def index(resource: dict[str, bool]) -> dict[str, bool]:
    return resource


app = Litestar(route_handlers=[index], dependencies={"resource": Provide(provide_resource)})
```

**Warning**: Cleanup runs after the handler returns but before the HTTP response is sent.

### 6. Always use `try/finally` around yielded resources
**Why**: Cleanup must run whether the handler succeeds or fails.

```python
from collections.abc import Generator


def provide_session() -> Generator[str, None, None]:
    session = "open"
    try:
        yield session
    finally:
        session = "closed"
```

**Warning**: Cleanup exceptions are re-raised later as `ExceptionGroup`, so sloppy cleanup can create secondary failure noise.

### 7. Do not re-raise handler exceptions from inside yield dependencies
**Why**: Litestar already propagates request exceptions through the normal error mechanism.

```python
from collections.abc import Generator


def transactional_dependency() -> Generator[str, None, None]:
    try:
        yield "session"
    except ValueError:
        # rollback here if needed
        pass
    finally:
        # close here
        pass
```

**Warning**: Re-raising from the dependency cleanup path is usually redundant and can obscure the original failure.

### 8. Use `Dependency(...)` as a marker when a parameter is conceptually a dependency
**Why**: The marker prevents Litestar from mis-documenting a defaulted dependency as a query parameter and lets it fail fast when a required dependency is missing.

```python
from typing import Annotated

from litestar import Litestar, get
from litestar.params import Dependency


@get("/")
def index(optional_flag: Annotated[int, Dependency(default=3)]) -> dict[str, int]:
    return {"optional_flag": optional_flag}


app = Litestar(route_handlers=[index])
```

**Warning**: Without the marker, a defaulted dependency-like parameter can appear in OpenAPI as a query param.

### 9. Use `Dependency()` with no default when missing configuration must fail at startup
**Why**: Explicit dependency markers catch missing dependency wiring early.

```python
from typing import Annotated

from litestar import Litestar, get
from litestar.params import Dependency


@get("/")
def index(required_service: Annotated[int, Dependency()]) -> dict[str, int]:
    return {"required_service": required_service}


app = Litestar(route_handlers=[index])
```

**Warning**: Without the marker, Litestar may assume the parameter is a request input instead of a missing dependency.

### 10. Override dependencies by redeclaring the same key at a lower layer
**Why**: Lower layers override higher-layer dependencies with the same key.

```python
from litestar import Controller, get
from litestar.di import Provide


def provide_prod() -> str:
    return "prod"


def provide_test() -> str:
    return "test"


class DemoController(Controller):
    path = "/demo"
    dependencies = {"mode": Provide(provide_prod)}

    @get("/override", dependencies={"mode": Provide(provide_test)})
    def override(self, mode: str) -> dict[str, str]:
        return {"mode": mode}
```

**Warning**: This is override behavior, not accumulation. Only one dependency value is injected for a key.

### 11. Use dependencies within dependencies when the composition is meaningful
**Why**: Dependency providers can themselves receive injected values.

```python
from litestar import Litestar, get
from litestar.di import Provide


def provide_number() -> int:
    return 6


def provide_is_even(number: int) -> bool:
    return number % 2 == 0


@get("/")
def index(is_even: bool) -> dict[str, bool]:
    return {"is_even": is_even}


app = Litestar(
    route_handlers=[index],
    dependencies={"number": Provide(provide_number), "is_even": Provide(provide_is_even)},
)
```

**Warning**: Deep dependency graphs become opaque fast. If the chain hides business logic, refactor.

### 12. Use handler-level `dto` and `return_dto` to separate inbound and outbound contracts
**Why**: Litestar DTOs control decoding for `data` and encoding for return values.

```python
from litestar import post

from .models import User, UserDTO, UserReturnDTO


@post("/users", dto=UserDTO, return_dto=UserReturnDTO)
def create_user(data: User) -> User:
    return data
```

**Warning**: If `return_dto` is omitted, Litestar reuses `dto` for output too. That is convenient until it is wrong.

### 13. Set `return_dto=None` when you want full manual response encoding
**Why**: This disables implicit output DTO handling while still allowing inbound DTO parsing.

```python
from litestar import post

from .models import User, UserDTO


@post("/users", dto=UserDTO, return_dto=None, sync_to_thread=False)
def create_user(data: User) -> bytes:
    return data.name.encode("utf-8")
```

**Warning**: Do not forget this when returning raw bytes or a custom response shape. Otherwise the DTO layer may try to encode something it should not.

### 14. Put DTOs on controllers or routers when the contract is shared across endpoints
**Why**: DTO layering reduces duplication and keeps a resource boundary consistent.

```python
from litestar import Controller, get, post

from .models import User, UserReadDTO, UserWriteDTO


class UserController(Controller):
    path = "/users"
    dto = UserWriteDTO
    return_dto = UserReadDTO

    @post("/")
    def create_user(self, data: User) -> User:
        return data

    @get("/")
    def list_users(self) -> list[User]:
        return []
```

**Warning**: A handler-level DTO will override the controller-level DTO. That can be good or a source of inconsistency.

### 15. Be version-aware with DTO codegen notes
**Why**: The docs note that DTO codegen became stable and enabled by default in 2.8.0, while older feature-flag guidance still exists for historical reasons.

- Prefer current DTO behavior unless the codebase explicitly disables it.
- Treat old `ExperimentalFeatures.DTO_CODEGEN` references as migration context, not default guidance.

**Warning**: Do not cargo-cult deprecated feature flags into current code.
