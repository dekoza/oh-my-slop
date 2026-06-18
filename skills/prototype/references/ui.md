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

Create a single switcher component on the route:

```python
# Django view
def settings_prototype(request):
    variant = request.GET.get("variant", "a")
    # ... existing data fetching ...
    return render(request, "settings/prototype.html", {
        "variant": variant,
        # ... context ...
    })
```

```html
{# Template with variant switcher #}
{% if variant == "a" %}
  {% include "settings/variant_a.html" %}
{% elif variant == "b" %}
  {% include "settings/variant_b.html" %}
{% else %}
  {% include "settings/variant_c.html" %}
{% endif %}

{# Floating bottom bar #}
<div class="prototype-bar" style="position:fixed;bottom:0;left:0;right:0;display:flex;gap:8px;padding:8px;background:#f8f9fa;border-top:1px solid #dee2e6;">
  <a href="?variant=a" class="btn btn-sm {% if variant == 'a' %}btn-primary{% else %}btn-outline-secondary{% endif %}">Variant A</a>
  <a href="?variant=b" class="btn btn-sm {% if variant == 'b' %}btn-primary{% else %}btn-outline-secondary{% endif %}">Variant B</a>
  <a href="?variant=c" class="btn btn-sm {% if variant == 'c' %}btn-primary{% else %}btn-outline-secondary{% endif %}">Variant C</a>
</div>
```

### 4. When done

Capture the answer — which variant won and why — somewhere durable (commit message, ADR, issue, or a `NOTES.md` next to the prototype). Delete the losing variants and the switcher bar. Fold the winning variant into the real page.
