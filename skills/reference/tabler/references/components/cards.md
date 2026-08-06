---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Cards

Complete reference for Tabler card component.

## Contents

- [Base Structure](#base-structure)
- [Card Sections](#card-sections)
  - [With Header](#with-header)
  - [With Footer](#with-footer)
  - [Complete Structure](#complete-structure)
- [Padding Variants](#padding-variants)
  - [Small Padding](#small-padding)
  - [Medium Padding](#medium-padding)
  - [Large Padding](#large-padding)
- [Card with Image](#card-with-image)
  - [Image Top](#image-top)
  - [Image Bottom](#image-bottom)
  - [Image Overlay](#image-overlay)
- [Card Status](#card-status)
  - [Top Status](#top-status)
  - [Start Status (Left)](#start-status-left)
  - [Bottom Status](#bottom-status)
- [Card Header Options](#card-header-options)
  - [With Actions](#with-actions)
  - [With Tabs](#with-tabs)
  - [With Pills](#with-pills)
- [Card Table](#card-table)
- [Card List](#card-list)
- [Stacked Cards](#stacked-cards)
- [Card Options](#card-options)
  - [Inactive Card](#inactive-card)
  - [Card with Border Color](#card-with-border-color)
  - [Card Link (Hoverable)](#card-link-hoverable)
- [Blog Post Card](#blog-post-card)
- [Grid Layouts](#grid-layouts)
  - [Two Column](#two-column)
  - [Three Column](#three-column)
- [Class Reference](#class-reference)
- [Common Patterns](#common-patterns)
  - [Dashboard Stat Card](#dashboard-stat-card)
  - [Card with Form](#card-with-form)
  - [Empty State in Card](#empty-state-in-card)
- [Gotchas](#gotchas)

## Base Structure

```html
<div class="card">
  <div class="card-body">
    Card content
  </div>
</div>
```

## Card Sections

### With Header
```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Card Title</h3>
  </div>
  <div class="card-body">
    Card content
  </div>
</div>
```

### With Footer
```html
<div class="card">
  <div class="card-body">
    Card content
  </div>
  <div class="card-footer">
    Footer content
  </div>
</div>
```

### Complete Structure
```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Title</h3>
    <div class="card-actions">
      <a href="#" class="btn btn-primary">Action</a>
    </div>
  </div>
  <div class="card-body">
    Main content
  </div>
  <div class="card-footer">
    Footer
  </div>
</div>
```

## Padding Variants

### Small Padding
```html
<div class="card card-sm">
  <div class="card-body">
    Compact card with reduced padding
  </div>
</div>
```

### Medium Padding
```html
<div class="card card-md">
  <div class="card-body">
    Card with medium padding
  </div>
</div>
```

### Large Padding
```html
<div class="card card-lg">
  <div class="card-body">
    Card with large padding
  </div>
</div>
```

## Card with Image

### Image Top
```html
<div class="card">
  <img class="card-img-top" src="image.jpg" alt="...">
  <div class="card-body">
    <h3 class="card-title">Title</h3>
    <p>Content</p>
  </div>
</div>
```

### Image Bottom
```html
<div class="card">
  <div class="card-body">
    <h3 class="card-title">Title</h3>
    <p>Content</p>
  </div>
  <img class="card-img-bottom" src="image.jpg" alt="...">
</div>
```

### Image Overlay
```html
<div class="card card-cover" style="background-image: url(image.jpg)">
  <div class="card-body">
    <h3 class="card-title text-white">Title</h3>
    <p class="text-white">Content</p>
  </div>
</div>
```

## Card Status

### Top Status
```html
<div class="card card-status-top card-status-primary">
  <div class="card-body">
    Card with primary status bar on top
  </div>
</div>
```

Available colors: `card-status-primary`, `card-status-success`, `card-status-danger`, `card-status-warning`, `card-status-info`, or any theme color like `card-status-blue`.

### Start Status (Left)
```html
<div class="card card-status-start card-status-success">
  <div class="card-body">
    Card with success status bar on left
  </div>
</div>
```

### Bottom Status
```html
<div class="card card-status-bottom card-status-danger">
  <div class="card-body">
    Card with danger status bar on bottom
  </div>
</div>
```

## Card Header Options

### With Actions
```html
<div class="card-header">
  <h3 class="card-title">Title</h3>
  <div class="card-actions">
    <button class="btn btn-sm btn-primary">Action</button>
  </div>
</div>
```

### With Tabs
```html
<div class="card">
  <div class="card-header">
    <ul class="nav nav-tabs card-header-tabs">
      <li class="nav-item">
        <a class="nav-link active" href="#tab1">Tab 1</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="#tab2">Tab 2</a>
      </li>
    </ul>
  </div>
  <div class="card-body">
    <div class="tab-content">
      <div class="tab-pane active" id="tab1">Content 1</div>
      <div class="tab-pane" id="tab2">Content 2</div>
    </div>
  </div>
</div>
```

### With Pills
```html
<div class="card-header">
  <ul class="nav nav-pills card-header-pills">
    <li class="nav-item">
      <a class="nav-link active" href="#">Active</a>
    </li>
    <li class="nav-item">
      <a class="nav-link" href="#">Link</a>
    </li>
  </ul>
</div>
```

## Card Table

```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Users</h3>
  </div>
  <div class="table-responsive">
    <table class="table card-table table-vcenter">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>John Doe</td>
          <td>john@example.com</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

## Card List

```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Items</h3>
  </div>
  <div class="list-group list-group-flush">
    <a href="#" class="list-group-item list-group-item-action">Item 1</a>
    <a href="#" class="list-group-item list-group-item-action">Item 2</a>
    <a href="#" class="list-group-item list-group-item-action">Item 3</a>
  </div>
</div>
```

## Stacked Cards

```html
<div class="card card-stacked">
  <div class="card-body">
    Stacked card with shadow layers
  </div>
</div>
```

## Card Options

### Inactive Card
```html
<div class="card card-inactive">
  <div class="card-body">
    Grayed out inactive card
  </div>
</div>
```

### Card with Border Color
```html
<div class="card card-border-primary">
  <div class="card-body">
    Card with primary border
  </div>
</div>
```

### Card Link (Hoverable)
```html
<a href="#" class="card card-link">
  <div class="card-body">
    Entire card is clickable with hover effect
  </div>
</a>
```

## Blog Post Card

```html
<div class="card">
  <a href="#">
    <img class="card-img-top" src="image.jpg" alt="Post image">
  </a>
  <div class="card-body">
    <div class="d-flex align-items-center mb-3">
      <span class="avatar avatar-sm me-3" style="background-image: url(avatar.jpg)"></span>
      <div>
        <div>Author Name</div>
        <div class="text-secondary">3 days ago</div>
      </div>
    </div>
    <h3 class="card-title">
      <a href="#" class="text-reset">Blog Post Title</a>
    </h3>
    <p class="text-secondary">
      Post excerpt or description goes here...
    </p>
    <div class="d-flex align-items-center mt-3">
      <div class="me-auto">
        <a href="#" class="text-secondary">
          <svg class="icon">...</svg> 12 comments
        </a>
      </div>
      <a href="#" class="btn btn-sm btn-primary">Read more</a>
    </div>
  </div>
</div>
```

## Grid Layouts

### Two Column
```html
<div class="row row-cards">
  <div class="col-md-6">
    <div class="card">
      <div class="card-body">Card 1</div>
    </div>
  </div>
  <div class="col-md-6">
    <div class="card">
      <div class="card-body">Card 2</div>
    </div>
  </div>
</div>
```

### Three Column
```html
<div class="row row-cards">
  <div class="col-md-4">
    <div class="card">
      <div class="card-body">Card 1</div>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card">
      <div class="card-body">Card 2</div>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card">
      <div class="card-body">Card 3</div>
    </div>
  </div>
</div>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.card` | Base card container (required) |
| `.card-body` | Main content area with padding |
| `.card-header` | Top section with title/actions |
| `.card-footer` | Bottom section |
| `.card-title` | Card title (use h3) |
| `.card-subtitle` | Subtitle below title |
| `.card-actions` | Action buttons in header |
| `.card-sm` | Small padding |
| `.card-md` | Medium padding |
| `.card-lg` | Large padding |
| `.card-status-top` | Status bar on top edge |
| `.card-status-start` | Status bar on left edge |
| `.card-status-bottom` | Status bar on bottom edge |
| `.card-status-{color}` | Status bar color |
| `.card-img-top` | Image at top |
| `.card-img-bottom` | Image at bottom |
| `.card-cover` | Background image overlay |
| `.card-table` | Table inside card (use with `.table`) |
| `.card-stacked` | Stacked appearance with layers |
| `.card-inactive` | Grayed out inactive state |
| `.card-border-{color}` | Colored border |
| `.card-link` | Entire card clickable with hover |
| `.row-cards` | Row container for card grids |

## Common Patterns

### Dashboard Stat Card
```html
<div class="card">
  <div class="card-body">
    <div class="d-flex align-items-center">
      <div class="me-auto">
        <div class="text-secondary mb-1">Total Users</div>
        <div class="h1 mb-0">2,847</div>
      </div>
      <div class="ms-auto">
        <svg class="icon icon-tabler text-green" style="width: 3rem; height: 3rem;">
          <use xlink:href="#tabler-users"/>
        </svg>
      </div>
    </div>
  </div>
</div>
```

### Card with Form
```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Settings</h3>
  </div>
  <div class="card-body">
    <form>
      <div class="mb-3">
        <label class="form-label">Name</label>
        <input type="text" class="form-control">
      </div>
      <div class="mb-3">
        <label class="form-label">Email</label>
        <input type="email" class="form-control">
      </div>
    </form>
  </div>
  <div class="card-footer text-end">
    <button class="btn btn-primary">Save</button>
  </div>
</div>
```

### Empty State in Card
```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Recent Activity</h3>
  </div>
  <div class="card-body">
    <div class="empty">
      <div class="empty-icon">
        <svg class="icon">...</svg>
      </div>
      <p class="empty-title">No activity yet</p>
      <p class="empty-subtitle text-secondary">
        Your recent activity will appear here
      </p>
    </div>
  </div>
</div>
```

## Gotchas

1. **Always use card-body**: Content should always be wrapped in `.card-body` for proper padding. Direct children of `.card` won't have padding.
2. **Header hierarchy**: Use `.card-header` > `.card-title` (h3 tag) for semantic structure and proper spacing.
3. **Footer alignment**: Use `.text-end` on `.card-footer` to right-align action buttons.
4. **Table in card**: Use `.card-table` on the `<table>` and wrap in `.table-responsive` for proper styling.
5. **Status position**: Status bars need TWO classes: `.card-status-{position}` AND `.card-status-{color}`.
6. **Image sizing**: Images with `.card-img-top` or `.card-img-bottom` should be appropriately sized — they'll stretch to card width.
7. **Row spacing**: Use `.row-cards` instead of plain `.row` for proper card spacing in grids.
8. **Card nesting**: Don't nest cards inside cards — use separate columns or restructure layout.
