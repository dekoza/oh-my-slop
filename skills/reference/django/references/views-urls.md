---
domain: Django Views & URLs
category: backend
priority: critical
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django Views & URL Routing Reference

Practical Django patterns for view design, URLconf structure, reversing, pagination, and response types.

### 1. Prefer FBVs for short, explicit request/response flows
**Why**: Function-based views are usually the clearest choice when the endpoint has a small amount of branching and no reusable CBV hooks.
```python
from django.http import HttpResponseNotAllowed
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse

from .models import Product


def product_publish(request, pk):
    product = get_object_or_404(Product, pk=pk)
    if request.method == "POST":
        product.is_published = True
        product.save(update_fields=["is_published"])
        return redirect("catalog:product-detail", pk=product.pk)
    if request.method == "GET":
        return TemplateResponse(request, "products/publish.html", {"product": product})
    return HttpResponseNotAllowed(["GET", "POST"])
```
**Warning**: Once an FBV starts accumulating repeated setup, permission, and form hooks, a CBV is usually the better fit.

### 2. Use `View` when different HTTP methods need different methods
**Why**: `View.dispatch()` routes the request to `get()`, `post()`, and friends so method-specific logic stays separated.
```python
from django.http import HttpResponse
from django.views import View


class OrderStatusView(View):
    def get(self, request, *args, **kwargs):
        return HttpResponse("pending")

    def post(self, request, *args, **kwargs):
        return HttpResponse(status=204)
```
**Warning**: If you do not implement a verb handler, Django returns `HttpResponseNotAllowed`.

### 3. Use `TemplateView` for template-first pages with light context
**Why**: `TemplateView` is ideal when the main job is rendering a template plus a little context data.
```python
from django.views.generic import TemplateView


class CategoryDashboardView(TemplateView):
    template_name = "categories/dashboard.html"
    extra_context = {"section": "catalog"}
```
**Warning**: If the view starts doing object lookup, form handling, or complex branching, `TemplateView` becomes the wrong abstraction.

### 4. Remember that `as_view()` returns a callable but each request gets a new instance
**Why**: Django configures the class once when URLs import, then instantiates the view per request, so instance attributes are request-scoped.
```python
from django.http import HttpResponse
from django.urls import path
from django.views import View


class ProductProbeView(View):
    greeting = "catalog"

    def setup(self, request, *args, **kwargs):
        super().setup(request, *args, **kwargs)
        self.request_id = request.headers.get("X-Request-ID", "missing")

    def get(self, request, *args, **kwargs):
        return HttpResponse(f"{self.greeting}:{self.request_id}")


urlpatterns = [path("probe/", ProductProbeView.as_view(greeting="inventory"), name="product-probe")]
```
**Warning**: Never put mutable request state on class attributes; it will leak across requests.

### 5. Know the core CBV mixins before subclassing generic views
**Why**: `ContextMixin`, `TemplateResponseMixin`, `SingleObjectMixin`, `MultipleObjectMixin`, and `FormMixin` explain where most CBV behavior comes from.
```python
from django.template.response import TemplateResponse
from django.views.generic.base import ContextMixin, TemplateResponseMixin, View
from django.views.generic.detail import SingleObjectMixin

from .models import Product


class ProductMetaView(SingleObjectMixin, TemplateResponseMixin, ContextMixin, View):
    model = Product
    template_name = "products/meta.html"

    def get(self, request, *args, **kwargs):
        self.object = self.get_object()
        context = self.get_context_data(product=self.object)
        return self.render_to_response(context)
```
**Warning**: Only one parent should inherit from `View`; the rest should be mixins or the MRO becomes fragile.

### 6. Use `ListView` for ordered list pages
**Why**: `ListView` already knows how to fetch a queryset, name the context, and render a template.
```python
from django.views.generic import ListView

from .models import Product


class ProductListView(ListView):
    model = Product
    context_object_name = "products"

    def get_queryset(self):
        return Product.objects.select_related("category").order_by("name")
```
**Warning**: Paginated or user-visible lists should always have deterministic ordering.

### 7. Use `DetailView` for single-object pages
**Why**: `DetailView` wraps `SingleObjectMixin` and template rendering into the common detail-page workflow.
```python
from django.views.generic import DetailView

from .models import User


class UserDetailView(DetailView):
    model = User
    context_object_name = "account"
    slug_field = "slug"
    slug_url_kwarg = "slug"
```
**Warning**: Avoid the default context name `user` when auth context processors are enabled; it collides with `request.user`.

### 8. Use `CreateView` for model creation forms
**Why**: `CreateView` handles GET, POST, validation errors, save, and redirect with minimal code.
```python
from django.urls import reverse_lazy
from django.views.generic import CreateView

from .models import Product


class ProductCreateView(CreateView):
    model = Product
    fields = ["name", "slug", "category"]
    success_url = reverse_lazy("catalog:product-list")
```
**Warning**: Do not define both `fields` and `form_class`; Django treats that as a configuration error.

