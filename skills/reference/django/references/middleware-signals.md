---
domain: middleware-signals
category: architecture
priority: high
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: production experience
---

# Django Middleware & Signals Reference

Request/response hooks and event hooks for generic Django 6.0 projects. Keep middleware low-level, keep receivers small, and prefer direct calls when you need explicit flow.

### 1. Keep middleware order dependency-safe
**Why**: Middleware order changes behavior. Security should run early, sessions must exist before auth, and CSRF must run after sessions.

```python
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
]
```

**Warning**: `AuthenticationMiddleware` depends on `SessionMiddleware`. Keep `SecurityMiddleware` near the top, keep `CsrfViewMiddleware` after sessions, and place `ContentSecurityPolicyMiddleware` low enough that later middleware can use its nonce support correctly.

### 2. Use a function-based middleware for simple request/response wrapping
**Why**: A function-based middleware is the shortest way to add one low-level behavior around every request.

```python
import uuid


def request_id_middleware(get_response):
    def middleware(request):
        request.request_id = uuid.uuid4().hex
        response = get_response(request)
        response["X-Request-ID"] = request.request_id
        return response

    return middleware
```

**Warning**: Use this style only for small cross-cutting behavior. Once you need hooks like `process_view()` or `process_exception()`, switch to a class.

### 3. Use a class-based middleware when you need one-time setup in `__init__()`
**Why**: `__init__()` runs once when Django starts, while `__call__()` runs per request.

```python
from django.conf import settings
from django.core.exceptions import MiddlewareNotUsed


class ResponseTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = getattr(settings, "ENABLE_RESPONSE_TIMING", True)
        if not self.enabled:
            raise MiddlewareNotUsed("ResponseTimingMiddleware is disabled.")

    def __call__(self, request):
        response = self.get_response(request)
        response["X-Response-Timing"] = "enabled"
        return response
```

**Warning**: Do not put per-request state on `self`. Middleware instances are shared across requests.

### 4. Use `process_view()` to short-circuit before the view executes
**Why**: `process_view()` sees the resolved view function and URL kwargs before Django calls the view.

```python
from django.http import HttpResponseForbidden


class StaffPreviewMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if view_kwargs.get("preview") and not request.user.is_staff:
            return HttpResponseForbidden("Staff access required.")
        return None
```

**Warning**: Avoid touching `request.POST` in `process_view()`. Doing that too early interferes with upload handler changes later in the request.

### 5. Use `process_exception()` only for exceptions raised by the view
**Why**: It lets you translate domain exceptions into a controlled response without burying view logic in `try`/`except` blocks.

```python
from django.http import JsonResponse


class OrderNotReady(Exception):
    pass


class OrderExceptionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        if isinstance(exception, OrderNotReady):
            return JsonResponse({"detail": "Order is not ready."}, status=409)
        return None
```

**Warning**: `process_exception()` is for exceptions from the view or template rendering path, not a general-purpose replacement for all middleware error handling.

### 6. Use `process_template_response()` to adjust `TemplateResponse` output late
**Why**: This hook lets middleware add or change context after the view returns but before the template renders.

```python
from myapp.models import Category


class TemplateDefaultsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_template_response(self, request, response):
        response.context_data = response.context_data or {}
        response.context_data.setdefault(
            "sidebar_categories",
            Category.objects.filter(is_active=True),
        )
        return response
```

**Warning**: This hook only runs for responses with a `render()` method. Plain `HttpResponse` objects skip it.

### 7. Write async middleware with `async def __call__()`
**Why**: Django 6.0 supports async middleware, but you need to mark the instance correctly so the async request path stays async.

```python
from asgiref.sync import iscoroutinefunction, markcoroutinefunction


class AsyncAuditMiddleware:
    async_capable = True
    sync_capable = False

    def __init__(self, get_response):
        self.get_response = get_response
        if iscoroutinefunction(get_response):
            markcoroutinefunction(self)

    async def __call__(self, request):
        response = await self.get_response(request)
        response["X-Audit-Mode"] = "async"
        return response
```

**Warning**: Do not declare async middleware casually. A sync/async mismatch works, but Django has to adapt the call stack at a performance cost.

### 8. Prefer built-in middleware settings over custom rewrites
**Why**: `SecurityMiddleware`, `CommonMiddleware`, `SessionMiddleware`, `CsrfViewMiddleware`, and `AuthenticationMiddleware` already solve common cross-cutting concerns.

```python
SECURE_SSL_REDIRECT = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
APPEND_SLASH = True

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]
```

**Warning**: Reimplementing these behaviors in custom middleware usually duplicates framework code badly and misses edge cases around redirects, cookies, and headers.

### 9. Use `ContentSecurityPolicyMiddleware` for Django 6.0 CSP support
**Why**: Django 6.0 adds first-party CSP middleware, so you no longer need custom response-header middleware for standard policy setup.

```python
from django.utils.csp import CSP

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
]

SECURE_CSP = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF, CSP.NONCE],
    "style-src": [CSP.SELF],
    "img-src": [CSP.SELF, "data:"],
}

SECURE_CSP_REPORT_ONLY = {
    "default-src": [CSP.SELF],
    "report-uri": "/csp-reports/",
}
```

**Warning**: Keep the deep CSP rules in `auth-security.md`. This file should only show the middleware integration point and the Django 6.0 settings surface.

### 10. Define custom signals sparingly and choose `send()` vs `send_robust()` on purpose
**Why**: Custom signals are useful when multiple independent listeners care about the same event, but they hide control flow.

```python
from django.dispatch import Signal

from myapp.models import Order

order_confirmed = Signal()


def notify_sales(sender, order, **kwargs):
    return f"sales:{order.pk}"


order_confirmed.connect(notify_sales)


def confirm_order(order):
    order.status = "confirmed"
    order.save(update_fields=["status"])
    strict_results = order_confirmed.send(sender=Order, order=order)
    robust_results = order_confirmed.send_robust(sender=Order, order=order)
    return strict_results, robust_results
```

