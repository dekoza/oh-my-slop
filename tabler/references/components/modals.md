# Modals

Complete reference for Tabler modal component (based on Bootstrap modals).

## Contents

- [Base Structure](#base-structure)
- [Trigger Button](#trigger-button)
- [Modal Sizes](#modal-sizes)
  - [Small Modal](#small-modal)
  - [Default Modal](#default-modal)
  - [Large Modal](#large-modal)
  - [Extra Large Modal](#extra-large-modal)
  - [Full Width Modal](#full-width-modal)
- [Modal Positions](#modal-positions)
  - [Centered Modal](#centered-modal)
  - [Scrollable Modal](#scrollable-modal)
- [Modal with Status](#modal-with-status)
- [Simple Modal (No Header)](#simple-modal-no-header)
- [Modal with Form](#modal-with-form)
- [Alert/Prompt Modal](#alertprompt-modal)
- [Modal with Blur Background](#modal-with-blur-background)
- [Class Reference](#class-reference)
- [JavaScript Initialization](#javascript-initialization)
  - [Via Data Attributes](#via-data-attributes)
  - [Via JavaScript](#via-javascript)
  - [Events](#events)
- [Common Patterns](#common-patterns)
  - [Confirmation Dialog](#confirmation-dialog)
  - [Success Message](#success-message)
- [Gotchas](#gotchas)

## Base Structure

```html
<div class="modal" id="modal-example" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Modal title</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        Modal content goes here.
      </div>
      <div class="modal-footer">
        <button type="button" class="btn" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn btn-primary">Save changes</button>
      </div>
    </div>
  </div>
</div>
```

## Trigger Button

```html
<button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#modal-example">
  Open Modal
</button>
```

## Modal Sizes

### Small Modal
```html
<div class="modal-dialog modal-sm">
  <div class="modal-content">
    ...
  </div>
</div>
```

### Default Modal
```html
<div class="modal-dialog">
  <div class="modal-content">
    ...
  </div>
</div>
```

### Large Modal
```html
<div class="modal-dialog modal-lg">
  <div class="modal-content">
    ...
  </div>
</div>
```

### Extra Large Modal
```html
<div class="modal-dialog modal-xl">
  <div class="modal-content">
    ...
  </div>
</div>
```

### Full Width Modal
```html
<div class="modal-dialog modal-fullscreen">
  <div class="modal-content">
    ...
  </div>
</div>
```

## Modal Positions

### Centered Modal
```html
<div class="modal-dialog modal-dialog-centered">
  <div class="modal-content">
    ...
  </div>
</div>
```

### Scrollable Modal
```html
<div class="modal-dialog modal-dialog-scrollable">
  <div class="modal-content">
    ...
  </div>
</div>
```

## Modal with Status

```html
<div class="modal-content">
  <div class="modal-status bg-success"></div>
  <div class="modal-header">
    <h5 class="modal-title">Success</h5>
    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
  </div>
  <div class="modal-body">
    Your changes have been saved successfully.
  </div>
  <div class="modal-footer">
    <button type="button" class="btn btn-success" data-bs-dismiss="modal">OK</button>
  </div>
</div>
```

Status colors: `.bg-primary`, `.bg-success`, `.bg-danger`, `.bg-warning`, `.bg-info`, or any theme color like `.bg-blue`.

## Simple Modal (No Header)

```html
<div class="modal-content">
  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
  <div class="modal-body text-center py-4">
    <svg class="icon mb-2 text-danger icon-lg">
      <use xlink:href="#tabler-alert-circle"/>
    </svg>
    <h3>Are you sure?</h3>
    <div class="text-secondary">Do you really want to delete this item? This action cannot be undone.</div>
  </div>
  <div class="modal-footer">
    <div class="w-100">
      <div class="row">
        <div class="col">
          <button class="btn w-100" data-bs-dismiss="modal">Cancel</button>
        </div>
        <div class="col">
          <button class="btn btn-danger w-100">Delete</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

## Modal with Form

```html
<div class="modal-content">
  <div class="modal-header">
    <h5 class="modal-title">Add User</h5>
    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
  </div>
  <div class="modal-body">
    <form>
      <div class="mb-3">
        <label class="form-label">Name</label>
        <input type="text" class="form-control" placeholder="Enter name">
      </div>
      <div class="mb-3">
        <label class="form-label">Email</label>
        <input type="email" class="form-control" placeholder="Enter email">
      </div>
      <div class="mb-3">
        <label class="form-label">Role</label>
        <select class="form-select">
          <option>Admin</option>
          <option>User</option>
        </select>
      </div>
    </form>
  </div>
  <div class="modal-footer">
    <button type="button" class="btn" data-bs-dismiss="modal">Cancel</button>
    <button type="submit" class="btn btn-primary">Add User</button>
  </div>
</div>
```

## Alert/Prompt Modal

```html
<div class="modal modal-blur fade" id="modal-danger">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content">
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      <div class="modal-status bg-danger"></div>
      <div class="modal-body text-center py-4">
        <svg class="icon mb-2 text-danger icon-lg">
          <use xlink:href="#tabler-alert-triangle"/>
        </svg>
        <h3>Are you sure?</h3>
        <div class="text-secondary">This action is permanent and cannot be undone.</div>
      </div>
      <div class="modal-footer">
        <div class="w-100">
          <div class="row">
            <div class="col">
              <button class="btn w-100" data-bs-dismiss="modal">Cancel</button>
            </div>
            <div class="col">
              <button class="btn btn-danger w-100" data-bs-dismiss="modal">Yes, delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

## Modal with Blur Background

```html
<div class="modal modal-blur fade" id="modal-example">
  ...
</div>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.modal` | Base modal container (required) |
| `.modal-dialog` | Centers modal in viewport |
| `.modal-content` | Modal content wrapper |
| `.modal-header` | Header section with title and close button |
| `.modal-body` | Main content area |
| `.modal-footer` | Footer section with action buttons |
| `.modal-title` | Modal title (use h5) |
| `.modal-sm` | Small modal |
| `.modal-lg` | Large modal |
| `.modal-xl` | Extra large modal |
| `.modal-fullscreen` | Full screen modal |
| `.modal-dialog-centered` | Vertically center modal |
| `.modal-dialog-scrollable` | Scrollable modal body |
| `.modal-status` | Status color bar at top |
| `.modal-blur` | Blur backdrop effect |
| `.btn-close` | Close button |

## JavaScript Initialization

### Via Data Attributes
```html
<!-- Trigger button -->
<button data-bs-toggle="modal" data-bs-target="#myModal">Open</button>

<!-- Modal -->
<div class="modal fade" id="myModal">...</div>
```

### Via JavaScript
```javascript
// Initialize
const myModal = new bootstrap.Modal(document.getElementById('myModal'));

// Show
myModal.show();

// Hide
myModal.hide();

// Toggle
myModal.toggle();
```

### Events
```javascript
const modalElement = document.getElementById('myModal');

modalElement.addEventListener('show.bs.modal', function (event) {
  // Do something when modal is about to show
});

modalElement.addEventListener('shown.bs.modal', function (event) {
  // Do something when modal is fully shown
});

modalElement.addEventListener('hide.bs.modal', function (event) {
  // Do something when modal is about to hide
});

modalElement.addEventListener('hidden.bs.modal', function (event) {
  // Do something when modal is fully hidden
});
```

## Common Patterns

### Confirmation Dialog
```html
<div class="modal modal-blur fade" id="modal-confirm-delete">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-status bg-danger"></div>
      <div class="modal-body text-center py-4">
        <svg class="icon mb-2 text-danger icon-lg">
          <use xlink:href="#tabler-trash"/>
        </svg>
        <h3>Delete item?</h3>
        <div class="text-secondary">This cannot be undone.</div>
      </div>
      <div class="modal-footer">
        <div class="w-100">
          <div class="row">
            <div class="col"><button class="btn w-100" data-bs-dismiss="modal">Cancel</button></div>
            <div class="col"><button class="btn btn-danger w-100">Delete</button></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Success Message
```html
<div class="modal modal-blur fade" id="modal-success">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-status bg-success"></div>
      <div class="modal-body text-center py-4">
        <svg class="icon mb-2 text-success icon-lg">
          <use xlink:href="#tabler-check"/>
        </svg>
        <h3>Success!</h3>
        <div class="text-secondary">Your changes have been saved.</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-success w-100" data-bs-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>
```

## Gotchas

1. **Requires Bootstrap JS**: Modals require Bootstrap's JavaScript to function.
2. **Unique IDs**: Each modal needs a unique `id` attribute for `data-bs-target` to work.
3. **Backdrop click**: By default, clicking outside modal closes it. Prevent with `data-bs-backdrop="static"`.
4. **Keyboard escape**: By default, pressing Escape closes modal. Prevent with `data-bs-keyboard="false"`.
5. **Multiple modals**: Stacking modals is not officially supported. Use one at a time.
6. **Focus management**: Modal automatically focuses first focusable element on open.
7. **Status position**: `.modal-status` must be first child of `.modal-content`.
8. **Dynamic content**: When loading modals via AJAX or dynamic DOM insertion, reinitialize the Bootstrap modal instance after the new content is inserted.
