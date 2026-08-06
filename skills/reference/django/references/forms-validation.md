---
domain: Django Forms & Validation
category: backend
priority: high
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django Forms & Validation Reference

Pure Django patterns for declaring forms, validating input, handling uploads, and managing formsets.

### 1. Declare a `Form` with explicit field definitions
**Why**: Form fields define both the server-side contract and the default HTML widgets.

```python
from django import forms


class ProductFilterForm(forms.Form):
    query = forms.CharField(max_length=100, required=False)
    min_price = forms.IntegerField(min_value=0, required=False)
    email = forms.EmailField(required=False)
    category = forms.ChoiceField(
        choices=[("hardware", "Hardware"), ("books", "Books")],
        required=False,
    )
    in_stock = forms.BooleanField(required=False)
```

**Warning**: `BooleanField` must use `required=False` when an unchecked box is valid.

### 2. Use `initial` for defaults and check bound vs unbound state
**Why**: Unbound forms show defaults; bound forms hold submitted data and are eligible for validation.

```python
from django import forms


class OrderSearchForm(forms.Form):
    status = forms.ChoiceField(choices=[("open", "Open"), ("paid", "Paid")], initial="open")
    user_email = forms.EmailField(required=False)


blank_form = OrderSearchForm(initial={"user_email": "buyer@example.com"})
bound_form = OrderSearchForm({"status": "paid", "user_email": "buyer@example.com"})

blank_form.is_bound  # False
bound_form.is_bound  # True
```

**Warning**: Passing a data dictionary binds the form immediately; `initial` is not a fallback during validation.

### 3. Process submissions with `is_valid()` and `cleaned_data`
**Why**: `request.POST` is raw input; `cleaned_data` contains normalized Python values.

```python
from django.shortcuts import redirect, render

from .forms import OrderForm
from .models import Order


def create_order(request):
    form = OrderForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        order = Order.objects.create(**form.cleaned_data)
        return redirect("orders:detail", pk=order.pk)
    return render(request, "orders/create.html", {"form": form})
```

**Warning**: Never write `request.POST` directly to models.

### 4. Keep the validation pipeline in order
**Why**: Django validates each field before form-wide validation, so each hook has a specific job.

```python
from django import forms


class ProductForm(forms.Form):
    sku = forms.CharField(max_length=32)

    def clean_sku(self):
        return self.cleaned_data["sku"].strip().upper()

    def clean(self):
        cleaned_data = super().clean()
        return cleaned_data


# Field pipeline: to_python() -> validate() -> run_validators() -> Field.clean()
# Form pipeline: clean_<field>() -> clean()
```

**Warning**: If field validation fails, `clean_<field>()` for that field is skipped, but `clean()` still runs.

### 5. Use `clean_<field>()` for one-field business rules
**Why**: Field-specific validation stays readable when it lives next to the field it validates.

```python
from django import forms
from django.core.exceptions import ValidationError

from .models import Product


class ProductForm(forms.Form):
    sku = forms.CharField(max_length=32)

    def clean_sku(self):
        sku = self.cleaned_data["sku"].strip().upper()
        if Product.objects.filter(sku=sku).exists():
            raise ValidationError("SKU must be unique.")
        return sku
```

**Warning**: Always return the cleaned value from `clean_<field>()`.

### 6. Use `clean()` for rules that span multiple fields
**Why**: Cross-field rules belong at the form level because they need access to more than one input.

```python
from django import forms
from django.core.exceptions import ValidationError


class OrderForm(forms.Form):
    delivery_method = forms.ChoiceField(choices=[("pickup", "Pickup"), ("courier", "Courier")])
    shipping_address = forms.CharField(required=False)

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("delivery_method") == "courier" and not cleaned_data.get("shipping_address"):
            self.add_error("shipping_address", "Courier orders need a shipping address.")
        if cleaned_data.get("delivery_method") == "pickup" and cleaned_data.get("shipping_address"):
            raise ValidationError("Pickup orders should not include a shipping address.")
        return cleaned_data
```

**Warning**: Use `.get()` because invalid fields may already be missing from `cleaned_data`.

### 7. Build `ModelForm` classes with explicit `Meta` settings
**Why**: `ModelForm` maps model fields into form fields, but `Meta` decides what is exposed.

```python
from django import forms

from .models import Product


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = ["name", "sku", "price", "category", "description"]
        widgets = {"description": forms.Textarea(attrs={"rows": 4})}
        help_texts = {"sku": "Shown in admin and exports."}
```

**Warning**: Prefer explicit `fields` over `"__all__"` so future model changes do not leak into the form.

### 8. Use `save(commit=False)` when a `ModelForm` needs extra model data
**Why**: Some fields should be set by application code, not by user input.

