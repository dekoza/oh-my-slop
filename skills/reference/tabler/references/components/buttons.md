---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Buttons

Complete reference for Tabler button component.

## Base Structure

```html
<button type="button" class="btn">Button</button>
<a href="#" class="btn" role="button">Link Button</a>
```

## Button Types (Colors)

### Semantic Colors
```html
<button class="btn btn-primary">Primary</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-success">Success</button>
<button class="btn btn-warning">Warning</button>
<button class="btn btn-danger">Danger</button>
<button class="btn btn-info">Info</button>
<button class="btn btn-light">Light</button>
<button class="btn btn-dark">Dark</button>
```

### Theme Colors
Use any theme color: `btn-blue`, `btn-azure`, `btn-indigo`, `btn-purple`, `btn-pink`, `btn-red`, `btn-orange`, `btn-yellow`, `btn-lime`, `btn-green`, `btn-teal`, `btn-cyan`.

```html
<button class="btn btn-blue">Blue</button>
<button class="btn btn-red">Red</button>
```

## Variants

### Outline Buttons
```html
<button class="btn btn-outline-primary">Outline Primary</button>
<button class="btn btn-outline-danger">Outline Danger</button>
```

### Ghost Buttons
```html
<button class="btn btn-ghost-primary">Ghost Primary</button>
<button class="btn btn-ghost-secondary">Ghost Secondary</button>
```

### Pill Buttons
```html
<button class="btn btn-primary btn-pill">Pill Button</button>
```

### Square Buttons
```html
<button class="btn btn-primary btn-square">
  <svg class="icon">...</svg>
</button>
```

## Sizes

```html
<button class="btn btn-primary btn-sm">Small</button>
<button class="btn btn-primary">Default</button>
<button class="btn btn-primary btn-lg">Large</button>
```

## States

### Disabled
```html
<button class="btn btn-primary" disabled>Disabled</button>
<a class="btn btn-primary disabled" role="button" aria-disabled="true">Link Disabled</a>
```

### Active
```html
<button class="btn btn-primary active">Active</button>
```

### Loading
```html
<button class="btn btn-primary" disabled>
  <span class="spinner-border spinner-border-sm me-2"></span>
  Loading...
</button>
```

## With Icons

### Icon Left
```html
<button class="btn btn-primary">
  <svg class="icon icon-tabler icon-tabler-plus">
    <use xlink:href="#tabler-plus"/>
  </svg>
  Add Item
</button>
```

### Icon Right
```html
<button class="btn btn-primary">
  Next
  <svg class="icon icon-tabler icon-tabler-arrow-right ms-1">
    <use xlink:href="#tabler-arrow-right"/>
  </svg>
</button>
```

### Icon Only
```html
<button class="btn btn-primary btn-icon">
  <svg class="icon">
    <use xlink:href="#tabler-heart"/>
  </svg>
</button>
```

## Button Groups

### Horizontal Group
```html
<div class="btn-group" role="group">
  <button class="btn btn-primary">Left</button>
  <button class="btn btn-primary">Middle</button>
  <button class="btn btn-primary">Right</button>
</div>
```

### Vertical Group
```html
<div class="btn-group-vertical" role="group">
  <button class="btn btn-primary">Top</button>
  <button class="btn btn-primary">Middle</button>
  <button class="btn btn-primary">Bottom</button>
</div>
```

### Toolbar
```html
<div class="btn-toolbar" role="toolbar">
  <div class="btn-group me-2">
    <button class="btn btn-primary">1</button>
    <button class="btn btn-primary">2</button>
  </div>
  <div class="btn-group">
    <button class="btn btn-secondary">3</button>
  </div>
</div>
```

## Button List

Vertical list of buttons with full width:

```html
<div class="btn-list">
  <button class="btn btn-primary">Save</button>
  <button class="btn btn-secondary">Cancel</button>
  <button class="btn btn-danger">Delete</button>
</div>
```

Horizontal list with spacing:

```html
<div class="btn-list">
  <a href="#" class="btn btn-success">Accept</a>
  <a href="#" class="btn btn-outline-secondary">Reject</a>
</div>
```

## Action Buttons

Large buttons for primary actions:

