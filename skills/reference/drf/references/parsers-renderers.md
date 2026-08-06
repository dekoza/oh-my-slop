---
domain: parsers-renderers
category: reference
priority: high
---

# DRF Parsers, Renderers, Content Negotiation & Metadata Reference

Use when customizing request parsing, response rendering, content negotiation, or OPTIONS metadata.

### 1. Parser Architecture

**Parsers convert raw request bodies into Python data — they're selected based on the `Content-Type` header and only invoked when `request.data` is first accessed (lazy).**

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser']
}

# Per-view
class MyView(APIView):
    parser_classes = [JSONParser]

# FBV
@api_view(['POST'])
@parser_classes([JSONParser])
def my_view(request): ...
```

**Default**: `[JSONParser, FormParser, MultiPartParser]`

### 2. Built-in Parser Classes

**Choose parsers based on what content types your API accepts.**

| Class | `media_type` | `request.data` type | Notes |
|-------|-------------|---------------------|-------|
| `JSONParser` | `application/json` | `dict` | Default |
| `FormParser` | `application/x-www-form-urlencoded` | `QueryDict` | Default. Use with `MultiPartParser` |
| `MultiPartParser` | `multipart/form-data` | `QueryDict` + `MultiValueDict` (files) | Default. Use with `FormParser` |
| `FileUploadParser` | `*/*` | `{'file': uploaded_file}` | Should be only parser on view |

### 3. FileUploadParser

**For raw file uploads via PUT — not for multipart form uploads.**

```python
class FileUploadView(APIView):
    parser_classes = [FileUploadParser]

    def put(self, request, filename, format=None):
        file_obj = request.data['file']
        return Response(status=204)

# urls.py
re_path(r'^upload/(?P<filename>[^/]+)$', FileUploadView.as_view())
```

Filename resolution: URL kwarg `filename` → `Content-Disposition` header → fallback.

Respects Django's `FILE_UPLOAD_HANDLERS` and `request.upload_handlers`.

**Warning:** `FileUploadParser` should be the only parser on the view. For web-based form uploads, use `MultiPartParser` instead.

### 4. Custom Parser

**Subclass `BaseParser` for non-standard content types.**

```python
from rest_framework.parsers import BaseParser

class PlainTextParser(BaseParser):
    media_type = 'text/plain'

    def parse(self, stream, media_type=None, parser_context=None):
        return stream.read().decode('utf-8')
```

`parser_context` keys: `view`, `request`, `args`, `kwargs`.

Error handling: malformed content → `ParseError` (400). Unknown content type → `UnsupportedMediaType` (415).

### 5. Renderer Architecture

**Renderers convert Python data to response bytes — they're selected via content negotiation (inspects `Accept` header).**

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ]
}

# Per-view
class MyView(APIView):
    renderer_classes = [JSONRenderer]

# FBV
@api_view(['GET'])
@renderer_classes([JSONRenderer])
def my_view(request): ...
```

**Default**: `[JSONRenderer, BrowsableAPIRenderer]`

The first renderer in the list is the default for underspecified requests (`Accept: */*` or missing header).

### 6. Built-in Renderer Classes

**Each renderer handles a specific media type — the browsable API is just another renderer.**

| Class | `media_type` | `format` | `charset` | Notes |
|-------|-------------|----------|-----------|-------|
| `JSONRenderer` | `application/json` | `'json'` | `None` | Supports `indent` param in Accept header |
| `TemplateHTMLRenderer` | `text/html` | `'html'` | `utf-8` | `Response` data = template context dict |
| `StaticHTMLRenderer` | `text/html` | `'html'` | `utf-8` | `Response` data = pre-rendered HTML string |
| `BrowsableAPIRenderer` | `text/html` | `'api'` | `utf-8` | Interactive HTML API browser |
| `AdminRenderer` | `text/html` | `'admin'` | `utf-8` | Admin-like CRUD interface |
| `HTMLFormRenderer` | `text/html` | `'form'` | `utf-8` | For `{% render_form serializer %}` template tag |
| `MultiPartRenderer` | `multipart/form-data` | `'multipart'` | `utf-8` | Test requests only |

### 7. JSONRenderer Behavior

**Controls JSON output format globally.**

- Default: unicode characters included, compact (no whitespace).
- `UNICODE_JSON` (default `True`) — allow unicode vs `\uXXXX` escapes.
- `COMPACT_JSON` (default `True`) — minified vs indented.
- Client can request indented: `Accept: application/json; indent=4`.

### 8. TemplateHTMLRenderer

**Renders response data as template context — for HTML views that return `Response`.**

Template resolution order:
1. Explicit `template_name` arg on `Response`
2. `.template_name` attribute on renderer class
3. `view.get_template_names()` return value

When used with serializer views, wrap data: `response.data = {'results': response.data}`.

### 9. AdminRenderer

**Admin-like CRUD interface for the browsable API.**

Needs `URL_FIELD_NAME` (default `'url'`) in serializer data for detail page links. `HyperlinkedModelSerializer` includes this automatically. For `ModelSerializer`, add explicitly:

```python
class AccountSerializer(serializers.ModelSerializer):
    url = serializers.CharField(source='get_absolute_url', read_only=True)
