---
domain: testing-settings
category: reference
priority: high
---

# DRF Testing Utilities & Settings Reference

Use when writing DRF tests or configuring `REST_FRAMEWORK` settings.

### 1. Test Client Classes

**DRF extends Django's test infrastructure — use `APIClient` for most tests.**

| Class | Base | Purpose |
|-------|------|---------|
| `APIRequestFactory` | `django.test.RequestFactory` | Create requests without middleware |
| `APIClient` | `django.test.Client` | Full test client with middleware |
| `RequestsClient` | `requests.Session` | Python `requests`-style (WSGI adapter, no network I/O) |

Test case classes (use `APIClient` as `self.client`):
| Class | Base |
|-------|------|
| `APISimpleTestCase` | `SimpleTestCase` |
| `APITransactionTestCase` | `TransactionTestCase` |
| `APITestCase` | `TestCase` |
| `APILiveServerTestCase` | `LiveServerTestCase` |

### 2. APIClient Usage

**The most common test client — supports auth shortcuts and format specification.**

```python
from rest_framework.test import APIClient

client = APIClient()

# Authentication
client.login(username='admin', password='secret')       # session auth
client.credentials(HTTP_AUTHORIZATION='Token abc123')    # header auth (persistent)
client.force_authenticate(user=user_instance)            # bypass auth entirely
client.force_authenticate(user=None)                     # unauthenticate

# Requests
response = client.get('/api/books/')
response = client.post('/api/books/', {'title': 'DRF Guide'}, format='json')
response = client.put('/api/books/1/', data, format='json')
response = client.patch('/api/books/1/', {'title': 'New'}, format='json')
response = client.delete('/api/books/1/')

# Clear credentials
client.credentials()  # call with no args to clear
client.logout()       # end session
```

Constructor: `APIClient(enforce_csrf_checks=False)`

**Warning:** `force_authenticate` sets `request.user` to an in-memory instance. If the user is modified in the DB during the test, the in-memory instance won't reflect it — call `user.refresh_from_db()`.

### 3. APIRequestFactory Usage

**Creates request objects for direct view testing — faster but no middleware.**

```python
from rest_framework.test import APIRequestFactory

factory = APIRequestFactory()

# Create requests
request = factory.get('/api/books/')
request = factory.post('/api/books/', {'title': 'DRF Guide'}, format='json')

# Auth on factory requests
from rest_framework.test import force_authenticate
force_authenticate(request, user=user_instance, token=token_instance)

# Call view directly
view = BookList.as_view()
response = view(request)
response.render()  # must render before accessing .content
```

Difference from Django's `RequestFactory`: multipart form data encoded for PUT/PATCH too (not just POST).

Available formats: `'multipart'` (default), `'json'`

**Warning:** `APIRequestFactory` returns Django's `HttpRequest`, NOT DRF's `Request`. Setting `.token` directly has no effect. Use `force_authenticate()` function instead. Responses are NOT rendered — must call `response.render()` before accessing `response.content`.

### 4. RequestsClient

**Python `requests`-style API — useful for integration testing or familiarity.**

```python
from rest_framework.test import RequestsClient

client = RequestsClient()
response = client.get('http://testserver/api/books/')  # fully qualified URL required
```

CSRF flow: GET to obtain `csrftoken` cookie, then pass `X-CSRFToken` header.

Auth: `client.auth = HTTPBasicAuth('user', 'pass')` or `client.headers.update({'Authorization': 'Token abc'})`

**Warning:** `RequestsClient` is WSGI-only — no real network I/O. Cannot send HTTP to remote servers. Use plain `requests.Session` for live tests.

### 5. URLPatternsTestCase

**Isolates URL configuration per test class — avoids URL conflicts between tests.**

```python
from rest_framework.test import URLPatternsTestCase, APITestCase

class TestBookAPI(URLPatternsTestCase, APITestCase):
    urlpatterns = [
        path('api/', include(router.urls)),
    ]

    def test_list_books(self):
        response = self.client.get('/api/books/')
        self.assertEqual(response.status_code, 200)
```

