---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Avatars

Complete reference for Tabler avatar component.

## Base Structure

### With Image
```html
<span class="avatar" style="background-image: url(avatar.jpg)"></span>
```

### With Initials
```html
<span class="avatar">JD</span>
```

### With Icon
```html
<span class="avatar">
  <svg class="icon">
    <use xlink:href="#tabler-user"/>
  </svg>
</span>
```

## Avatar Sizes

```html
<span class="avatar avatar-xs" style="background-image: url(avatar.jpg)"></span>
<span class="avatar avatar-sm" style="background-image: url(avatar.jpg)"></span>
<span class="avatar" style="background-image: url(avatar.jpg)"></span>
<span class="avatar avatar-md" style="background-image: url(avatar.jpg)"></span>
<span class="avatar avatar-lg" style="background-image: url(avatar.jpg)"></span>
<span class="avatar avatar-xl" style="background-image: url(avatar.jpg)"></span>
```

Sizes: `avatar-xs`, `avatar-sm`, (default), `avatar-md`, `avatar-lg`, `avatar-xl`

## Avatar Shapes

### Rounded (Default)
```html
<span class="avatar" style="background-image: url(avatar.jpg)"></span>
```

### Rounded Circle
```html
<span class="avatar rounded-circle" style="background-image: url(avatar.jpg)"></span>
```

### Square
```html
<span class="avatar rounded-0" style="background-image: url(avatar.jpg)"></span>
```

### Slightly Rounded
```html
<span class="avatar rounded-3" style="background-image: url(avatar.jpg)"></span>
```

## Avatar with Status

```html
<span class="avatar" style="background-image: url(avatar.jpg)">
  <span class="badge bg-success"></span>
</span>

<span class="avatar" style="background-image: url(avatar.jpg)">
  <span class="badge bg-danger"></span>
</span>

<span class="avatar" style="background-image: url(avatar.jpg)">
  <span class="badge bg-warning"></span>
</span>
```

Status colors: `.bg-success` (online), `.bg-danger` (offline), `.bg-warning` (away), `.bg-secondary` (busy)

## Avatar with Placeholder

When no image available:

```html
<span class="avatar">
  <svg class="icon">
    <use xlink:href="#tabler-user"/>
  </svg>
</span>
```

## Avatar Colors

For initials or icons without images:

```html
<span class="avatar bg-primary text-primary-fg">AB</span>
<span class="avatar bg-success text-success-fg">CD</span>
<span class="avatar bg-danger text-danger-fg">EF</span>
<span class="avatar bg-blue-lt">GH</span>
```

## Avatar List

Horizontal list of avatars:

```html
<div class="avatar-list">
  <span class="avatar" style="background-image: url(avatar1.jpg)"></span>
  <span class="avatar" style="background-image: url(avatar2.jpg)"></span>
  <span class="avatar" style="background-image: url(avatar3.jpg)"></span>
  <span class="avatar" style="background-image: url(avatar4.jpg)"></span>
</div>
```

### Stacked Avatar List

Overlapping avatars:

```html
<div class="avatar-list avatar-list-stacked">
  <span class="avatar" style="background-image: url(avatar1.jpg)"></span>
  <span class="avatar" style="background-image: url(avatar2.jpg)"></span>
  <span class="avatar" style="background-image: url(avatar3.jpg)"></span>
  <span class="avatar">+5</span>
</div>
```

## Avatar with Upload

```html
<div class="avatar avatar-upload">
  <span class="avatar" style="background-image: url(avatar.jpg)"></span>
  <label class="avatar-upload-button" for="avatar-upload">
    <svg class="icon">
      <use xlink:href="#tabler-camera"/>
    </svg>
  </label>
  <input type="file" id="avatar-upload" class="d-none" accept="image/*">
</div>
```

## Using img Tag (Alternative)

