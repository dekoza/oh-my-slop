---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Form Elements

Complete reference for Tabler form components.

## Contents

- [Base Input](#base-input)
- [Input Types](#input-types)
  - [Text Input](#text-input)
  - [Email Input](#email-input)
  - [Password Input](#password-input)
  - [Number Input](#number-input)
  - [URL Input](#url-input)
  - [Date Input](#date-input)
  - [Time Input](#time-input)
  - [Color Input](#color-input)
- [Textarea](#textarea)
- [Select](#select)
  - [Basic Select](#basic-select)
  - [Multiple Select](#multiple-select)
- [Input Sizes](#input-sizes)
  - [Small](#small)
  - [Default](#default)
  - [Large](#large)
- [Input States](#input-states)
  - [Disabled](#disabled)
  - [Readonly](#readonly)
  - [Plaintext (Read-only Styled)](#plaintext-read-only-styled)
- [Checkboxes](#checkboxes)
  - [Basic Checkbox](#basic-checkbox)
  - [Multiple Checkboxes](#multiple-checkboxes)
  - [Inline Checkboxes](#inline-checkboxes)
  - [Checkbox with Description](#checkbox-with-description)
- [Radio Buttons](#radio-buttons)
  - [Basic Radio](#basic-radio)
  - [Inline Radios](#inline-radios)
- [Toggle Switches](#toggle-switches)
  - [Basic Switch](#basic-switch)
  - [Switch with Description](#switch-with-description)
- [Range Input](#range-input)
- [File Input](#file-input)
  - [Basic File Input](#basic-file-input)
  - [Multiple Files](#multiple-files)
- [Input Groups](#input-groups)
  - [With Text Addon](#with-text-addon)
  - [With Button](#with-button)
  - [With Dropdown](#with-dropdown)
  - [Prepend and Append](#prepend-and-append)
- [Input with Icon](#input-with-icon)
  - [Icon Prepended](#icon-prepended)
  - [Icon Appended](#icon-appended)
- [Form Validation](#form-validation)
  - [Valid State](#valid-state)
  - [Invalid State](#invalid-state)
  - [Validation on Select](#validation-on-select)
- [Help Text](#help-text)
- [Required Fields](#required-fields)
- [Form Layout](#form-layout)
  - [Vertical Form (Default)](#vertical-form-default)
  - [Horizontal Form](#horizontal-form)
  - [Inline Form](#inline-form)
- [Class Reference](#class-reference)
- [Common Patterns](#common-patterns)
  - [Login Form](#login-form)
  - [Search with Filters](#search-with-filters)
- [Gotchas](#gotchas)

## Base Input

```html
<div class="mb-3">
  <label class="form-label">Name</label>
  <input type="text" class="form-control" placeholder="Enter name">
</div>
```

## Input Types

### Text Input
```html
<input type="text" class="form-control" placeholder="Text input">
```

### Email Input
```html
<input type="email" class="form-control" placeholder="Email address">
```

### Password Input
```html
<input type="password" class="form-control" placeholder="Password">
```

### Number Input
```html
<input type="number" class="form-control" placeholder="Number">
```

### URL Input
```html
<input type="url" class="form-control" placeholder="https://example.com">
```

### Date Input
```html
<input type="date" class="form-control">
```

### Time Input
```html
<input type="time" class="form-control">
```

### Color Input
```html
<input type="color" class="form-control form-control-color" value="#206bc4">
```

## Textarea

```html
<div class="mb-3">
  <label class="form-label">Message</label>
  <textarea class="form-control" rows="3" placeholder="Enter message"></textarea>
</div>
```

## Select

### Basic Select
```html
<div class="mb-3">
  <label class="form-label">Country</label>
  <select class="form-select">
    <option>Select country...</option>
    <option value="1">United States</option>
    <option value="2">United Kingdom</option>
    <option value="3">Germany</option>
  </select>
</div>
```

### Multiple Select
```html
<select class="form-select" multiple>
  <option>Option 1</option>
  <option>Option 2</option>
  <option>Option 3</option>
</select>
```

## Input Sizes

### Small
```html
<input type="text" class="form-control form-control-sm" placeholder="Small input">
```

### Default
```html
<input type="text" class="form-control" placeholder="Default input">
```

### Large
```html
<input type="text" class="form-control form-control-lg" placeholder="Large input">
```

## Input States

### Disabled
```html
<input type="text" class="form-control" placeholder="Disabled input" disabled>
```

### Readonly
```html
<input type="text" class="form-control" value="Read-only value" readonly>
```

### Plaintext (Read-only Styled)
```html
<input type="text" class="form-control-plaintext" value="Read-only plaintext" readonly>
```

## Checkboxes

### Basic Checkbox
```html
<div class="form-check">
  <input type="checkbox" class="form-check-input" id="checkbox1">
  <label class="form-check-label" for="checkbox1">
    Remember me
  </label>
</div>
```

### Multiple Checkboxes
```html
<div class="mb-3">
  <label class="form-label">Preferences</label>
  <div class="form-check">
    <input type="checkbox" class="form-check-input" id="check1">
    <label class="form-check-label" for="check1">Option 1</label>
  </div>
  <div class="form-check">
    <input type="checkbox" class="form-check-input" id="check2">
    <label class="form-check-label" for="check2">Option 2</label>
  </div>
  <div class="form-check">
    <input type="checkbox" class="form-check-input" id="check3">
    <label class="form-check-label" for="check3">Option 3</label>
  </div>
</div>
```

### Inline Checkboxes
```html
<div>
  <div class="form-check form-check-inline">
    <input type="checkbox" class="form-check-input" id="inline1">
    <label class="form-check-label" for="inline1">Option 1</label>
  </div>
  <div class="form-check form-check-inline">
    <input type="checkbox" class="form-check-input" id="inline2">
    <label class="form-check-label" for="inline2">Option 2</label>
  </div>
</div>
```

### Checkbox with Description
```html
<div class="form-check">
  <input type="checkbox" class="form-check-input" id="check-desc">
  <label class="form-check-label" for="check-desc">
    <strong>Enable notifications</strong>
    <span class="form-check-description">
      Receive email notifications about new updates
    </span>
  </label>
</div>
```

## Radio Buttons

### Basic Radio
```html
<div class="form-check">
  <input type="radio" class="form-check-input" name="radio1" id="radio1" checked>
  <label class="form-check-label" for="radio1">Option 1</label>
</div>
<div class="form-check">
  <input type="radio" class="form-check-input" name="radio1" id="radio2">
  <label class="form-check-label" for="radio2">Option 2</label>
</div>
```

### Inline Radios
```html
<div class="form-check form-check-inline">
  <input type="radio" class="form-check-input" name="radio2" id="inline-radio1">
  <label class="form-check-label" for="inline-radio1">Yes</label>
</div>
<div class="form-check form-check-inline">
  <input type="radio" class="form-check-input" name="radio2" id="inline-radio2">
  <label class="form-check-label" for="inline-radio2">No</label>
</div>
```

## Toggle Switches

### Basic Switch
```html
<div class="form-check form-switch">
  <input type="checkbox" class="form-check-input" id="switch1">
  <label class="form-check-label" for="switch1">Enable feature</label>
</div>
```

### Switch with Description
```html
<div class="form-check form-switch">
  <input type="checkbox" class="form-check-input" id="switch-desc">
  <label class="form-check-label" for="switch-desc">
    <strong>Dark mode</strong>
    <span class="form-check-description">
      Switch to dark theme
    </span>
  </label>
</div>
```

## Range Input

```html
<div class="mb-3">
  <label class="form-label">Volume</label>
  <input type="range" class="form-range" min="0" max="100" value="50">
</div>
```

## File Input

### Basic File Input
```html
<div class="mb-3">
  <label class="form-label">Upload file</label>
  <input type="file" class="form-control">
</div>
```

### Multiple Files
```html
<input type="file" class="form-control" multiple>
```

## Input Groups

### With Text Addon
```html
<div class="input-group mb-3">
  <span class="input-group-text">@</span>
  <input type="text" class="form-control" placeholder="Username">
</div>
```

### With Button
```html
<div class="input-group mb-3">
  <input type="text" class="form-control" placeholder="Search">
  <button class="btn btn-primary" type="button">
    <svg class="icon"><use xlink:href="#tabler-search"/></svg>
  </button>
</div>
```

### With Dropdown
```html
<div class="input-group mb-3">
  <button class="btn btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">
    Action
  </button>
  <div class="dropdown-menu">
    <a class="dropdown-item" href="#">Option 1</a>
    <a class="dropdown-item" href="#">Option 2</a>
  </div>
  <input type="text" class="form-control">
</div>
```

### Prepend and Append
```html
<div class="input-group mb-3">
  <span class="input-group-text">$</span>
  <input type="text" class="form-control" placeholder="0.00">
  <span class="input-group-text">.00</span>
</div>
```

## Input with Icon

### Icon Prepended
```html
<div class="mb-3">
  <label class="form-label">Email</label>
  <div class="input-icon">
    <span class="input-icon-addon">
      <svg class="icon"><use xlink:href="#tabler-mail"/></svg>
    </span>
    <input type="email" class="form-control" placeholder="Email">
  </div>
</div>
```

### Icon Appended
```html
<div class="input-icon">
  <input type="text" class="form-control" placeholder="Search">
  <span class="input-icon-addon">
    <svg class="icon"><use xlink:href="#tabler-search"/></svg>
  </span>
</div>
```

## Form Validation

### Valid State
```html
<div class="mb-3">
  <label class="form-label">Email</label>
  <input type="email" class="form-control is-valid" value="user@example.com">
  <div class="valid-feedback">Looks good!</div>
</div>
```

### Invalid State
```html
<div class="mb-3">
  <label class="form-label">Email</label>
  <input type="email" class="form-control is-invalid" value="invalid-email">
  <div class="invalid-feedback">Please provide a valid email.</div>
</div>
```

### Validation on Select
```html
<select class="form-select is-invalid">
  <option>Select...</option>
</select>
<div class="invalid-feedback">Please select an option.</div>
```

## Help Text

```html
<div class="mb-3">
  <label class="form-label">Password</label>
  <input type="password" class="form-control">
  <small class="form-hint">
    Must be at least 8 characters long and contain numbers.
  </small>
</div>
```

## Required Fields

```html
<div class="mb-3">
  <label class="form-label required">Email</label>
  <input type="email" class="form-control" required>
</div>
```

## Form Layout

### Vertical Form (Default)
```html
<form>
  <div class="mb-3">
    <label class="form-label">Name</label>
    <input type="text" class="form-control">
  </div>
  <div class="mb-3">
    <label class="form-label">Email</label>
    <input type="email" class="form-control">
  </div>
  <button type="submit" class="btn btn-primary">Submit</button>
</form>
```

### Horizontal Form
```html
<form>
  <div class="row mb-3">
    <label class="col-sm-3 col-form-label">Name</label>
    <div class="col-sm-9">
      <input type="text" class="form-control">
    </div>
  </div>
  <div class="row mb-3">
    <label class="col-sm-3 col-form-label">Email</label>
    <div class="col-sm-9">
      <input type="email" class="form-control">
    </div>
  </div>
  <div class="row">
    <div class="col-sm-9 offset-sm-3">
      <button type="submit" class="btn btn-primary">Submit</button>
    </div>
  </div>
</form>
```

### Inline Form
```html
<form class="row row-cols-auto g-3 align-items-center">
  <div class="col">
    <input type="text" class="form-control" placeholder="Name">
  </div>
  <div class="col">
    <input type="email" class="form-control" placeholder="Email">
  </div>
  <div class="col">
    <button type="submit" class="btn btn-primary">Submit</button>
  </div>
</form>
```

## Class Reference

| Class | Purpose |
|-------|---------|
| `.form-label` | Label for form inputs |
| `.form-control` | Base input/textarea/select class |
| `.form-select` | Select dropdown |
| `.form-check` | Checkbox/radio container |
| `.form-check-input` | Checkbox/radio input |
| `.form-check-label` | Checkbox/radio label |
| `.form-switch` | Toggle switch |
| `.form-range` | Range slider |
| `.form-control-sm` | Small input |
| `.form-control-lg` | Large input |
| `.input-group` | Input group container |
| `.input-group-text` | Text addon in input group |
| `.input-icon` | Input with icon container |
| `.input-icon-addon` | Icon in input |
| `.is-valid` | Valid state |
| `.is-invalid` | Invalid state |
| `.valid-feedback` | Valid feedback message |
| `.invalid-feedback` | Invalid feedback message |
| `.form-hint` | Help text |
| `.required` | Required field indicator |

## Common Patterns

### Login Form
```html
<form>
  <div class="mb-3">
    <label class="form-label">Email address</label>
    <input type="email" class="form-control" placeholder="your@email.com">
  </div>
  <div class="mb-2">
    <label class="form-label">
      Password
      <a href="#" class="float-end small">Forgot password?</a>
    </label>
    <input type="password" class="form-control" placeholder="Your password">
  </div>
  <div class="mb-3">
    <label class="form-check">
      <input type="checkbox" class="form-check-input">
      <span class="form-check-label">Remember me</span>
    </label>
  </div>
  <button type="submit" class="btn btn-primary w-100">Sign in</button>
</form>
```

### Search with Filters
```html
<div class="row g-3 mb-3">
  <div class="col">
    <div class="input-icon">
      <span class="input-icon-addon">
        <svg class="icon"><use xlink:href="#tabler-search"/></svg>
      </span>
      <input type="text" class="form-control" placeholder="Search...">
    </div>
  </div>
  <div class="col-auto">
    <select class="form-select">
      <option>All categories</option>
      <option>Category 1</option>
      <option>Category 2</option>
    </select>
  </div>
  <div class="col-auto">
    <button class="btn btn-primary">Search</button>
  </div>
</div>
```

## Gotchas

1. **Always use .mb-3**: Add `.mb-3` to form field containers for consistent spacing.
2. **Label association**: Use `for` attribute on label matching input's `id` for accessibility.
3. **Required indicator**: Add `.required` class to `.form-label`, not to the input.
4. **Validation feedback**: `.invalid-feedback` only shows when parent has `.is-invalid`.
5. **Input group sizing**: Apply size class to `.input-group`, not individual elements.
6. **Checkbox label**: Wrap checkbox input and label in `.form-check`, not vice versa.
7. **Switch is a checkbox**: `.form-switch` requires `type="checkbox"`, not a separate element.
8. **Help text position**: `.form-hint` goes after the input, not before.
9. **File input styling**: File inputs use `.form-control`, not custom classes.
