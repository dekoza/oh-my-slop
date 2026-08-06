---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Dropdowns

Complete reference for Tabler dropdown component (based on Bootstrap dropdowns).

## Contents

- [Base Structure](#base-structure)
- [Dropdown Positions](#dropdown-positions)
  - [Default (Bottom)](#default-bottom)
  - [Dropup](#dropup)
  - [Dropend (Right)](#dropend-right)
  - [Dropstart (Left)](#dropstart-left)
- [Dropdown Menu Alignment](#dropdown-menu-alignment)
  - [Left Aligned (Default)](#left-aligned-default)
  - [Right Aligned](#right-aligned)
- [Dropdown Items](#dropdown-items)
  - [Regular Items](#regular-items)
  - [Active Item](#active-item)
  - [Disabled Item](#disabled-item)
  - [With Divider](#with-divider)
  - [With Headers](#with-headers)
- [Dropdown with Icons](#dropdown-with-icons)
- [Dropdown with Badges](#dropdown-with-badges)
- [Dropdown with Checkboxes](#dropdown-with-checkboxes)
- [Dropdown with Arrow](#dropdown-with-arrow)
- [Dropdown with Card](#dropdown-with-card)
- [Dark Dropdown](#dark-dropdown)
- [Split Button Dropdown](#split-button-dropdown)
- [Button Group Dropdown](#button-group-dropdown)
- [Dropdown Sizes](#dropdown-sizes)
  - [Small Dropdown Button](#small-dropdown-button)
  - [Large Dropdown Button](#large-dropdown-button)
- [Class Reference](#class-reference)
- [JavaScript Usage](#javascript-usage)
  - [Via Data Attributes](#via-data-attributes)
  - [Via JavaScript](#via-javascript)
  - [Events](#events)
- [Common Patterns](#common-patterns)
  - [User Menu](#user-menu)
  - [Actions Dropdown](#actions-dropdown)
  - [Filter Dropdown](#filter-dropdown)
- [Gotchas](#gotchas)

## Base Structure

```html
<div class="dropdown">
  <button class="btn btn-primary dropdown-toggle" data-bs-toggle="dropdown">
    Dropdown
  </button>
  <div class="dropdown-menu">
    <a class="dropdown-item" href="#">Action</a>
    <a class="dropdown-item" href="#">Another action</a>
    <a class="dropdown-item" href="#">Something else</a>
  </div>
</div>
```

## Dropdown Positions

### Default (Bottom)
```html
<div class="dropdown">
  <button class="btn dropdown-toggle" data-bs-toggle="dropdown">Dropdown</button>
  <div class="dropdown-menu">...</div>
</div>
```

### Dropup
```html
<div class="dropup">
  <button class="btn dropdown-toggle" data-bs-toggle="dropdown">Dropup</button>
  <div class="dropdown-menu">...</div>
</div>
```

### Dropend (Right)
```html
<div class="dropend">
  <button class="btn dropdown-toggle" data-bs-toggle="dropdown">Dropend</button>
  <div class="dropdown-menu">...</div>
</div>
```

### Dropstart (Left)
```html
<div class="dropstart">
  <button class="btn dropdown-toggle" data-bs-toggle="dropdown">Dropstart</button>
  <div class="dropdown-menu">...</div>
</div>
```

## Dropdown Menu Alignment

### Left Aligned (Default)
```html
<div class="dropdown-menu">...</div>
```

### Right Aligned
```html
<div class="dropdown-menu dropdown-menu-end">...</div>
```

## Dropdown Items

### Regular Items
```html
<div class="dropdown-menu">
  <a class="dropdown-item" href="#">Action</a>
  <a class="dropdown-item" href="#">Another action</a>
</div>
```

### Active Item
```html
<a class="dropdown-item active" href="#">Active item</a>
```

### Disabled Item
```html
<a class="dropdown-item disabled" href="#">Disabled item</a>
```

### With Divider
```html
<div class="dropdown-menu">
  <a class="dropdown-item" href="#">Action</a>
  <a class="dropdown-item" href="#">Another action</a>
  <div class="dropdown-divider"></div>
  <a class="dropdown-item" href="#">Separated link</a>
</div>
```

### With Headers
```html
<div class="dropdown-menu">
  <h6 class="dropdown-header">Dropdown header</h6>
  <a class="dropdown-item" href="#">Action</a>
  <a class="dropdown-item" href="#">Another action</a>
  <div class="dropdown-divider"></div>
  <h6 class="dropdown-header">Another header</h6>
  <a class="dropdown-item" href="#">Something else</a>
</div>
```

## Dropdown with Icons

```html
<div class="dropdown-menu">
  <a class="dropdown-item" href="#">
    <svg class="icon dropdown-item-icon">
      <use xlink:href="#tabler-edit"/>
    </svg>
    Edit
  </a>
  <a class="dropdown-item" href="#">
    <svg class="icon dropdown-item-icon">
      <use xlink:href="#tabler-trash"/>
    </svg>
    Delete
  </a>
  <a class="dropdown-item" href="#">
    <svg class="icon dropdown-item-icon">
      <use xlink:href="#tabler-download"/>
    </svg>
    Download
  </a>
</div>
```

## Dropdown with Badges

```html
<div class="dropdown-menu">
  <a class="dropdown-item" href="#">
    Messages
    <span class="badge bg-red ms-auto">4</span>
  </a>
  <a class="dropdown-item" href="#">
    Notifications
    <span class="badge bg-blue ms-auto">12</span>
  </a>
</div>
```

## Dropdown with Checkboxes

```html
<div class="dropdown-menu">
  <label class="dropdown-item">
    <input type="checkbox" class="form-check-input me-2">
    Option 1
  </label>
  <label class="dropdown-item">
    <input type="checkbox" class="form-check-input me-2" checked>
    Option 2
  </label>
  <label class="dropdown-item">
    <input type="checkbox" class="form-check-input me-2">
    Option 3
  </label>
</div>
```

## Dropdown with Arrow

```html
<div class="dropdown-menu dropdown-menu-arrow">
  <a class="dropdown-item" href="#">Action</a>
  <a class="dropdown-item" href="#">Another action</a>
</div>
```

## Dropdown with Card

```html
<div class="dropdown-menu dropdown-menu-card">
  <div class="card">
    <div class="card-body">
      <h3 class="card-title">Card Title</h3>
      <p class="text-secondary">Card content goes here.</p>
      <a href="#" class="btn btn-primary">Action</a>
    </div>
  </div>
</div>
```

## Dark Dropdown

```html
<div class="dropdown-menu dropdown-menu-dark">
  <a class="dropdown-item" href="#">Action</a>
  <a class="dropdown-item" href="#">Another action</a>
  <div class="dropdown-divider"></div>
  <a class="dropdown-item" href="#">Separated link</a>
</div>
```

## Split Button Dropdown

```html
<div class="btn-group">
  <button type="button" class="btn btn-primary">Action</button>
  <button type="button" class="btn btn-primary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown">
    <span class="visually-hidden">Toggle Dropdown</span>
  </button>
  <div class="dropdown-menu">
    <a class="dropdown-item" href="#">Action</a>
    <a class="dropdown-item" href="#">Another action</a>
  </div>
</div>
```

## Button Group Dropdown

```html
<div class="btn-group">
  <button class="btn btn-primary">Button 1</button>
  <button class="btn btn-primary">Button 2</button>
  <div class="btn-group">
    <button class="btn btn-primary dropdown-toggle" data-bs-toggle="dropdown">
      Dropdown
    </button>
    <div class="dropdown-menu">
      <a class="dropdown-item" href="#">Action</a>
      <a class="dropdown-item" href="#">Another action</a>
    </div>
  </div>
</div>
```

## Dropdown Sizes

### Small Dropdown Button
```html
<button class="btn btn-sm btn-primary dropdown-toggle" data-bs-toggle="dropdown">
  Small Dropdown
</button>
```

### Large Dropdown Button
```html
<button class="btn btn-lg btn-primary dropdown-toggle" data-bs-toggle="dropdown">
  Large Dropdown
</button>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.dropdown` | Base dropdown container |
| `.dropup` | Dropdown that opens upward |
| `.dropend` | Dropdown that opens to the right |
| `.dropstart` | Dropdown that opens to the left |
| `.dropdown-toggle` | Dropdown trigger button |
| `.dropdown-menu` | Dropdown menu container |
| `.dropdown-menu-end` | Right-align dropdown menu |
| `.dropdown-menu-arrow` | Add arrow pointer to menu |
| `.dropdown-menu-card` | Dropdown with card styling |
| `.dropdown-menu-dark` | Dark dropdown theme |
| `.dropdown-item` | Dropdown menu item |
| `.dropdown-header` | Section header in dropdown |
| `.dropdown-divider` | Divider line |
| `.dropdown-item-icon` | Icon in dropdown item |
| `.active` | Active dropdown item |
| `.disabled` | Disabled dropdown item |

## JavaScript Usage

### Via Data Attributes
```html
<button data-bs-toggle="dropdown">Toggle</button>
```

### Via JavaScript
```javascript
const dropdown = new bootstrap.Dropdown(document.getElementById('dropdownButton'));
dropdown.show();
dropdown.hide();
dropdown.toggle();
```

### Events
```javascript
const dropdownElement = document.getElementById('myDropdown');

dropdownElement.addEventListener('show.bs.dropdown', function () {
  // Before dropdown shows
});

dropdownElement.addEventListener('shown.bs.dropdown', function () {
  // After dropdown is shown
});

dropdownElement.addEventListener('hide.bs.dropdown', function () {
  // Before dropdown hides
});

dropdownElement.addEventListener('hidden.bs.dropdown', function () {
  // After dropdown is hidden
});
```

## Common Patterns

### User Menu
```html
<div class="dropdown">
  <a href="#" class="nav-link d-flex align-items-center p-0" data-bs-toggle="dropdown">
    <span class="avatar avatar-sm" style="background-image: url(avatar.jpg)"></span>
    <div class="d-none d-xl-block ps-2">
      <div>John Doe</div>
      <div class="mt-1 small text-secondary">Administrator</div>
    </div>
  </a>
  <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
    <a class="dropdown-item" href="#">
      <svg class="icon dropdown-item-icon"><use xlink:href="#tabler-user"/></svg>
      Profile
    </a>
    <a class="dropdown-item" href="#">
      <svg class="icon dropdown-item-icon"><use xlink:href="#tabler-settings"/></svg>
      Settings
    </a>
    <div class="dropdown-divider"></div>
    <a class="dropdown-item" href="#">
      <svg class="icon dropdown-item-icon"><use xlink:href="#tabler-logout"/></svg>
      Logout
    </a>
  </div>
</div>
```

### Actions Dropdown
```html
<div class="dropdown">
  <button class="btn btn-ghost-secondary btn-icon" data-bs-toggle="dropdown">
    <svg class="icon"><use xlink:href="#tabler-dots-vertical"/></svg>
  </button>
  <div class="dropdown-menu dropdown-menu-end">
    <a class="dropdown-item" href="#">Edit</a>
    <a class="dropdown-item" href="#">Duplicate</a>
    <div class="dropdown-divider"></div>
    <a class="dropdown-item text-danger" href="#">Delete</a>
  </div>
</div>
```

### Filter Dropdown
```html
<div class="dropdown">
  <button class="btn dropdown-toggle" data-bs-toggle="dropdown">
    <svg class="icon"><use xlink:href="#tabler-filter"/></svg>
    Filter
  </button>
  <div class="dropdown-menu">
    <h6 class="dropdown-header">Status</h6>
    <label class="dropdown-item">
      <input type="checkbox" class="form-check-input me-2" checked> Active
    </label>
    <label class="dropdown-item">
      <input type="checkbox" class="form-check-input me-2"> Inactive
    </label>
    <div class="dropdown-divider"></div>
    <h6 class="dropdown-header">Type</h6>
    <label class="dropdown-item">
      <input type="checkbox" class="form-check-input me-2"> Admin
    </label>
    <label class="dropdown-item">
      <input type="checkbox" class="form-check-input me-2"> User
    </label>
  </div>
</div>
```

## Gotchas

1. **Requires Bootstrap JS**: Dropdowns require Bootstrap's JavaScript to function.
2. **Toggle button**: Must have `data-bs-toggle="dropdown"` attribute on trigger button.
3. **Positioning**: Use `.dropdown-menu-end` for right alignment, not custom CSS.
4. **Arrow placement**: `.dropdown-menu-arrow` positions arrow automatically based on dropdown position.
5. **Disabled items**: Use `.disabled` class on links, not `disabled` attribute (doesn't work on `<a>`).
6. **Icon spacing**: Use `.dropdown-item-icon` class on icons, not manual margins.
7. **Dark theme**: Use `.dropdown-menu-dark` on `.dropdown-menu`, not individual items.
8. **Auto close**: By default, clicking outside closes dropdown. Prevent with `data-bs-auto-close="false"`.
9. **Multiple levels**: Bootstrap doesn't support multi-level dropdowns natively — requires custom JS.
