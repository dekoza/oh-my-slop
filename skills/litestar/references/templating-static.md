---
domain: Litestar Templates and Static Files
category: frontend-backend
priority: medium
---

# Litestar Templates and Static Files Reference

Use this file for template engine setup, template responses, template context behavior, CSRF insertion, and the current static-files API.

### 1. Register templating with `TemplateConfig`
**Why**: Litestar wires template engines through `template_config`, not ad hoc globals.

```python
from pathlib import Path

from litestar import Litestar
from litestar.contrib.jinja import JinjaTemplateEngine
from litestar.template.config import TemplateConfig


app = Litestar(
    route_handlers=[],
    template_config=TemplateConfig(directory=Path("templates"), engine=JinjaTemplateEngine),
)
```

**Warning**: Template-engine extras are optional dependencies. Installing Litestar alone does not guarantee Jinja, Mako, or MiniJinja is present.

### 2. Return `Template(...)` responses from handlers
**Why**: Litestar template responses are first-class response objects.

```python
from litestar import get
from litestar.response import Template


@get("/")
def home() -> Template:
    return Template(template_name="home.html", context={"title": "Dashboard"})
```

**Warning**: If the template name is wrong, Litestar raises `TemplateNotFoundException` rather than silently rendering nothing.

### 3. Use `template_name` for normal templates and `template_str` only for tiny inline fragments
**Why**: Inline strings are useful for small responses but scale poorly.

```python
from litestar import get
from litestar.response import Template


@get("/fragment")
async def fragment() -> Template:
    return Template(template_str="<strong>{{ message }}</strong>", context={"message": "Saved"})
```

**Warning**: If the template grows beyond a tiny fragment, move it into a real file.

### 4. The current request is available in template context as `request`
**Why**: Templates can access app state, URL helpers, and request context without manual plumbing.

```html
<span>{{ request.app.state.version }}</span>
```

**Warning**: Do not duplicate request-derived values into context unless you actually need a renamed or transformed form.

### 5. Mark `csrf_input` safe when rendering it into forms
**Why**: Litestar provides a CSRF input helper, but escaping it would break the hidden input markup.

```html
<form method="post">
    {{ csrf_input | safe }}
    <input type="text" name="name" />
</form>
```

**Warning**: Forgetting the safe marker turns the hidden input into escaped text instead of a usable field.

### 6. Use built-in template callables instead of rebuilding URL logic manually
**Why**: Litestar exposes helpers such as `url_for`, `csrf_token`, and `url_for_static_asset` in template environments.

```html
<a href="{{ url_for('user-detail', user_id=7) }}">Open</a>
<script src="{{ url_for_static_asset('static', file_path='/app.js') }}"></script>
```

**Warning**: URL helpers depend on correct route names. Broken names are a routing bug, not a template bug.

### 7. Register custom template callables through the engine callback
**Why**: Template behavior extensions belong in the engine configuration layer.

```python
from pathlib import Path

from litestar.contrib.jinja import JinjaTemplateEngine
from litestar.template.config import TemplateConfig


def greet(ctx: dict[str, object]) -> str:
    return str(ctx.get("name", "guest"))


def register(engine: JinjaTemplateEngine) -> None:
    engine.register_template_callable(key="greet", template_callable=greet)


template_config = TemplateConfig(
    directory=Path("templates"),
    engine=JinjaTemplateEngine,
    engine_callback=register,
)
```

**Warning**: Do not hide business logic inside template callables. Keep them small and presentation-oriented.

### 8. Serve static files with `create_static_files_router()`
**Why**: This is the documented current API.

```python
from litestar import Litestar
from litestar.static_files import create_static_files_router


app = Litestar(
    route_handlers=[create_static_files_router(path="/static", directories=["assets"])],
)
```

**Warning**: Directory paths are resolved relative to the working directory used to start the app.

### 9. Use `html_mode=True` only for actual static HTML site behavior
**Why**: HTML mode adds implicit `index.html` and `404.html` handling.

```python
from litestar import Litestar
from litestar.static_files import create_static_files_router


app = Litestar(
    route_handlers=[create_static_files_router(path="/", directories=["site"], html_mode=True)],
)
```

**Warning**: Do not enable HTML mode for ordinary asset directories. It changes routing behavior.

### 10. Use `send_as_attachment=True` only when download semantics are intended
**Why**: Static files default to inline content disposition.

```python
from litestar import Litestar
from litestar.static_files import create_static_files_router


app = Litestar(
    route_handlers=[
        create_static_files_router(path="/downloads", directories=["exports"], send_as_attachment=True)
    ],
)
```

**Warning**: Attachment headers change browser behavior. Do not use them for CSS, JS, or inline-view assets.

### 11. Reverse static URLs with the router name instead of hard-coding paths
**Why**: Static route names keep templates and code resilient to path changes.

```python
from litestar import Litestar
from litestar.static_files import create_static_files_router


app = Litestar(route_handlers=[create_static_files_router(path="/static", directories=["assets"])])
path = app.route_reverse(name="static", file_path="/logo.svg")
```

**Warning**: The route name defaults to `static`, but if a custom name is used you must reverse that exact name.

### 12. Treat `StaticFilesConfig` as deprecated migration surface
**Why**: Current docs mark `StaticFilesConfig` deprecated in favor of `create_static_files_router()`.

- Prefer router-based static setup in new code.
- If editing legacy code, call out the deprecation instead of pretending both APIs are equally current.

**Warning**: Mixing deprecated and current static APIs in the same change creates upgrade debt immediately.