**Warning:** Must be mixed with another test case class (`APITestCase`, `APISimpleTestCase`, etc.).

### 6. Testing Gotchas

**Common test setup mistakes that cause confusing failures.**

1. **CSRF in tests**: DRF validates CSRF inside the view (not middleware). `enforce_csrf_checks=True` on factory/client enables it — default is `False`.

2. **Unrendered responses**: Factory-created view responses need `response.render()` before `response.content`.

3. **`force_authenticate` user staleness**: The user instance is in-memory. DB changes don't propagate — call `refresh_from_db()`.

4. **`override_settings` and DRF**: Only overriding the entire `REST_FRAMEWORK` dict triggers reload. Partial key overrides within the dict are NOT detected.

```python
# Correct
@override_settings(REST_FRAMEWORK={**base_settings, 'PAGE_SIZE': 10})
def test_pagination(self):
    ...

# Incorrect — won't take effect
@override_settings(REST_FRAMEWORK__PAGE_SIZE=10)  # doesn't work
```

5. **Test request default format**: Default is `'multipart'` (configurable via `TEST_REQUEST_DEFAULT_FORMAT`). For JSON-heavy APIs, set to `'json'`.

### 7. Complete REST_FRAMEWORK Settings Reference

**All settings with their default values — copy this as a starting point.**

#### API Policy Settings

| Key | Default | Description |
|-----|---------|-------------|
| `DEFAULT_RENDERER_CLASSES` | `[JSONRenderer, BrowsableAPIRenderer]` | Response renderers |
| `DEFAULT_PARSER_CLASSES` | `[JSONParser, FormParser, MultiPartParser]` | Request body parsers |
| `DEFAULT_AUTHENTICATION_CLASSES` | `[SessionAuthentication, BasicAuthentication]` | Auth schemes |
| `DEFAULT_PERMISSION_CLASSES` | `[AllowAny]` | Permission checks |
| `DEFAULT_THROTTLE_CLASSES` | `[]` | Rate limiting |
| `DEFAULT_CONTENT_NEGOTIATION_CLASS` | `DefaultContentNegotiation` | Accept negotiation |
| `DEFAULT_SCHEMA_CLASS` | `openapi.AutoSchema` | Schema inspector |

#### Generic View Settings

| Key | Default | Description |
|-----|---------|-------------|
| `DEFAULT_FILTER_BACKENDS` | `[]` | Filter backends |
| `DEFAULT_PAGINATION_CLASS` | `None` | Pagination class |
| `PAGE_SIZE` | `None` | Default page size |
| `SEARCH_PARAM` | `'search'` | SearchFilter query param |
| `ORDERING_PARAM` | `'ordering'` | OrderingFilter query param |

#### Throttle Settings

| Key | Default | Description |
|-----|---------|-------------|
| `DEFAULT_THROTTLE_RATES` | `{'user': None, 'anon': None}` | Rate per scope |
| `NUM_PROXIES` | `None` | Proxy count for IP detection |

#### Authentication Settings

| Key | Default | Description |
|-----|---------|-------------|
| `UNAUTHENTICATED_USER` | `AnonymousUser` | `request.user` when unauthenticated |
| `UNAUTHENTICATED_TOKEN` | `None` | `request.auth` when unauthenticated |

#### Versioning Settings

| Key | Default | Description |
|-----|---------|-------------|
| `DEFAULT_VERSIONING_CLASS` | `None` | Versioning scheme |
| `DEFAULT_VERSION` | `None` | `request.version` when no version present |
| `ALLOWED_VERSIONS` | `None` | Restrict valid versions |
| `VERSION_PARAM` | `'version'` | Parameter name |

#### Date/Time Formatting

