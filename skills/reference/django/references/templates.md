---
domain: Django Templates
category: frontend
priority: high
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django Templates Reference

Core Django template language patterns for Django 6.0, including template partials.

### 1. Use variables, tags, filters, and comments deliberately
**Why**: Django templates stay readable when data output, control flow, transformation, and comments each use their own syntax.

```htmldjango
{# Single-line note #}
<h1>{{ product.name }}</h1>
<p>{{ order.created_at|date:"Y-m-d" }}</p>

{% if user.is_authenticated %}
    <p>{{ user.username|default:"guest" }}</p>
{% endif %}

{% comment %}
Multi-line comment blocks work here.
{% endcomment %}
```

**Warning**: `{# #}` comments cannot span multiple lines; use `{% comment %}` for larger blocks.

### 2. Keep dot lookups simple and precompute real logic in views
**Why**: The template engine supports dictionary, attribute, and index lookup, but it is not a general-purpose programming language.

```htmldjango
<p>{{ product.category.name }}</p>
<p>{{ order.items.0.name }}</p>
<p>{{ user.get_full_name }}</p>
```

**Warning**: Templates can call zero-argument callables, but they cannot pass method arguments; complex branching belongs in Python.

### 3. Branch with `{% if %}`, `{% elif %}`, and `{% else %}`
**Why**: Simple boolean checks belong in templates when they directly affect presentation.

```htmldjango
{% if product.is_active and product.stock > 0 %}
    <span>Available</span>
{% elif product.is_active %}
    <span>Backorder</span>
{% else %}
    <span>Archived</span>
{% endif %}
```

**Warning**: Parentheses are invalid in Django template `if` expressions; nest `if` blocks when precedence is unclear.

### 4. Iterate with `{% for %}` and always provide `{% empty %}`
**Why**: Empty states are part of the UI contract, and `forloop` helpers remove noisy counters from views.

```htmldjango
<ul>
{% for category in product.categories.all %}
    <li>
        {{ forloop.counter }}. {{ category.name }}
        {% if forloop.last %}(last of {{ forloop.length }}){% endif %}
    </li>
{% empty %}
    <li>No categories assigned.</li>
{% endfor %}
</ul>
```

**Warning**: `forloop.length` is available in Django 6.0, but the loop should still stay presentation-focused.

### 5. Use `{% with %}` to avoid repeating noisy expressions
**Why**: Scoped aliases make templates shorter without moving trivial presentation concerns back into the view.

```htmldjango
{% with primary_category=product.category featured_orders=user.orders.all %}
    <h2>{{ primary_category.name }}</h2>
    <p>Orders: {{ featured_orders|length }}</p>
{% endwith %}
```

**Warning**: Variables created with `as` outside a `{% block %}` are not available inside overridden child blocks.

### 6. Include small fragments with `with` and `only`
**Why**: `{% include %}` is the simplest way to reuse markup when inheritance would be overkill.

```htmldjango
{% include "catalog/_product_card.html" with product=product user=user only %}
{% include "orders/_summary.html" with order=order %}
```

**Warning**: Included templates render independently; blocks inside an included template are already resolved, not overridable later.

### 7. Start inheritance with `{% extends %}` and `{% block %}`
**Why**: Base templates centralize shared layout so child templates only override the page-specific parts.

```htmldjango
{# templates/base.html #}
<title>{% block title %}Shop{% endblock %}</title>
<main>{% block content %}{% endblock %}</main>

{# templates/catalog/product_detail.html #}
{% extends "base.html" %}
{% block title %}{{ product.name }}{% endblock %}
{% block content %}
    <h1>{{ product.name }}</h1>
{% endblock %}
```

**Warning**: `{% extends %}` must be the first template tag in the child template.

### 8. Use `{{ block.super }}` when a child should add, not replace
**Why**: Appending to parent output is cleaner than copying the entire parent block into every child.

```htmldjango
{% extends "base.html" %}

{% block title %}
    {{ block.super }} · {{ category.name }}
{% endblock %}
```

**Warning**: `block.super` is already escaped by the parent render; do not wrap it in filters that assume raw input.

### 9. Define reusable Django 6.0 partials with `{% partialdef %}` and render them with `{% partial %}`
**Why**: Template partials are Django 6.0’s built-in fragment reuse mechanism inside a single template file.

```htmldjango
{% partialdef product_card %}
    <article>
        <h2>{{ product.name }}</h2>
        <p>{{ product.description|truncatewords:12 }}</p>
    </article>
{% endpartialdef product_card %}

{% for product in featured_products %}
    {% partial product_card %}
{% endfor %}

{% partialdef order_badge inline %}
    <span>{{ order.status }}</span>
{% endpartialdef order_badge %}
```

**Warning**: `partialdef` names must be valid template identifiers, and the partial renders with the current context each time.

### 10. Load or include a single fragment with `template.html#partial_name`
**Why**: Django 6.0 can address one partial directly instead of rendering the full template file.

```python
from django.shortcuts import get_object_or_404, render
from django.template.loader import get_template

from shop.models import Product


def product_card_view(request, product_id):
    product = get_object_or_404(Product, pk=product_id)
    partial = get_template("catalog/product_list.html#product_card")
    return render(
        request,
        "catalog/product_list.html#product_card",
        {"product": product, "partial_preview": partial.render({"product": product})},
    )
```

**Warning**: `template.html#partial_name` only works for partials defined in that template with `partialdef`.

### 11. Format values with `date`, `default`, and `truncatewords`
**Why**: Common display cleanup belongs in filters, not duplicated string handling across views.

