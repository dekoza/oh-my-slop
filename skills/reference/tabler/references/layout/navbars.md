---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Navbars

Complete reference for Tabler navbar component.

## Contents

- [Base Structure](#base-structure)
- [Navbar Brand](#navbar-brand)
  - [With Logo Image](#with-logo-image)
  - [With Text](#with-text)
  - [With Logo and Text](#with-logo-and-text)
- [Navbar Color Schemes](#navbar-color-schemes)
  - [Light Navbar (Default)](#light-navbar-default)
  - [Dark Navbar](#dark-navbar)
- [Navbar with Dropdown](#navbar-with-dropdown)
- [Navbar with Icons](#navbar-with-icons)
- [Navbar with User Menu](#navbar-with-user-menu)
- [Navbar with Notifications](#navbar-with-notifications)
- [Navbar with Search](#navbar-with-search)
- [Active Nav Item](#active-nav-item)
- [Disabled Nav Item](#disabled-nav-item)
- [Navbar Alignment](#navbar-alignment)
  - [Left-Aligned (Default)](#left-aligned-default)
  - [Right-Aligned](#right-aligned)
  - [Centered](#centered)
  - [Split (Left and Right)](#split-left-and-right)
- [Responsive Navbar](#responsive-navbar)
  - [Collapse on Medium and Below](#collapse-on-medium-and-below)
  - [Collapse on Large and Below](#collapse-on-large-and-below)
  - [Always Collapsed](#always-collapsed)
- [Mobile Toggler](#mobile-toggler)
- [Navbar Container](#navbar-container)
  - [Full Width](#full-width)
  - [Fixed Width](#fixed-width)
- [Class Reference](#class-reference)
- [Common Patterns](#common-patterns)
  - [Full Header with Logo, Nav, and User Menu](#full-header-with-logo-nav-and-user-menu)
  - [Simple Top Bar](#simple-top-bar)
- [Gotchas](#gotchas)

## Base Structure

```html
<nav class="navbar navbar-expand-md navbar-light">
  <div class="container-xl">
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu">
      <span class="navbar-toggler-icon"></span>
    </button>
    <a href="/" class="navbar-brand">
      <img src="logo.svg" alt="Logo" height="36">
    </a>
    <div class="collapse navbar-collapse" id="navbar-menu">
      <ul class="navbar-nav">
        <li class="nav-item">
          <a class="nav-link" href="/">Home</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" href="/about">About</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" href="/contact">Contact</a>
        </li>
      </ul>
    </div>
  </div>
</nav>
```

## Navbar Brand

### With Logo Image
```html
<a href="/" class="navbar-brand">
  <img src="logo.svg" alt="App Name" height="36">
</a>
```

### With Text
```html
<a href="/" class="navbar-brand">
  <span class="navbar-brand-name">App Name</span>
</a>
```

### With Logo and Text
```html
<a href="/" class="navbar-brand">
  <img src="logo.svg" alt="" height="36" class="navbar-brand-image">
  <span class="navbar-brand-name">App Name</span>
</a>
```

## Navbar Color Schemes

### Light Navbar (Default)
```html
<nav class="navbar navbar-light">
  ...
</nav>
```

### Dark Navbar
```html
<nav class="navbar navbar-dark">
  ...
</nav>
```

## Navbar with Dropdown

```html
<ul class="navbar-nav">
  <li class="nav-item dropdown">
    <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown">
      Products
    </a>
    <div class="dropdown-menu">
      <a class="dropdown-item" href="#">Product 1</a>
      <a class="dropdown-item" href="#">Product 2</a>
      <div class="dropdown-divider"></div>
      <a class="dropdown-item" href="#">All Products</a>
    </div>
  </li>
</ul>
```

## Navbar with Icons

```html
<ul class="navbar-nav">
  <li class="nav-item">
    <a class="nav-link" href="/">
      <svg class="icon"><use xlink:href="#tabler-home"/></svg>
      Home
    </a>
  </li>
  <li class="nav-item">
    <a class="nav-link" href="/settings">
      <svg class="icon"><use xlink:href="#tabler-settings"/></svg>
      Settings
    </a>
  </li>
</ul>
```

## Navbar with User Menu

```html
<div class="navbar-nav ms-auto">
  <div class="nav-item dropdown">
    <a href="#" class="nav-link d-flex align-items-center p-0" data-bs-toggle="dropdown">
      <span class="avatar avatar-sm" style="background-image: url(avatar.jpg)"></span>
      <div class="d-none d-xl-block ps-2">
        <div>John Doe</div>
        <div class="mt-1 small text-secondary">Admin</div>
      </div>
    </a>
    <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
      <a class="dropdown-item" href="/profile">
        <svg class="icon dropdown-item-icon"><use xlink:href="#tabler-user"/></svg>
        Profile
      </a>
      <a class="dropdown-item" href="/settings">
        <svg class="icon dropdown-item-icon"><use xlink:href="#tabler-settings"/></svg>
        Settings
      </a>
      <div class="dropdown-divider"></div>
      <a class="dropdown-item" href="/logout">
        <svg class="icon dropdown-item-icon"><use xlink:href="#tabler-logout"/></svg>
        Logout
      </a>
    </div>
  </div>
</div>
```

## Navbar with Notifications

```html
<div class="navbar-nav">
  <div class="nav-item dropdown">
    <a href="#" class="nav-link px-0" data-bs-toggle="dropdown">
      <svg class="icon"><use xlink:href="#tabler-bell"/></svg>
      <span class="badge bg-red badge-notification badge-blink"></span>
    </a>
    <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
      <a class="dropdown-item" href="#">
        <div class="d-flex">
          <span class="avatar me-2" style="background-image: url(avatar1.jpg)"></span>
          <div>
            <strong>Jane</strong> mentioned you
            <div class="small text-secondary">2 hours ago</div>
          </div>
        </div>
      </a>
      <a class="dropdown-item" href="#">
        <div class="d-flex">
          <span class="avatar me-2" style="background-image: url(avatar2.jpg)"></span>
          <div>
            <strong>Bob</strong> commented on your post
            <div class="small text-secondary">5 hours ago</div>
          </div>
        </div>
      </a>
      <div class="dropdown-divider"></div>
      <a class="dropdown-item text-center" href="/notifications">
        View all notifications
      </a>
    </div>
  </div>
</div>
```

## Navbar with Search

```html
<div class="navbar-nav flex-row">
  <div class="nav-item">
    <a href="#" class="nav-link px-0" data-bs-toggle="modal" data-bs-target="#modal-search">
      <svg class="icon"><use xlink:href="#tabler-search"/></svg>
    </a>
  </div>
</div>
```

## Active Nav Item

```html
<li class="nav-item">
  <a class="nav-link active" href="/">Home</a>
</li>
```

## Disabled Nav Item

```html
<li class="nav-item">
  <a class="nav-link disabled">Disabled</a>
</li>
```

## Navbar Alignment

### Left-Aligned (Default)
```html
<ul class="navbar-nav">
  ...
</ul>
```

### Right-Aligned
```html
<ul class="navbar-nav ms-auto">
  ...
</ul>
```

### Centered
```html
<ul class="navbar-nav mx-auto">
  ...
</ul>
```

### Split (Left and Right)
```html
<div class="collapse navbar-collapse" id="navbar-menu">
  <ul class="navbar-nav">
    <li class="nav-item"><a class="nav-link" href="/">Home</a></li>
    <li class="nav-item"><a class="nav-link" href="/about">About</a></li>
  </ul>
  <ul class="navbar-nav ms-auto">
    <li class="nav-item"><a class="nav-link" href="/login">Login</a></li>
  </ul>
</div>
```

## Responsive Navbar

### Collapse on Medium and Below
```html
<nav class="navbar navbar-expand-md">
  ...
</nav>
```

### Collapse on Large and Below
```html
<nav class="navbar navbar-expand-lg">
  ...
</nav>
```

### Always Collapsed
```html
<nav class="navbar">
  ...
</nav>
```

## Mobile Toggler

```html
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu">
  <span class="navbar-toggler-icon"></span>
</button>
```

## Navbar Container

### Full Width
```html
<nav class="navbar">
  <div class="container-fluid">
    ...
  </div>
</nav>
```

### Fixed Width
```html
<nav class="navbar">
  <div class="container-xl">
    ...
  </div>
</nav>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.navbar` | Base navbar class |
| `.navbar-expand-{breakpoint}` | Responsive collapse (sm, md, lg, xl, xxl) |
| `.navbar-light` | Light color scheme |
| `.navbar-dark` | Dark color scheme |
| `.navbar-brand` | Brand/logo link |
| `.navbar-brand-image` | Logo image in brand |
| `.navbar-brand-name` | Text name in brand |
| `.navbar-toggler` | Mobile menu toggle button |
| `.navbar-toggler-icon` | Toggle button icon |
| `.navbar-collapse` | Collapsible navbar content |
| `.navbar-nav` | Navbar navigation list |
| `.nav-item` | Navigation item |
| `.nav-link` | Navigation link |
| `.active` | Active navigation item |
| `.disabled` | Disabled navigation item |
| `.dropdown` | Dropdown container in navbar |

## Common Patterns

### Full Header with Logo, Nav, and User Menu
```html
<nav class="navbar navbar-expand-md navbar-light">
  <div class="container-xl">
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#navbar-menu">
      <span class="navbar-toggler-icon"></span>
    </button>
    <a href="/" class="navbar-brand">
      <img src="logo.svg" alt="Logo" height="36">
    </a>
    <div class="navbar-nav flex-row order-md-last">
      <div class="nav-item dropdown">
        <a href="#" class="nav-link d-flex align-items-center p-0" data-bs-toggle="dropdown">
          <span class="avatar avatar-sm" style="background-image: url(avatar.jpg)"></span>
        </a>
        <div class="dropdown-menu dropdown-menu-end">
          <a class="dropdown-item" href="/profile">Profile</a>
          <a class="dropdown-item" href="/settings">Settings</a>
          <div class="dropdown-divider"></div>
          <a class="dropdown-item" href="/logout">Logout</a>
        </div>
      </div>
    </div>
    <div class="collapse navbar-collapse" id="navbar-menu">
      <ul class="navbar-nav">
        <li class="nav-item active">
          <a class="nav-link" href="/">Dashboard</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" href="/projects">Projects</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" href="/team">Team</a>
        </li>
      </ul>
    </div>
  </div>
</nav>
```

### Simple Top Bar
```html
<nav class="navbar navbar-light">
  <div class="container-xl">
    <a href="/" class="navbar-brand">
      <img src="logo.svg" alt="Logo" height="36">
    </a>
    <div class="navbar-nav flex-row">
      <a href="/login" class="btn btn-primary">Sign in</a>
    </div>
  </div>
</nav>
```

## Gotchas

1. **Container required**: Always wrap navbar content in `.container-xl` or `.container-fluid`.
2. **Collapse target**: `data-bs-target` on toggler must match `id` on `.navbar-collapse`.
3. **Expand class**: Use `.navbar-expand-{breakpoint}` to control when navbar collapses.
4. **Nav alignment**: Use `.ms-auto` (margin-start auto) to push nav items right.
5. **Mobile order**: Use `.order-md-last` on user menu to position it correctly on mobile.
6. **Active state**: Add `.active` to `.nav-link`, not to `.nav-item`.
7. **Dropdown arrow**: Use `.dropdown-menu-arrow` and `.dropdown-menu-end` for user menu dropdowns.
8. **Icon-only links**: Remove horizontal padding with `.px-0` on icon-only nav links.
9. **Requires Bootstrap JS**: Navbar collapse/dropdown features require Bootstrap JavaScript.
