---
domain: async-tasks
category: async
priority: high
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: community patterns
---

# Django Async Tasks Reference

Practical patterns for async views, async-safe ORM usage, and Django 6.0 background tasks.

### 1. Prefer async views for concurrent I/O, not CPU-bound work
**Why**: Async views help when one request waits on multiple external operations, but they do not make CPU-heavy Python code faster.

```python
import asyncio

from django.http import JsonResponse


async def fetch_inventory_metrics():
    await asyncio.sleep(0.2)
    return {"available": 42}


async def fetch_shipping_metrics():
    await asyncio.sleep(0.2)
    return {"pending": 3}


async def dashboard_metrics_view(request):
    inventory_metrics, shipping_metrics = await asyncio.gather(
        fetch_inventory_metrics(),
        fetch_shipping_metrics(),
    )

    return JsonResponse(
        {
            "inventory": inventory_metrics,
            "shipping": shipping_metrics,
        }
    )
```

**Warning**: If the view mostly compresses files, resizes images, or crunches numbers, keep it sync or move the work into a background task.

### 2. Build querysets synchronously and await only terminal async ORM methods
**Why**: Query construction stays synchronous; the safe rule is to compose the queryset first and await a terminal method such as `aget()`, `acreate()`, `asave()`, `adelete()`, `acount()`, `aexists()`, or `abulk_create()`.

```python
from django.http import JsonResponse


async def order_summary_view(request, order_id):
    order_queryset = Order.objects.select_related("user").filter(user__is_active=True)
    order = await order_queryset.aget(pk=order_id)
    open_orders = await Order.objects.filter(user=order.user, status="open").acount()
    has_products = await Product.objects.filter(order=order).aexists()

    return JsonResponse(
        {
            "order_id": order.pk,
            "user_email": order.user.email,
            "open_orders": open_orders,
            "has_products": has_products,
        }
    )
```

**Warning**: Do not invent a-prefixed chaining methods. Query construction stays synchronous; only terminal async methods are awaited.

### 3. Use async create, save, delete, and bulk create for terminal writes
**Why**: Django 6.0 exposes async write helpers for the terminal operations you actually await.

```python
async def seed_category_view(request):
    category = await Category.objects.acreate(name="Featured")

    product = Product(name="Starter Pack", category=category, price="19.99")
    await product.asave()

    extra_products = [
        Product(name="Bundle A", category=category, price="29.99"),
        Product(name="Bundle B", category=category, price="39.99"),
    ]
    await Product.objects.abulk_create(extra_products)

    archived_products = Product.objects.filter(category=category, archived=True)
    deleted_count, _ = await archived_products.adelete()

    return {"category_id": category.pk, "deleted_count": deleted_count}
```

**Warning**: Keep the whole database interaction inside Django ORM calls; do not pass raw connection objects across async boundaries.

### 4. Keep transactions in synchronous helpers and call them with `sync_to_async()`
**Why**: Transaction management is still a sync boundary, so atomic multi-step writes belong in one synchronous function.

```python
from asgiref.sync import sync_to_async
from django.db import transaction


def finalize_order_sync(order_id):
    with transaction.atomic():
        order = Order.objects.select_for_update().select_related("user").get(pk=order_id)
        order.status = "confirmed"
        order.save(update_fields=["status"])
        return {"order_id": order.pk, "user_id": order.user_id}


async def finalize_order_view(request, order_id):
    payload = await sync_to_async(finalize_order_sync, thread_sensitive=True)(order_id)
    return payload
```

**Warning**: Do not scatter transactional ORM work across several awaited calls; that breaks the transaction boundary.

### 5. Use `sync_to_async()` and `async_to_sync()` only at explicit edges
**Why**: These adapters are for boundary crossings, not a license to mix calling styles everywhere.

```python
from asgiref.sync import async_to_sync, sync_to_async


def load_user_sync(user_id):
    return User.objects.get(pk=user_id)


async def fetch_profile(user_id):
    user = await sync_to_async(load_user_sync, thread_sensitive=True)(user_id)
    return {"id": user.pk, "email": user.email}


async def publish_order_update(order_id):
    return {"order_id": order_id, "status": "sent"}


def publish_from_signal(order_id):
    return async_to_sync(publish_order_update)(order_id)
```