**Warning**: If one function must definitely run before another, call it directly. Signals are the wrong abstraction for deterministic in-process workflows.

### 11. Register receivers with `@receiver` and import `signals` in `AppConfig.ready()`
**Why**: This keeps signal registration explicit and avoids side effects from importing application modules at the wrong time.

```python
import importlib

from django.apps import AppConfig
from django.db.models.signals import post_save
from django.dispatch import receiver

from myapp.models import Order


class ShopConfig(AppConfig):
    name = "myapp"

    def ready(self):
        importlib.import_module("myapp.signals")


@receiver(post_save, sender=Order)
def update_order_search_index(sender, instance, **kwargs):
    if instance.status == "confirmed":
        instance.search_document = f"order-{instance.pk}"
```

**Warning**: `ready()` can run more than once in tests. Duplicate connections are easy to create if your receiver is not a stable module-level function.

### 12. Filter model receivers by `sender`
**Why**: Model signals fire for many models. Narrowing the sender avoids wasted work and accidental side effects.

```python
from django.db.models.signals import pre_save
from django.dispatch import receiver

from myapp.models import Product


@receiver(pre_save, sender=Product)
def normalize_product_name(sender, instance, **kwargs):
    instance.name = instance.name.strip()
```

**Warning**: A receiver without `sender=Product` may run for every `pre_save` in the process, which is usually pointless and sometimes dangerous.

### 13. Use `pre_save` for normalization and `post_save` for created/update branching
**Why**: `pre_save` is the right place to clean an object before persistence, while `post_save` tells you whether the row was created.

```python
from django.core.cache import cache
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from myapp.models import Order, Product


@receiver(pre_save, sender=Product)
def populate_product_slug(sender, instance, **kwargs):
    if not instance.slug:
        instance.slug = instance.name.lower().replace(" ", "-")


@receiver(post_save, sender=Order)
def cache_order_state(sender, instance, created, **kwargs):
    if created:
        cache.set(f"order:{instance.pk}:state", instance.status)
    else:
        cache.delete(f"order:{instance.pk}:state")
```

**Warning**: `post_save` runs after `save()`, not after the transaction commits. Do not send irreversible side effects from it unless commit timing does not matter.

### 14. Use `pre_delete` and `post_delete` for cleanup around removal
**Why**: Delete signals help remove related files, cache keys, or audit markers when an object disappears.

```python
from django.core.cache import cache
from django.db.models.signals import post_delete, pre_delete
from django.dispatch import receiver

from myapp.models import Product


@receiver(pre_delete, sender=Product)
def remember_image_path(sender, instance, **kwargs):
    if instance.image:
        instance._deleted_image_name = instance.image.name


@receiver(post_delete, sender=Product)
def purge_product_cache(sender, instance, **kwargs):
    cache.delete(f"product:{instance.pk}")
```

**Warning**: Keep delete receivers idempotent. A failing cleanup task must not be the only thing standing between you and a valid delete.

### 15. Use `m2m_changed` for join-table events
**Why**: Many-to-many updates do not emit `post_save` for the relation itself, so use `m2m_changed` when category membership matters.

```python
from django.db.models.signals import m2m_changed
from django.dispatch import receiver

from myapp.models import Product


@receiver(m2m_changed, sender=Product.categories.through)
def update_category_count(sender, instance, action, pk_set, **kwargs):
    if action == "post_add" and pk_set:
        instance.category_count = instance.categories.count()
        instance.save(update_fields=["category_count"])
```

**Warning**: Use the through model as the sender. `sender=Product` is wrong for `m2m_changed`.

### 16. Use `request_started` and `request_finished` for lightweight request lifecycle hooks
**Why**: These signals are useful for coarse instrumentation that does not belong in application views.

```python
import logging

from django.core.signals import request_finished, request_started
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(request_started)
def log_request_start(sender, environ, **kwargs):
    logger.debug("request-start path=%s", environ.get("PATH_INFO"))


@receiver(request_finished)
def log_request_finish(sender, **kwargs):
    logger.debug("request-finished sender=%s", sender.__name__)
```

**Warning**: These receivers run for every request. Keep them tiny and avoid database work or network I/O.

### 17. Use `transaction.on_commit()` for side effects that must see committed data
**Why**: `post_save` fires before the surrounding transaction commits, so external systems can observe rows that later roll back.

```python
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from myapp.models import Order


def enqueue_receipt_email(order_id):
    return f"queued:{order_id}"


@receiver(post_save, sender=Order)
def send_receipt_after_commit(sender, instance, created, **kwargs):
    if not created or instance.status != "confirmed":
        return

    transaction.on_commit(lambda: enqueue_receipt_email(instance.pk))
```

**Warning**: Do not send emails, publish events, or invalidate shared caches directly inside `post_save` when the enclosing transaction can still fail.

### 18. Protect receiver registration with `dispatch_uid` and `weak=False` when needed
**Why**: Django stores receivers as weak references by default, and repeated imports or recreated bound methods can register duplicate handlers.

```python
from django.core.signals import request_finished


class MetricsBackend:
    def handle_request_finished(self, sender, **kwargs):
        return f"handled:{sender.__name__}"


backend = MetricsBackend()
request_finished.connect(
    backend.handle_request_finished,
    weak=False,
    dispatch_uid="metrics.request_finished",
)

request_finished.disconnect(dispatch_uid="metrics.request_finished")
```

**Warning**: Do not rely on receiver ordering for business rules. Registration order can become brittle across imports, tests, and mixed sync/async receivers.
