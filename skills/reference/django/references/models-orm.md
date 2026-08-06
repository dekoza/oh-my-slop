---
domain: Django Models & ORM
category: backend
priority: critical
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django Models & ORM Reference

Shared model and ORM patterns across Django projects, extended with advanced ORM usage and Django 6.0 features.

### 1. Prevent N+1 queries with `select_related()` and `prefetch_related()`
**Why**: Accessing related objects inside a loop without eager loading turns one query into many.

```python
# ❌ Bad: extra query for every order
for order in Order.objects.all():
    print(order.user.email)

# ✅ Good: join ForeignKey / OneToOne relations
for order in Order.objects.select_related("user"):
    print(order.user.email)

# ✅ Good: prefetch ManyToMany / reverse FK relations
products = Product.objects.prefetch_related("categories", "variants")
```

**Warning**: `select_related()` is for `ForeignKey` / `OneToOne`; `prefetch_related()` is for `ManyToMany` and reverse relations.

### 2. Add `distinct()` after filtering through M2M or reverse FK relations
**Why**: Joins through `variants`, `categories`, or other multi-row relations can duplicate the parent rows.

```python
# ❌ Bad: the same product can appear more than once
products = Product.objects.filter(variants__price__gt=0)

# ✅ Good: de-duplicate parent rows
products = Product.objects.filter(variants__price__gt=0).distinct()
```

**Warning**: Missing `distinct()` often breaks counts, pagination, and UI lists in subtle ways.

### 3. Bypass `auto_now=True` fields with `QuerySet.update()`
**Why**: Django overwrites manual values for `auto_now=True` fields on every `save()`.

```python
custom_time = timezone.now() - timedelta(days=1)

# ❌ Bad: Django replaces the manual value during save()
invoice.updated_at = custom_time
invoice.save()

# ✅ Good: update() bypasses model save() logic
Invoice.objects.filter(pk=invoice.pk).update(updated_at=custom_time)
invoice.refresh_from_db()
```

**Warning**: If you need an exact timestamp in tests, imports, or backfills, `save()` is the wrong tool.

### 4. Work around `auto_now_add=True` by creating first and updating second
**Why**: `auto_now_add=True` ignores provided values during object creation, including factory-created objects.

```python
custom_time = timezone.now() - timedelta(days=30)

# ❌ Bad: created_at is still set to "now"
invoice = Invoice.objects.create(number="INV-001", created_at=custom_time)

# ✅ Good: create first, then override with update()
invoice = Invoice.objects.create(number="INV-001")
Invoice.objects.filter(pk=invoice.pk).update(created_at=custom_time)
invoice.refresh_from_db()
```

**Warning**: The same workaround applies when a factory appears to accept `created_at` but Django silently discards it.

### 5. Use `select_for_update()` only inside an atomic block
**Why**: Row locks prevent concurrent requests from overwriting each other during critical updates.

```python
# Assume `atomic` is imported in the module.
with atomic():
    order = Order.objects.select_for_update().get(pk=order_id)
    order.status = "confirmed"
    order.save(update_fields=["status"])
```

**Warning**: `select_for_update()` without an open atomic block is ineffective or errors, depending on the backend and query shape.

### 6. Wrap multi-step writes in an atomic block
**Why**: Related writes must commit together or roll back together.

```python
# Assume `atomic` is imported in the module.
@atomic
def finalize_order(order_id: int) -> Invoice:
    order = Order.objects.select_for_update().select_related("user").get(pk=order_id)
    invoice = Invoice.objects.create(user=order.user, total=order.total)
    order.invoice = invoice
    order.status = "invoiced"
    order.save(update_fields=["invoice", "status"])
    return invoice
```

**Warning**: If one write fails outside an atomic block, earlier writes may already be committed and leave inconsistent state behind.

### 7. Verify model field names before writing queries
**Why**: Plausible field names are often wrong, and Django only tells you at runtime.

```python
# ❌ Bad: guessed field name
Order.objects.filter(state="open")

# ✅ Good: query the real field after checking the model definition
Order.objects.filter(status="open")
```

**Warning**: Never assume a field is called `state`, `kind`, `code`, or `type` just because it sounds likely.

### 8. Use `Count(..., distinct=True)` for M2M aggregates
**Why**: Counting across joins without `distinct=True` can inflate totals.

```python
from django.db.models import Count

# ❌ Bad: duplicate join rows can overcount categories
products = Product.objects.annotate(category_count=Count("categories"))

# ✅ Good: count unique related rows
products = Product.objects.annotate(category_count=Count("categories", distinct=True))
```

**Warning**: This matters most when a queryset already joins other related tables or adds multiple annotations.

### 9. Avoid `null=True` on `CharField` and `TextField`
**Why**: String fields with both `NULL` and `""` create two empty states to maintain forever.

```python
class Product(models.Model):
    # ❌ Bad
    subtitle = models.CharField(max_length=200, null=True, blank=True)

    # ✅ Good
    summary = models.TextField(blank=True, default="")
```

**Warning**: Queries become noisy when you have to handle both `isnull=True` and `=""` for the same concept.