### 9. Use `UpdateView` for editing existing objects
**Why**: `UpdateView` retrieves the target object, binds a model form, and saves changes through the standard form lifecycle.
```python
from django.views.generic import UpdateView

from .models import Product


class ProductUpdateView(UpdateView):
    model = Product
    fields = ["name", "slug", "category", "is_active"]

    def get_queryset(self):
        return Product.objects.select_related("category")
```
**Warning**: Scope `get_queryset()` to objects the current user may edit, not the entire table by default.

### 10. Use `DeleteView` for confirmation-then-delete flows
**Why**: `DeleteView` shows a confirmation page on GET and deletes only on POST.
```python
from django.urls import reverse_lazy
from django.views.generic import DeleteView

from .models import Category


class CategoryDeleteView(DeleteView):
    model = Category
    success_url = reverse_lazy("catalog:category-list")
```
**Warning**: `DeleteView` does not delete on GET; the confirmation template must POST back.

### 11. Apply decorators to FBVs directly and to CBVs via `dispatch()` or `as_view()`
**Why**: Decorators like `login_required`, `permission_required`, `require_http_methods`, and `csrf_exempt` stay useful even in CBV-heavy codebases.
```python
from django.contrib.auth.decorators import login_required, permission_required
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods


@login_required
@permission_required("orders.change_order", raise_exception=True)
@require_http_methods(["GET", "POST"])
def order_review(request, pk):
    return HttpResponse(f"order:{pk}")


@method_decorator(login_required, name="dispatch")
class ProtectedOrderView(View):
    def get(self, request, *args, **kwargs):
        return HttpResponse("ok")


@csrf_exempt
@require_http_methods(["POST"])
def inbound_webhook(request):
    return HttpResponse(status=204)
```
**Warning**: `csrf_exempt` is a narrow exception for trusted integrations, not a convenience for browser forms.

### 12. Prefer `TemplateResponse` over `render()` when middleware may alter the response
**Why**: `TemplateResponse` delays rendering so middleware or callbacks can still change the template or context.
```python
from django.template.response import TemplateResponse

from .models import Product


def product_index(request):
    return TemplateResponse(
        request,
        "products/index.html",
        {"products": Product.objects.order_by("name")},
    )
```
**Warning**: `render()` is shorter, but it returns an already-rendered `HttpResponse` and skips template-response middleware hooks.

### 13. Prefer `path()` with built-in converters for most routes
**Why**: `path()` is easier to read than raw regexes and gives typed values for `int`, `slug`, `uuid`, and `path` segments.
```python
from django.urls import path

from . import views


urlpatterns = [
    path("products/<int:pk>/", views.product_detail, name="product-detail"),
    path("categories/<slug:slug>/", views.category_detail, name="category-detail"),
    path("orders/<uuid:order_id>/", views.order_detail, name="order-detail"),
    path("files/<path:filepath>/", views.file_browser, name="file-browser"),
]
```
**Warning**: Converter-less segments default to `str`, which does not include `/` characters.

### 14. Use `re_path()` only when converters cannot express the constraint
**Why**: Regular expressions are the escape hatch for route formats that built-in converters cannot model cleanly.
```python
from django.urls import re_path

from . import views


urlpatterns = [
    re_path(
        r"^reports/(?P<year>[0-9]{4})/(?P<month>[0-9]{2})/$",
        views.monthly_report,
        name="monthly-report",
    )
]
```
**Warning**: `re_path()` captured values arrive as strings, even when the regex only matches digits.

### 15. Register custom converters for reusable parsing rules
**Why**: A custom converter keeps route validation in the URL layer instead of scattering parsing logic across views.
```python
from django.urls import path, register_converter

from . import views


class CategoryCodeConverter:
    regex = r"[A-Z]{3}-[0-9]{2}"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value.upper()


register_converter(CategoryCodeConverter, "categorycode")
urlpatterns = [path("categories/<categorycode:code>/", views.category_detail, name="category-detail")]
```
**Warning**: If `to_python()` or `to_url()` raises `ValueError`, matching or reversing fails.

### 16. Namespace URLs with `app_name` and `include(..., namespace=...)`
**Why**: Namespaces prevent route-name collisions and make reverse lookups unambiguous.
```python
# catalog/urls.py
from django.urls import path

from . import views

app_name = "catalog"
urlpatterns = [path("products/", views.product_list, name="product-list")]

# project/urls.py
from django.urls import include, path

urlpatterns = [path("shop/", include("catalog.urls", namespace="catalog"))]
```
**Warning**: `namespace=` requires the included URLconf to define `app_name` or to be included as a `(patterns, app_name)` tuple.

### 17. Use `reverse()` at runtime and `reverse_lazy()` at import time
**Why**: `reverse()` resolves immediately, while `reverse_lazy()` defers resolution until URLconf loading is safe.
```python
from django.http import HttpResponseRedirect
from django.urls import reverse, reverse_lazy
from django.views.generic import DeleteView

from .models import Product


class ProductDeleteView(DeleteView):
    model = Product
    success_url = reverse_lazy("catalog:product-list")


def send_to_product(request, pk):
    return HttpResponseRedirect(reverse("catalog:product-detail", kwargs={"pk": pk}))
```
**Warning**: Using `reverse()` in class attributes, decorators, or default arguments often breaks because the URLconf is not ready yet.

