---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Colors & Typography

Complete reference for Tabler's color system, typography utilities, CSS custom properties, icon patterns, and low-level layout helpers.

## Contents

- [Color System](#color-system)
  - [Base Colors](#base-colors)
  - [Light Variants](#light-variants)
  - [Gray Palette](#gray-palette)
  - [Social Colors](#social-colors)
  - [Semantic Colors](#semantic-colors)
  - [Color Utilities](#color-utilities)
  - [CSS Custom Properties](#css-custom-properties)
- [Typography](#typography)
  - [Headings and Heading Utility Classes](#headings-and-heading-utility-classes)
  - [Display Text](#display-text)
  - [Lead and Supporting Text](#lead-and-supporting-text)
  - [Truncation and Reset Utilities](#truncation-and-reset-utilities)
  - [Subheader](#subheader)
- [Icon System](#icon-system)
  - [Base SVG Pattern](#base-svg-pattern)
  - [Size Modifiers](#size-modifiers)
  - [Filled and Animated Icons](#filled-and-animated-icons)
- [Undocumented and Preview Utilities](#undocumented-and-preview-utilities)
  - [Scrollable Containers](#scrollable-containers)
  - [Flex and Hover Helpers](#flex-and-hover-helpers)
  - [Fixed Size Helpers](#fixed-size-helpers)
  - [Divide Utilities](#divide-utilities)
  - [Print and Navbar Helpers](#print-and-navbar-helpers)
  - [Card Grid Helper](#card-grid-helper)
- [Class Reference](#class-reference)
- [Gotchas](#gotchas)

## Color System

Tabler ships four practical color groups:

1. Twelve theme colors for accents, badges, buttons, alerts, charts, and states.
2. Twelve low-intensity light variants with the `-lt` suffix.
3. Eleven neutral grays from `50` through `950`.
4. Sixteen social brand colors for recognizable third-party actions.

The current bundle exposes Tabler-specific variables with the `--tblr-*` prefix.

## Base Colors

These are the main non-semantic theme colors documented by Tabler.

| Color | CSS variable | Common utilities |
|-------|--------------|------------------|
| Blue | `--tblr-blue` | `.bg-blue`, `.text-blue`, `.text-blue-fg` |
| Azure | `--tblr-azure` | `.bg-azure`, `.text-azure`, `.text-azure-fg` |
| Indigo | `--tblr-indigo` | `.bg-indigo`, `.text-indigo`, `.text-indigo-fg` |
| Purple | `--tblr-purple` | `.bg-purple`, `.text-purple`, `.text-purple-fg` |
| Pink | `--tblr-pink` | `.bg-pink`, `.text-pink`, `.text-pink-fg` |
| Red | `--tblr-red` | `.bg-red`, `.text-red`, `.text-red-fg` |
| Orange | `--tblr-orange` | `.bg-orange`, `.text-orange`, `.text-orange-fg` |
| Yellow | `--tblr-yellow` | `.bg-yellow`, `.text-yellow`, `.text-yellow-fg` |
| Lime | `--tblr-lime` | `.bg-lime`, `.text-lime`, `.text-lime-fg` |
| Green | `--tblr-green` | `.bg-green`, `.text-green`, `.text-green-fg` |
| Teal | `--tblr-teal` | `.bg-teal`, `.text-teal`, `.text-teal-fg` |
| Cyan | `--tblr-cyan` | `.bg-cyan`, `.text-cyan`, `.text-cyan-fg` |

### Base Color Swatches

```html
<div class="row row-cards">
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-blue text-blue-fg">
        <div class="subheader text-blue-fg">Blue</div>
        <div class="h2 mb-0">.bg-blue</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-azure text-azure-fg">
        <div class="subheader text-azure-fg">Azure</div>
        <div class="h2 mb-0">.bg-azure</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-indigo text-indigo-fg">
        <div class="subheader text-indigo-fg">Indigo</div>
        <div class="h2 mb-0">.bg-indigo</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-purple text-purple-fg">
        <div class="subheader text-purple-fg">Purple</div>
        <div class="h2 mb-0">.bg-purple</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-pink text-pink-fg">
        <div class="subheader text-pink-fg">Pink</div>
        <div class="h2 mb-0">.bg-pink</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-red text-red-fg">
        <div class="subheader text-red-fg">Red</div>
        <div class="h2 mb-0">.bg-red</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-orange text-orange-fg">
        <div class="subheader text-orange-fg">Orange</div>
        <div class="h2 mb-0">.bg-orange</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-yellow text-yellow-fg">
        <div class="subheader text-yellow-fg">Yellow</div>
        <div class="h2 mb-0">.bg-yellow</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-lime text-lime-fg">
        <div class="subheader text-lime-fg">Lime</div>
        <div class="h2 mb-0">.bg-lime</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-green text-green-fg">
        <div class="subheader text-green-fg">Green</div>
        <div class="h2 mb-0">.bg-green</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-teal text-teal-fg">
        <div class="subheader text-teal-fg">Teal</div>
        <div class="h2 mb-0">.bg-teal</div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card">
      <div class="card-body bg-cyan text-cyan-fg">
        <div class="subheader text-cyan-fg">Cyan</div>
        <div class="h2 mb-0">.bg-cyan</div>
      </div>
    </div>
  </div>
</div>
```

## Light Variants

Every base color has a low-emphasis background variant with the `-lt` suffix.

| Color | Light variable | Utility |
|-------|----------------|---------|
| Blue | `--tblr-blue-lt` | `.bg-blue-lt` |
| Azure | `--tblr-azure-lt` | `.bg-azure-lt` |
| Indigo | `--tblr-indigo-lt` | `.bg-indigo-lt` |
| Purple | `--tblr-purple-lt` | `.bg-purple-lt` |
| Pink | `--tblr-pink-lt` | `.bg-pink-lt` |
| Red | `--tblr-red-lt` | `.bg-red-lt` |
| Orange | `--tblr-orange-lt` | `.bg-orange-lt` |
| Yellow | `--tblr-yellow-lt` | `.bg-yellow-lt` |
| Lime | `--tblr-lime-lt` | `.bg-lime-lt` |
| Green | `--tblr-green-lt` | `.bg-green-lt` |
| Teal | `--tblr-teal-lt` | `.bg-teal-lt` |
| Cyan | `--tblr-cyan-lt` | `.bg-cyan-lt` |

### Light Background Example

```html
<div class="row row-cards">
  <div class="col-md-6">
    <div class="card">
      <div class="card-body bg-blue-lt">
        <div class="subheader text-blue">Blue light</div>
        <div class="h3 mb-1">.bg-blue-lt</div>
        <p class="mb-0 text-secondary">Use for subtle notice boxes and status chips.</p>
      </div>
    </div>
  </div>
  <div class="col-md-6">
    <div class="card">
      <div class="card-body bg-green-lt">
        <div class="subheader text-green">Green light</div>
        <div class="h3 mb-1">.bg-green-lt</div>
        <p class="mb-0 text-secondary">Good for success summaries that should not dominate the layout.</p>
      </div>
    </div>
  </div>
</div>
```

## Gray Palette

Tabler's neutral scale uses eleven shades from `50` through `950`.

| Shade | Variable | Typical use |
|-------|----------|-------------|
| 50 | `--tblr-gray-50` | App background, subtle surfaces |
| 100 | `--tblr-gray-100` | Inverted text, soft dividers |
| 200 | `--tblr-gray-200` | Default light border tone |
| 300 | `--tblr-gray-300` | Stronger separators |
| 400 | `--tblr-gray-400` | Muted foreground accents |
| 500 | `--tblr-gray-500` | Secondary text |
| 600 | `--tblr-gray-600` | Neutral solid foreground |
| 700 | `--tblr-gray-700` | Main body tone in light mode |
| 800 | `--tblr-gray-800` | Dark surface and dark text |
| 900 | `--tblr-gray-900` | Dark background surface |
| 950 | `--tblr-gray-950` | Deepest neutral |

### Gray Surface Example

```html
<div class="row row-cards">
  <div class="col-md-4">
    <div class="card">
      <div class="card-body bg-gray-50">
        <div class="subheader text-secondary">Gray 50</div>
        <div class="h3 mb-1">Soft surface</div>
        <span class="text-muted">--tblr-gray-50</span>
      </div>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card">
      <div class="card-body bg-gray-500 text-gray-500-fg">
        <div class="subheader text-gray-500-fg">Gray 500</div>
        <div class="h3 mb-1">Neutral solid</div>
        <span>--tblr-gray-500</span>
      </div>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card">
      <div class="card-body bg-gray-950 text-gray-950-fg">
        <div class="subheader text-gray-950-fg">Gray 950</div>
        <div class="h3 mb-1">Deep contrast</div>
        <span>--tblr-gray-950</span>
      </div>
    </div>
  </div>
</div>
```

## Social Colors

Tabler documents sixteen branded social colors.

| Brand | Variable | Typical utility |
|-------|----------|-----------------|
| Facebook | `--tblr-facebook` | `.bg-facebook`, `.text-facebook` |
| Twitter | `--tblr-twitter` | `.bg-twitter`, `.text-twitter` |
| X | `--tblr-x` | `.bg-x`, `.text-x` |
| Linkedin | `--tblr-linkedin` | `.bg-linkedin`, `.text-linkedin` |
| Google | `--tblr-google` | `.bg-google`, `.text-google` |
| Youtube | `--tblr-youtube` | `.bg-youtube`, `.text-youtube` |
| Vimeo | `--tblr-vimeo` | `.bg-vimeo`, `.text-vimeo` |
| Dribbble | `--tblr-dribbble` | `.bg-dribbble`, `.text-dribbble` |
| Github | `--tblr-github` | `.bg-github`, `.text-github` |
| Instagram | `--tblr-instagram` | `.bg-instagram`, `.text-instagram` |
| Pinterest | `--tblr-pinterest` | `.bg-pinterest`, `.text-pinterest` |
| VK | `--tblr-vk` | `.bg-vk`, `.text-vk` |
| RSS | `--tblr-rss` | `.bg-rss`, `.text-rss` |
| Flickr | `--tblr-flickr` | `.bg-flickr`, `.text-flickr` |
| Bitbucket | `--tblr-bitbucket` | `.bg-bitbucket`, `.text-bitbucket` |
| Tabler | `--tblr-tabler` | `.bg-tabler`, `.text-tabler` |

### Social Badge Example

```html
<div class="card">
  <div class="card-body">
    <div class="btn-list">
      <span class="badge bg-facebook text-facebook-fg">Facebook</span>
      <span class="badge bg-twitter text-twitter-fg">Twitter</span>
      <span class="badge bg-x text-x-fg">X</span>
      <span class="badge bg-github text-github-fg">GitHub</span>
      <span class="badge bg-instagram text-instagram-fg">Instagram</span>
      <span class="badge bg-tabler text-tabler-fg">Tabler</span>
    </div>
  </div>
</div>
```

## Semantic Colors

Semantic colors map intent to meaning across components.

| Semantic color | Variable | Common utilities |
|----------------|----------|------------------|
| Primary | `--tblr-primary` | `.bg-primary`, `.text-primary`, `.text-primary-fg` |
| Secondary | `--tblr-secondary` | `.bg-secondary`, `.text-secondary`, `.text-secondary-fg` |
| Success | `--tblr-success` | `.bg-success`, `.text-success`, `.text-success-fg` |
| Danger | `--tblr-danger` | `.bg-danger`, `.text-danger`, `.text-danger-fg` |
| Warning | `--tblr-warning` | `.bg-warning`, `.text-warning`, `.text-warning-fg` |
| Info | `--tblr-info` | `.bg-info`, `.text-info`, `.text-info-fg` |
| Light | `--tblr-light` | `.bg-light`, `.text-light`, `.text-light-fg` |
| Dark | `--tblr-dark` | `.bg-dark`, `.text-dark`, `.text-dark-fg` |

### Semantic Banner Example

```html
<div class="row row-cards">
  <div class="col-md-6">
    <div class="alert bg-primary-lt text-primary mb-0">
      <div class="h3 mb-1">Primary highlight</div>
      <span>Use for the default product accent.</span>
    </div>
  </div>
  <div class="col-md-6">
    <div class="alert bg-danger-lt text-danger mb-0">
      <div class="h3 mb-1">Danger highlight</div>
      <span>Use for destructive actions and failures.</span>
    </div>
  </div>
</div>
```

## Color Utilities

Tabler generates two main utility families for the theme and semantic colors:

| Pattern | Purpose |
|---------|---------|
| `.bg-{color}` | Solid background |
| `.bg-{color}-lt` | Low-intensity background |
| `.text-{color}` | Text color |
| `.text-{color}-fg` | Contrast foreground for solid colored backgrounds |

The same pattern works for semantic colors, base colors, social colors, and grays that are exposed in the bundle.

### Utility Combination Example

```html
<div class="row row-cards">
  <div class="col-lg-4">
    <div class="card">
      <div class="card-body bg-blue text-blue-fg">
        <div class="h3 mb-1">Solid background</div>
        <span>.bg-blue + .text-blue-fg</span>
      </div>
    </div>
  </div>
  <div class="col-lg-4">
    <div class="card">
      <div class="card-body bg-blue-lt text-blue">
        <div class="h3 mb-1">Tinted background</div>
        <span>.bg-blue-lt + .text-blue</span>
      </div>
    </div>
  </div>
  <div class="col-lg-4">
    <div class="card">
      <div class="card-body">
        <div class="h3 text-blue mb-1">Text only</div>
        <span class="text-secondary">.text-blue inside a neutral card</span>
      </div>
    </div>
  </div>
</div>
```

### Utility Pattern Example for Social and Semantic Colors

```html
<div class="card">
  <div class="card-body">
    <div class="btn-list">
      <span class="badge bg-success text-success-fg">Saved</span>
      <span class="badge bg-warning text-warning-fg">Pending</span>
      <span class="badge bg-youtube text-youtube-fg">YouTube</span>
      <span class="badge bg-facebook-lt text-facebook">Facebook light</span>
    </div>
  </div>
</div>
```

## CSS Custom Properties

Tabler-specific design tokens use the `--tblr-*` prefix.

### Core Token Families

| Family | Examples | Notes |
|--------|----------|-------|
| Theme colors | `--tblr-blue`, `--tblr-red`, `--tblr-cyan` | Base theme palette |
| Light variants | `--tblr-blue-lt`, `--tblr-green-lt` | Tinted low-contrast backgrounds |
| Grays | `--tblr-gray-50` through `--tblr-gray-950` | Neutral scale |
| Semantic colors | `--tblr-primary`, `--tblr-success`, `--tblr-danger` | Intent-driven palette |
| Typography | `--tblr-font-sans-serif`, `--tblr-body-font-size`, `--tblr-font-size-h1` | Text system |
| Layout and surfaces | `--tblr-bg-surface`, `--tblr-bg-surface-secondary`, `--tblr-border-radius` | Cards, forms, containers |
| Text and links | `--tblr-body-color`, `--tblr-secondary-color`, `--tblr-link-color`, `--tblr-text-inverted` | Foreground rules |

### Frequently Used Verified Variables

| Variable | Role |
|----------|------|
| `--tblr-primary` | Default accent color |
| `--tblr-secondary` | Secondary neutral tone |
| `--tblr-body-color` | Main foreground text |
| `--tblr-body-font-size` | Base font size |
| `--tblr-font-sans-serif` | Sans family token |
| `--tblr-font-size-h1` | `.h1` and `h1` size |
| `--tblr-line-height-h1` | `.h1` and `h1` line height |
| `--tblr-bg-surface` | Main card and panel surface |
| `--tblr-bg-surface-secondary` | App background and low-emphasis surfaces |
| `--tblr-bg-surface-tertiary` | Subtle nested surface |
| `--tblr-link-color` | Default link color |
| `--tblr-border-radius` | Standard radius |
| `--tblr-gray-950` | Deepest neutral |

### Custom Property Example

```html
<div class="card" style="background: var(--tblr-bg-surface); color: var(--tblr-body-color); border-radius: var(--tblr-border-radius);">
  <div class="card-body">
    <div class="subheader" style="color: var(--tblr-secondary);">Surface token demo</div>
    <div class="h2 mb-2" style="font-size: var(--tblr-font-size-h1); line-height: var(--tblr-line-height-h1);">
      Custom properties in markup
    </div>
    <a href="#" style="color: var(--tblr-link-color);">Link using --tblr-link-color</a>
  </div>
</div>
```

## Typography

Tabler keeps Bootstrap's familiar text utilities, then adds its own low-level tokens and the Tabler-specific `.subheader` helper.

## Headings and Heading Utility Classes

Headings exist as both semantic tags and reusable utility classes.

| Class | Size token | Line-height token |
|-------|------------|-------------------|
| `.h1` | `--tblr-font-size-h1` | `--tblr-line-height-h1` |
| `.h2` | `--tblr-font-size-h2` | `--tblr-line-height-h2` |
| `.h3` | `--tblr-font-size-h3` | `--tblr-line-height-h3` |
| `.h4` | `--tblr-font-size-h4` | `--tblr-line-height-h4` |
| `.h5` | `--tblr-font-size-h5` | `--tblr-line-height-h5` |
| `.h6` | `--tblr-font-size-h6` | `--tblr-line-height-h6` |

### Headings Example

```html
<div class="card">
  <div class="card-body">
    <h1>H1 using semantic tag</h1>
    <h2>H2 using semantic tag</h2>
    <h3>H3 using semantic tag</h3>
    <div class="h1">H1 using utility class</div>
    <div class="h2">H2 using utility class</div>
    <div class="h3">H3 using utility class</div>
    <div class="h4">H4 using utility class</div>
    <div class="h5">H5 using utility class</div>
    <div class="h6 mb-0">H6 using utility class</div>
  </div>
</div>
```

## Display Text

Display classes create oversized headline styles.

| Class | Purpose |
|-------|---------|
| `.display-1` | Largest display headline |
| `.display-2` | Large hero title |
| `.display-3` | Section hero |
| `.display-4` | Large section heading |
| `.display-5` | Medium marketing heading |
| `.display-6` | Compact display heading |

### Display Example

```html
<div class="card">
  <div class="card-body">
    <div class="display-1">Display 1</div>
    <div class="display-2">Display 2</div>
    <div class="display-3">Display 3</div>
    <div class="display-4">Display 4</div>
    <div class="display-5">Display 5</div>
    <div class="display-6 mb-0">Display 6</div>
  </div>
</div>
```

## Lead and Supporting Text

These utilities shape secondary hierarchy without changing structure.

| Class | Purpose |
|-------|---------|
| `.lead` | Introductory paragraph or summary |
| `.text-muted` | Muted text color |
| `.small` | Smaller text size |
| `.text-secondary` | Secondary neutral text |
| `.text-reset` | Reset inherited link or accent color |

### Supporting Text Example

```html
<div class="card">
  <div class="card-body">
    <p class="lead">Lead text is useful for first-paragraph summaries and dashboard overviews.</p>
    <p class="text-muted">Muted text is suitable for timestamps, helper copy, and weak metadata.</p>
    <p class="text-secondary">Secondary text keeps information visible without competing with headings.</p>
    <p class="small">Small text is typically used for legal copy, microcopy, or inline notes.</p>
    <a href="#" class="text-reset">Reset link color back to inherited text color</a>
  </div>
</div>
```

## Truncation and Reset Utilities

`.text-truncate` is practical for long labels inside constrained card layouts.

### Truncate Example

```html
<div class="card">
  <div class="card-body">
    <div class="text-truncate" style="max-width: 14rem;">
      Very long notification title that should stay on one line inside a narrow card column
    </div>
  </div>
</div>
```

## Subheader

`.subheader` is a Tabler-specific small heading treatment used throughout dashboard cards, filters, and sidebars.

### Subheader Example

```html
<div class="card">
  <div class="card-body">
    <div class="subheader">Revenue this month</div>
    <div class="h1 mb-1">$42,800</div>
    <span class="text-secondary">Compared to the previous billing cycle.</span>
  </div>
</div>
```

## Icon System

Tabler icons are inline SVGs. The safe baseline is the `.icon` class on the `<svg>` element plus optional size or animation modifiers.

## Base SVG Pattern

The official docs show outline icons using `fill="none"`, `stroke="currentColor"`, and a class like `.icon icon-1`. Filled icons switch to `fill="currentColor"`.

### Base Outline Icon

```html
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-1">
  <path d="M12 20l-7 -7a5 5 0 1 1 7 -7a5 5 0 1 1 7 7l-7 7"></path>
</svg>
```

### Base Filled Icon

```html
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="icon icon-2">
  <path d="M12 21c-.3 0 -.6 -.1 -.8 -.3l-7 -6.9a6.5 6.5 0 0 1 9.2 -9.1l.6 .6l.6 -.6a6.5 6.5 0 0 1 9.2 9.1l-7 6.9c-.2 .2 -.5 .3 -.8 .3z"></path>
</svg>
```

## Size Modifiers

### Verified in current Tabler bundle

| Class | Verified status | Notes |
|-------|-----------------|-------|
| `.icon` | Verified | Base square icon sizing driven by `--tblr-icon-size` |
| `.icon-sm` | Verified | Smaller icon, 1rem size |
| `.icon-md` | Verified | Medium display icon |
| `.icon-lg` | Verified | Large display icon |

### Common project and docs-facing size names

The task requires documenting the broader naming pattern below. Only `.icon-sm`, `.icon-md`, and `.icon-lg` were emitted as CSS rules in the verified v1.4 bundle I inspected. Treat the rest as conventions that should be verified in the exact build you ship.

| Class | Practical meaning |
|-------|-------------------|
| `.icon-xs` | Extra small icon naming convention |
| `.icon-sm` | Small icon |
| `.icon-md` | Medium icon |
| `.icon-lg` | Large icon |
| `.icon-xl` | Extra large icon naming convention |
| `.icon-1` through `.icon-10` | Numeric scale sometimes seen in examples or project conventions |

### Size Example

```html
<div class="d-flex align-items-center gap-3">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-xs">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-sm">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-md">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-lg">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-xl">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
</div>
```

### Numeric Scale Example

```html
<div class="d-flex align-items-center gap-2 flex-wrap">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-1"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-2"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-3"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-4"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-5"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-6"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-7"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-8"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-9"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-10"><path d="M12 6l0 12"></path><path d="M6 12l12 0"></path></svg>
</div>
```

### Variable-driven Icon Size Example

```html
<div class="d-flex align-items-center gap-3">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" style="--tblr-icon-size: 1rem;"><path d="M4 12h16"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" style="--tblr-icon-size: 1.5rem;"><path d="M4 12h16"></path></svg>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" style="--tblr-icon-size: 2.5rem;"><path d="M4 12h16"></path></svg>
</div>
```

## Filled and Animated Icons

The bundle also includes `icon-inline`, `icon-filled`, `icon-pulse`, `icon-tada`, and `icon-rotate`.

### Filled and Animated Example

```html
<div class="d-flex align-items-center gap-4">
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="icon icon-filled">
    <path d="M12 21c-.3 0 -.6 -.1 -.8 -.3l-7 -6.9a6.5 6.5 0 0 1 9.2 -9.1l.6 .6l.6 -.6a6.5 6.5 0 0 1 9.2 9.1l-7 6.9c-.2 .2 -.5 .3 -.8 .3z"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-pulse">
    <path d="M12 4v16"></path>
    <path d="M4 12h16"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tada">
    <path d="M5 12h14"></path>
    <path d="M12 5l7 7l-7 7"></path>
  </svg>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-rotate">
    <path d="M4 12a8 8 0 1 0 2 -5.3"></path>
    <path d="M4 4v5h5"></path>
  </svg>
</div>
```

## Undocumented and Preview Utilities

These helpers appear in Tabler preview markup or bundle output but are not centrally documented in the main base docs. Some are fully emitted in CSS. Others are preview conventions that must be verified against your installed build.

## Scrollable Containers

### `.scroll-y`

- Verified in bundle.
- Sets vertical scrolling while keeping horizontal overflow hidden.

```html
<div class="card">
  <div class="card-body scroll-y" style="max-height: 12rem;">
    <div class="divide-y">
      <div>Row 1</div>
      <div>Row 2</div>
      <div>Row 3</div>
      <div>Row 4</div>
      <div>Row 5</div>
      <div>Row 6</div>
      <div>Row 7</div>
      <div>Row 8</div>
    </div>
  </div>
</div>
```

## Flex and Hover Helpers

### `.flex-center`

- Seen in Tabler preview markup.
- Not emitted as a CSS rule in the inspected v1.4 bundle.
- Treat as a project helper, not guaranteed core utility.

```html
<a href="#" class="d-flex flex-column flex-center text-center text-secondary p-3 link-hoverable">
  <span class="h5 mb-1">Centered item</span>
  <span class="small">Preview-style app launcher tile</span>
</a>
```

### `.link-hoverable`

- Verified in bundle.
- Adds hover background and accent color without default underline noise.

```html
<a href="#" class="d-flex align-items-center gap-3 p-3 link-hoverable text-reset">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-sm text-blue">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
  <span>Hoverable utility link</span>
</a>
```

## Fixed Size Helpers

### `.w-6` and `.h-6`

- Verified in bundle.
- Useful for square icon or brand tiles.

```html
<div class="d-flex align-items-center gap-3">
  <span class="d-inline-flex align-items-center justify-content-center bg-blue-lt text-blue w-6 h-6 rounded">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-sm">
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    </svg>
  </span>
  <span class="text-secondary">Fixed square launcher slot</span>
</div>
```

## Divide Utilities

### `.divide-y`

- Verified in bundle.
- Adds a vertical separator between sibling items.
- Related spacing variants include `.divide-y-0` through `.divide-y-6` and `.divide-y-fill`.

```html
<div class="card">
  <div class="card-body divide-y">
    <div>
      <div class="subheader">CPU</div>
      <div class="h3 mb-0">41%</div>
    </div>
    <div>
      <div class="subheader">Memory</div>
      <div class="h3 mb-0">7.8 GB</div>
    </div>
    <div>
      <div class="subheader">Disk</div>
      <div class="h3 mb-0">68%</div>
    </div>
  </div>
</div>
```

## Print and Navbar Helpers

### `.d-print-none`

- Verified in bundle.
- Hides an element when printed.

```html
<div class="d-print-none">
  <a href="#" class="btn btn-primary">Visible on screen only</a>
</div>
```

### `.d-none-navbar-horizontal`

- Seen in Tabler layout markup.
- Not emitted as a standalone CSS rule in the inspected bundle output I verified.
- Treat as a layout-specific helper from Tabler preview templates.

```html
<a href="#" class="navbar-brand d-none-navbar-horizontal">
  <span class="navbar-brand-image bg-blue text-blue-fg rounded px-2 py-1">T</span>
</a>
```

### `.navbar-brand-autodark`

- Seen in preview markup and dark-mode SCSS.
- Works with `.navbar-brand-image` so the brand artwork can auto-adapt in dark mode.

```html
<a href="#" class="navbar-brand navbar-brand-autodark">
  <span class="navbar-brand-image d-inline-flex align-items-center justify-content-center bg-blue text-blue-fg rounded px-2 py-1">
    TB
  </span>
</a>
```

## Card Grid Helper

### `.row-cards`

- Verified in bundle.
- Applies the card-specific gutter system and lets nested rows inherit card spacing rules.

```html
<div class="row row-cards">
  <div class="col-md-6">
    <div class="card">
      <div class="card-body">Card A</div>
    </div>
  </div>
  <div class="col-md-6">
    <div class="card">
      <div class="card-body">Card B</div>
    </div>
  </div>
</div>
```

## Class Reference

| Class or pattern | Purpose |
|------------------|---------|
| `.bg-{color}` | Solid background color |
| `.bg-{color}-lt` | Low-intensity tinted background |
| `.text-{color}` | Text color utility |
| `.text-{color}-fg` | Accessible foreground on solid color |
| `.h1`–`.h6` | Heading utility classes |
| `.display-1`–`.display-6` | Oversized display text |
| `.lead` | Introductory paragraph style |
| `.text-muted` | Muted text tone |
| `.small` | Smaller text size |
| `.text-secondary` | Secondary neutral text |
| `.text-reset` | Reset inherited link color |
| `.text-truncate` | Single-line truncation |
| `.subheader` | Tabler-specific small heading |
| `.icon` | Base icon sizing rule |
| `.icon-xs` | Extra small icon naming convention |
| `.icon-sm` | Verified small icon size |
| `.icon-md` | Verified medium icon size |
| `.icon-lg` | Verified large icon size |
| `.icon-xl` | Extra large icon naming convention |
| `.icon-1` through `.icon-10` | Numeric icon naming convention |
| `.icon-inline` | Inline icon alignment helper |
| `.icon-filled` | Filled icon helper |
| `.icon-pulse` | Pulsing icon animation |
| `.icon-tada` | Tada animation |
| `.icon-rotate` | Rotation animation |
| `.scroll-y` | Vertical scrolling helper |
| `.flex-center` | Preview helper for centered flex layout |
| `.link-hoverable` | Hover background for links or tiles |
| `.w-6` | Fixed width helper |
| `.h-6` | Fixed height helper |
| `.divide-y` | Vertical separators between siblings |
| `.d-print-none` | Hide element on print |
| `.d-none-navbar-horizontal` | Preview/layout navbar helper |
| `.navbar-brand-autodark` | Auto-adjust brand in dark mode |
| `.row-cards` | Card-aware row gutter helper |

## Gotchas

1. **Tabler variables are `--tblr-*`, not generic Bootstrap-only tokens.** Theme overrides should target `--tblr-primary`, `--tblr-bg-surface`, `--tblr-body-color`, and related variables.
2. **Use `-fg` on solid surfaces.** If you apply `.bg-blue`, `.bg-red`, `.bg-facebook`, or another strong background, pair it with `.text-blue-fg`, `.text-red-fg`, `.text-facebook-fg`, and so on.
3. **Use `-lt` for background, not emphasis text.** `.bg-green-lt` is designed for subtle containers; combine it with `.text-green` or regular body text.
4. **`.subheader` is part of Tabler's design language.** It is the right utility for section labels above metrics, filters, and micro-headings.
5. **Icon sizing is inconsistent across docs, preview markup, and bundle output.** In the inspected v1.4 CSS bundle, `.icon-sm`, `.icon-md`, and `.icon-lg` are explicitly emitted. `.icon-xs`, `.icon-xl`, and numeric classes should be treated as conventions unless verified in your build.
6. **Preview-only helpers are not guaranteed stable.** `.flex-center` and `.d-none-navbar-horizontal` appear in Tabler preview templates, but they were not emitted as standalone rules in the inspected bundle output.
7. **`row-cards` matters in dashboard layouts.** It sets the card gutter variables so nested cards stay visually consistent.
8. **Gray scale is broader than Bootstrap defaults.** Tabler uses `50` through `950`, which makes neutral theming much more precise.
