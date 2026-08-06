---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Alerts

Complete reference for Tabler alert component.

## Base Structure

```html
<div class="alert alert-primary" role="alert">
  A simple primary alert—check it out!
</div>
```

## Alert Types

### Semantic Alerts
```html
<div class="alert alert-success" role="alert">
  Success alert
</div>

<div class="alert alert-info" role="alert">
  Info alert
</div>

<div class="alert alert-warning" role="alert">
  Warning alert
</div>

<div class="alert alert-danger" role="alert">
  Danger alert
</div>
```

### Theme Color Alerts
Use any theme color: `alert-blue`, `alert-azure`, `alert-indigo`, `alert-purple`, `alert-pink`, `alert-red`, `alert-orange`, `alert-yellow`, `alert-lime`, `alert-green`, `alert-teal`, `alert-cyan`.

```html
<div class="alert alert-blue" role="alert">
  Blue alert
</div>
```

## Alert with Icon

```html
<div class="alert alert-success" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-check"/>
      </svg>
    </div>
    <div>
      Your account has been saved successfully.
    </div>
  </div>
</div>
```

## Alert with Title

```html
<div class="alert alert-danger" role="alert">
  <h4 class="alert-title">Error occurred</h4>
  <div class="text-secondary">
    Your changes could not be saved. Please try again.
  </div>
</div>
```

## Alert with Title and Icon

```html
<div class="alert alert-warning" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-alert-triangle"/>
      </svg>
    </div>
    <div>
      <h4 class="alert-title">Warning!</h4>
      <div class="text-secondary">This action cannot be undone.</div>
    </div>
  </div>
</div>
```

## Dismissible Alert

```html
<div class="alert alert-success alert-dismissible" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-check"/>
      </svg>
    </div>
    <div>
      Success! Your changes have been saved.
    </div>
  </div>
  <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
</div>
```

## Important Alert

Adds emphasis with larger padding and border:

```html
<div class="alert alert-important alert-danger" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-alert-circle"/>
      </svg>
    </div>
    <div>
      <h4 class="alert-title">Critical Error</h4>
      <div class="text-secondary">
        The system has encountered a critical error. Please contact support.
      </div>
    </div>
  </div>
</div>
```

## Alert with Buttons

```html
<div class="alert alert-info" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-info-circle"/>
      </svg>
    </div>
    <div class="flex-fill">
      <h4 class="alert-title">New version available</h4>
      <div class="text-secondary mb-3">
        A new version of this app is available. Would you like to update?
      </div>
      <div class="btn-list">
        <a href="#" class="btn btn-primary">Update now</a>
        <a href="#" class="btn">Remind me later</a>
      </div>
    </div>
  </div>
</div>
```

## Alert with Avatar

```html
<div class="alert alert-success" role="alert">
  <div class="d-flex">
    <div>
      <span class="avatar me-3" style="background-image: url(avatar.jpg)"></span>
    </div>
    <div>
      <strong>John Doe</strong> mentioned you in a comment.
    </div>
  </div>
</div>
```

## Alert with Links

```html
<div class="alert alert-primary" role="alert">
  This is a primary alert with <a href="#" class="alert-link">an example link</a>.
</div>
```

## Alert with List

```html
<div class="alert alert-danger" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-alert-circle"/>
      </svg>
    </div>
    <div>
      <h4 class="alert-title">Validation errors</h4>
      <ul class="mb-0">
        <li>Email is required</li>
        <li>Password must be at least 8 characters</li>
        <li>Terms of service must be accepted</li>
      </ul>
    </div>
  </div>
</div>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.alert` | Base alert class (required) |
| `.alert-{color}` | Alert color (primary, success, info, warning, danger, etc.) |
| `.alert-dismissible` | Makes alert dismissible with close button |
| `.alert-important` | Emphasizes alert with larger padding/border |
| `.alert-icon` | Icon styling inside alert |
| `.alert-title` | Title heading inside alert (use h4) |
| `.alert-link` | Styled link inside alert |
| `.btn-close` | Close button for dismissible alerts |

## Common Patterns

### Form Validation Error
```html
<div class="alert alert-danger alert-dismissible" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-alert-circle"/>
      </svg>
    </div>
    <div>
      <h4 class="alert-title">Unable to save</h4>
      <div class="text-secondary">Please fix the following errors:</div>
      <ul class="mb-0">
        <li>Username is already taken</li>
        <li>Email format is invalid</li>
      </ul>
    </div>
  </div>
  <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
</div>
```

### Success Notification
```html
<div class="alert alert-success alert-dismissible" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-check"/>
      </svg>
    </div>
    <div>
      Your profile has been updated successfully.
    </div>
  </div>
  <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
</div>
```

### Info with Action
```html
<div class="alert alert-info" role="alert">
  <div class="d-flex">
    <div>
      <svg class="icon alert-icon">
        <use xlink:href="#tabler-info-circle"/>
      </svg>
    </div>
    <div class="flex-fill">
      You have 3 unread messages.
      <a href="#" class="btn btn-sm btn-primary ms-auto">View messages</a>
    </div>
  </div>
</div>
```

## Gotchas

1. **Always include role="alert"**: Required for accessibility — screen readers announce alerts.
2. **Icon structure**: Use `.d-flex` wrapper with icon in first div for proper alignment.
3. **Alert title**: Use `<h4>` tag with `.alert-title` class, not other heading levels.
4. **Close button**: Place `.btn-close` as last child of `.alert`, not inside content div.
5. **Dismissible requires JS**: Bootstrap's JavaScript must be loaded for `data-bs-dismiss="alert"` to work.
6. **Text contrast**: Use `.text-secondary` for body text in alerts to ensure proper contrast with colored backgrounds.
7. **Alert links**: Use `.alert-link` class on links inside alerts for proper color matching.
8. **Don't nest alerts**: Alerts should not be nested inside each other — use separate alerts instead.