```htmldjango
<p>Placed: {{ order.created_at|date:"Y-m-d H:i" }}</p>
<p>Buyer: {{ order.user.get_full_name|default:"Anonymous user" }}</p>
<p>{{ product.description|truncatewords:20 }}</p>
```

**Warning**: Filter arguments containing spaces must be quoted, or template parsing will fail.

### 12. Use `join` and `length` for collection-oriented output
**Why**: Templates frequently need counts and readable lists without turning views into formatting helpers.

```htmldjango
<p>Categories: {{ product.categories.all|join:", " }}</p>
<p>Total categories: {{ product.categories.all|length }}</p>
<p>Total orders: {{ user.orders.all|length }}</p>
```

**Warning**: `join` is for presentation; if the queryset work is expensive, optimize the query in Python first.

### 13. Rely on auto-escaping by default and use `safe` only for trusted HTML
**Why**: Django escapes variables automatically, which is the default XSS defense for template output.

```python
from django.utils.safestring import mark_safe


product_note = mark_safe("<strong>Verified</strong>")
plain_note = "<strong>Untrusted</strong>"
```

```htmldjango
<p>{{ plain_note }}</p>
<p>{{ plain_note|safe }}</p>
<p>{{ product_note }}</p>
<p>{{ product_note|escape }}</p>
```

**Warning**: `mark_safe()` and the `safe` filter bypass escaping; use them only when the HTML is fully trusted.

### 14. Disable escaping for the smallest possible block with `{% autoescape off %}`
**Why**: Block-level escape control is sometimes necessary when output is intentionally non-HTML or pre-sanitized.

```htmldjango
{% autoescape off %}
    {{ product_notes|join:"<br>" }}
{% endautoescape %}

{% autoescape on %}
    {{ product.name }}
{% endautoescape %}
```

**Warning**: Turning auto-escaping off changes how chained filters behave; `join` can mark results safe before `escape` runs.

### 15. Replace old `assignment_tag` examples with `simple_tag` plus `as`
**Why**: Modern Django uses `simple_tag`, and templates can store the result with `as` instead of relying on old tutorials.

```python
from django import template

register = template.Library()


@register.simple_tag
def category_label(category):
    return f"Category: {category.name}"
```

```htmldjango
{% load catalog_tags %}
{% category_label category as label %}
<p>{{ label }}</p>
```

**Warning**: If a guide tells you to use `assignment_tag`, the guide is outdated for Django 6.0.

### 16. Use `inclusion_tag` when a Python helper should render another template
**Why**: Inclusion tags keep repeated component markup in a dedicated template while centralizing the supporting query logic.

```python
from django import template

register = template.Library()


@register.inclusion_tag("catalog/_category_list.html")
def category_list(product):
    return {"categories": product.categories.all()}
```

```htmldjango
{% load catalog_tags %}
{% category_list product %}
```

**Warning**: `inclusion_tag` returns context data, not rendered HTML; Django renders the specified template for you.

### 17. Write custom filters with `register.filter` and `needs_autoescape`
**Why**: Filters that emit HTML must respect the current escape mode instead of guessing.

```python
from django import template
from django.utils.html import conditional_escape
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter(needs_autoescape=True)
def highlight_category(value, autoescape=True):
    escape = conditional_escape if autoescape else (lambda text: text)
    return mark_safe(f"<strong>{escape(value)}</strong>")
```

**Warning**: A filter that introduces HTML must escape its inputs correctly before calling `mark_safe()`.

### 18. Add shared context with built-in and custom context processors
**Why**: Context processors keep request-wide data out of every individual view.

```python
from shop.services import category_service


def storefront(request):
    return {"store_categories": category_service.visible_to(request.user)}


TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "django.template.context_processors.debug",
                "shop.context_processors.storefront",
            ],
        },
    }
]
```

**Warning**: `debug` data is only useful when `DEBUG` is enabled, and expensive custom processors slow every render that uses a request context.

### 19. Configure `TEMPLATES`, `DIRS`, `APP_DIRS`, and loader chains consciously
**Why**: Template discovery bugs usually come from vague loader configuration, not from the template syntax itself.

```python
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {},
    },
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "NAME": "cached",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": False,
        "OPTIONS": {
            "loaders": [
                (
                    "django.template.loaders.cached.Loader",
                    [
                        "django.template.loaders.filesystem.Loader",
                        "django.template.loaders.app_directories.Loader",
                    ],
                )
            ],
        },
    },
]
```

**Warning**: Use either `APP_DIRS` or an explicit loader chain for a given engine configuration; do not make template resolution ambiguous.

### 20. Namespace templates by app instead of dumping everything into one directory
**Why**: `app_name/template_name.html` keeps large projects and reusable apps from colliding on filenames like `detail.html`.

```htmldjango
templates/
    catalog/product_detail.html
    catalog/_product_card.html
    orders/order_detail.html
    users/profile.html

{% include "catalog/_product_card.html" with product=product only %}
```

**Warning**: Flat template directories become collision-prone fast, especially once multiple apps define `list.html` or `detail.html`.

### 21. Control whitespace by formatting template source intentionally
**Why**: Django templates preserve text outside tags, so spacing decisions in the source file affect rendered output.

```htmldjango
<ul>
{% for category in product.categories.all %}
    <li>{{ category.name }}</li>
{% endfor %}
</ul>

<p>{{ product.name }}</p><p>{{ product.sku }}</p>
```

**Warning**: Django does not use Jinja-style whitespace trim markers; avoid accidental spaces and blank lines by keeping structural tags tightly aligned.
