# UI Prototype

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), then throws the rest away.

If the question is about logic/state rather than what something looks like — wrong branch. Use [Logic](logic.md).

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."
- Any time the user would otherwise spend a day picking between three vague mockups in their head.

## Two sub-shapes — strongly prefer sub-shape A

A UI prototype is much easier to judge when it's **butting up against the rest of the app** — real header, real sidebar, real data, real density. A throwaway route on its own is a vacuum: every variant looks fine in isolation. Default to sub-shape A whenever there's a plausible existing page to host the variants. Only reach for sub-shape B if the prototype genuinely has no nearby home.

### Sub-shape A — adjustment to an existing page (preferred)

The route already exists. Variants are rendered **on the same route**, gated by a `?variant=` URL search param. The existing data fetching, params, and auth all stay — only the rendering swaps. This is the default; pick it unless there's a specific reason not to.

If the prototype is for something that doesn't yet have a page but *would naturally live inside one* (a new section of the dashboard, a new card on the settings screen, a new step in an existing flow) — that's still sub-shape A. Mount the variants inside the host page.

### Sub-shape B — a new page (last resort)

Only use this when the thing being prototyped genuinely has no existing page to live inside — e.g. an entirely new top-level surface, or a flow that can't be embedded anywhere sensible.

Create a **throwaway route** following whatever routing convention the project already uses — don't invent a new top-level structure. Name it so it's obviously a prototype (e.g. include the word `prototype` in the path or filename). Same `?variant=` pattern.

Before committing to sub-shape B, sanity-check: is there really no existing page this could be embedded in? An empty route hides design problems that a populated one would expose.

In both sub-shapes the floating bottom bar is identical.

## Process

### 1. State the question and pick N

Default to **3 variants**. More than 5 stops being radically different and starts being noise — cap there.

Write down the plan in one line, in the prototype's location or a top-of-file comment:

> "Three variants of the settings page, switchable via `?variant=`, on the existing `/settings` route."

This works whether the user is here to push back or not.

### 2. Generate radically different variants

Draft each variant. Hold each one to:

- The page's purpose and the data it has access to.
- The project's component library / styling system (Tabler, TailwindCSS, shadcn, plain CSS, whatever).
- A clear exported component name, e.g. `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.

### 3. Wire them together

Three things must hold, and only running the page shows them:

- **Switching changes what is rendered.** The controls navigate to the new `?variant=`, so the server renders that variant. Changing only the label or the URL leaves the old variant on screen.
- **A reload keeps the selection**, because the URL carries it.
- **Production excludes the prototype on the server.** Read one explicit setting when the server starts — never an undeclared template variable. With prototypes off, don't register throwaway routes, ignore `?variant=` on the real page, and render no switcher. Hiding the bar is not exclusion.

Keep the switcher's hooks whatever the framework — a `.prototype-bar` element listing the variant names in `data-variants`, with `#prev-variant`, `#next-variant` and `#variant-label` — so every prototype can be checked the same way. This sketch shows all three with the Python standard library only. Adapt it to the project's own framework and configuration rather than copying its server:

