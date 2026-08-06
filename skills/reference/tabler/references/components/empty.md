---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Empty States

Complete reference for Tabler empty state component.

## Base Structure

```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-inbox"/>
    </svg>
  </div>
  <p class="empty-title">No results found</p>
  <p class="empty-subtitle text-secondary">
    Try adjusting your search or filter to find what you're looking for.
  </p>
</div>
```

## Empty with Image

```html
<div class="empty">
  <div class="empty-img">
    <img src="empty-state.svg" alt="" height="128">
  </div>
  <p class="empty-title">No results found</p>
  <p class="empty-subtitle text-secondary">
    We couldn't find what you're looking for.
  </p>
</div>
```

## Empty with Header Text

```html
<div class="empty">
  <div class="empty-header">404</div>
  <p class="empty-title">Page not found</p>
  <p class="empty-subtitle text-secondary">
    The page you are looking for doesn't exist or has been moved.
  </p>
</div>
```

## Empty with Action

```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-file-plus"/>
    </svg>
  </div>
  <p class="empty-title">No documents yet</p>
  <p class="empty-subtitle text-secondary">
    Get started by creating your first document.
  </p>
  <div class="empty-action">
    <a href="#" class="btn btn-primary">
      <svg class="icon"><use xlink:href="#tabler-plus"/></svg>
      Create document
    </a>
  </div>
</div>
```

## Empty with Multiple Actions

```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-users"/>
    </svg>
  </div>
  <p class="empty-title">No team members</p>
  <p class="empty-subtitle text-secondary">
    Invite your team to start collaborating.
  </p>
  <div class="empty-action">
    <div class="btn-list">
      <a href="#" class="btn btn-primary">Invite team</a>
      <a href="#" class="btn">Learn more</a>
    </div>
  </div>
</div>
```

## Empty in Card

```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Recent Activity</h3>
  </div>
  <div class="card-body">
    <div class="empty">
      <div class="empty-icon">
        <svg class="icon">
          <use xlink:href="#tabler-activity"/>
        </svg>
      </div>
      <p class="empty-title">No activity yet</p>
      <p class="empty-subtitle text-secondary">
        Your recent activity will appear here.
      </p>
    </div>
  </div>
</div>
```

## Full Page Empty State

```html
<div class="container-xl d-flex flex-column justify-content-center">
  <div class="empty">
    <div class="empty-img">
      <img src="empty-search.svg" alt="" height="128">
    </div>
    <p class="empty-title">No results found</p>
    <p class="empty-subtitle text-secondary">
      We couldn't find any results matching your search criteria.
    </p>
    <div class="empty-action">
      <a href="#" class="btn btn-primary">
        Clear filters
      </a>
    </div>
  </div>
</div>
```

## 404 Page

```html
<div class="container-xl d-flex flex-column justify-content-center">
  <div class="empty">
    <div class="empty-header">404</div>
    <p class="empty-title">Oops… You just found an error page</p>
    <p class="empty-subtitle text-secondary">
      We are sorry but the page you are looking for was not found
    </p>
    <div class="empty-action">
      <a href="/" class="btn btn-primary">
        <svg class="icon"><use xlink:href="#tabler-arrow-left"/></svg>
        Take me home
      </a>
    </div>
  </div>
</div>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.empty` | Base empty state container |
| `.empty-icon` | Icon container (centered) |
| `.empty-img` | Image container (centered) |
| `.empty-header` | Large text header (for error codes, etc.) |
| `.empty-title` | Primary heading |
| `.empty-subtitle` | Secondary description text |
| `.empty-action` | Action buttons container |

## Common Patterns

### Empty Search Results
```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-search"/>
    </svg>
  </div>
  <p class="empty-title">No search results</p>
  <p class="empty-subtitle text-secondary">
    We couldn't find anything for "<strong>{{ search_query }}</strong>". Try a different search term.
  </p>
  <div class="empty-action">
    <a href="#" class="btn">Clear search</a>
  </div>
</div>
```

### Empty Inbox
```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-inbox"/>
    </svg>
  </div>
  <p class="empty-title">Inbox empty</p>
  <p class="empty-subtitle text-secondary">
    You're all caught up! No new messages.
  </p>
</div>
```

### Empty Cart
```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-shopping-cart"/>
    </svg>
  </div>
  <p class="empty-title">Your cart is empty</p>
  <p class="empty-subtitle text-secondary">
    Add items to your cart to continue shopping.
  </p>
  <div class="empty-action">
    <a href="/products" class="btn btn-primary">Browse products</a>
  </div>
</div>
```

### Empty List with Create Action
```html
<div class="empty">
  <div class="empty-icon">
    <svg class="icon">
      <use xlink:href="#tabler-folder"/>
    </svg>
  </div>
  <p class="empty-title">No projects yet</p>
  <p class="empty-subtitle text-secondary">
    Get started by creating your first project.
  </p>
  <div class="empty-action">
    <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#modal-new-project">
      <svg class="icon"><use xlink:href="#tabler-plus"/></svg>
      New project
    </button>
  </div>
</div>
```

### Access Denied
```html
<div class="container-xl d-flex flex-column justify-content-center">
  <div class="empty">
    <div class="empty-header">403</div>
    <p class="empty-title">Access denied</p>
    <p class="empty-subtitle text-secondary">
      You don't have permission to access this page.
    </p>
    <div class="empty-action">
      <a href="/" class="btn btn-primary">Go to homepage</a>
    </div>
  </div>
</div>
```

### Server Error
```html
<div class="container-xl d-flex flex-column justify-content-center">
  <div class="empty">
    <div class="empty-header">500</div>
    <p class="empty-title">Oops… Something went wrong</p>
    <p class="empty-subtitle text-secondary">
      We're experiencing technical difficulties. Please try again later.
    </p>
    <div class="empty-action">
      <button class="btn btn-primary" onclick="window.location.reload()">
        <svg class="icon"><use xlink:href="#tabler-refresh"/></svg>
        Reload page
      </button>
    </div>
  </div>
</div>
```

## Gotchas

1. **Centered by default**: Empty states are horizontally centered — use additional flex utilities for vertical centering.
2. **Icon size**: Icons in `.empty-icon` are automatically sized large. Don't add size classes.
3. **Subtitle color**: Always use `.text-secondary` on `.empty-subtitle` for proper hierarchy.
4. **Image height**: Set explicit height on images in `.empty-img` (recommended: 128px).
5. **Full page centering**: Wrap in `.container-xl` with `.d-flex .flex-column .justify-content-center` for full-page empty states.
6. **Action spacing**: `.empty-action` adds automatic top margin — don't add manual spacing.
7. **Multiple actions**: Use `.btn-list` inside `.empty-action` for multiple buttons.
8. **Error codes**: Use `.empty-header` for large error codes (404, 403, 500), not `.empty-title`.
9. **Don't nest**: Empty states should not be nested inside each other.