```html
<button class="btn btn-primary btn-action">
  <svg class="icon">
    <use xlink:href="#tabler-plus"/>
  </svg>
</button>
```

## With Badges

```html
<button class="btn btn-primary position-relative">
  Inbox
  <span class="badge bg-red badge-notification badge-blink"></span>
</button>

<button class="btn btn-primary">
  Notifications
  <span class="badge bg-red ms-2">4</span>
</button>
```

## Social Buttons

```html
<button class="btn btn-facebook">
  <svg class="icon icon-tabler icon-tabler-brand-facebook">
    <use xlink:href="#tabler-brand-facebook"/>
  </svg>
  Facebook
</button>

<button class="btn btn-twitter">
  <svg class="icon icon-tabler icon-tabler-brand-twitter">
    <use xlink:href="#tabler-brand-twitter"/>
  </svg>
  Twitter
</button>
```

Social button colors: `btn-facebook`, `btn-twitter`, `btn-google`, `btn-youtube`, `btn-vimeo`, `btn-dribbble`, `btn-github`, `btn-instagram`, `btn-pinterest`, `btn-vk`, `btn-rss`, `btn-flickr`, `btn-bitbucket`, `btn-tabler`.

## Class Reference

| Class | Purpose |
|-------|---------|
| `.btn` | Base button class (required) |
| `.btn-{color}` | Solid colored button (primary, secondary, success, etc.) |
| `.btn-outline-{color}` | Outlined button variant |
| `.btn-ghost-{color}` | Ghost button (minimal styling) |
| `.btn-pill` | Fully rounded corners |
| `.btn-square` | Square shape (equal width/height) |
| `.btn-icon` | Icon-only button with proper padding |
| `.btn-sm` | Small size |
| `.btn-lg` | Large size |
| `.btn-action` | Large circular action button |
| `.btn-list` | Container for button lists |
| `.btn-group` | Horizontal button group |
| `.btn-group-vertical` | Vertical button group |
| `.btn-toolbar` | Toolbar with multiple button groups |
| `.active` | Active state |
| `.disabled` | Disabled state (for links) |
| `disabled` | Disabled attribute (for buttons) |

## Common Patterns

### Primary Action with Secondary
```html
<div class="btn-list">
  <button class="btn btn-primary">Save Changes</button>
  <button class="btn">Cancel</button>
</div>
```

### Form Actions
```html
<div class="card-footer text-end">
  <div class="btn-list">
    <button type="button" class="btn">Cancel</button>
    <button type="submit" class="btn btn-primary">Submit</button>
  </div>
</div>
```

### Loading State Toggle
```html
<button class="btn btn-primary" id="btn-submit">
  <span class="btn-text">Submit</span>
  <span class="spinner-border spinner-border-sm d-none" role="status"></span>
</button>

<script>
// Toggle loading state
const btn = document.getElementById('btn-submit');
btn.querySelector('.btn-text').classList.add('d-none');
btn.querySelector('.spinner-border').classList.remove('d-none');
btn.disabled = true;
</script>
```

### Dropdown Button
```html
<div class="dropdown">
  <button class="btn btn-primary dropdown-toggle" data-bs-toggle="dropdown">
    Actions
  </button>
  <div class="dropdown-menu">
    <a class="dropdown-item" href="#">Edit</a>
    <a class="dropdown-item" href="#">Delete</a>
  </div>
</div>
```

## Gotchas

1. **Link vs Button**: Use `<button>` for actions, `<a>` for navigation. Add `role="button"` to link buttons.
2. **Disabled Links**: Use `.disabled` class + `aria-disabled="true"`. The `disabled` attribute doesn't work on `<a>` tags.
3. **Icon Spacing**: Use `.me-1`, `.me-2`, `.ms-1`, `.ms-2` for icon spacing within buttons.
4. **Button Groups**: Don't add margins to buttons inside `.btn-group` — the group handles spacing.
5. **Loading State**: Always disable the button while loading to prevent double-clicks.
6. **Color Contrast**: Use `.text-{color}-fg` for text on colored backgrounds to ensure accessibility.
7. **Ghost Buttons**: Ghost buttons have transparent backgrounds — use on light backgrounds only or ensure sufficient contrast.
