# Plugins

Reference for Tabler plugin-style components, Bootstrap behaviors, and external-library integrations that are missing from the existing component files.

> Requires JavaScript initialization.

## Contents

- [Feedback & UI](#feedback--ui)
  - [Offcanvas](#offcanvas)
  - [Spinners](#spinners)
  - [Popovers](#popovers)
  - [Tooltips](#tooltips)
  - [Carousel](#carousel)
  - [Segmented Control](#segmented-control)
  - [Switch Icon](#switch-icon)
- [Form Enhancements](#form-enhancements)
  - [Form Fieldset](#form-fieldset)
  - [Input Mask](#input-mask)
  - [Autosize](#autosize)
  - [Range Slider](#range-slider)
- [Rich Content](#rich-content)
  - [Charts (ApexCharts)](#charts-apexcharts)
  - [Countup](#countup)
  - [Dropzone](#dropzone)
  - [HugeRTE / WYSIWYG](#hugerte--wysiwyg)
- [Embeds & Maps](#embeds--maps)
  - [Inline Player (Plyr)](#inline-player-plyr)
  - [Vector Maps (jsVectorMap)](#vector-maps-jsvectormap)
- [Visual Plugins](#visual-plugins)
  - [Flags](#flags)
  - [Payments](#payments)
- [Status & Progress](#status--progress)
  - [Statuses](#statuses)
  - [Steps](#steps)
  - [Progress](#progress)
  - [Toasts](#toasts)
  - [Pagination](#pagination)
  - [Breadcrumbs](#breadcrumbs)
  - [Ribbons](#ribbons)
  - [Placeholders](#placeholders)
  - [Datagrid](#datagrid)
  - [Timelines](#timelines)
  - [Tracking](#tracking)
  - [Selectgroups](#selectgroups)

## Feedback & UI

### Offcanvas

**Description**: Bootstrap offcanvas panels used by Tabler for side drawers, settings panels, and bottom banners.

**Required CSS/JS**: `tabler.min.css` and Bootstrap JavaScript with the offcanvas plugin.

**HTML markup**:

```html
<button class="btn" type="button" data-bs-toggle="offcanvas" data-bs-target="#offcanvas-settings" aria-controls="offcanvas-settings">
  Open settings
</button>

<div class="offcanvas offcanvas-start offcanvas-narrow" tabindex="-1" id="offcanvas-settings" aria-labelledby="offcanvas-settings-title">
  <div class="offcanvas-header">
    <h2 class="offcanvas-title" id="offcanvas-settings-title">Theme settings</h2>
    <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
  </div>
  <div class="offcanvas-body">Panel content</div>
</div>
```

**Initialization pattern**:

```javascript
const panel = new bootstrap.Offcanvas(document.getElementById('offcanvas-settings'));
panel.show();
```

**Tabler-specific classes**: `.offcanvas-start`, `.offcanvas-end`, `.offcanvas-top`, `.offcanvas-bottom`, `.offcanvas-narrow`, `.h-auto`.

**Data attributes**: `data-bs-toggle="offcanvas"`, `data-bs-target`, `data-bs-dismiss="offcanvas"`, `aria-controls`.

### Spinners

**Description**: Loading indicators used inside buttons, cards, and async placeholders.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required unless toggled by application code.

**HTML markup**:

```html
<span class="spinner-border text-primary" role="status" aria-hidden="true"></span>
<span class="spinner-grow text-secondary" role="status" aria-hidden="true"></span>
<button class="btn btn-primary" type="button" disabled>
  <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
  Saving
</button>
```

**Initialization pattern**:

```javascript
spinnerElement.classList.remove('d-none');
```

**Tabler-specific classes**: `.spinner-border`, `.spinner-grow`, `.spinner-border-sm`, `.text-primary`, `.text-secondary`.

**Data attributes**: None built in.

### Popovers

**Description**: Bootstrap popovers for contextual help, validation hints, and compact overlays.

**Required CSS/JS**: `tabler.min.css`, Bootstrap JavaScript, and Popper.

**HTML markup**:

```html
<button class="btn" type="button" data-bs-toggle="popover" data-bs-placement="top" title="Popover title" data-bs-content="Compact supporting text">
  Show popover
</button>

<span class="form-help" data-bs-toggle="popover" data-bs-placement="top" data-bs-html="true" data-bs-content="<p class='mb-0'>ZIP help text</p>">?</span>
```

**Initialization pattern**:

```javascript
document.querySelectorAll('[data-bs-toggle="popover"]').forEach((element) => new bootstrap.Popover(element));
```

**Tabler-specific classes**: `.form-help`.

**Data attributes**: `data-bs-toggle="popover"`, `data-bs-placement`, `data-bs-content`, `data-bs-html`, `title`.

### Tooltips

**Description**: Bootstrap tooltips used on icons, tracking blocks, steps, flags, and compact action buttons.

**Required CSS/JS**: `tabler.min.css`, Bootstrap JavaScript, and Popper.

**HTML markup**:

```html
<button class="btn btn-icon" type="button" data-bs-toggle="tooltip" data-bs-placement="top" title="Refresh data">
  ↻
</button>

<div class="tracking-block bg-success" data-bs-toggle="tooltip" data-bs-placement="top" title="Operational"></div>
```

**Initialization pattern**:

```javascript
document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => new bootstrap.Tooltip(element));
```

**Tabler-specific classes**: `.btn-icon`, `.tracking-block`.

**Data attributes**: `data-bs-toggle="tooltip"`, `data-bs-placement`, `data-bs-html`, `title`.

### Carousel

**Description**: Bootstrap carousel for rotating hero panels, screenshots, or marketing slides.

**Required CSS/JS**: `tabler.min.css` and Bootstrap JavaScript.

**HTML markup**:

```html
<div id="carousel-demo" class="carousel slide" data-bs-ride="carousel">
  <div class="carousel-inner">
    <div class="carousel-item active"><div class="p-5 bg-primary-lt">Slide one</div></div>
    <div class="carousel-item"><div class="p-5 bg-success-lt">Slide two</div></div>
  </div>
  <button class="carousel-control-prev" type="button" data-bs-target="#carousel-demo" data-bs-slide="prev"></button>
  <button class="carousel-control-next" type="button" data-bs-target="#carousel-demo" data-bs-slide="next"></button>
</div>
```

**Initialization pattern**:

```javascript
const carousel = new bootstrap.Carousel(document.getElementById('carousel-demo'));
```

**Tabler-specific classes**: `.carousel`, `.carousel-fade`, `.bg-primary-lt`, `.bg-success-lt`.

**Data attributes**: `data-bs-ride="carousel"`, `data-bs-slide`, `data-bs-target`.

### Segmented Control

**Description**: Tabler segmented navigation used for compact tab-style switching.

**Required CSS/JS**: `tabler.min.css`; Bootstrap tab JavaScript if segments switch tab panes.

**HTML markup**:

```html
<nav class="nav nav-segmented w-100" role="tablist">
  <button class="nav-link active" type="button" data-bs-toggle="tab" data-bs-target="#segment-card" aria-selected="true">
    Card
  </button>
  <button class="nav-link" type="button" data-bs-toggle="tab" data-bs-target="#segment-paypal" aria-selected="false">
    PayPal
  </button>
</nav>
```

**Initialization pattern**:

```javascript
const tab = new bootstrap.Tab(document.querySelector('[data-bs-target="#segment-card"]'));
tab.show();
```

**Tabler-specific classes**: `.nav-segmented`, `.nav-segmented-vertical`, `.w-100`, `.nav-link-input`.

**Data attributes**: `data-bs-toggle="tab"`, `data-bs-target`, `aria-selected`.

### Switch Icon

**Description**: Tabler icon toggle control for favorites, likes, and quick actions.

**Required CSS/JS**: `tabler.min.css` and Tabler JavaScript (`switch-icon.ts` in core JS bundle).

**HTML markup**:

```html
<button class="switch-icon switch-icon-slide-up" type="button" data-bs-toggle="switch-icon" aria-label="Favorite item">
  <span class="switch-icon-a text-muted">☆</span>
  <span class="switch-icon-b text-yellow">★</span>
</button>
```

**Initialization pattern**:

```javascript
document.querySelectorAll('[data-bs-toggle="switch-icon"]').forEach((element) => element.addEventListener('click', () => element.classList.toggle('active')));
```

**Tabler-specific classes**: `.switch-icon`, `.switch-icon-slide-up`, `.switch-icon-scale`, `.switch-icon-a`, `.switch-icon-b`, `.active`.

**Data attributes**: `data-bs-toggle="switch-icon"`.

## Form Enhancements

### Form Fieldset

**Description**: Tabler fieldset wrapper for visually grouped controls.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required.

**HTML markup**:

```html
<fieldset class="form-fieldset">
  <div class="mb-3">
    <label class="form-label required">Full name</label>
    <input type="text" class="form-control" autocomplete="off">
  </div>
</fieldset>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.form-fieldset`, `.form-label`, `.form-control`.

**Data attributes**: None built in.

### Input Mask

**Description**: IMask-powered formatted inputs for dates, phone numbers, money, or identifiers.

**Required CSS/JS**: `tabler.min.css` and the IMask library.

**HTML markup**:

```html
<input type="text" class="form-control" data-mask="00/00/0000" data-mask-visible="true" placeholder="00/00/0000" autocomplete="off">
<input type="text" class="form-control" data-mask="0000 0000 0000 0000" data-mask-reverse="true" placeholder="Card number" autocomplete="off">
```

**Initialization pattern**:

```javascript
document.querySelectorAll('[data-mask]').forEach((element) => IMask(element, { mask: element.dataset.mask }));
```

**Tabler-specific classes**: `.form-control`.

**Data attributes**: `data-mask`, `data-mask-visible`, `data-mask-reverse`.

### Autosize

**Description**: Auto-growing textareas for notes, comments, and message editors.

**Required CSS/JS**: `tabler.min.css` and the autosize library or Tabler autosize bundle.

**HTML markup**:

```html
<textarea class="form-control" data-bs-toggle="autosize" rows="2" placeholder="Type details"></textarea>
```

**Initialization pattern**:

```javascript
autosize(document.querySelectorAll('[data-bs-toggle="autosize"]'));
```

**Tabler-specific classes**: `.form-control`.

**Data attributes**: `data-bs-toggle="autosize"`.

### Range Slider

**Description**: noUiSlider integration for single-value and multi-handle ranges.

**Required CSS/JS**: `tabler.min.css`, Tabler vendor CSS, and `noUiSlider`.

**HTML markup**:

```html
<div id="range-price" data-slider='{"start":[20,80],"connect":[false,true,false],"step":5,"range":{"min":0,"max":100}}'></div>
```

**Initialization pattern**:

```javascript
noUiSlider.create(document.getElementById('range-price'), JSON.parse(document.getElementById('range-price').dataset.slider));
```

**Tabler-specific classes**: Range styling comes from Tabler vendor CSS.

**Data attributes**: `data-slider`.

## Rich Content

### Charts (ApexCharts)

**Description**: Tabler chart wrappers built on ApexCharts for dashboards, sparklines, bars, lines, and heatmaps.

**Required CSS/JS**: `tabler.min.css`, Tabler vendor CSS, and ApexCharts.

**HTML markup**:

```html
<div id="chart-sales"></div>
```

**Initialization pattern**:

```javascript
new ApexCharts(document.getElementById('chart-sales'), {
  chart: { type: 'line', fontFamily: 'inherit', height: 240 },
  series: [{ name: 'Sales', data: [12, 18, 14, 24] }],
  colors: ['var(--tblr-primary)']
}).render();
```

**Tabler-specific classes**: Chart wrappers are plain containers; use Tabler CSS variables such as `var(--tblr-primary)` and `fontFamily: 'inherit'`.

**Data attributes**: None required by default.

### Countup

**Description**: Animated numbers triggered when a value enters the viewport.

**Required CSS/JS**: `tabler.min.css` and CountUp.js via Tabler JS bundle.

**HTML markup**:

```html
<h2 data-countup>30000</h2>
<span data-countup='{"duration":4,"enableScrollSpy":true}'>1250</span>
```

**Initialization pattern**:

```javascript
document.querySelectorAll('[data-countup]').forEach((element) => new countUp.CountUp(element, parseInt(element.textContent, 10), JSON.parse(element.dataset.countup || '{}')).start());
```

**Tabler-specific classes**: Usually used with metric typography classes like `.h1`, `.h2`, `.display-*`.

**Data attributes**: `data-countup` with optional JSON config.

### Dropzone

**Description**: Drag-and-drop file uploader based on Dropzone.js.

**Required CSS/JS**: `tabler.min.css`, Tabler vendor CSS, and Dropzone.js.

**HTML markup**:

```html
<form id="dropzone-documents" class="dropzone" action="/upload">
  <div class="fallback">
    <input name="file" type="file" multiple>
  </div>
</form>
```

**Initialization pattern**:

```javascript
new Dropzone('#dropzone-documents');
```

**Tabler-specific classes**: `.dropzone`.

**Data attributes**: None required by default.

### HugeRTE / WYSIWYG

**Description**: Rich text editor integration used for email and document editing.

**Required CSS/JS**: `tabler.min.css` and HugeRTE.

**HTML markup**:

```html
<textarea id="hugerte-editor">Hello, <b>Tabler</b>!</textarea>
```

**Initialization pattern**:

```javascript
hugeRTE.init({ selector: '#hugerte-editor', height: 300, menubar: false, statusbar: false });
```

**Tabler-specific classes**: No required wrapper class; pair with Tabler form spacing utilities.

**Data attributes**: None required by default.

## Embeds & Maps

### Inline Player (Plyr)

**Description**: Embedded media player wrapper for YouTube and Vimeo content.

**Required CSS/JS**: `tabler.min.css`, Plyr CSS, and Plyr JavaScript.

**HTML markup**:

```html
<div id="player-intro" data-plyr-provider="youtube" data-plyr-embed-id="bTqVqk7FSmY"></div>
```

**Initialization pattern**:

```javascript
new Plyr('#player-intro');
```

**Tabler-specific classes**: None required by default.

**Data attributes**: `data-plyr-provider`, `data-plyr-embed-id`.

### Vector Maps (jsVectorMap)

**Description**: Interactive world and country maps rendered by jsVectorMap.

**Required CSS/JS**: `tabler.min.css`, Tabler vendor CSS, and jsVectorMap.

**HTML markup**:

```html
<div id="map-world" style="height: 20rem"></div>
```

**Initialization pattern**:

```javascript
new jsVectorMap({ selector: '#map-world', map: 'world', backgroundColor: 'transparent' });
```

**Tabler-specific classes**: Prefer Tabler CSS variables for region colors and neutral surfaces.

**Data attributes**: None required by default.

## Visual Plugins

### Flags

**Description**: Country flag sprites delivered as a separate Tabler stylesheet.

**Required CSS/JS**: `tabler-flags.min.css`; no JavaScript required.

**HTML markup**:

```html
<span class="flag flag-country-pl"></span>
<span class="flag flag-sm flag-country-us"></span>
<span class="flag flag-xl flag-country-jp"></span>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.flag`, `.flag-country-pl`, `.flag-country-us`, `.flag-xs`, `.flag-sm`, `.flag-md`, `.flag-lg`, `.flag-xl`.

**Data attributes**: Often paired with `data-bs-toggle="tooltip"` for country names.

### Payments

**Description**: Payment provider logos delivered as a separate Tabler stylesheet.

**Required CSS/JS**: `tabler-payments.min.css`; no JavaScript required.

**HTML markup**:

```html
<span class="payment payment-provider-visa"></span>
<span class="payment payment-sm payment-provider-mastercard"></span>
<span class="payment payment-provider-paypal-dark"></span>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.payment`, `.payment-provider-visa`, `.payment-provider-mastercard`, `.payment-provider-paypal-dark`, `.payment-xs`, `.payment-sm`, `.payment-lg`.

**Data attributes**: None built in.

## Status & Progress

### Statuses

**Description**: Compact status badges and dots for health, availability, and state labels.

**Required CSS/JS**: `tabler.min.css`; optional Bootstrap tooltip JavaScript if labels are hidden behind tooltips.

**HTML markup**:

```html
<span class="status status-green">
  <span class="status-dot status-dot-animated"></span>
  Live
</span>
<span class="status-dot bg-danger d-block"></span>
<span class="status-indicator status-blue"><span class="status-indicator-circle"></span><span class="status-indicator-circle"></span><span class="status-indicator-circle"></span></span>
```

**Initialization pattern**:

```javascript
// CSS only unless combined with tooltip behavior.
```

**Tabler-specific classes**: `.status`, `.status-green`, `.status-dot`, `.status-dot-animated`, `.status-indicator`, `.status-indicator-animated`.

**Data attributes**: Optional `data-bs-toggle="tooltip"`.

### Steps

**Description**: Horizontal or compact progress steps, optionally enhanced with Bootstrap tooltips.

**Required CSS/JS**: `tabler.min.css`; optional Bootstrap tooltip JavaScript.

**HTML markup**:

```html
<ul class="steps steps-green steps-counter my-4">
  <li class="step-item">Cart</li>
  <li class="step-item active" data-bs-toggle="tooltip" title="Payment step">Payment</li>
  <li class="step-item">Review</li>
</ul>
```

**Initialization pattern**:

```javascript
document.querySelectorAll('.step-item[data-bs-toggle="tooltip"]').forEach((element) => new bootstrap.Tooltip(element));
```

**Tabler-specific classes**: `.steps`, `.steps-green`, `.steps-counter`, `.step-item`, `.active`.

**Data attributes**: Optional `data-bs-toggle="tooltip"`, `title`.

### Progress

**Description**: Linear progress bars, separated stacks, and indeterminate loading states.

**Required CSS/JS**: `tabler.min.css`; no library required unless updated dynamically by application code.

**HTML markup**:

```html
<div class="progress progress-separated">
  <div class="progress-bar bg-primary" style="width: 44%" role="progressbar" aria-valuenow="44" aria-valuemin="0" aria-valuemax="100"></div>
  <div class="progress-bar bg-info" style="width: 19%" role="progressbar" aria-valuenow="19" aria-valuemin="0" aria-valuemax="100"></div>
</div>
```

**Initialization pattern**:

```javascript
progressElement.querySelector('.progress-bar').style.width = '60%';
```

**Tabler-specific classes**: `.progress`, `.progress-separated`, `.progress-xs`, `.progress-bar`, `.progress-bar-indeterminate`, `.progress-bar-animated`.

**Data attributes**: None built in.

### Toasts

**Description**: Bootstrap toast notifications for transient feedback and cookie prompts.

**Required CSS/JS**: `tabler.min.css` and Bootstrap JavaScript.

**HTML markup**:

```html
<button class="btn btn-primary" type="button" data-bs-toggle="toast" data-bs-target="#toast-simple">
  Show toast
</button>

<div class="toast-container position-fixed bottom-0 end-0 p-3">
  <div class="toast" id="toast-simple" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
    <div class="toast-header">
      <strong class="me-auto">System</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body">Saved successfully.</div>
  </div>
</div>
```

**Initialization pattern**:

```javascript
new bootstrap.Toast(document.getElementById('toast-simple')).show();
```

**Tabler-specific classes**: `.toast-container`, `.toast`, `.toast-header`, `.toast-body`.

**Data attributes**: `data-bs-toggle="toast"`, `data-bs-target`, `data-bs-dismiss="toast"`, `data-bs-autohide`.

### Pagination

**Description**: Pagination controls for list and table navigation.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required unless wiring AJAX or list pagination.

**HTML markup**:

```html
<ul class="pagination">
  <li class="page-item disabled"><span class="page-link">Previous</span></li>
  <li class="page-item active"><a class="page-link" href="#">1</a></li>
  <li class="page-item"><a class="page-link" href="#">2</a></li>
  <li class="page-item"><a class="page-link" href="#">Next</a></li>
</ul>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.pagination`, `.page-item`, `.page-link`, `.page-prev`, `.page-next`, `.page-text`.

**Data attributes**: None built in.

### Breadcrumbs

**Description**: Hierarchical navigation trails, including step-style and muted variants.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required.

**HTML markup**:

```html
<nav aria-label="Breadcrumb">
  <ol class="breadcrumb breadcrumb-muted">
    <li class="breadcrumb-item"><a href="#">Home</a></li>
    <li class="breadcrumb-item"><a href="#">Checkout</a></li>
    <li class="breadcrumb-item active" aria-current="page">Review</li>
  </ol>
</nav>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.breadcrumb`, `.breadcrumb-item`, `.breadcrumb-muted`.

**Data attributes**: None built in.

### Ribbons

**Description**: Card and panel corner markers for featured, sale, or bookmarked states.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required.

**HTML markup**:

```html
<div class="card position-relative">
  <div class="ribbon ribbon-top ribbon-bookmark bg-yellow">NEW</div>
  <div class="card-body">Featured content</div>
</div>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.ribbon`, `.ribbon-top`, `.ribbon-start`, `.ribbon-bottom`, `.ribbon-bookmark`, `.bg-yellow`.

**Data attributes**: None built in.

### Placeholders

**Description**: Skeleton-loading placeholders used before async content is ready.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required unless your app swaps real content in later.

**HTML markup**:

```html
<div class="card placeholder-glow">
  <div class="card-body">
    <div class="placeholder col-9 mb-3"></div>
    <div class="placeholder placeholder-xs col-10"></div>
    <div class="placeholder placeholder-xs col-12"></div>
  </div>
</div>
```

**Initialization pattern**:

```javascript
placeholderCard.classList.remove('placeholder-glow');
```

**Tabler-specific classes**: `.placeholder`, `.placeholder-glow`, `.placeholder-xs`.

**Data attributes**: None built in.

### Datagrid

**Description**: Responsive label-value grid for metadata panels and detail views.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required.

**HTML markup**:

```html
<div class="datagrid">
  <div class="datagrid-item">
    <div class="datagrid-title">Registrar</div>
    <div class="datagrid-content">Third Party</div>
  </div>
  <div class="datagrid-item">
    <div class="datagrid-title">Port number</div>
    <div class="datagrid-content">3306</div>
  </div>
</div>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.datagrid`, `.datagrid-item`, `.datagrid-title`, `.datagrid-content`.

**Data attributes**: None built in.

### Timelines

**Description**: Vertical event streams with icons, cards, and timestamped activity.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required.

**HTML markup**:

```html
<ul class="timeline">
  <li class="timeline-event">
    <div class="timeline-event-icon bg-primary-lt">✓</div>
    <div class="card timeline-event-card">
      <div class="card-body">
        <div class="text-secondary float-end">10 min ago</div>
        <h4>Deployment finished</h4>
        <p class="text-secondary mb-0">Service is online.</p>
      </div>
    </div>
  </li>
</ul>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.timeline`, `.timeline-simple`, `.timeline-event`, `.timeline-event-icon`, `.timeline-event-card`.

**Data attributes**: None built in.

### Tracking

**Description**: Uptime-style status blocks that often rely on tooltips for detail.

**Required CSS/JS**: `tabler.min.css`; Bootstrap tooltip JavaScript when block tooltips are enabled.

**HTML markup**:

```html
<div class="tracking tracking-squares">
  <div class="tracking-block bg-success" data-bs-toggle="tooltip" data-bs-placement="top" title="Operational"></div>
  <div class="tracking-block bg-warning" data-bs-toggle="tooltip" data-bs-placement="top" title="High load"></div>
  <div class="tracking-block bg-danger" data-bs-toggle="tooltip" data-bs-placement="top" title="Downtime"></div>
</div>
```

**Initialization pattern**:

```javascript
document.querySelectorAll('.tracking-block[data-bs-toggle="tooltip"]').forEach((element) => new bootstrap.Tooltip(element));
```

**Tabler-specific classes**: `.tracking`, `.tracking-squares`, `.tracking-block`.

**Data attributes**: `data-bs-toggle="tooltip"`, `data-bs-placement`, `title`.

### Selectgroups

**Description**: Tabler visual checkbox and radio groups, including boxed and payment variants.

**Required CSS/JS**: `tabler.min.css`; no JavaScript required.

**HTML markup**:

```html
<div class="form-selectgroup form-selectgroup-boxes d-flex flex-column">
  <label class="form-selectgroup-item flex-fill">
    <input type="radio" name="payment-method" value="visa" class="form-selectgroup-input" checked>
    <span class="form-selectgroup-label d-flex align-items-center p-3">
      <span class="form-selectgroup-check"></span>
      <span class="ms-3"><span class="payment payment-provider-visa payment-xs me-2"></span>Visa</span>
    </span>
  </label>
</div>
```

**Initialization pattern**:

```javascript
// No JavaScript initialization required.
```

**Tabler-specific classes**: `.form-selectgroup`, `.form-selectgroup-boxes`, `.form-selectgroup-item`, `.form-selectgroup-input`, `.form-selectgroup-label`, `.form-selectgroup-check`.

**Data attributes**: None built in.

## Gotchas

1. **JavaScript required**: Bootstrap, ApexCharts, Dropzone, Plyr, jsVectorMap, IMask, autosize, HugeRTE, and CountUp all require JavaScript initialization.
2. **Prefer data-attribute triggers first**: Bootstrap components such as offcanvas, popovers, tooltips, carousel, tabs, and toasts already support `data-bs-*` APIs.
3. **Vendor CSS is separate**: `tabler-flags.min.css`, `tabler-payments.min.css`, and Tabler vendor bundles are not included automatically by plain component markup.
4. **Use Tabler CSS variables in charts/maps**: Tabler examples rely on inherited fonts and theme variables instead of hardcoded colors.
5. **Tooltips and popovers need Popper**: Bootstrap JS alone is insufficient for those overlays.
6. **Dropzone, Plyr, and HugeRTE need explicit containers**: missing IDs or selectors break initialization immediately.
