---
domain: Litestar Websockets and Testing
category: backend
priority: high
---

# Litestar Websockets and Testing Reference

Use this file for websocket APIs, connection-scoped behavior, stream pitfalls, websocket tests, and Litestar's testing utilities.

### 1. Pick the right websocket API: low-level `@websocket`, `@websocket_listener`, or `@websocket_stream`
**Why**: Litestar exposes different websocket abstractions for different workloads.

- `@websocket` -> low-level socket control
- `@websocket_listener` -> message-in, message-out endpoint style
- `@websocket_stream` -> proactive server push from an async generator

**Warning**: Do not default to the low-level API when a listener or stream matches the job. That is unnecessary complexity.

### 2. Use `@websocket` only when you truly need direct socket orchestration
**Why**: Low-level handlers must accept the socket, handle accept or close, and manage the loop themselves.

```python
from litestar import WebSocket, websocket


@websocket("/ws")
async def socket_handler(socket: WebSocket) -> None:
    await socket.accept()
    await socket.send_json({"status": "ready"})
    await socket.close()
```

**Warning**: Low-level handlers must be async, must accept `socket`, and must return `None`.

### 3. Prefer `@websocket_listener` for request-like websocket message handling
**Why**: Listeners parse incoming data and serialize outgoing data for you.

```python
from litestar import Litestar, websocket_listener


@websocket_listener("/")
async def echo(data: str) -> str:
    return data


app = Litestar([echo])
```

**Warning**: Listener JSON input is parsed but currently not fully validated like HTTP route input.

### 4. Know the listener data rules: `str`, `bytes`, or JSON-ish types
**Why**: Listener type annotations control how incoming and outgoing frames are handled.

```python
from litestar import Litestar, websocket_listener


@websocket_listener("/")
async def handle_json(data: dict[str, str]) -> dict[str, str]:
    return data


app = Litestar([handle_json])
```

**Warning**: If you want bytes or text specifically, annotate for it. Otherwise Litestar assumes JSON-oriented handling.

### 5. Use `receive_mode` and `send_mode` only for actual transport needs
**Why**: Text and binary mode describe transport framing, not Python type semantics.

```python
from litestar import Litestar, websocket_listener


@websocket_listener("/binary", receive_mode="binary", send_mode="binary")
async def binary_echo(data: bytes) -> bytes:
    return data


app = Litestar([binary_echo])
```

**Warning**: A listener in binary receive mode will ignore text-channel events.

### 6. Remember websocket dependencies are connection-scoped, not message-scoped
**Why**: Dependencies on listeners and streams are evaluated for the route-handler lifetime.

```python
from litestar import Litestar, websocket_listener
from litestar.di import Provide


def provide_prefix() -> str:
    return "srv:"


@websocket_listener("/", dependencies={"prefix": Provide(provide_prefix)})
async def prefixed(data: str, prefix: str) -> str:
    return prefix + data


app = Litestar([prefixed])
```

**Warning**: Do not expect the provider to rerun for every incoming message.

### 7. Do not hold scarce resources in websocket stream dependencies for long-lived streams
**Why**: Stream dependencies live for the full stream lifetime, which may be indefinite.

```python
import asyncio
from collections.abc import AsyncGenerator

from litestar import Litestar, websocket_stream


LOCK = asyncio.Lock()


@websocket_stream("/")
async def stream_ticks() -> AsyncGenerator[int, None]:
    counter = 0
    while True:
        async with LOCK:
            counter += 1
            yield counter
        await asyncio.sleep(1)


app = Litestar([stream_ticks])
```

**Warning**: Acquiring a DB session or lock in a stream dependency can pin that resource until disconnect.

### 8. Use `allow_data_discard=True` only when incoming stream data is truly irrelevant
**Why**: Stream handlers normally watch for disconnects by reading the socket, which can conflict with application reads.

- Default behavior protects against silent data loss.
- If incoming messages should be ignored, opt in deliberately.

