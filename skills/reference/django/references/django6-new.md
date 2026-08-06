---
domain: django6-new
category: features
priority: critical
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django 6.0 Flagship Features Reference

Short, migration-focused patterns for the Django 6.0 features worth adopting first.

### 1. Define reusable template fragments with `{% partialdef %}` and `{% partial %}`
**Why**: Django 6.0 partials let one template define and reuse named fragments without splitting everything into extra files. See `templates.md` for the full partials reference.

```htmldjango
{% partialdef product_card %}
    <article>
        <h2>{{ product.name }}</h2>
        <p>{{ product.category.name }}</p>
    </article>
{% endpartialdef product_card %}

{% for product in products %}
    {% partial product_card %}
{% endfor %}
```

**Warning**: Partials need Django 6.0+, render with the current context, and do not replace normal template inheritance.

### 2. Render a single fragment directly with `template.html#partial_name`
**Why**: Fragment addressing keeps one template as the source of truth while letting a view render only the needed section. See `templates.md` for direct fragment loading details.

```python
from django.shortcuts import get_object_or_404, render

from .models import Product


def product_card(request, product_id):
    product = get_object_or_404(Product, pk=product_id)
    return render(
        request,
        "catalog/products.html#product_card",
        {"product": product},
    )
```

**Warning**: `template.html#partial_name` only works when that partial is defined in the target template with `partialdef`.

### 3. Define background work with `@task` and enqueue it after commit
**Why**: Django 6.0 gives background work a first-party contract, but writes and task enqueueing still need transaction discipline. See `async-tasks.md` for the full tasks reference.

```python
from functools import partial

from django.db import transaction
from django.tasks import task


@task(queue_name="emails")
def send_order_receipt(order_id, email_address):
    return {"order_id": order_id, "email": email_address}


transaction.on_commit(partial(send_order_receipt.enqueue, 42, "user@example.com"))
```

**Warning**: Do not enqueue work that depends on uncommitted rows; use `transaction.on_commit()` or workers may run before the data exists.

### 4. Configure task backends deliberately for development and tests
**Why**: The built-in backends are for local feedback, not production execution. See `async-tasks.md` for backend trade-offs and worker integration.

```python
TASKS = {
    "default": {
        "BACKEND": "django.tasks.backends.immediate.ImmediateBackend",
    },
    "test": {
        "BACKEND": "django.tasks.backends.dummy.DummyBackend",
    },
}
```

**Warning**: `ImmediateBackend` runs work inline, and `DummyBackend` never executes it; neither is a real production queue.

### 5. Start CSP with middleware, policy settings, and nonces
**Why**: Django 6.0 ships first-party CSP support, so you can stop relying on third-party middleware for the core policy flow. See `auth-security.md` for the full CSP reference.

```python
from django.utils.csp import CSP

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
]

SECURE_CSP = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF, CSP.NONCE],
    "img-src": [CSP.SELF, "https:"],
}

TEMPLATES = [{
    "OPTIONS": {
        "context_processors": ["django.template.context_processors.csp"],
    }
}]
```

```htmldjango
<script nonce="{{ csp_nonce }}">
    window.categoryFilterReady = true;
</script>
```

**Warning**: A nonce only works when the matching request context exposes `csp_nonce`, and cached HTML must not reuse stale nonces.

### 6. Override CSP per view instead of weakening the global policy
**Why**: A strict base policy is maintainable only if narrow exceptions stay close to the view that needs them. See `auth-security.md` for override semantics and report-only usage.

```python
from django.http import HttpResponse
from django.utils.csp import CSP
from django.views.decorators.csp import csp_override


@csp_override({"default-src": [CSP.SELF], "img-src": [CSP.SELF, "data:"]})
def category_badge_preview(request):
    return HttpResponse("ok")
```

**Warning**: `@csp_override()` replaces the base policy for that view; it does not merge additional directives into it.

### 7. Treat Django email objects as wrappers around Python’s modern email API
**Why**: Django 6.0 now builds messages on Python’s modern `email.message.EmailMessage`, which changes extension and attachment expectations. See `testing.md` for email assertions and the Django email docs for the full mail API surface.

```python
import email.utils
from email.message import MIMEPart
from email.policy import SMTP

from django.core.mail import EmailMessage

from .models import User

user = User(email="user@example.com")
message = EmailMessage(
    subject="Order ready",
    body="Your order is ready.",
    from_email="store@example.com",
    to=[user.email],
)
attachment = MIMEPart()
attachment.set_content(
    b"order-summary",
    maintype="application",
    subtype="octet-stream",
    filename="order.txt",
    disposition="attachment",
    cid=email.utils.make_msgid(),
)
message.attach(attachment)
python_email = message.message(policy=SMTP)
```