### 18. Do not repeat the parent prefix inside child URLconfs
**Why**: `include()` removes the matched parent prefix before handing the remainder to the child URLconf.
```python
# project/urls.py
from django.urls import include, path

urlpatterns = [path("shop/", include("catalog.urls", namespace="catalog"))]

# catalog/urls.py
from django.urls import path

from . import views

app_name = "catalog"
urlpatterns = [path("products/", views.product_list, name="product-list")]
```
**Warning**: If the child URLconf also starts with `shop/`, the final route becomes `/shop/shop/...`.

### 19. Put catch-all patterns last in `urlpatterns`
**Why**: Django resolves patterns in order and stops at the first match, so broad routes can shadow precise ones.
```python
from django.urls import path, re_path

from . import views


urlpatterns = [
    path("products/<int:pk>/", views.product_detail, name="product-detail"),
    path("orders/<uuid:order_id>/", views.order_detail, name="order-detail"),
    re_path(r"^(?P<slug>[-\w]+)/$", views.category_page, name="category-page"),
]
```
**Warning**: A catch-all route above a specific route creates hard-to-debug wrong matches and 404s.

### 20. Use `Paginator` for sync lists and `AsyncPaginator` for async Django 6.0 code
**Why**: Manual pagination still matters outside `ListView`, and Django 6.0 adds async paginator methods for async views.
```python
from django.core.paginator import AsyncPaginator, Paginator
from django.http import JsonResponse
from django.template.response import TemplateResponse

from .models import Product


def product_list(request):
    page_obj = Paginator(Product.objects.order_by("name"), 20).get_page(request.GET.get("page"))
    return TemplateResponse(request, "products/list.html", {"page_obj": page_obj})


async def product_feed(request):
    names = [product.name async for product in Product.objects.order_by("name")]
    page_obj = await AsyncPaginator(names, 50).aget_page(request.GET.get("page"))
    return JsonResponse({"products": await page_obj.aget_object_list()})
```
**Warning**: Paginating an unordered queryset produces unstable pages, and async paginator methods must be awaited.

### 21. Use `redirect()` for ad hoc redirects and `RedirectView` for declarative ones
**Why**: `redirect()` is ideal for runtime decisions, while `RedirectView` is convenient for legacy routes and static remaps.
```python
from django.shortcuts import redirect
from django.views.generic.base import RedirectView

from .models import Order


def latest_order(request):
    order = Order.objects.order_by("-pk").first()
    return redirect("orders:detail", pk=order.pk)


class LegacyOrdersRedirectView(RedirectView):
    pattern_name = "orders:list"
    permanent = True
```
**Warning**: Permanent redirects are sticky in browsers and search engines, so use them only for stable migrations.

### 22. Use `JsonResponse` for lightweight JSON endpoints in pure Django
**Why**: Small JSON endpoints often need nothing beyond Django's built-in response classes.
```python
from django.http import JsonResponse

from .models import Order


def order_status(request, pk):
    order = Order.objects.values("pk", "status", "total").get(pk=pk)
    return JsonResponse(order)
```
**Warning**: `JsonResponse` expects a dict by default; use `safe=False` only when a top-level list or scalar is intentional.

### 23. Use `FileResponse` for files and `StreamingHttpResponse` for generated streams
**Why**: `FileResponse` efficiently serves file-like objects, while `StreamingHttpResponse` avoids materializing large generated payloads in memory.
```python
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, StreamingHttpResponse

from .models import Order


def order_invoice(request, pk):
    filename = Path(settings.MEDIA_ROOT) / f"invoices/{pk}.pdf"
    return FileResponse(filename.open("rb"), as_attachment=True, filename=f"order-{pk}.pdf")


def order_export(request):
    def rows():
        yield "id,total\n"
        for order in Order.objects.order_by("pk").iterator():
            yield f"{order.pk},{order.total}\n"

    return StreamingHttpResponse(rows(), content_type="text/csv")
```
**Warning**: Streaming responses do not buffer content, so generators must be safe to iterate exactly once.

### 24. Register custom `handler404` and `handler500` in the root URLconf
**Why**: Custom error handlers centralize branded error pages and keep project-wide 404 and 500 behavior consistent.
```python
from django.http import Http404
from django.template.response import TemplateResponse

from .models import Product


def product_or_404(request, pk):
    try:
        product = Product.objects.get(pk=pk)
    except Product.DoesNotExist as exc:
        raise Http404("Product not found") from exc
    return TemplateResponse(request, "products/detail.html", {"product": product})


def custom_404(request, exception):
    return TemplateResponse(request, "errors/404.html", status=404)


def custom_500(request):
    return TemplateResponse(request, "errors/500.html", status=500)


handler404 = "project.views.custom_404"
handler500 = "project.views.custom_500"
```
**Warning**: `handler404` and `handler500` only work when set in the root URLconf, not a child URL module.