| Key | Default | Description |
|-----|---------|-------------|
| `DATETIME_FORMAT` | `'iso-8601'` | DateTimeField output |
| `DATETIME_INPUT_FORMATS` | `['iso-8601']` | DateTimeField input |
| `DATE_FORMAT` | `'iso-8601'` | DateField output |
| `DATE_INPUT_FORMATS` | `['iso-8601']` | DateField input |
| `TIME_FORMAT` | `'iso-8601'` | TimeField output |
| `TIME_INPUT_FORMATS` | `['iso-8601']` | TimeField input |
| `DURATION_FORMAT` | `'django'` | DurationField output |

Setting format to `None` returns Python objects (rendering deferred to renderer).

#### JSON Encoding

| Key | Default | Description |
|-----|---------|-------------|
| `UNICODE_JSON` | `True` | Allow unicode in JSON |
| `COMPACT_JSON` | `True` | Minified JSON |
| `STRICT_JSON` | `True` | Reject `nan`/`inf` |
| `COERCE_DECIMAL_TO_STRING` | `True` | DecimalField as string |
| `COERCE_BIGINT_TO_STRING` | `False` | BigIntegerField as string (for JS) |

#### Content Type Controls

| Key | Default | Description |
|-----|---------|-------------|
| `URL_FORMAT_OVERRIDE` | `'format'` | Query param for format override (`None` = disable) |
| `FORMAT_SUFFIX_KWARG` | `'format'` | URL conf param for format suffixes |
| `URL_FIELD_NAME` | `'url'` | Key for URL field in HyperlinkedModelSerializer |

#### View Display

| Key | Default | Description |
|-----|---------|-------------|
| `VIEW_NAME_FUNCTION` | `'rest_framework.views.get_view_name'` | View name callable |
| `VIEW_DESCRIPTION_FUNCTION` | `'rest_framework.views.get_view_description'` | View description callable |

#### Exception Handling

| Key | Default | Description |
|-----|---------|-------------|
| `EXCEPTION_HANDLER` | `'rest_framework.views.exception_handler'` | Exception handler callable |
| `NON_FIELD_ERRORS_KEY` | `'non_field_errors'` | Key for object-level validation errors |

#### HTML / Browsable API

| Key | Default | Description |
|-----|---------|-------------|
| `HTML_SELECT_CUTOFF` | `1000` | Max items in relational dropdowns |
| `HTML_SELECT_CUTOFF_TEXT` | `"More than {count} items..."` | Text when cutoff exceeded |
| `UPLOADED_FILES_USE_URL` | `True` | FileField as URL vs filename |

#### Schema Generation

| Key | Default | Description |
|-----|---------|-------------|
| `SCHEMA_COERCE_PATH_PK` | `True` | Map `pk` to actual field name in schema |
| `SCHEMA_COERCE_METHOD_NAMES` | `{'retrieve': 'read', 'destroy': 'delete'}` | Action→method name mapping |

#### Test Settings

| Key | Default | Description |
|-----|---------|-------------|
| `TEST_REQUEST_DEFAULT_FORMAT` | `'multipart'` | Default format for test requests |
| `TEST_REQUEST_RENDERER_CLASSES` | `[MultiPartRenderer, JSONRenderer]` | Available test request formats |

### 8. Settings Access in Code

**Use `api_settings` for programmatic access — it auto-resolves dotted import paths.**

```python
from rest_framework.settings import api_settings

# Access a setting
default_renderers = api_settings.DEFAULT_RENDERER_CLASSES  # returns class objects, not strings
page_size = api_settings.PAGE_SIZE
```

Auto-reload: `override_settings(REST_FRAMEWORK={...})` in tests triggers settings reload via Django's `setting_changed` signal. Only works when overriding the entire `REST_FRAMEWORK` dict.

**Warning:** Removed settings (`PAGINATE_BY`, `PAGINATE_BY_PARAM`, `MAX_PAGINATE_BY`) raise `RuntimeError` if present — these were removed in DRF 3.x. Use `DEFAULT_PAGINATION_CLASS` and `PAGE_SIZE` instead.
