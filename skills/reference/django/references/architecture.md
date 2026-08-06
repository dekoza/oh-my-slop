---
domain: Django Architecture
category: architecture
priority: high
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: community patterns
---

# Django Architecture Reference

Use these patterns when deciding how to split a Django codebase, wire dependencies, and keep operations predictable.

### 1. Cross-context imports use public API, not internal modules

**Why**: Public exports let one app depend on another app's contract instead of its internal file layout.

```python
# ❌ Bad
from apps.catalog.services.pricing import calculate_price

# ✅ Good
from apps.catalog import calculate_price

# apps/catalog/__init__.py
from apps.catalog.services.pricing import calculate_price

__all__ = ["calculate_price"]
```

**Warning**: If `__init__.py` creates import loops, expose the symbol lazily with `__getattr__` from pattern 2.

### 2. Circular imports are resolved with deferred imports and PEP 562 lazy loading

**Why**: Django apps often depend on each other. Deferred imports and lazy module exports break the cycle without flattening the domain.

```python
# ✅ Deferred import inside a function
def process_payment(order_id: int) -> None:
    # Circular import: orders.models imports payments.api
    from apps.orders.models import Order

    order = Order.objects.get(pk=order_id)
    order.payment_status = "pending"
    order.save(update_fields=["payment_status"])

# apps/catalog/__init__.py
def __getattr__(name: str):
    if name == "Product":
        from apps.catalog.models import Product
        return Product
    raise AttributeError(name)
```

**Warning**: Inline imports are a last resort. If you cannot explain the cycle, your boundaries are probably wrong.

### 3. Append-only ledgers beat mutable counters for stock and money

**Why**: Auditability disappears when you overwrite balances. Ledger rows preserve history and allow reconciliation.

```python
# ❌ Bad
variant.stock = 10
variant.save()

# ✅ Good
InventoryEntry.objects.create(
    variant=variant,
    quantity=10,
    source="vendor_delivery",
    document_id=delivery.id,
    created_by=request.user,
)

current_stock = InventoryEntry.objects.filter(variant=variant).aggregate(
    total=Sum("quantity"),
)["total"] or 0
```

**Warning**: Never mix a mutable `stock` field with a ledger unless one is explicitly declared as a cache with a repair path.

### 4. Singleton configuration belongs in the database only for runtime-tunable settings

**Why**: Feature flags and operational thresholds sometimes need admin editing without a deploy.

```python
from django.db import models
from solo.models import SingletonModel


class SiteSettings(SingletonModel):
    enable_payments = models.BooleanField(default=True)
    low_stock_threshold = models.IntegerField(default=5)
    max_discount_percent = models.IntegerField(default=50)
```

**Warning**: Do not move secrets or boot-critical configuration into a singleton model. Startup must not depend on database state.

### 5. Each Django app is a bounded context, not a random folder

**Why**: Apps should map to business capabilities, not to framework layers. This keeps change localized.

```text
apps/
  users/
  catalog/
  orders/
  payments/
  shared/
```

```python
# ✅ Cross-app access goes through a public API
from apps.catalog import get_product_price
```

**Warning**: A `utils` or `common` app becomes a junk drawer fast. Keep shared code small and generic.

### 6. Services accept injected dependencies instead of hardcoding them

**Why**: Dependency injection keeps orchestration testable and makes external integrations replaceable.

```python
class OrderService:
    def __init__(self, customer_repo=None):
        self.customer_repo = customer_repo or CustomerRepository()

    def create_order(self, customer_id: int):
        customer = self.customer_repo.get(customer_id)
        order = Order.objects.create(customer=customer)
        return order
```

**Warning**: Do not add a container framework for trivial code. Constructor arguments are enough for most Django services.

### 7. Split projects and apps by deployment boundary first, then by domain

**Why**: A project package wires settings, URLs, ASGI/WSGI, and startup. Apps implement domain behavior.

```text
config/
  settings/
  urls.py
  asgi.py
  wsgi.py
apps/
  billing/
  inventory/
  users/
```

**Warning**: Do not create an app per model. Split only when a domain has its own workflows, permissions, or integrations.

### 8. Name apps by business capability, not by Django primitive

**Why**: `orders`, `billing`, and `warehouse` communicate intent; `models`, `services`, and `helpers` do not.

```text
# ❌ Bad
apps/
  api/
  core/
  utils/

# ✅ Better
apps/
  checkout/
  fulfillment/
  customer_accounts/
```

**Warning**: A vague app name usually hides mixed responsibilities and guarantees future refactors.

### 9. Prefer component-based settings for long-lived projects

**Why**: Component-based settings isolate concerns like database, logging, and security better than one giant module.

```python
# config/settings/__init__.py
from split_settings.tools import include, optional

include(
    "components/base.py",
    "components/database.py",
    "components/logging.py",
    optional("local.py"),
)
```

**Warning**: `django-split-settings` helps when settings are large. For very small projects, extra indirection is pointless.

### 10. Inheritance-based settings work, but only when environment differences are small

**Why**: A `base.py` plus `local.py`, `test.py`, and `production.py` can be simpler than component-based settings for small teams.

```python
# config/settings/production.py
from .base import *

DEBUG = False
SECURE_SSL_REDIRECT = True
```

