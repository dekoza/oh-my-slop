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

{# Floating bottom bar — gated on DEBUG so a stray prototype can't ship it to users #}
{% if settings.DEBUG %}
<div class="prototype-bar" style="position:fixed;bottom:0;left:0;right:0;display:flex;gap:8px;padding:8px;background:#f8f9fa;border-top:1px solid #dee2e6;align-items:center;justify-content:center;" data-variants='["a","b","c"]'>
  <button class="btn btn-sm btn-outline-secondary" id="prev-variant">&#8592; Prev</button>
  <span class="badge bg-primary" id="variant-label">Variant A</span>
  <button class="btn btn-sm btn-outline-secondary" id="next-variant">Next &#8594;</button>
</div>
<script>
  (function() {
    var bar = document.querySelector('.prototype-bar');
    if (!bar) return;
    var variants = JSON.parse(bar.dataset.variants);
    var url = new URLSearchParams(location.search);
    var idx = variants.indexOf(url.get('variant') || variants[0]);
    if (idx < 0) idx = 0;
    var label = document.getElementById('variant-label');
    function update() {
      label.textContent = 'Variant ' + variants[idx].toUpperCase();
      url.set('variant', variants[idx]);
      history.replaceState({}, '', '?' + url.toString());
    }
    document.getElementById('prev-variant').addEventListener('click', function() {
      idx = (idx - 1 + variants.length) % variants.length;
      update();
    });
    document.getElementById('next-variant').addEventListener('click', function() {
      idx = (idx + 1) % variants.length;
      update();
    });
    document.addEventListener('keydown', function(e) {
      if (e.target.matches('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') { idx = (idx - 1 + variants.length) % variants.length; update(); }
      else if (e.key === 'ArrowRight') { idx = (idx + 1) % variants.length; update(); }
    });
    update();
  })();
</script>
{% endif %}
```

### 4. When done

Capture the answer — which variant won and why — somewhere durable (commit message, ADR, issue, or a `NOTES.md` next to the prototype). Fold the validated decision (the winning variant) into the real page, held to the same bar as production code. The prototype itself — losing variants, switcher bar, and `NOTES.md` — is committed as a primary source to a throwaway branch out of main (see the `prototype` skill, Rule 7); leave a context pointer to that branch on the implementation issue.

## Anti-patterns

- **Variants that differ only in colour or copy.** Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant should be structurally different — different layout, information hierarchy, and primary affordance.
- **Wiring variants to real mutations.** Point them at a stub. A prototype is for learning, not for shipping end-to-end flows.
- **Promoting the prototype directly to production.** Rewrite it properly when folding it in. Lift the validated decision into real code with real tests, error handling, and abstractions — the throwaway exemptions end the moment it's absorbed.
