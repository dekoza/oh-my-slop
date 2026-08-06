---
domain: Django Admin
category: backend
priority: medium
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django Admin Reference

Use these patterns when the Django admin is the internal back office, not the public application UI.

### 1. Start with a useful `ModelAdmin` changelist
**Why**: The default admin is technically functional but too weak for real back-office usage.

```python
from django.contrib import admin

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "status", "total", "created_at"]
    list_filter = ["status", "created_at"]
    search_fields = ["id", "user__username", "user__email"]
    ordering = ["-created_at"]
```

**Warning**: `search_fields` runs `icontains` queries by default, so keep it on indexed or genuinely searchable fields.

### 2. Use `@admin.display` for computed list columns
**Why**: Admin tables often need computed columns, but the column still needs a readable title and stable sorting.

```python
from django.contrib import admin

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "price", "is_low_stock"]

    @admin.display(boolean=True, ordering="stock", description="Low stock")
    def is_low_stock(self, obj):
        return obj.stock < 5
```

**Warning**: A computed column is not sortable unless you map it to a real field or expression with `ordering=`.

### 3. Keep audit fields read-only with `readonly_fields`
**Why**: Staff users should see timestamps and actor fields without being allowed to edit them.

```python
from django.contrib import admin

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    fields = ["name", "category", "price", "created_at", "updated_at"]
    readonly_fields = ["created_at", "updated_at"]
```

**Warning**: `readonly_fields` only protects admin forms; it does not make the model field immutable elsewhere in your codebase.

### 4. Use `list_editable` for fast inline edits in the changelist
**Why**: Back-office teams often need to flip flags or adjust a small number of fields without opening each object.

```python
from django.contrib import admin

from .models import Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "is_active", "sort_order"]
    list_editable = ["is_active", "sort_order"]
    ordering = ["sort_order", "name"]
```

**Warning**: A field in `list_editable` must also be in `list_display`, and it cannot be the link field for the row.

### 5. Use `autocomplete_fields` for large relations
**Why**: Large `ForeignKey` or `ManyToManyField` dropdowns become unusable and slow.

```python
from django.contrib import admin

from .models import Category, Product


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    search_fields = ["name", "slug"]


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    autocomplete_fields = ["category", "related_products"]
```

**Warning**: The related admin must define `search_fields`, or Django cannot power the autocomplete endpoint.

### 6. Use `TabularInline` for dense child rows
**Why**: Order lines and similar records fit better in a compact table than in full stacked forms.

```python
from django.contrib import admin

from .models import Order, OrderItem


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 1
    min_num = 1
    max_num = 20
    autocomplete_fields = ["product"]


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    inlines = [OrderItemInline]
```

**Warning**: `TabularInline` is cramped; once each row needs rich help text or multi-line fields, switch to `StackedInline`.

### 7. Use `StackedInline` when each related object needs more room
**Why**: Verbose related records are unreadable in a single row table.

```python
from django.contrib import admin

from .models import ProductImage


class ProductImageInline(admin.StackedInline):
    model = ProductImage
    extra = 0
    min_num = 1
    max_num = 5
    fields = [("image", "alt_text"), "caption", "is_primary"]
```

**Warning**: `min_num` and `max_num` constrain formsets, not database integrity, so add model validation when the rule is absolute.

### 8. Narrow the admin view in `get_queryset()`
**Why**: Admin screens often need both access filtering and query optimization.

```python
from django.contrib import admin

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "status", "total"]

    def get_queryset(self, request):
        queryset = super().get_queryset(request).select_related("user")
        if request.user.is_superuser:
            return queryset
        return queryset.filter(user=request.user)
```

**Warning**: UI-level filtering is not a permission system by itself; pair it with permission hooks when access must be blocked.

### 9. Stamp request-dependent fields in `save_model()`
**Why**: Some fields should come from the acting staff user, not from editable form input.

```python
from django.contrib import admin

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    exclude = ["updated_by"]

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
```

**Warning**: `save_model()` should augment the save, not replace Django's default behavior; call `super()` unless you have a proven reason not to.

### 10. Recompute related data in `save_related()`
**Why**: Parent objects often depend on inline formsets that do not exist yet during `save_model()`.

```python
from django.contrib import admin

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        order = form.instance
        order.total = sum(item.quantity * item.unit_price for item in order.items.all())
        order.save(update_fields=["total"])
```

**Warning**: Do not recalculate inline-dependent values in `save_model()`; the related objects are not fully saved there yet.

### 11. Override widgets with `formfield_overrides`
**Why**: Admin defaults are often too weak for long text or structured internal content.

```python
from django import forms
from django.contrib import admin
from django.db import models

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    formfield_overrides = {
        models.TextField: {"widget": forms.Textarea(attrs={"rows": 6, "cols": 80})},
    }
```

