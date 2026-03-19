---
name: tabler
description: "Use when tasks involve Tabler UI components, CSS classes, variants, or layout patterns. Comprehensive reference for Tabler HTML/CSS framework."
---

# Tabler UI Reference

Tabler is the default UI framework for web projects in this context. Comprehensive reference guide for Tabler UI framework (<https://tabler.io/>). Use this skill when building UI with Tabler components, choosing CSS classes, or implementing responsive layouts.

## Quick Start

1. Identify the component or pattern you need (button, card, form, layout, etc.).
2. Refer to **Component Routing** below to find the correct reference file.
3. Use the provided HTML patterns and CSS classes verbatim.
4. Verify responsive behavior and accessibility requirements.

## Critical Patterns

1. **Bootstrap Foundation** - Tabler extends Bootstrap 5.3. All Bootstrap utilities work (`.d-flex`, `.justify-content-*`, `.align-items-*`, grid system).
2. **Color System** - Use `.bg-{color}` for backgrounds and `.text-{color}-fg` for foreground text. Light variants: `.bg-{color}-lt` with `.text-{color}-lt-fg`.
3. **Size Modifiers** - Most components support size classes: `-xs`, `-sm`, (default), `-lg`, `-xl`.
4. **State Classes** - Common states: `.active`, `.disabled`, `.loading`.
5. **Icon Integration** - Use Tabler Icons with `.icon` class. Size with `.icon-{size}` (1-10).
6. **Responsive Utilities** - Use Bootstrap responsive classes: `.d-{breakpoint}-{display}`, `.col-{breakpoint}-{size}`.
7. **Data Attributes** - Bootstrap JS components use `data-bs-toggle`, `data-bs-target`, `data-bs-dismiss`.
8. **Card Hierarchy** - Always structure cards as `.card` > `.card-body` (or `.card-header`/`.card-footer`).
9. **Form Structure** - Wrap inputs in `.mb-3` for spacing. Use `.form-label`, `.form-control`, `.form-select`.
10. **Modal Initialization** - Modals require JavaScript initialization via Bootstrap's Modal API or `data-bs-toggle="modal"`.

## Component Routing

### Components
- **Alerts** - Success/info/warning/danger alerts, dismissible variants, with icons → `references/components/alerts.md`
- **Avatars** - User avatars with images/initials/icons, sizes, status badges → `references/components/avatars.md`
- **Badges** - Color badges, pills, sizes, with icons, notifications → `references/components/badges.md`
- **Buttons** - All button types, variants (outline/ghost/pill), sizes, states → `references/components/buttons.md`
- **Cards** - Card structure, padding variants, headers/footers, layouts → `references/components/cards.md`
- **Dropdowns** - Dropdown menus, items, dividers, with icons/checkboxes → `references/components/dropdowns.md`
- **Empty States** - Empty/blank states with icons/illustrations, 404 pages → `references/components/empty.md`
- **Modals** - Modal dialogs, prompts, forms, status indicators → `references/components/modals.md`
- **Tables** - Responsive tables, sticky headers, row states, sizes → `references/components/tables.md`

### Forms
- **Form Elements** - Inputs, textareas, selects, checkboxes, radios, toggles → `references/forms/form-elements.md`

### Layout
- **Navbars** - Navigation bars, branding, menus, responsive mobile → `references/layout/navbars.md`

### Base
- **Colors & Typography** - Full color system, typography, CSS custom properties, icons, undocumented utilities → `references/base/colors-typography.md`

### Patterns
- **Page Patterns** - Page composition patterns from preview (settings, users, pricing, dashboard, invoice, search) → `references/patterns/page-patterns.md`

### Plugins
- **Plugins** - JS plugin components (charts, dropzone, flags, payments, offcanvas, spinners, and 20+ more) → `references/plugins/plugins.md`

### Reference Index
- **Reference Index** - Cross-index of all Tabler reference files → `references/REFERENCE.md`

## Color Reference

Tabler provides semantic and theme colors:

**Semantic**: `primary`, `secondary`, `success`, `danger`, `warning`, `info`, `light`, `dark`

**Theme Colors**: `blue`, `azure`, `indigo`, `purple`, `pink`, `red`, `orange`, `yellow`, `lime`, `green`, `teal`, `cyan`

**Usage**:
- Background: `.bg-{color}` (e.g., `.bg-primary`, `.bg-blue`)
- Text: `.text-{color}` (e.g., `.text-primary`, `.text-blue`)
- Foreground on colored bg: `.text-{color}-fg` (e.g., `.text-primary-fg`)
- Light variant: `.bg-{color}-lt` with `.text-{color}-lt-fg`

## Size Reference

Common size modifiers across components:

- **Extra Small**: `-xs` (avatars, buttons, badges)
- **Small**: `-sm` (buttons, cards, tables, badges)
- **Default**: no suffix (standard size)
- **Large**: `-lg` (buttons, avatars, badges)
- **Extra Large**: `-xl` (buttons, avatars)

## Bootstrap Integration

Tabler is built on Bootstrap 5.3. Use these utilities freely:

**Layout**:
- Grid: `.container`, `.row`, `.col-{size}`, `.col-{breakpoint}-{size}`
- Flexbox: `.d-flex`, `.flex-row`, `.flex-column`, `.justify-content-*`, `.align-items-*`
- Spacing: `.m-{size}`, `.p-{size}`, `.mt-*`, `.mb-*`, `.mx-*`, `.my-*` (0-5, auto)

**Display**:
- `.d-none`, `.d-block`, `.d-inline`, `.d-inline-block`
- Responsive: `.d-{breakpoint}-{value}` (sm, md, lg, xl, xxl)

**Text**:
- Alignment: `.text-start`, `.text-center`, `.text-end`
- Transform: `.text-lowercase`, `.text-uppercase`, `.text-capitalize`
- Weight: `.fw-light`, `.fw-normal`, `.fw-bold`

**Borders**:
- `.border`, `.border-top`, `.border-end`, `.border-bottom`, `.border-start`
- `.rounded`, `.rounded-circle`, `.rounded-0`, `.rounded-3`


