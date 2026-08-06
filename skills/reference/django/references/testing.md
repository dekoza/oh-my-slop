---
domain: Django Testing
category: testing
priority: high
description: "Reusable Django and pytest-django testing patterns for fast, reliable suites"
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: community patterns
---

# Django Testing Reference

Use these patterns for Django unit and integration tests. Prefer real application behavior, keep setup explicit, and only reach for slower transactional paths when the contract actually depends on them.

### 1. Configure pytest-django once and centralize shared fixtures
**Why**: Test discovery gets brittle when settings, markers, and shared fixtures are scattered across the suite.

```ini
# pytest.ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings.test
python_files = tests.py test_*.py *_tests.py
markers =
    integration: tests that touch Django or HTTP boundaries
    slow: tests with expensive setup
```

```python
# tests/conftest.py
import pytest

from tests.factories import UserFactory


@pytest.fixture
def test_user(db):
    return UserFactory(username="TEST_user")
```

**Warning**: `conftest.py` is loaded once per test session. If fixtures create database state, they must be function-scoped or prefixed with `TEST_` to avoid collisions with seed data.

### 2. Pick the smallest useful base class: `SimpleTestCase`, `TestCase`, or `TransactionTestCase`
**Why**: Using a database-enabled base class for pure logic tests slows the suite. Using `TestCase` for commit-sensitive code hides transaction behavior.

```python
from django.test import SimpleTestCase, TestCase, TransactionTestCase


class SlugTests(SimpleTestCase):
    def test_slugify(self):
        from django.utils.text import slugify
        assert slugify("Hello World") == "hello-world"


class ViewTests(TestCase):
    def test_product_list(self):
        response = self.client.get("/products/")
        self.assertEqual(response.status_code, 200)


class OnCommitTests(TransactionTestCase):
    def test_on_commit_hook(self):
        from django.db import transaction
        called = []
        transaction.on_commit(lambda: called.append(1))
        self.assertEqual(called, [1])
```

**Warning**: `TransactionTestCase` does not roll back between tests and requires a fresh database for each test. Use it sparingly because it is much slower than `TestCase`.

### 3. Use the Django test client for response contracts, redirects, and template assertions
**Why**: The test client exercises URL resolution, middleware, sessions, and templates without running a real server.

```python
from django.test import TestCase
from django.urls import reverse


class AccountViewTests(TestCase):
    def test_profile_page(self):
        response = self.client.get(reverse("account:profile"), follow=True)

        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "account/profile.html")
        self.assertContains(response, "Profile")
```

**Warning**: `assertTemplateUsed()` only works if the view uses the template directly or via `render()`. Using `TemplateResponse` with middleware modifications may bypass this assertion.

### 4. Use `RequestFactory` for direct view unit tests and set missing request state yourself
**Why**: `RequestFactory` is faster than the test client for view logic, but it skips middleware, session, and authentication setup.

```python
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory, TestCase

from app.views import dashboard_view


class DashboardViewTests(TestCase):
    def test_anonymous_request(self):
        request = RequestFactory().get("/dashboard/")
        request.user = AnonymousUser()

        response = dashboard_view(request)

        self.assertEqual(response.status_code, 302)
```

**Warning**: `RequestFactory` bypasses middleware. If the view depends on middleware state (e.g., `request.session`), use the test client instead.

### 5. Provide an `authenticated_client` fixture for repeated protected-view tests
**Why**: Repeating user creation and login in every test adds noise and obscures the request contract.

```python
import pytest

from tests.factories import UserFactory


@pytest.fixture
def authenticated_client(client, db):
    user = UserFactory(username="TEST_staff")
    client.force_login(user)
    return client


@pytest.mark.django_db
def test_order_list(authenticated_client):
    response = authenticated_client.get("/orders/")

    assert response.status_code == 200
```

**Warning**: `force_login()` does not validate password. Use it only in tests. For integration testing, use `client.login()` with real credentials.

### 6. Override settings locally with `override_settings()` and `modify_settings()`
**Why**: Tests should mutate settings only for the code path under test, not for the whole suite.

```python
from django.test import TestCase, modify_settings, override_settings


@override_settings(ALLOWED_HOSTS=["tenant.example.test"])
class TenantHostTests(TestCase):
    @modify_settings(MIDDLEWARE={"append": "django.middleware.locale.LocaleMiddleware"})
    def test_host_specific_route(self):
        response = self.client.get("/", headers={"host": "tenant.example.test"})

        self.assertEqual(response.status_code, 200)
```