```python
"""Prototype variants on an existing page, plus a throwaway route.

Run: python3 prototype_example.py --env development|production [--port 8000]
Prototypes exist only when the server starts with --env development.
"""
import argparse
import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

SETTINGS = {"name": "Ada", "email": "ada@example.com", "theme": "dark"}  # stub data

VARIANTS = {  # structurally different layouts over the same data
    "a": lambda: "<table>" + "".join(
        f"<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in SETTINGS.items()) + "</table>",
    "b": lambda: "".join(
        f"<details open><summary>{html.escape(k)}</summary>{html.escape(v)}</details>" for k, v in SETTINGS.items()),
    "c": lambda: "<nav>" + " | ".join(html.escape(k) for k in SETTINGS) + "</nav><p>"
    + html.escape(SETTINGS["name"]) + "</p>",
}

SWITCHER = """<div class="prototype-bar" data-variants="VARIANT_NAMES"
  style="position:fixed;bottom:0;left:0;right:0;display:flex;gap:8px;justify-content:center;padding:8px">
  <button type="button" id="prev-variant">&#8592; Prev</button>
  <span id="variant-label"></span>
  <button type="button" id="next-variant">Next &#8594;</button>
</div>
<script>
(function () {
  var variants = JSON.parse(document.querySelector('.prototype-bar').dataset.variants);
  var params = new URLSearchParams(location.search);
  var idx = Math.max(0, variants.indexOf(params.get('variant')));
  document.getElementById('variant-label').textContent = 'Variant ' + variants[idx].toUpperCase();
  function go(step) {  // navigate: the server renders the chosen variant, and a reload keeps it
    params.set('variant', variants[(idx + step + variants.length) % variants.length]);
    location.search = params.toString();
  }
  document.getElementById('prev-variant').addEventListener('click', function () { go(-1); });
  document.getElementById('next-variant').addEventListener('click', function () { go(1); });
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;  // leave browser shortcuts to the browser
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });
})();
</script>"""


def legitimate_settings() -> str:
    rows = "".join(f"<li>{k}: {html.escape(v)}</li>" for k, v in SETTINGS.items())
    return f"<main><h1>Settings</h1><ul>{rows}</ul></main>"


def variant(query: dict) -> str:
    chosen = query.get("variant", ["a"])[0]
    chosen = chosen if chosen in VARIANTS else "a"
    return f'<main data-variant="{chosen}">{VARIANTS[chosen]()}</main>'


def make_handler(prototypes: bool):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlsplit(self.path)
            query = parse_qs(url.query)
            if url.path == "/settings":  # the real page; variants only when enabled
                main = variant(query) if prototypes else legitimate_settings()
            elif url.path == "/prototype/settings" and prototypes:  # throwaway route
                main = variant(query)
            else:
                self.send_error(404)
                return
            names = html.escape(json.dumps(list(VARIANTS)))  # the bar lists exactly what the server renders
            bar = SWITCHER.replace("VARIANT_NAMES", names) if prototypes else ""
            body = f"<!doctype html><html><body><header>Acme</header>{main}{bar}</body></html>".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, choices=["development", "production"])
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.env == "development"))
    print(f"serving on http://127.0.0.1:{server.server_port} ({args.env})", flush=True)
    server.serve_forever()
```

In a framework project the same three points map onto its own mechanisms: register the throwaway route only under the configuration that enables prototypes, read `?variant=` only when it is enabled, and pass that same flag explicitly to whatever renders the switcher. Then start the server in each configuration and check it: in development, flip variants and reload in a browser; in production, request the throwaway route and the real page with `?variant=`.

### 4. When done

Follow the prototype skill's When done: record which variant won and why in `NOTES.md`, capture every variant, the switcher and the notes on a throwaway branch, leave a pointer, and only then clean up the files it wholly owns. The host page qualifies only if every uncommitted change in it is the prototype's; if it also holds other work, remove only the prototype's lines by hand, or report them. Building the winning variant into the real page is a separately authorized implementation, held to the same bar as production code.

## Anti-patterns

- **Variants that differ only in colour or copy.** Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant should be structurally different — different layout, information hierarchy, and primary affordance.
- **Wiring variants to real mutations.** Point them at a stub. A prototype is for learning, not for shipping end-to-end flows.
- **Hiding the switcher and calling the prototype excluded.** A hidden bar still leaves the throwaway route and `?variant=` working in production. Turn prototypes off on the server, from explicit configuration, and check it there.
- **Promoting the prototype directly to production.** Lift the validated decision, including a reusable pure interface where appropriate, only in a separately authorized implementation with real tests, error handling, and the needed abstractions. Leave the throwaway shell behind; its exemptions never carry into production.