**Warning**: Optional email helper arguments are moving to keyword-only style, and legacy `MIMEBase` attachment patterns are deprecated in Django 6.0.

### 8. Use `CompositePrimaryKey` only when the natural key is worth the cost
**Why**: Composite keys now exist, but they still complicate relations, forms, and admin usage compared with a surrogate `id`. See `models-orm.md` for the broader ORM trade-offs.

```python
from django.db import models


class Product(models.Model):
    name = models.CharField(max_length=100)


class Order(models.Model):
    reference = models.CharField(max_length=20, primary_key=True)


class OrderItem(models.Model):
    pk = models.CompositePrimaryKey("order_id", "product_id")
    order = models.ForeignKey(Order, on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
```

**Warning**: `ForeignKey` support to composite-key models is still limited, and Django admin cannot manage those models directly yet.

### 9. Let `GeneratedField` keep derived columns in the database
**Why**: Generated columns centralize calculation rules and Django 6.0 refreshes values after `save()` on supporting backends. See `models-orm.md` for more generated-field examples.

```python
from django.db import models
from django.db.models import F


class Order(models.Model):
    subtotal_cents = models.IntegerField()
    shipping_cents = models.IntegerField()
    total_cents = models.GeneratedField(
        expression=F("subtotal_cents") + F("shipping_cents"),
        output_field=models.IntegerField(),
        db_persist=True,
    )
```

**Warning**: Auto-refresh after `save()` is backend-dependent; on MySQL and MariaDB the field becomes deferred and refreshes on later access.

### 10. Use `AsyncPaginator` and `AsyncPage` inside async views
**Why**: Async pagination removes the last obvious sync-only paginator calls from async request flows. See `async-tasks.md` for async patterns and `views-urls.md` for view-level pagination examples.

```python
from django.core.paginator import AsyncPaginator
from django.http import JsonResponse

from .models import Product


async def product_feed(request):
    paginator = AsyncPaginator(Product.objects.order_by("name"), 20)
    page = await paginator.aget_page(request.GET.get("page"))
    products = await page.aget_object_list()
    return JsonResponse(
        {"count": await paginator.acount(), "has_next": await page.ahas_next()}
    )
```

**Warning**: Async paginator methods must be awaited, and unstable ordering still breaks pagination exactly like it does in sync code.

### 11. Use the general `StringAgg()` instead of backend-specific versions
**Why**: Django 6.0 makes `StringAgg()` generally available, so grouped string summaries no longer need PostgreSQL-only imports. See `models-orm.md` for aggregate patterns and grouped annotations.

```python
from django.db.models import StringAgg, Value

category_names = Product.objects.values("category_id").annotate(
    product_names=StringAgg("name", delimiter=Value(", "), order_by="name")
)
```

**Warning**: Aggregates still need deterministic grouping and ordering; `StringAgg()` does not fix duplicated join rows for you.

### 12. Use `AnyValue()` when grouped queries need one representative scalar
**Why**: Some grouped queries need one non-aggregate expression to survive SQL validation, and `AnyValue()` now gives that escape hatch. See `models-orm.md` for grouped annotation guidance.

```python
from django.db.models import AnyValue, Count

category_summary = Product.objects.values("category_id").annotate(
    category_name=AnyValue("category__name"),
    product_count=Count("id"),
)
```

**Warning**: `AnyValue()` returns an arbitrary non-null value; use it only when any representative value is genuinely acceptable.

### 13. Use `as_div()` as the default fast form layout
**Why**: `as_div()` is the modern built-in renderer for quick forms when you do not need full manual markup yet. See `forms-validation.md` for rendering and manual field layout patterns.

```htmldjango
<form method="post">
    {% csrf_token %}
    {{ form.as_div }}
</form>
```

**Warning**: `as_div()` renders fields, not the outer `<form>` element or actions, so real layouts still need explicit wrappers and submit controls.

### 14. Make the `BigAutoField` default explicit when upgrading mixed projects
**Why**: Django 6.0 now defaults `DEFAULT_AUTO_FIELD` to `BigAutoField`, so older apps with implicit `AutoField` assumptions need a conscious migration choice. See `settings-config.md` for the full settings reference.

```python
from django.apps import AppConfig

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


class CatalogConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "catalog"
```

**Warning**: If an older app must stay on `AutoField`, pin it explicitly instead of assuming pre-6.0 behavior will remain.