```python
from django import forms

from .models import Product


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = ["name", "price", "categories"]

    def save(self, user, commit=True):
        product = super().save(commit=False)
        product.updated_by = user
        if commit:
            product.save()
            self.save_m2m()
        return product
```

**Warning**: If the form has many-to-many fields, call `save_m2m()` after saving the instance.

### 9. Choose field classes that match the real input type
**Why**: Correct field classes give you coercion, HTML5 inputs, and built-in validation.

```python
from django import forms

from .models import Category, Order


class ProductIntakeForm(forms.Form):
    name = forms.CharField(max_length=120)
    quantity = forms.IntegerField(min_value=0)
    price = forms.DecimalField(max_digits=10, decimal_places=2)
    email = forms.EmailField()
    status = forms.ChoiceField(choices=Order.Status.choices)
    category = forms.ModelChoiceField(queryset=Category.objects.all())
    spec_sheet = forms.FileField(required=False)
    image = forms.ImageField(required=False)
```

**Warning**: `ChoiceField` normalizes to strings; use `TypedChoiceField` or `ModelChoiceField` when you need other types.

### 10. Customize widgets with `attrs` instead of hand-rolling HTML
**Why**: Widget configuration keeps rendering close to the form definition while preserving Django binding behavior.

```python
from django import forms

from .models import Product


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = ["name", "price", "category"]
        widgets = {
            "name": forms.TextInput(attrs={"placeholder": "Product name"}),
            "price": forms.NumberInput(attrs={"step": "0.01", "min": "0"}),
            "category": forms.Select(attrs={"data-role": "category"}),
        }
```

**Warning**: Widget attrs change HTML output only; they do not replace server-side validation.

### 11. Create a custom widget when one reusable HTML shape is missing
**Why**: Custom widgets centralize rendering for repeated form inputs.

```python
from django import forms


class SKUInput(forms.TextInput):
    template_name = "widgets/sku_input.html"

    def __init__(self, attrs=None):
        super().__init__(attrs={"spellcheck": "false", **(attrs or {})})


class ProductForm(forms.Form):
    sku = forms.CharField(widget=SKUInput())
```

**Warning**: A custom widget changes rendering, not normalization or validation.

### 12. Reuse function validators and `RegexValidator`
**Why**: Validators are composable and reusable across both forms and models.

```python
from django import forms
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator


def validate_even_quantity(value):
    if value % 2:
        raise ValidationError("Quantity must be even.")


class OrderLineForm(forms.Form):
    sku = forms.CharField(validators=[RegexValidator(r"^[A-Z0-9-]+\Z", "Use uppercase SKU format.")])
    quantity = forms.IntegerField(min_value=1, validators=[validate_even_quantity])
```

**Warning**: Validators run after field coercion and before `clean_<field>()`.

### 13. Use class-based validators when the rule needs configuration
**Why**: Callable validator classes work well when the same rule needs different limits in different forms.

```python
from django import forms
from django.core.exceptions import ValidationError


class MaxFileSizeValidator:
    def __init__(self, max_bytes):
        self.max_bytes = max_bytes

    def __call__(self, uploaded_file):
        if uploaded_file.size > self.max_bytes:
            raise ValidationError(f"File must be <= {self.max_bytes} bytes.")


class ProductImageForm(forms.Form):
    image = forms.ImageField(validators=[MaxFileSizeValidator(2_000_000)])
```

**Warning**: Validators must raise `ValidationError`; returning `False` does nothing.

### 14. Put shared invariants on models and request-specific rules on forms
**Why**: Model validators protect domain rules everywhere; form validators handle view-specific context.

```python
from django import forms
from django.core.validators import RegexValidator
from django.db import models


class Product(models.Model):
    sku = models.CharField(max_length=32, validators=[RegexValidator(r"^[A-Z0-9-]+\Z")])


class ProductPublishForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = ["sku", "is_published"]

    def __init__(self, *args, user, **kwargs):
        self.user = user
        super().__init__(*args, **kwargs)

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("is_published") and not self.user.is_staff:
            self.add_error("is_published", "Only staff users can publish.")
        return cleaned_data
```

**Warning**: `model.save()` does not call `full_clean()` automatically, so model validators are not magically enforced on every save.

### 15. Bind uploads with `request.FILES` and multipart forms
**Why**: File and image fields stay empty unless both the request and template are wired correctly.

```htmldjango
# forms.py
from django import forms


class ProductAssetForm(forms.Form):
    spec_sheet = forms.FileField(required=False)
    image = forms.ImageField(required=False)


# views.py
form = ProductAssetForm(request.POST or None, request.FILES or None)


# template.html
<form method="post" enctype="multipart/form-data">
    {% csrf_token %}
    {{ form.as_p }}
</form>
```