**Warning**: Default to `thread_sensitive=True` for Django ORM access. Database adapters and request-local state are thread-sensitive.

### 6. Write middleware that can run in sync and async stacks
**Why**: Hybrid middleware avoids unnecessary request adaptation and preserves async performance under ASGI.

```python
from asgiref.sync import iscoroutinefunction
from django.utils.decorators import sync_and_async_middleware


@sync_and_async_middleware
def request_id_middleware(get_response):
    if iscoroutinefunction(get_response):

        async def middleware(request):
            request.request_id = request.headers.get("X-Request-ID", "generated-id")
            response = await get_response(request)
            response["X-Request-ID"] = request.request_id
            return response

    else:

        def middleware(request):
            request.request_id = request.headers.get("X-Request-ID", "generated-id")
            response = get_response(request)
            response["X-Request-ID"] = request.request_id
            return response

    return middleware
```

**Warning**: One synchronous middleware in an otherwise async stack can force thread-per-request behavior and erase much of the async benefit.

### 7. Handle client disconnects in long-lived async views
**Why**: Slow streams, polling endpoints, and long-running API aggregation can be cancelled when the client disappears.

```python
import asyncio

from asgiref.sync import sync_to_async
from django.http import JsonResponse


def reset_refreshing_orders_sync():
    return Order.objects.filter(status="refreshing").update(status="pending")


async def inventory_refresh_view(request):
    try:
        await asyncio.sleep(2)
        return JsonResponse({"status": "refreshed"})
    except asyncio.CancelledError:
        await sync_to_async(reset_refreshing_orders_sync, thread_sensitive=True)()
        raise
```

**Warning**: Cleanup code must stay idempotent. A cancelled request is not a business-success path.

### 8. Paginate async querysets with `AsyncPaginator` and `AsyncPage`
**Why**: Django 6.0 adds async-native pagination so you do not have to drop back to synchronous pagination helpers in async views.

```python
from django.core.paginator import AsyncPaginator
from django.http import JsonResponse


async def product_list_view(request):
    page_number = int(request.GET.get("page", 1))
    queryset = Product.objects.filter(is_active=True).order_by("name")
    paginator = AsyncPaginator(queryset, per_page=20)
    page = await paginator.aget_page(page_number)
    items = await page.aget_object_list()

    return JsonResponse(
        {
            "page": page.number,
            "has_next": await page.ahas_next(),
            "count": await paginator.acount(),
            "product_ids": [product.pk for product in items],
        }
    )
```

**Warning**: Keep `orphans` smaller than `per_page`. Django 6.0 deprecates `orphans >= per_page`.

### 9. Define background work with `@task` and enqueue it from request code
**Why**: Django 6.0 background tasks formalize task definition, validation, enqueueing, and result tracking.

```python
from django.core.mail import send_mail
from django.http import JsonResponse
from django.tasks import task


@task(priority=5, queue_name="emails")
def send_order_confirmation(order_id, email):
    return send_mail(
        subject=f"Order {order_id} confirmed",
        message="Your order is being prepared.",
        from_email=None,
        recipient_list=[email],
    )


def confirm_order_view(request, order_id):
    order = Order.objects.select_related("user").get(pk=order_id)
    result = send_order_confirmation.enqueue(order_id=order.pk, email=order.user.email)
    return JsonResponse({"task_result_id": result.id, "status": result.status})
```

**Warning**: Django ships the task contract, not the worker process. Production still needs real execution infrastructure.

### 10. Configure `ImmediateBackend` and `DummyBackend` for development and tests
**Why**: Built-in backends are useful for local development, assertions, and migration toward background execution.

```python
TASKS = {
    "default": {
        "BACKEND": "django.tasks.backends.immediate.ImmediateBackend",
    },
    "tests": {
        "BACKEND": "django.tasks.backends.dummy.DummyBackend",
    },
}


def choose_backend(debug):
    return "default" if debug else "tests"
```

