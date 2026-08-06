---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Badges

Complete reference for Tabler badge component.

## Base Structure

```html
<span class="badge">Default</span>
<span class="badge bg-primary">Primary</span>
```

## Badge Colors

### Semantic Colors
```html
<span class="badge bg-primary text-primary-fg">Primary</span>
<span class="badge bg-secondary text-secondary-fg">Secondary</span>
<span class="badge bg-success text-success-fg">Success</span>
<span class="badge bg-danger text-danger-fg">Danger</span>
<span class="badge bg-warning text-warning-fg">Warning</span>
<span class="badge bg-info text-info-fg">Info</span>
<span class="badge bg-light text-light-fg">Light</span>
<span class="badge bg-dark text-dark-fg">Dark</span>
```

### Theme Colors
```html
<span class="badge bg-blue text-blue-fg">Blue</span>
<span class="badge bg-azure text-azure-fg">Azure</span>
<span class="badge bg-indigo text-indigo-fg">Indigo</span>
<span class="badge bg-purple text-purple-fg">Purple</span>
<span class="badge bg-pink text-pink-fg">Pink</span>
<span class="badge bg-red text-red-fg">Red</span>
<span class="badge bg-orange text-orange-fg">Orange</span>
<span class="badge bg-yellow text-yellow-fg">Yellow</span>
<span class="badge bg-lime text-lime-fg">Lime</span>
<span class="badge bg-green text-green-fg">Green</span>
<span class="badge bg-teal text-teal-fg">Teal</span>
<span class="badge bg-cyan text-cyan-fg">Cyan</span>
```

## Light Variants

Softer, pastel backgrounds:

```html
<span class="badge bg-primary-lt">Primary Light</span>
<span class="badge bg-success-lt">Success Light</span>
<span class="badge bg-danger-lt">Danger Light</span>
<span class="badge bg-blue-lt">Blue Light</span>
```

## Badge Pill

Fully rounded corners:

```html
<span class="badge bg-primary badge-pill">Pill Badge</span>
<span class="badge bg-success-lt badge-pill">Light Pill</span>
```

## Badge Sizes

### Small Badge
```html
<span class="badge bg-primary badge-sm">Small</span>
```

### Default Badge
```html
<span class="badge bg-primary">Default</span>
```

## Badges with Icons

### Icon Before Text
```html
<span class="badge bg-primary">
  <svg class="icon icon-sm">
    <use xlink:href="#tabler-check"/>
  </svg>
  Active
</span>
```

### Icon Only
```html
<span class="badge bg-success">
  <svg class="icon">
    <use xlink:href="#tabler-check"/>
  </svg>
</span>
```

## Notification Badge

Small dot indicator for notifications:

```html
<span class="badge badge-notification bg-red"></span>
```

### With Blinking Animation
```html
<span class="badge badge-notification bg-red badge-blink"></span>
```

## Badges in Components

### In Buttons
```html
<button class="btn btn-primary">
  Notifications
  <span class="badge bg-red ms-2">4</span>
</button>

<!-- With notification dot -->
<button class="btn btn-primary position-relative">
  Messages
  <span class="badge badge-notification bg-red"></span>
</button>
```

### In List Items
```html
<ul class="list-group">
  <li class="list-group-item d-flex justify-content-between align-items-center">
    Inbox
    <span class="badge bg-primary badge-pill">14</span>
  </li>
  <li class="list-group-item d-flex justify-content-between align-items-center">
    Spam
    <span class="badge bg-danger badge-pill">2</span>
  </li>
</ul>
```

### In Navigation
```html
<ul class="nav nav-tabs">
  <li class="nav-item">
    <a class="nav-link active" href="#">
      Home
      <span class="badge bg-red ms-2">5</span>
    </a>
  </li>
  <li class="nav-item">
    <a class="nav-link" href="#">
      Profile
    </a>
  </li>
</ul>
```

### In Cards
```html
<div class="card-header">
  <h3 class="card-title">
    Tasks
    <span class="badge bg-blue ms-2">12</span>
  </h3>
</div>
```

### As Links
```html
<a href="#" class="badge bg-primary">Clickable Badge</a>
```

## Empty Badge

Badge outline without background:

```html
<span class="badge badge-outline text-primary">Outline</span>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.badge` | Base badge class (required) |
| `.bg-{color}` | Background color |
| `.text-{color}-fg` | Foreground text color (for accessibility) |
| `.bg-{color}-lt` | Light background variant |
| `.badge-pill` | Fully rounded corners |
| `.badge-sm` | Small size |
| `.badge-notification` | Small notification dot |
| `.badge-blink` | Blinking animation |
| `.badge-outline` | Outlined badge without background |

## Common Patterns

### Status Indicator
```html
<span class="badge bg-success-lt">Active</span>
<span class="badge bg-danger-lt">Inactive</span>
<span class="badge bg-warning-lt">Pending</span>
```

### Count Badge
```html
<button class="btn btn-ghost-primary position-relative">
  <svg class="icon"><use xlink:href="#tabler-bell"/></svg>
  <span class="badge badge-notification bg-red">3</span>
</button>
```

### Category Tags
```html
<div>
  <span class="badge bg-blue-lt me-1">JavaScript</span>
  <span class="badge bg-green-lt me-1">Python</span>
  <span class="badge bg-purple-lt me-1">Django</span>
</div>
```

### Role Badge
```html
<div class="d-flex align-items-center">
  <span class="avatar me-2" style="background-image: url(avatar.jpg)"></span>
  <div>
    <div>John Doe</div>
    <div class="text-secondary">
      <span class="badge bg-purple-lt badge-sm">Admin</span>
    </div>
  </div>
</div>
```

### Version Badge
```html
<h1>
  My App
  <span class="badge bg-blue-lt ms-2">v2.1.0</span>
</h1>
```

## Gotchas

1. **Always pair color classes**: Use both `.bg-{color}` and `.text-{color}-fg` for proper contrast.
2. **Light variants don't need -fg**: `.bg-{color}-lt` variants use automatic text color.
3. **Notification badge positioning**: Parent needs `.position-relative` for notification dots to position correctly.
4. **Badge vs Label**: Badges are for counts/status, not form labels. Use `<label class="form-label">` for forms.
5. **Spacing in components**: Use margin utilities (`.ms-2`, `.me-1`) to space badges from adjacent content.
6. **Icon sizing**: Use `.icon-sm` for icons inside badges to maintain proper proportions.
7. **Badge as link**: When using `<a>` with `.badge`, hover/focus states are automatic.
8. **Empty badge**: `.badge-notification` has no text content — it's a visual indicator only.
