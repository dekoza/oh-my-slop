---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Tables

Complete reference for Tabler table component.

## Contents

- [Base Structure](#base-structure)
- [Table Variants](#table-variants)
  - [Striped Rows](#striped-rows)
  - [Bordered](#bordered)
  - [Borderless](#borderless)
  - [Hoverable Rows](#hoverable-rows)
  - [Small/Compact](#smallcompact)
- [Table Utilities](#table-utilities)
  - [Vertical Centering](#vertical-centering)
  - [Prevent Text Wrapping](#prevent-text-wrapping)
  - [Mobile Cards (Responsive)](#mobile-cards-responsive)
  - [Card Table (Inside Card)](#card-table-inside-card)
- [Row States](#row-states)
  - [Contextual Colors](#contextual-colors)
  - [Active Row](#active-row)
- [Table with Checkboxes](#table-with-checkboxes)
- [Table with Actions](#table-with-actions)
  - [With Dropdown Actions](#with-dropdown-actions)
- [Table with Avatars](#table-with-avatars)
- [Sticky Header](#sticky-header)
- [Sortable Table Headers](#sortable-table-headers)
- [Class Reference](#class-reference)
- [Common Patterns](#common-patterns)
  - [Data Table with Pagination](#data-table-with-pagination)
  - [Empty Table State](#empty-table-state)
- [Gotchas](#gotchas)

## Base Structure

```html
<div class="table-responsive">
  <table class="table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Email</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>John Doe</td>
        <td>john@example.com</td>
        <td><span class="badge bg-success">Active</span></td>
      </tr>
      <tr>
        <td>Jane Smith</td>
        <td>jane@example.com</td>
        <td><span class="badge bg-danger">Inactive</span></td>
      </tr>
    </tbody>
  </table>
</div>
```

## Table Variants

### Striped Rows
```html
<table class="table table-striped">
  ...
</table>
```

### Bordered
```html
<table class="table table-bordered">
  ...
</table>
```

### Borderless
```html
<table class="table table-borderless">
  ...
</table>
```

### Hoverable Rows
```html
<table class="table table-hover">
  ...
</table>
```

### Small/Compact
```html
<table class="table table-sm">
  ...
</table>
```

## Table Utilities

### Vertical Centering
```html
<table class="table table-vcenter">
  ...
</table>
```

### Prevent Text Wrapping
```html
<table class="table table-nowrap">
  ...
</table>
```

### Mobile Cards (Responsive)
```html
<table class="table table-mobile">
  ...
</table>
```

### Card Table (Inside Card)
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

## Row States

### Contextual Colors
```html
<tr class="table-primary">...</tr>
<tr class="table-secondary">...</tr>
<tr class="table-success">...</tr>
<tr class="table-danger">...</tr>
<tr class="table-warning">...</tr>
<tr class="table-info">...</tr>
<tr class="table-light">...</tr>
<tr class="table-dark">...</tr>
```

### Active Row
```html
<tr class="table-active">...</tr>
```

## Table with Checkboxes

```html
<table class="table table-vcenter">
  <thead>
    <tr>
      <th class="w-1">
        <input type="checkbox" class="form-check-input">
      </th>
      <th>Name</th>
      <th>Email</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <input type="checkbox" class="form-check-input">
      </td>
      <td>John Doe</td>
      <td>john@example.com</td>
      <td><span class="badge bg-success">Active</span></td>
    </tr>
    <tr>
      <td>
        <input type="checkbox" class="form-check-input">
      </td>
      <td>Jane Smith</td>
      <td>jane@example.com</td>
      <td><span class="badge bg-danger">Inactive</span></td>
    </tr>
  </tbody>
</table>
```

## Table with Actions

```html
<table class="table table-vcenter">
  <thead>
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th class="w-1"></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>John Doe</td>
      <td>john@example.com</td>
      <td>
        <div class="btn-list">
          <button class="btn btn-sm btn-primary">Edit</button>
          <button class="btn btn-sm btn-danger">Delete</button>
        </div>
      </td>
    </tr>
  </tbody>
</table>
```

### With Dropdown Actions
```html
<td>
  <div class="dropdown">
    <button class="btn btn-sm dropdown-toggle" data-bs-toggle="dropdown">
      Actions
    </button>
    <div class="dropdown-menu dropdown-menu-end">
      <a class="dropdown-item" href="#">Edit</a>
      <a class="dropdown-item" href="#">Delete</a>
    </div>
  </div>
</td>
```

## Table with Avatars

```html
<table class="table table-vcenter">
  <thead>
    <tr>
      <th>User</th>
      <th>Role</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <div class="d-flex align-items-center">
          <span class="avatar me-2" style="background-image: url(avatar.jpg)"></span>
          <div>
            <div>John Doe</div>
            <div class="text-secondary small">john@example.com</div>
          </div>
        </div>
      </td>
      <td>Administrator</td>
      <td><span class="badge bg-success">Active</span></td>
    </tr>
  </tbody>
</table>
```

## Sticky Header

```html
<div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
  <table class="table table-vcenter">
    <thead class="table-sticky">
      <tr>
        <th>Name</th>
        <th>Email</th>
      </tr>
    </thead>
    <tbody>
      <!-- Many rows -->
    </tbody>
  </table>
</div>
```

## Sortable Table Headers

```html
<thead>
  <tr>
    <th>
      <a href="#" class="table-sort">Name</a>
    </th>
    <th>
      <a href="#" class="table-sort table-sort-asc">Email</a>
    </th>
    <th>
      <a href="#" class="table-sort table-sort-desc">Status</a>
    </th>
  </tr>
</thead>
```

Sort states: `.table-sort` (unsorted), `.table-sort-asc` (ascending), `.table-sort-desc` (descending)

## Class Reference

| Class | Purpose |
|-------|---------|
| `.table` | Base table class (required) |
| `.table-responsive` | Horizontal scroll on small screens |
| `.table-striped` | Zebra-striped rows |
| `.table-bordered` | Borders on all sides |
| `.table-borderless` | No borders |
| `.table-hover` | Hoverable rows |
| `.table-sm` | Compact padding |
| `.table-vcenter` | Vertically center cell content |
| `.table-nowrap` | Prevent text wrapping |
| `.table-mobile` | Mobile card layout |
| `.card-table` | Table inside card (use with `.table`) |
| `.table-sticky` | Sticky header (on `<thead>`) |
| `.table-sort` | Sortable column header |
| `.table-sort-asc` | Ascending sort indicator |
| `.table-sort-desc` | Descending sort indicator |
| `.table-{color}` | Row color (primary, success, danger, etc.) |
| `.table-active` | Active row state |
| `.w-1` | Minimal column width |

## Common Patterns

### Data Table with Pagination
```html
<div class="card">
  <div class="table-responsive">
    <table class="table card-table table-vcenter">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <!-- Table rows -->
      </tbody>
    </table>
  </div>
  <div class="card-footer d-flex align-items-center">
    <p class="m-0 text-secondary">Showing 1 to 10 of 50 entries</p>
    <ul class="pagination m-0 ms-auto">
      <li class="page-item disabled">
        <a class="page-link" href="#">Previous</a>
      </li>
      <li class="page-item active"><a class="page-link" href="#">1</a></li>
      <li class="page-item"><a class="page-link" href="#">2</a></li>
      <li class="page-item"><a class="page-link" href="#">3</a></li>
      <li class="page-item">
        <a class="page-link" href="#">Next</a>
      </li>
    </ul>
  </div>
</div>
```

### Empty Table State
```html
<div class="table-responsive">
  <table class="table card-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Email</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="2">
          <div class="empty">
            <div class="empty-icon">
              <svg class="icon">...</svg>
            </div>
            <p class="empty-title">No data found</p>
            <p class="empty-subtitle text-secondary">
              Try adjusting your filters
            </p>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

## Gotchas

1. **Always wrap in table-responsive**: Use `.table-responsive` wrapper for horizontal scrolling on mobile.
2. **Card table**: Use `.card-table` with `.table` when table is inside a card (removes extra borders).
3. **Checkbox column width**: Use `.w-1` on checkbox column headers to minimize width.
4. **Action column**: Use `.w-1` on action column to prevent unnecessary width.
5. **vcenter for complex cells**: Always use `.table-vcenter` when cells contain avatars, badges, or multi-line content.
6. **Sticky header height**: Set explicit `max-height` on `.table-responsive` wrapper for sticky headers to work.
7. **Sort requires JS**: `.table-sort` classes are visual only — implement sorting logic separately.
8. **Row colors accessibility**: Ensure sufficient contrast when using `.table-{color}` classes.
9. **Mobile responsiveness**: Consider `.table-mobile` for better mobile experience with many columns.