```

### 10. Custom Renderer

**Subclass `BaseRenderer` for non-standard output formats.**

```python
from rest_framework.renderers import BaseRenderer

class PlainTextRenderer(BaseRenderer):
    media_type = 'text/plain'
    format = 'txt'
    charset = 'utf-8'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return str(data).encode(self.charset)
```

`renderer_context` keys: `view`, `request`, `response`, `args`, `kwargs`.

For binary content: set `charset = None` and `render_style = 'binary'`.

### 11. HTML Error Rendering

**HTML renderers on exception try templates in order, then fall back to plain text.**

1. Template `{status_code}.html`
2. Template `api_exception.html`
3. Plain HTTP status code + text

Context includes `status_code` and `details` keys. `DEBUG=True` shows Django traceback instead.

### 12. Content Negotiation

**How DRF selects which renderer/parser to use for each request.**

Algorithm:
1. More specific media types preferred over less specific.
2. Equal specificity: order of `renderer_classes` determines priority.
3. **`q` values are NOT used** — DRF ignores quality factors in Accept header.
4. URL format override (`?format=json` or `.json` suffix) → filter by renderer format.
5. No match → `NotAcceptable` (406). Format override no match → `Http404`.

Custom content negotiation:
```python
from rest_framework.negotiation import BaseContentNegotiation

class IgnoreClientContentNegotiation(BaseContentNegotiation):
    def select_parser(self, request, parsers):
        return parsers[0]  # always use first parser

    def select_renderer(self, request, renderers, format_suffix):
        return (renderers[0], renderers[0].media_type)  # always use first renderer
```

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_CONTENT_NEGOTIATION_CLASS': 'myapp.negotiation.IgnoreClientContentNegotiation'
}

# Per-view
class MyView(APIView):
    content_negotiation_class = IgnoreClientContentNegotiation
```

**Warning:** `q` values in `Accept` headers are deliberately ignored by DRF — see `internals.md` section 14 for the full negotiation algorithm. Renderer order in `renderer_classes` / `DEFAULT_RENDERER_CLASSES` is the tiebreaker — put your preferred default first.

### 13. Metadata

**Controls what `OPTIONS` requests return — used by API clients for discovery.**

Default class: `SimpleMetadata`

```python
# Global
REST_FRAMEWORK = {
    'DEFAULT_METADATA_CLASS': 'rest_framework.metadata.SimpleMetadata'
}

# Per-view
class MyView(APIView):
    metadata_class = MyMetadata  # or None to disable OPTIONS metadata
```

`SimpleMetadata` response includes: `name`, `description`, `renders`, `parses`, `actions` (field info for POST/PUT).

Custom metadata: subclass `BaseMetadata`, implement `determine_metadata(self, request, view)`.

**Warning:** `OPTIONS` responses are NOT cacheable — use a GET endpoint for cacheable schema information.