**Warning**: If you need concurrent receive plus proactive sending, a manual combined pattern is safer than pretending the data does not matter.

### 9. Use `send_websocket_stream()` for simultaneous receive and proactive streaming
**Why**: Combined stream-and-receive patterns need explicit orchestration.

```python
import anyio
from collections.abc import AsyncGenerator

from litestar import Litestar, WebSocket, websocket
from litestar.exceptions import WebSocketDisconnect
from litestar.handlers import send_websocket_stream


@websocket("/")
async def handler(socket: WebSocket) -> None:
    await socket.accept()
    stop = anyio.Event()

    async def produce() -> AsyncGenerator[str, None]:
        while not stop.is_set():
            yield "ping"
            await anyio.sleep(0.5)

    async def consume() -> None:
        async for event in socket.iter_json():
            await socket.send_json(event)

    try:
        async with anyio.create_task_group() as tg:
            tg.start_soon(send_websocket_stream, socket, produce())
            tg.start_soon(consume)
    except WebSocketDisconnect:
        stop.set()


app = Litestar([handler])
```

**Warning**: If you disable disconnect listening, some other code path must handle disconnect or the stream may never stop.

### 10. Use the test client for ordinary HTTP and websocket contract tests
**Why**: Litestar's test clients sit on top of `httpx` and cover most endpoint testing needs without a real server.

```python
from litestar import MediaType, get
from litestar.testing import create_test_client


@get("/health", media_type=MediaType.TEXT, sync_to_thread=False)
def health() -> str:
    return "healthy"


def test_health() -> None:
    with create_test_client(route_handlers=[health]) as client:
        response = client.get("/health")
        assert response.text == "healthy"
```

**Warning**: If the test is just a plain endpoint contract, do not spin up a subprocess server unnecessarily.

### 11. Test websockets with `websocket_connect()`
**Why**: The built-in test client includes websocket helpers.

```python
from typing import Any

from litestar import WebSocket, websocket
from litestar.testing import create_test_client


def test_websocket() -> None:
    @websocket("/ws")
    async def websocket_handler(socket: WebSocket[Any, Any, Any]) -> None:
        await socket.accept()
        payload = await socket.receive_json()
        await socket.send_json({"message": payload})
        await socket.close()

    with create_test_client(route_handlers=[websocket_handler]).websocket_connect("/ws") as ws:
        ws.send_json({"hello": "world"})
        assert ws.receive_json() == {"message": {"hello": "world"}}
```

**Warning**: If the endpoint uses listener or stream behavior, test the actual protocol shape, not a simplified fake.

### 12. Use subprocess clients when the in-process client cannot emulate the transport correctly
**Why**: Infinite SSE or true live-server behaviors can deadlock or misbehave with the direct ASGI client.

```python
from collections.abc import AsyncIterator

import pytest

from litestar.testing import subprocess_async_client


@pytest.fixture(name="async_client")
async def fx_async_client() -> AsyncIterator:
    async with subprocess_async_client(workdir=".", app="my_app.main:app") as client:
        yield client
```

**Warning**: Do not use a subprocess client as the default test style. It is for cases the regular client cannot represent faithfully.

### 13. Use `RequestFactory` for unit-level request object tests
**Why**: `RequestFactory` is the narrow tool for code that expects a `Request` object instead of a full HTTP round trip.

```python
from litestar.testing import RequestFactory


request = RequestFactory().get("/")
assert request.url.path == "/"
```

**Warning**: This is not a replacement for route or middleware integration tests.

### 14. Use the blocking portal only when sync tests must call async helpers directly
**Why**: `TestClient` exposes an anyio portal for bridging sync tests and async functions.

```python
import anyio

from litestar.testing import create_test_client


def test_portal() -> None:
    async def compute(value: float) -> float:
        await anyio.sleep(0)
        return value

    with create_test_client(route_handlers=[] ) as client, client.portal() as portal:
        assert portal.call(compute, 1.5) == 1.5
```

**Warning**: If the test is already async, use `AsyncTestClient` instead of forcing sync indirection.