**Warning**: `override_settings()` changes settings after the app registry is loaded. Some settings (like `INSTALLED_APPS`) cannot be changed this way.

### 7. Inspect `mail.outbox` instead of talking to a real SMTP server
**Why**: Django's in-memory email backend keeps tests deterministic and makes message assertions cheap.

```python
from django.core import mail
from django.core.mail import send_mail
from django.test import TestCase


class EmailTests(TestCase):
    def test_password_reset_email(self):
        send_mail("Reset", "Body", "noreply@example.com", ["user@example.com"])

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Reset")
        self.assertEqual(mail.outbox[0].to, ["user@example.com"])
```

**Warning**: `mail.outbox` is global. If multiple tests send email, the outbox accumulates. Clear it with `mail.outbox.clear()` if tests run in sequence.

### 8. Test file uploads with `SimpleUploadedFile` and multipart posts
**Why**: Upload tests should send the same kind of payload that a real browser submits.

```python
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse


class DocumentUploadTests(TestCase):
    def test_upload(self):
        upload = SimpleUploadedFile(
            "report.txt",
            b"quarterly results",
            content_type="text/plain",
        )

        response = self.client.post(
            reverse("documents:upload"),
            data={"title": "Quarterly report", "file": upload},
        )

        self.assertEqual(response.status_code, 302)
```

**Warning**: Upload fields in forms require both `request.FILES` and the form to be bound with `request.FILES`. If the form binding is missing, uploads are always empty.

### 9. Capture management command output with `call_command()` and `StringIO`
**Why**: Command tests should verify real command behavior, not internal helper functions only.

```python
from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class CommandTests(TestCase):
    def test_rebuild_index_command(self):
        out = StringIO()

        call_command("rebuild_index", "--dry-run", stdout=out)

        self.assertIn("dry run", out.getvalue().lower())
```

**Warning**: Commands raise `CommandError` if they fail. Catching the exception prevents test failures that should fail. Test the exception explicitly if failure is expected.

### 10. Register custom markers and keep fixture visibility deliberate
**Why**: Unregistered markers create warning noise, and misplaced fixtures silently disappear because pytest only loads `conftest.py` from the current directory or its parents.

```ini
# pytest.ini
[pytest]
markers =
    unit: pure logic tests without database access
    integration: tests that touch Django or HTTP boundaries
    slow: expensive setup or large fixture graphs
```

```python
# tests/integration/conftest.py
import pytest

from tests.factories import UserFactory


@pytest.fixture
def staff_user(db):
    return UserFactory(username="TEST_staff_user")
```

**Warning**: If `conftest.py` does not exist in a subdirectory, pytest will not load fixtures from parent directories for that subtree. Always place root fixtures in `tests/conftest.py`.

### 11. Keep database-modifying fixtures function-scoped and use `transaction=True` only when boundaries matter
**Why**: Default rollback isolation is fast. Transactional tests are slower and should be reserved for code that depends on commits, locks, or `on_commit()` callbacks.

```python
from django.db import transaction

import pytest

from tests.factories import OrderFactory


@pytest.mark.django_db(transaction=True)
def test_on_commit_callback():
    with transaction.atomic():
        order = OrderFactory(reference="TEST-PENDING")
        transaction.on_commit(
            lambda: type(order).objects.filter(pk=order.pk).update(reference="TEST-COMMITTED")
        )

    order.refresh_from_db()
    assert order.reference == "TEST-COMMITTED"
```

**Warning**: Without `transaction=True`, the `on_commit()` callback fires immediately. With `transaction=True`, the callback waits for the transaction to commit. This matters for testing transaction behavior.

### 12. Use `update_or_create()` when lookup rows may already exist
**Why**: Seed data and setup migrations make plain `create()` fragile. Idempotent fixtures prevent noisy unique-constraint failures.

```python
import pytest

from shop.models import Product


@pytest.fixture
def reusable_product(db):
    product, _ = Product.objects.update_or_create(
        sku="TEST-SKU-001",
        defaults={"name": "Notebook"},
    )
    return product
```

**Warning**: `update_or_create()` requires at least one field in the `defaults` argument, or the update has nothing to do. Always provide defaults.