**Warning**: `ImmediateBackend` and `DummyBackend` are for development and testing. They are not production worker backends.

### 11. Adjust task defaults with `using()` and inspect attempts with `TaskContext`
**Why**: Task configuration belongs on the task object, and retry-aware logic should read context instead of inventing undocumented retry APIs.

```python
import logging
from datetime import timedelta

from django.tasks import task

logger = logging.getLogger(__name__)


@task(takes_context=True, queue_name="exports")
def export_order_snapshot(context, order_id):
    logger.info("Export attempt %s for order %s", context.attempt, order_id)
    if context.attempt < 3:
        raise ValueError("Temporary export failure")
    return {"order_id": order_id, "attempt": context.attempt}


delayed_export = export_order_snapshot.using(priority=10, run_after=timedelta(minutes=5))
```

**Warning**: The framework exposes attempt metadata, but retry execution policy still depends on the backend and worker you run.

### 12. Enqueue tasks only after the database commit succeeds
**Why**: A worker can pick up the task before uncommitted rows become visible on a different connection.

```python
from functools import partial

from django.db import transaction
from django.tasks import task


@task
def sync_order_to_erp(order_id):
    return {"order_id": order_id, "status": "queued"}


def create_order_view(request):
    with transaction.atomic():
        order = Order.objects.create(user=request.user, status="new")
        transaction.on_commit(partial(sync_order_to_erp.enqueue, order_id=order.pk))
    return {"order_id": order.pk}
```

**Warning**: Calling `.enqueue()` inside the transaction body is a race. The task can run before the row exists for the worker.

### 13. Test async views with `pytest.mark.asyncio` and Django `AsyncClient`
**Why**: Async views deserve async tests so the request path, awaited code, and async auth helpers are exercised directly.

```python
import pytest
from django.test import AsyncClient


@pytest.mark.asyncio
async def test_product_search_view():
    user = await User.objects.acreate(username="owner")
    client = AsyncClient()
    await client.aforce_login(user)

    response = await client.get("/products/search/", query_params={"q": "starter"})

    assert response.status_code == 200
```

**Warning**: `AsyncClient` does not support `follow=True` on its request methods. Test redirects explicitly.

### 14. Deploy async Django under ASGI, not just WSGI
**Why**: Async views under WSGI work, but the async stack benefits arrive only when the application runs through ASGI.

```python
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "myproject.settings")
application = get_asgi_application()

server_commands = {
    "uvicorn": "uvicorn myproject.asgi:application --workers 4",
    "daphne": "daphne myproject.asgi:application",
    "hypercorn": "hypercorn myproject.asgi:application",
}
```

**Warning**: Running async views behind WSGI adds adaptation overhead and loses efficient long-lived connection handling.

### 15. Reach for Channels only when you need WebSockets or bidirectional sessions
**Why**: Plain async views cover HTTP concurrency; WebSockets are a different transport and usually need `django-channels`.

```python
from channels.generic.websocket import AsyncJsonWebsocketConsumer


class OrderUpdatesConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.order_group_name = f"order-{self.scope['url_route']['kwargs']['order_id']}"
        await self.channel_layer.group_add(self.order_group_name, self.channel_name)
        await self.accept()

    async def order_status_changed(self, event):
        await self.send_json({"status": event["status"]})
```

**Warning**: Do not add Channels just because a view is async. Use it when you need WebSockets, fan-out, or server push.

### 16. Disable persistent DB connections in async mode and choose Celery only when the problem is bigger
**Why**: Async Django should avoid thread-local persistent connections, and Django tasks are enough until you truly need distributed scheduling, mature retries, or a large worker ecosystem.

```python
CONN_MAX_AGE = 0

TASKS = {
    "default": {
        "BACKEND": "django.tasks.backends.immediate.ImmediateBackend",
    }
}


def choose_background_strategy(needs_cron, needs_distributed_workers, queue_volume):
    if needs_cron or needs_distributed_workers or queue_volume == "high":
        return "evaluate_celery"
    return "use_django_tasks"
```

**Warning**: Django database connections are thread-local. In async mode, disable persistent connections and choose Celery only when operational requirements, not fashion, demand it.