### 10. Remember that `QuerySet`s are lazy and cache after evaluation
**Why**: QuerySets do not hit the database until evaluation, then they may reuse cached results.

```python
orders = Order.objects.filter(status="open")

# No query yet
open_exists = orders.exists()

cached_orders = list(orders)
Order.objects.create(user=user, status="open")

# Still uses the old cached result
same_rows = list(orders)

# Fresh queryset sees new rows
fresh_rows = list(Order.objects.filter(status="open"))
```

**Warning**: Reusing an evaluated queryset after writes is a common source of stale reads in tests and services.

### 11. Prefer abstract models over multi-table inheritance unless you need separate tables
**Why**: Multi-table inheritance adds extra joins; abstract models copy shared fields into the concrete table.

```python
# ✅ Good: abstract base, no extra table
class Product(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Variant(Product):
    sku = models.CharField(max_length=64)


# ⚠️ Different trade-off: multi-table inheritance adds joins
class Product(models.Model):
    name = models.CharField(max_length=200)


class Variant(Product):
    sku = models.CharField(max_length=64)
```

**Warning**: Use multi-table inheritance only when you explicitly want separate tables and parent-child joins.

### 12. Pop custom form kwargs before `super().__init__()`
**Why**: Django forms reject unknown keyword arguments unless you remove them first.

```python
class ProductForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        self.user = kwargs.pop("user", None)
        super().__init__(*args, **kwargs)
```

**Warning**: If you call `super()` first, Django raises `TypeError` before your form can use the custom value.

### 13. Parse JSON stored in `TextField` before treating it like a dict
**Why**: A JSON string in a `TextField` is still just a Python string until you decode it.

```python
import json

# ❌ Bad: payload_json is a string
invoice = Invoice.objects.get(pk=invoice_id)
value = invoice.payload_json["status"]

# ✅ Good: decode first
invoice = Invoice.objects.get(pk=invoice_id)
payload = json.loads(invoice.payload_json)
value = payload["status"]
```

**Warning**: If the schema really is JSON, prefer `models.JSONField()` so Django handles serialization and type conversion for you.

### 14. Prefer `TextChoices` and `IntegerChoices` over magic values
**Why**: Enum-backed choices keep stored values, labels, and defaults consistent across models, forms, and admin.

```python
from django.db import models

class Product(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    status = models.CharField(max_length=16, choices=Status, default=Status.DRAFT)

class Order(models.Model):
    class Priority(models.IntegerChoices):
        LOW = 1, "Low"
        NORMAL = 2, "Normal"
        HIGH = 3, "High"

    priority = models.IntegerField(choices=Priority, default=Priority.NORMAL)
```

**Warning**: `choices` are for stable, mostly static values. If the list changes often, model it as a table with `ForeignKey` instead.

### 15. Build chainable domain queries with a custom `QuerySet` and `Manager.from_queryset()`
**Why**: Putting reusable filters on a custom queryset keeps business queries composable instead of scattering them across views and services.

```python
from django.db import models

class ProductQuerySet(models.QuerySet):
    def active(self):
        return self.filter(is_active=True)

    def for_category(self, category_slug: str):
        return self.filter(category__slug=category_slug)

ProductManager = models.Manager.from_queryset(ProductQuerySet)

class Product(models.Model):
    category = models.ForeignKey("Category", on_delete=models.CASCADE)
    is_active = models.BooleanField(default=True)
    objects = ProductManager()

products = Product.objects.active().for_category("books")
```

**Warning**: Return querysets from queryset methods. If a method returns a list or scalar too early, you break chaining.

### 16. Choose abstract, proxy, and multi-table inheritance for different problems
**Why**: Django has three inheritance styles and each solves a different problem: shared fields, alternate Python behavior, or separate parent-child tables.

```python
from django.db import models

class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True

class Product(TimestampedModel):
    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)

class ActiveProduct(Product):
    class Meta:
        proxy = True
```

**Warning**: Proxy models do not create new tables, while multi-table inheritance does. Pick deliberately or you pay for joins you did not need.

### 17. Put business rules in database constraints, not only Python validation
**Why**: `UniqueConstraint` and `CheckConstraint` protect data regardless of whether writes come from forms, scripts, admin, or bulk imports.

```python
from django.db import models
from django.db.models import Q

class Product(models.Model):
    category = models.ForeignKey("Category", on_delete=models.CASCADE)
    sku = models.CharField(max_length=64)
    price = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["category", "sku"],
                name="unique_product_sku_per_category",
            ),
            models.CheckConstraint(
                condition=Q(price__gte=0),
                name="product_price_gte_0",
            ),
        ]
```

**Warning**: Validation alone is not enough under concurrency. The database is the final authority, so encode critical invariants there.

### 18. Use `ExclusionConstraint` for overlap rules the ORM cannot express with uniqueness
**Why**: Some constraints are about ranges or mutual exclusion, not equality. PostgreSQL can enforce those rules directly.

```python
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from django.db import models

class Order(models.Model):
    user = models.ForeignKey("auth.User", on_delete=models.CASCADE)
    delivery_window = DateTimeRangeField()

    class Meta:
        constraints = [
            ExclusionConstraint(
                name="exclude_overlapping_delivery_windows_per_user",
                expressions=[
                    ("user", RangeOperators.EQUAL),
                    ("delivery_window", RangeOperators.OVERLAPS),
                ],
            )
        ]
```

