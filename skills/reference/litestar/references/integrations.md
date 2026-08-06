---
domain: Litestar Integrations and Boundaries
category: reference
priority: medium
---

# Litestar Integrations and Boundaries Reference

Use this file when the task touches Litestar's integration surface rather than its core routing or request machinery. This file is intentionally boundary-focused so the skill does not sprawl into every plugin ecosystem detail.

## 1. HTMX integration belongs here; full HTMX semantics do not

Litestar exposes an HTMX integration surface, but it is not the source of truth for `hx-*` behavior.

- `HTMXPlugin` can configure the default request class for HTMX-aware routes.
- `HTMXRequest` exposes HTMX request details such as `request.htmx`.
- `HTMXTemplate` and related response classes shape HTMX-specific response headers and behaviors.

```python
from pathlib import Path

from litestar import Litestar, get
from litestar.contrib.jinja import JinjaTemplateEngine
from litestar.plugins.htmx import HTMXPlugin, HTMXRequest, HTMXTemplate
from litestar.response import Template
from litestar.template.config import TemplateConfig


@get("/form")
def form(request: HTMXRequest) -> Template:
    if request.htmx:
        return HTMXTemplate(template_name="partials/form.html", context={"partial": True}, push_url="/form")
    return HTMXTemplate(template_name="pages/form.html", context={"partial": False})


app = Litestar(
    route_handlers=[form],
    plugins=[HTMXPlugin()],
    template_config=TemplateConfig(directory=Path("templates"), engine=JinjaTemplateEngine),
)
```

**Warning**: If the problem is about swap rules, trigger modifiers, or attribute inheritance, load `@htmx`. Litestar only owns the plugin surface.

## 2. Know the HTMX-specific response classes before inventing headers manually

Litestar documents response helpers for common HTMX behaviors:

- `HTMXTemplate`
- `HXStopPolling`
- `ClientRedirect`
- `ClientRefresh`
- `HXLocation`
- `PushUrl`
- `ReplaceUrl`
- `Reswap`
- `Retarget`
- `TriggerEvent`

**Warning**: Do not hand-roll HTMX headers if a documented response class already expresses the behavior.

## 3. Template engines are optional extras, not guaranteed runtime dependencies

Core Litestar stays lightweight. Template engines require extras or explicit dependencies:

- `litestar[jinja]`
- `litestar[mako]`
- `litestar[minijinja]`
- `litestar[standard]` includes Jinja

**Warning**: If a task adds templating to a project that does not already have the engine dependency, note the dependency requirement instead of assuming it exists.

## 4. Testing helpers integrate with `httpx`, not a bespoke client stack

Litestar test clients are built on `httpx` and should be treated as the default test surface for route contracts.

- In-process tests -> `TestClient`, `AsyncTestClient`, `create_test_client()`
- Transport edge cases -> `subprocess_sync_client()`, `subprocess_async_client()`

**Warning**: If a test failure looks like an HTTPX or transport behavior issue, verify whether the endpoint needs a subprocess test rather than blaming Litestar routing first.

## 5. Guards integrate with auth, but they are not auth backends

Guards authorize access based on `connection` and `route_handler`; they often rely on authentication middleware having populated `connection.user`.

**Warning**: Do not misuse guards as full authentication systems. They are authorization gates.

## 6. DTOs and plugins are adjacent, not interchangeable

DTOs are a core Litestar mechanism. Some model families reach Litestar through plugins or contrib packages.

- Core DTO control lives in the framework (`dto`, `return_dto`, `DataclassDTO`, etc.)
- Pydantic, attrs, SQLAlchemy, and other ecosystems may add plugin-specific capabilities

**Warning**: If the task depends on deep model-plugin behavior, this skill should name that boundary instead of inventing plugin internals.

## 7. Static file routing is now router-based, which matters for migration work

The current docs push `create_static_files_router()`. Legacy `StaticFilesConfig` is explicitly deprecated.

**Warning**: When updating older code, call out the migration boundary. Silent partial migrations create mixed-style codebases that are harder to maintain.

## 8. Version awareness matters right now

The official docs include 2.x-era migration notes and deprecations, while the repo metadata currently reports `3.0.0b0`.

- Treat deprecation notes as active compatibility concerns.
- Prefer current documented APIs when writing new examples.
- If editing existing code that uses old APIs, explain whether you are preserving compatibility or migrating.

**Warning**: A lot of bad Litestar advice comes from flattening 2.x and 3.0-beta behavior into one invented rule set. Do not do that.