**Warning**: Inheritance-based settings become brittle when each environment overrides dozens of values. At that point, switch to component-based settings.

### 11. Environment loading must be explicit and deterministic

**Why**: Hidden `.env` behavior causes production drift. The project must state what reads environment variables and when.

```python
# django-environ: typed values and DATABASE_URL parsing
import environ

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")
DATABASES = {"default": env.db("DATABASE_URL")}

# python-decouple: simple scalar config
from decouple import config

DEBUG = config("DEBUG", default=False, cast=bool)
SECRET_KEY = config("SECRET_KEY")
```

**Warning**: Pick one primary approach. Mixing `python-decouple`, `django-environ`, raw `os.environ`, and dotenv loaders creates nondeterministic config.

### 12. Use a custom user model from day one

**Why**: Swapping `auth.User` after migrations spread through the project is painful and usually botched.

```python
# settings.py
AUTH_USER_MODEL = "users.User"

# apps/users/models.py
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    preferred_language = models.CharField(max_length=8, default="pl")
```

**Warning**: Never reference `django.contrib.auth.models.User` directly in models. Use `settings.AUTH_USER_MODEL` or `get_user_model()`.

### 13. Use string model references and the app registry to reduce startup coupling

**Why**: Lazy foreign keys and `apps.get_model()` avoid import-time coupling across apps.

```python
class Invoice(models.Model):
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT)


def rebuild_projection(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    for order in Order.objects.iterator():
        OrderProjection.objects.update_or_create(
            order_id=order.pk,
            defaults={"total_amount": order.calculate_total()},
        )
```

**Warning**: String references solve model loading issues, not bad boundaries. If apps constantly need each other's internals, the design is still wrong.

### 14. Keep domain workflows in service modules, not in views and not in obese models

**Why**: Views should translate HTTP. Models should protect invariants. Multi-step business processes belong in services.

```python
# apps/orders/services.py
@transaction.atomic
def place_order(*, customer, lines, actor):
    order = Order.objects.create(customer=customer, created_by=actor)
    reserve_inventory(order=order, lines=lines)
    emit_order_created(order)
    return order
```

**Warning**: "Fat models" becomes a slogan when people start cramming payment gateways, emails, and stock logic into `save()`.

### 15. Add a repository pattern only for complex query boundaries

**Why**: Repository pattern helps when read models, reporting queries, or external persistence concerns would otherwise leak everywhere.

```python
class OrderRepository:
    def get_open_for_customer(self, customer_id: int):
        return (
            Order.objects.filter(customer_id=customer_id, status=Order.Status.OPEN)
            .select_related("customer")
            .prefetch_related("lines")
        )
```

**Warning**: Wrapping every `objects.get()` in a repository pattern is ceremony, not architecture.

### 16. Structured logging needs JSON output and per-request context

**Why**: Plain text logs are useless once requests cross workers, queues, and services. Structured logs are queryable.

```python
import structlog
from structlog.contextvars import bind_contextvars, clear_contextvars

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()

def log_middleware(get_response):
    def middleware(request):
        clear_contextvars()
        bind_contextvars(request_id=request.headers.get("X-Request-ID"))
        return get_response(request)
    return middleware
```

**Warning**: If you cannot correlate logs by request, tenant, or job id, your logging stack is half-built.

### 17. Docker images should be multi-stage and run as a non-root user

**Why**: Multi-stage builds keep images small, and non-root containers reduce damage from compromise and host permission bugs.

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY . .
RUN useradd -m appuser
USER appuser
CMD ["/app/.venv/bin/gunicorn", "config.wsgi:application"]
```

**Warning**: Setting `USER` too early breaks package installation. Setting it never is worse.

**Alternative using pip:**

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .
RUN useradd -m appuser
USER appuser
CMD ["gunicorn", "config.wsgi:application"]
```

### 18. Containers need healthchecks, `tini`, and one clear process entry point

**Why**: Django does not manage Unix signals for you. Proper init and health probes make deploys and restarts predictable.

```dockerfile
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/.venv/bin/gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
```

```yaml
healthcheck:
  test: ["CMD-SHELL", "python manage.py check --deploy || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
```

**Warning**: Do not use `runserver` in containers outside local development. It is the wrong process model.

### 19. Consider separating test infrastructure from the development stack

**Why**: Integration and browser tests benefit from isolation. A separate `compose.test.yml` can prevent port collisions and lifecycle coupling.

```yaml
services:
  testdb:
    image: postgres:16
    networks: [test-net]

  tests:
    build:
      context: .
      dockerfile: Dockerfile.test
    depends_on:
      testdb:
        condition: service_healthy
    networks: [test-net]
```

**Warning**: If test services live inside the main compose stack, developers may accidentally break or reuse them.

### 20. Management commands are operational entry points, not dumping grounds

**Why**: Scheduled jobs, backfills, and repair tasks need stable entry points with parsing, logging, and exit codes.

```python
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Rebuild order projections"

    def handle(self, *args, **options):
        try:
            rebuild_order_projection()
        except ProjectionError as exc:
            raise CommandError(str(exc)) from exc
```

**Warning**: Keep business logic in regular modules. Commands should orchestrate input, logging, and failure handling.