```html
<span class="avatar">
  <img src="avatar.jpg" alt="User Name">
</span>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.avatar` | Base avatar class (required) |
| `.avatar-xs` | Extra small (1.5rem) |
| `.avatar-sm` | Small (2rem) |
| (default) | Default (2.5rem) |
| `.avatar-md` | Medium (3rem) |
| `.avatar-lg` | Large (4rem) |
| `.avatar-xl` | Extra large (5rem) |
| `.avatar-list` | Horizontal avatar list container |
| `.avatar-list-stacked` | Overlapping/stacked avatars |
| `.avatar-upload` | Avatar with upload button |
| `.avatar-upload-button` | Upload button overlay |
| `.rounded-circle` | Fully circular shape |
| `.rounded-0` | Square shape |
| `.rounded-3` | Slightly rounded corners |

## Common Patterns

### User Profile Header
```html
<div class="d-flex align-items-center mb-3">
  <span class="avatar avatar-lg me-3" style="background-image: url(avatar.jpg)">
    <span class="badge bg-success"></span>
  </span>
  <div>
    <h3 class="mb-0">John Doe</h3>
    <div class="text-secondary">Product Designer</div>
  </div>
</div>
```

### Comment with Avatar
```html
<div class="d-flex">
  <span class="avatar me-3" style="background-image: url(avatar.jpg)"></span>
  <div class="flex-fill">
    <div class="fw-bold">Jane Smith</div>
    <div class="text-secondary small">2 hours ago</div>
    <div class="mt-2">
      Great work on this feature!
    </div>
  </div>
</div>
```

### Team Member List
```html
<div class="list-group">
  <div class="list-group-item">
    <div class="d-flex align-items-center">
      <span class="avatar me-3" style="background-image: url(avatar1.jpg)"></span>
      <div class="flex-fill">
        <div>Alice Johnson</div>
        <div class="text-secondary small">alice@example.com</div>
      </div>
      <span class="badge bg-success-lt">Active</span>
    </div>
  </div>
  <div class="list-group-item">
    <div class="d-flex align-items-center">
      <span class="avatar me-3" style="background-image: url(avatar2.jpg)"></span>
      <div class="flex-fill">
        <div>Bob Wilson</div>
        <div class="text-secondary small">bob@example.com</div>
      </div>
      <span class="badge bg-secondary-lt">Offline</span>
    </div>
  </div>
</div>
```

### Avatar with Initials (Generated)
```html
<span class="avatar bg-blue-lt">
  {{ user.first_name.0 }}{{ user.last_name.0 }}
</span>
```

### Collaborators
```html
<div class="card-footer">
  <div class="d-flex align-items-center">
    <div class="me-auto">
      <strong>Collaborators</strong>
    </div>
    <div class="avatar-list avatar-list-stacked">
      <span class="avatar avatar-sm" style="background-image: url(avatar1.jpg)"></span>
      <span class="avatar avatar-sm" style="background-image: url(avatar2.jpg)"></span>
      <span class="avatar avatar-sm" style="background-image: url(avatar3.jpg)"></span>
      <span class="avatar avatar-sm">+3</span>
    </div>
  </div>
</div>
```

## Gotchas

1. **Background image**: Use inline `style="background-image: url(...)"` for avatar images, not `src` attribute.
2. **Status badge position**: Status badge must be direct child of `.avatar` for proper positioning.
3. **Initials**: Limit to 1-2 characters for readability. Use uppercase.
4. **List spacing**: `.avatar-list` handles spacing automatically — don't add margins to individual avatars.
5. **Stacked order**: In `.avatar-list-stacked`, avatars layer from left to right (first avatar on top).
6. **Size consistency**: Use same size class for all avatars in a list (e.g., all `.avatar-sm`).
7. **Color contrast**: When using `.bg-{color}` for initials, pair with `.text-{color}-fg` or use `-lt` variants.
8. **Upload button**: Requires custom JavaScript to handle file input and preview update.
9. **Alt text**: If using `<img>` tag inside avatar, always include descriptive `alt` attribute.