**Warning**: `ExclusionConstraint` is PostgreSQL-specific. Do not pretend it is portable across all Django-supported backends.

### 19. Prefer `Meta.indexes` for composite, partial, and covering indexes
**Why**: `Meta.indexes` is more expressive than `db_index=True` and lets you optimize real query patterns instead of individual fields in isolation.

```python
from django.db import models
from django.db.models import Q

class Product(models.Model):
    category = models.ForeignKey("Category", on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=["category", "name"], name="product_category_name_idx"),
            models.Index(
                fields=["name"],
                condition=Q(is_active=True),
                name="product_active_name_idx",
            ),
            models.Index(fields=["category"], include=["name"], name="product_category_cover_idx"),
        ]
```

**Warning**: Partial and covering indexes depend on backend support. Keep them aligned with the database you actually run in production.

### 20. Use `F()`, `Q()`, `Subquery()`, and `OuterRef()` for database-side expressions
**Why**: Advanced expressions move arithmetic, boolean logic, and correlated subqueries into SQL so the database can do the work atomically and efficiently.

```python
from django.db.models import F, OuterRef, Q, Subquery

latest_order_total = Subquery(
    Order.objects.filter(user=OuterRef("pk"))
    .order_by("-created_at")
    .values("total")[:1]
)

users = User.objects.annotate(latest_order_total=latest_order_total).filter(
    Q(is_active=True) | Q(is_staff=True)
)

Product.objects.filter(pk=product_id, stock__gte=1).update(stock=F("stock") - 1)
```

**Warning**: These expressions are powerful but easy to misuse. Inspect the SQL when queries become non-trivial, especially with correlated subqueries.

### 21. Use `bulk_create()`, `bulk_update()`, and `in_bulk()` for batch work
**Why**: Batch APIs cut round-trips and are the right tool for imports, sync jobs, and high-volume updates.

```python
Product.objects.bulk_create(
    [
        Product(name="Notebook", category=category),
        Product(name="Pen", category=category),
    ]
)

products_by_id = Product.objects.in_bulk([1, 2, 3])
products_by_id[1].name = "Hardcover Notebook"
Product.objects.bulk_update(products_by_id.values(), ["name"])
```

**Warning**: Bulk operations skip a lot of model-layer behavior such as per-object `save()` customizations and many signals. Do not assume they behave like repeated `.save()` calls.

### 22. Use `GeneratedField` for database-computed columns and know the refresh behavior
**Why**: `GeneratedField` keeps derived data in the database and Django 6.0 refreshes generated values after `save()` on backends with `RETURNING` support.

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


order = Order.objects.create(subtotal_cents=1000, shipping_cents=500)
print(order.total_cents)
```

**Warning**: On SQLite, PostgreSQL, and Oracle the value refreshes after `save()`. On MySQL and MariaDB it is deferred and fetched on later access.

### 23. Use `CompositePrimaryKey` only when a natural multi-column identity is worth the trade-offs
**Why**: Django supports composite keys, but they complicate relations, forms, admin, and migrations compared with a normal surrogate key.

```python
from django.db import models

class Product(models.Model):
    name = models.CharField(max_length=100)


class Order(models.Model):
    reference = models.CharField(max_length=20, primary_key=True)


class OrderProduct(models.Model):
    pk = models.CompositePrimaryKey("order_id", "product_id")
    order = models.ForeignKey(Order, on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    quantity = models.IntegerField()
```

**Warning**: Composite primary keys still have gaps in Django support. `ForeignKey` relations to them and Django admin registration are not fully supported.

### 24. Use `AnyValue` and general `StringAgg` for grouped annotations in Django 6.0
**Why**: Django 6.0 adds `AnyValue()` for non-grouped expressions in aggregates and makes `StringAgg()` generally available outside PostgreSQL-specific APIs.

```python
from django.db.models import AnyValue, Count, StringAgg, Value

category_summaries = Product.objects.values("category_id").annotate(
    category_name=AnyValue("category__name"),
    product_count=Count("id"),
    product_names=StringAgg("name", delimiter=Value(", ")),
)
```

**Warning**: `AnyValue()` is for cases where the database needs help accepting a non-aggregate expression inside grouped queries. It is not a substitute for understanding your grouping semantics.

### 25. Use raw SQL only for queries the ORM cannot express clearly
**Why**: `connection.cursor()` is the escape hatch for vendor-specific SQL, maintenance statements, or reporting queries that become unreadable in ORM form.

```python
from django.db import connection

with connection.cursor() as cursor:
    cursor.execute(
        """
        SELECT category_id, COUNT(*)
        FROM shop_product
        WHERE is_active = %s
        GROUP BY category_id
        HAVING COUNT(*) > %s
        """,
        [True, 10],
    )
    rows = cursor.fetchall()
```

**Warning**: Always parameterize values instead of interpolating strings. Raw SQL bypasses model abstractions, portability, and part of Django's safety net.