**Warning**: Missing either `request.FILES` or `enctype="multipart/form-data"` breaks uploads.

### 16. Add or remove fields dynamically in `__init__()`
**Why**: Runtime form shape is useful when available fields depend on the current `User` or object state.

```python
from django import forms

from .models import Category, Product, User


class OrderForm(forms.Form):
    product = forms.ModelChoiceField(queryset=Product.objects.none())

    def __init__(self, *args, **kwargs):
        user = kwargs.pop("user")
        super().__init__(*args, **kwargs)
        self.fields["product"].queryset = Product.objects.all()
        if user.is_staff:
            self.fields["approver"] = forms.ModelChoiceField(queryset=User.objects.all(), required=False)
```

**Warning**: Pop custom kwargs before `super().__init__()` or Django raises `TypeError`.

### 17. Render forms with helpers or manual layout
**Why**: Django gives you fast default rendering and fine-grained manual control when the layout needs it.

```django
<form method="post">
    {% csrf_token %}
    {{ form.as_p }}
</form>

<form method="post">
    {% csrf_token %}
    {{ form.as_div }}
</form>

<form method="post">
    {% csrf_token %}
    {{ form.non_field_errors }}
    {% for field in form.visible_fields %}
        <div>{{ field.label_tag }} {{ field }} {{ field.errors }}</div>
    {% endfor %}
</form>
```

**Warning**: `as_p()` and `as_div()` do not render the outer `<form>` tag or submit button, and `as_div()` requires Django 5.0+.

### 18. Read errors from `form.errors` and `form.non_field_errors()`
**Why**: Field errors and form-wide errors are stored separately and should be rendered deliberately.

```python
from django import forms
from django.core.exceptions import ValidationError


class UserInviteForm(forms.Form):
    email = forms.EmailField(error_messages={"required": "Enter an email address."})
    role = forms.ChoiceField(choices=[("buyer", "Buyer"), ("manager", "Manager")])

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("role") == "manager" and not cleaned_data.get("email", "").endswith("@example.com"):
            raise ValidationError("Manager invites must use a company email.")
        return cleaned_data


form = UserInviteForm({"email": "bad", "role": "manager"})
form.is_valid()
form.errors
form.non_field_errors()
```

**Warning**: Accessing `form.errors` triggers validation if it has not already run.

### 19. Use `formset_factory()` for repeated plain forms
**Why**: Formsets let one request handle multiple copies of the same form without manual field naming.

```python
from django import forms
from django.forms import formset_factory

from .models import Product


class OrderLineForm(forms.Form):
    product = forms.ModelChoiceField(queryset=Product.objects.all())
    quantity = forms.IntegerField(min_value=1)


OrderLineFormSet = formset_factory(OrderLineForm, extra=1, can_delete=True)
formset = OrderLineFormSet(request.POST or None)
```

**Warning**: Render `{{ formset.management_form }}` in the template or the formset will be invalid.

### 20. Use `modelformset_factory()` and `inlineformset_factory()` for bulk model editing
**Why**: Model formsets edit many rows; inline formsets edit child objects tied to one parent instance.

```python
from django.forms import inlineformset_factory, modelformset_factory

from .models import Category, Product


ProductFormSet = modelformset_factory(Product, fields=["name", "price"], extra=0, can_delete=True)
CategoryProductFormSet = inlineformset_factory(Category, Product, fields=["name", "price"], extra=1)
```

**Warning**: Always narrow the queryset for model formsets so you do not expose every editable row by default.

### 21. Validate formsets with `is_valid()`, `total_form_count()`, and `deleted_forms`
**Why**: Formset-level checks are where you enforce limits, duplicates, and deletion-aware rules across submitted forms.

```python
from django.core.exceptions import ValidationError
from django.forms import BaseFormSet, formset_factory


class BaseOrderLineFormSet(BaseFormSet):
    def clean(self):
        super().clean()
        if any(self.errors):
            return
        products = set()
        for form in self.forms:
            if self.can_delete and form in self.deleted_forms:
                continue
            product = form.cleaned_data.get("product")
            if product in products:
                raise ValidationError("Each product may appear only once.")
            if product:
                products.add(product)


OrderLineFormSet = formset_factory(
    form=OrderLineForm,
    formset=BaseOrderLineFormSet,
    extra=1,
    can_delete=True,
)

formset = OrderLineFormSet(request.POST or None)
formset.is_valid()
formset.total_form_count()
formset.deleted_forms
```

**Warning**: `deleted_forms` is meaningful only on a bound formset after validation has populated cleaned data.