**Warning**: `formfield_overrides` does not replace widgets already controlled by `autocomplete_fields`, `raw_id_fields`, or `radio_fields`.

### 12. Write bulk actions with `@admin.action`
**Why**: Repeating the same operation object by object is wasted staff time.

```python
from django.contrib import admin, messages

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    actions = ["mark_paid"]

    @admin.action(description="Mark selected orders as paid", permissions=["change"])
    def mark_paid(self, request, queryset):
        updated = queryset.update(status=Order.Status.PAID)
        self.message_user(request, f"Updated {updated} orders.", messages.SUCCESS)
```

**Warning**: `queryset.update()` is fast but bypasses model `save()` logic and signals.

### 13. Return a confirmation page for risky actions
**Why**: Destructive or expensive admin actions should not execute immediately after one accidental click.

```python
from django.contrib import admin
from django.template.response import TemplateResponse

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    actions = ["archive_selected"]

    @admin.action(description="Archive selected products")
    def archive_selected(self, request, queryset):
        if "confirm" in request.POST:
            queryset.update(is_archived=True)
            self.message_user(request, "Selected products were archived.")
            return None
        context = {
            **self.admin_site.each_context(request),
            "title": "Confirm archive",
            "products": queryset,
            "action": "archive_selected",
        }
        return TemplateResponse(request, "admin/products/archive_confirmation.html", context)
```

**Warning**: A custom confirmation page must preserve the selection and action name, or the second POST will lose context.

### 14. Brand the admin site and use a custom `AdminSite` when needed
**Why**: Once the admin becomes a real internal tool, branding and custom registration usually outgrow the default singleton site.

```python
from django.contrib import admin

from .models import Category, Order, Product, User


admin.site.site_header = "Operations admin"
admin.site.site_title = "Operations"


class OperationsAdminSite(admin.AdminSite):
    site_header = "Operations admin"
    site_title = "Operations"
    index_title = "Back office"


operations_admin_site = OperationsAdminSite(name="operations_admin")
operations_admin_site.register(Product)
operations_admin_site.register(Category)
operations_admin_site.register(Order)
operations_admin_site.register(User)
```

**Warning**: If you move to a custom `AdminSite`, make sure your URLconf points to that site instead of the default `admin.site.urls`.

### 15. Add custom admin URLs through `get_urls()`
**Why**: Reporting, imports, and maintenance screens often belong inside admin permissions and chrome.

```python
from django.contrib import admin
from django.template.response import TemplateResponse
from django.urls import path

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    def get_urls(self):
        custom_urls = [
            path("summary/", self.admin_site.admin_view(self.summary_view), name="orders-summary"),
        ]
        return custom_urls + super().get_urls()

    def summary_view(self, request):
        context = {
            **self.admin_site.each_context(request),
            "title": "Order summary",
            "order_count": self.get_queryset(request).count(),
        }
        return TemplateResponse(request, "admin/orders/summary.html", context)
```

**Warning**: Always wrap custom admin views with `admin_site.admin_view()` so staff checks and cache protection still apply.

### 16. Gate access with `has_*_permission` hooks
**Why**: Admin access rules are often per-model and tighter than global `is_staff`.

```python
from django.contrib import admin

from .models import Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser or request.user.groups.filter(name="Catalog Managers").exists()

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_staff
```

**Warning**: If `has_view_permission()` is stricter than expected, staff users may lose even read-only access to the changelist.

### 17. Override `change_form_template` for object-level tools
**Why**: Sometimes the standard change form needs one extra admin-only action, not a whole custom view rewrite.

```htmldjango
# admin.py
from django.contrib import admin

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    change_form_template = "admin/orders/change_form.html"


# templates/admin/orders/change_form.html
{% extends "admin/change_form.html" %}
{% block object-tools-items %}
  {{ block.super }}
  <li><a href="{% url 'admin:orders-summary' %}">Open summary</a></li>
{% endblock %}
```

**Warning**: Keep the override as small as possible; copying the full stock admin template makes upgrades fragile.

### 18. Query `LogEntry` when you need the admin audit trail
**Why**: The admin already records create, change, and delete events, so use that trail before inventing another audit table.

```python
from django.contrib.admin.models import LogEntry

from .models import Order


def get_order_admin_history(order: Order):
    return LogEntry.objects.select_related("user", "content_type").filter(
        content_type__app_label=order._meta.app_label,
        content_type__model=order._meta.model_name,
        object_id=str(order.pk),
    ).order_by("-action_time")
```

**Warning**: `LogEntry` gives you admin activity only; changes made outside the admin are invisible unless you log them elsewhere.