### 13. Override `auto_now_add` timestamps with `queryset.update()` after factory creation
**Why**: Django ignores direct assignment to `auto_now_add=True` during `save()`. If a test needs an exact timestamp, patch the stored row after creation.

```python
from datetime import datetime, timezone

import pytest

from tests.factories import OrderFactory


@pytest.mark.django_db
def test_created_at_override():
    expected_created_at = datetime(2024, 1, 15, tzinfo=timezone.utc)
    order = OrderFactory()

    type(order).objects.filter(pk=order.pk).update(created_at=expected_created_at)
    order.refresh_from_db()

    assert order.created_at == expected_created_at
```

**Warning**: `auto_now=True` fields also ignore manual assignment. Use `queryset.update()` for both `auto_now_add` and `auto_now` field overrides in tests.

### 14. Prefix seed-sensitive values with `TEST_` to avoid fixture collisions
**Why**: Tests run against migrated databases, not empty fantasy worlds. Explicit test-only prefixes reduce collisions with usernames, slugs, and codes from seed data.

```python
from tests.factories import OrderFactory, ProductFactory, UserFactory


def test_order_reference_prefix(db):
    user = UserFactory(username="TEST_order_owner")
    product = ProductFactory(sku="TEST-SKU-001")
    order = OrderFactory(reference="TEST-ORDER-001", user=user, product=product)

    assert order.reference.startswith("TEST-")
```

**Warning**: Test-specific prefixes do not guarantee uniqueness if you have multiple tests creating similar data. Use fixtures or factories to ensure test isolation.

### 15. Prefer factories for reusable relational setup and inline payloads for tiny one-offs
**Why**: Factories keep relational setup consistent, while tiny inline dictionaries are clearer than forcing every primitive through a factory.

```python
import pytest

from tests.factories import OrderFactory, ProductFactory, UserFactory


@pytest.mark.django_db
def test_add_order_note(client):
    user = UserFactory(username="TEST_factory_user")
    product = ProductFactory(name="Planner")
    order = OrderFactory(user=user, product=product)

    payload = {"note": "gift wrap"}
    response = client.post(f"/orders/{order.pk}/notes/", data=payload)

    assert response.status_code == 302
```

**Warning**: Factory overuse makes tests slow and hard to debug. If a test needs only one simple string, inline it instead of creating a factory parameter.

### 16. Use real domain objects by default and fake only outbound HTTP with `httpx.MockTransport`
**Why**: Heavy mocking hides broken ORM queries and invalid state transitions. Keep Django models and services real, and fake only external APIs.

```python
import httpx
import pytest

from tests.factories import OrderFactory


def handler(request: httpx.Request) -> httpx.Response:
    assert request.url.path == "/api/orders"
    return httpx.Response(200, json={"status": "accepted"})


@pytest.mark.django_db
def test_order_sync_request():
    order = OrderFactory(reference="TEST-ORDER-API")
    client = httpx.Client(
        base_url="https://example.test",
        transport=httpx.MockTransport(handler),
    )

    response = client.post("/api/orders", json={"reference": order.reference})

    assert response.json()["status"] == "accepted"
```

**Warning**: Mock transports are powerful but can hide integration bugs. For critical external APIs, run integration tests against real staging endpoints or use VCR cassettes.

### 17. Speed up repeated pytest-django runs with `--reuse-db` and recreate only after schema changes
**Why**: Rebuilding the test database every run wastes time. Reuse it during local loops, then force recreation when migrations change.

```ini
# pytest.ini
[pytest]
addopts = --reuse-db
```

```bash
pytest
pytest --create-db
```

**Warning**: `--reuse-db` can silently hide schema mismatches. If tests fail with mysterious errors after migrations, run `pytest --create-db` to rebuild.

### 18. Playwright + Django E2E pitfalls
**Why**: Browser E2E tests against `live_server` fail in ways plain Django tests never do — wrong base URLs and missing static assets produce silent misroutes and blank pages.

- Prevent redirect loops: when the `live_server` fixture is used, always navigate with `live_server.url`.
- Make the navigation target explicit: a missing `base_url`/`live_server.url` can silently route tests to localhost and fail.
- Static assets are not automatically served by Django `live_server`; configure static handling for test runs.
- If static assets are required, run `manage.py collectstatic --noinput` before launching browser E2E tests.
- Fallback when browser E2E is unavailable: cover flow behavior with Django test client integration tests (or `httpx` transport where appropriate).
