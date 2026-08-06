---
scope: tabler
target_versions: "Tabler 1.x"
last_verified: 2026-03-19
source_basis: official docs
---

# Page Patterns

Page-level composition patterns from preview.tabler.io. These references show how Tabler-specific classes combine into complete screens rather than isolated components.

## Contents

- [Settings page](#settings-page)
- [Users page](#users-page)
- [Empty states page](#empty-states-page)
- [Activity feed](#activity-feed)
- [Pricing cards](#pricing-cards)
- [Dashboard widgets](#dashboard-widgets)
- [Invoice](#invoice)
- [Search results](#search-results)

## Settings page

Settings pages in Tabler are usually built as form-heavy cards with a title, supporting subtitle, compact field grid, and a transparent footer for actions.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="row justify-content-center">
        <div class="col-lg-8">
          <form class="card">
            <div class="card-body">
              <h3 class="card-title">Profile details</h3>
              <div class="card-subtitle text-secondary">
                Update your public identity and account details.
              </div>
              <div class="row g-3 mt-2">
                <div class="col-md-6">
                  <label class="form-label">Full name</label>
                  <input type="text" class="form-control" value="Paweł Kuna">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Email</label>
                  <input type="email" class="form-control" value="pawel@example.com">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Business name</label>
                  <input type="text" class="form-control" value="Tabler Studio">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Business ID</label>
                  <input type="text" class="form-control" value="PL-548214">
                </div>
                <div class="col-12">
                  <label class="form-label">Location</label>
                  <input type="text" class="form-control" value="Gdańsk, Poland">
                </div>
              </div>
            </div>
            <div class="card-footer bg-transparent mt-auto">
              <div class="btn-list justify-content-end">
                <a href="#" class="btn">Cancel</a>
                <button type="submit" class="btn btn-primary">Save changes</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.card-title` | Primary section heading inside the settings card |
| `.card-subtitle` | Secondary guidance under the heading |
| `.row.g-3` | Dense form spacing used by Tabler settings layouts |
| `.card-footer.bg-transparent` | Neutral footer that avoids a heavy boxed ending |
| `.btn-list.justify-content-end` | Standard right-aligned action cluster |

### When to use

- Account, profile, billing, or workspace configuration screens.
- Any form page that should feel like a contained settings panel instead of a generic form.

### Composition notes

- This pattern is built from the card primitives in `../components/cards.md`.
- The footer treatment is the defining Tabler cue; the transparent footer keeps long forms visually lighter.

## Users page

The users page pattern is a card grid. Each person is presented as a self-contained profile tile with centered identity details and split action buttons.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="row row-cards">
        <div class="col-sm-6 col-lg-4">
          <div class="card">
            <div class="card-body p-4 text-center">
              <span class="avatar avatar-xl mb-3 rounded" style="background-image: url(./static/avatars/000m.jpg)"></span>
              <h3 class="m-0 mb-1"><a href="#" class="text-reset">Paweł Kuna</a></h3>
              <div class="text-secondary">UI Designer</div>
              <div class="mt-3">
                <span class="badge bg-purple-lt">Owner</span>
              </div>
            </div>
            <div class="d-flex">
              <a href="#" class="card-btn">
                <span class="text-secondary me-2">✉</span>
                Email
              </a>
              <a href="#" class="card-btn">
                <span class="text-secondary me-2">☎</span>
                Call
              </a>
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-lg-4">
          <div class="card">
            <div class="card-body p-4 text-center">
              <span class="avatar avatar-xl mb-3 rounded bg-green-lt">JL</span>
              <h3 class="m-0 mb-1"><a href="#" class="text-reset">Jeffie Lewzey</a></h3>
              <div class="text-secondary">Chemical Engineer</div>
              <div class="mt-3">
                <span class="badge bg-green-lt">Admin</span>
              </div>
            </div>
            <div class="d-flex">
              <a href="#" class="card-btn">
                <span class="text-secondary me-2">✉</span>
                Email
              </a>
              <a href="#" class="card-btn">
                <span class="text-secondary me-2">☎</span>
                Call
              </a>
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-lg-4">
          <div class="card">
            <div class="card-body p-4 text-center">
              <span class="avatar avatar-xl mb-3 rounded" style="background-image: url(./static/avatars/002f.jpg)"></span>
              <h3 class="m-0 mb-1"><a href="#" class="text-reset">Mallory Hulme</a></h3>
              <div class="text-secondary">Geologist IV</div>
              <div class="mt-3">
                <span class="badge bg-azure-lt">Manager</span>
              </div>
            </div>
            <div class="d-flex">
              <a href="#" class="card-btn">
                <span class="text-secondary me-2">✉</span>
                Email
              </a>
              <a href="#" class="card-btn">
                <span class="text-secondary me-2">☎</span>
                Call
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.row-cards` | Tabler grid spacing for card collections |
| `.avatar.avatar-xl` | Large identity anchor inside each tile |
| `.badge.bg-*-lt` | Lightweight role labels |
| `.card-btn` | Split, full-width bottom actions used in user cards |
| `.text-reset` | Keeps linked names aligned with surrounding card text |

### When to use

- Member directories, account pickers, team overviews, or customer lists.
- Pages where every record needs equal visual weight and quick actions.

### Composition notes

- The base shell comes from `../components/cards.md`, but the page pattern is the repeated `row-cards` grid plus `card-btn` action split.

## Empty states page

Tabler treats empty states as a page pattern, not just a single component. The pattern works best when multiple empty variants are shown inside a calm, roomy layout.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="row row-cards">
        <div class="col-md-4">
          <div class="card">
            <div class="card-body">
              <div class="empty">
                <div class="empty-img">
                  <img src="./static/illustrations/undraw_printing_invoices_5r4r.svg" alt="" height="128">
                </div>
                <p class="empty-title">No invoices found</p>
                <p class="empty-subtitle text-secondary">
                  Start by creating your first invoice for this workspace.
                </p>
                <div class="empty-action">
                  <a href="#" class="btn btn-primary">Create invoice</a>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card">
            <div class="card-body">
              <div class="empty">
                <div class="empty-icon">
                  <span class="avatar avatar-md bg-blue-lt">🔍</span>
                </div>
                <p class="empty-title">No search results</p>
                <p class="empty-subtitle text-secondary">
                  Broaden the filters to surface more matching records.
                </p>
                <div class="empty-action">
                  <a href="#" class="btn">Clear filters</a>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card">
            <div class="card-body">
              <div class="empty">
                <div class="empty-header">404</div>
                <p class="empty-title">Page not found</p>
                <p class="empty-subtitle text-secondary">
                  The destination no longer exists or the address is wrong.
                </p>
                <div class="empty-action">
                  <a href="#" class="btn btn-primary">Back to dashboard</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.empty` | Base empty-state layout block |
| `.empty-img` | Illustration-led empty variant |
| `.empty-icon` | Icon-led empty variant |
| `.empty-header` | Large code or label for error-style states |
| `.empty-title` | Main empty-state heading |
| `.empty-subtitle` | Supporting copy with muted hierarchy |
| `.empty-action` | Standard CTA wrapper for recovery actions |

### When to use

- Search pages with no matches, first-run screens, missing content states, and error pages.
- Pages that should remain visually intentional even when data is absent.

### Composition notes

- See `../components/empty.md` for the component-level variants.
- Use cards around empties when the page compares multiple empty-state treatments or keeps the empty state inside a larger dashboard layout.

## Activity feed

The activity feed pattern uses a `.divide-y` stack to create clean, timeline-like rows without needing separate cards for every event.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Recent activity</h3>
        </div>
        <div class="divide-y">
          <div class="row align-items-center p-3">
            <div class="col-auto">
              <span class="avatar rounded" style="background-image: url(./static/avatars/000m.jpg)"></span>
            </div>
            <div class="col text-truncate">
              <a href="#" class="text-reset d-block">Jeffie Lewzey commented on your post</a>
              <div class="text-secondary text-truncate">24 hours ago</div>
            </div>
            <div class="col-auto">
              <span class="status-dot status-dot-animated bg-red d-block"></span>
            </div>
          </div>
          <div class="row align-items-center p-3">
            <div class="col-auto">
              <span class="avatar rounded bg-green-lt">SA</span>
            </div>
            <div class="col text-truncate">
              <a href="#" class="text-reset d-block">Sunny Airey uploaded 3 new photos</a>
              <div class="text-secondary text-truncate">2 days ago</div>
            </div>
            <div class="col-auto">
              <span class="status-dot bg-green d-block"></span>
            </div>
          </div>
          <div class="row align-items-center p-3">
            <div class="col-auto">
              <span class="avatar rounded" style="background-image: url(./static/avatars/003m.jpg)"></span>
            </div>
            <div class="col text-truncate">
              <a href="#" class="text-reset d-block">Thatcher Keel created a new profile</a>
              <div class="text-secondary text-truncate">3 days ago</div>
            </div>
            <div class="col-auto">
              <span class="status-dot bg-secondary d-block"></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.divide-y` | The core Tabler feed separator treatment |
| `.avatar` | Compact person marker per activity row |
| `.status-dot` | Read or unread signal at row end |
| `.status-dot-animated` | Extra emphasis for fresh activity |
| `.text-truncate` | Keeps feed rows tidy when messages vary in length |

### When to use

- Notification centers, audit trails, status histories, or team activity timelines.
- Any page where events should read as a stream instead of discrete cards.

### Composition notes

- The card shell comes from `../components/cards.md`, but the page-level behavior comes from the `.divide-y` event stack.

## Pricing cards

Pricing pages in Tabler rely on evenly sized `card-md` plans, display-style pricing, roomy feature lists, and a full-width call to action.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="row row-cards">
        <div class="col-md-6 col-xl-3">
          <div class="card card-md">
            <div class="card-body text-center">
              <div class="text-uppercase text-secondary font-weight-medium">Free</div>
              <div class="display-5 fw-bold my-3">$0</div>
              <ul class="list-unstyled lh-lg">
                <li><strong>3</strong> Users</li>
                <li>Sharing Tools</li>
                <li>Design Tools</li>
                <li>Private Messages</li>
                <li>Twitter API</li>
              </ul>
              <div class="mt-4">
                <a href="#" class="btn w-100">Choose plan</a>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-6 col-xl-3">
          <div class="card card-md">
            <div class="card-body text-center">
              <div class="text-uppercase text-secondary font-weight-medium">Premium</div>
              <div class="display-5 fw-bold my-3">$49</div>
              <ul class="list-unstyled lh-lg">
                <li><strong>10</strong> Users</li>
                <li>Sharing Tools</li>
                <li>Design Tools</li>
                <li>Private Messages</li>
                <li>Twitter API</li>
              </ul>
              <div class="mt-4">
                <a href="#" class="btn btn-primary w-100">Choose plan</a>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-6 col-xl-3">
          <div class="card card-md">
            <div class="card-body text-center">
              <div class="text-uppercase text-secondary font-weight-medium">Enterprise</div>
              <div class="display-5 fw-bold my-3">$99</div>
              <ul class="list-unstyled lh-lg">
                <li><strong>100</strong> Users</li>
                <li>Sharing Tools</li>
                <li>Design Tools</li>
                <li>Private Messages</li>
                <li>Priority Support</li>
              </ul>
              <div class="mt-4">
                <a href="#" class="btn w-100">Choose plan</a>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-6 col-xl-3">
          <div class="card card-md">
            <div class="card-body text-center">
              <div class="text-uppercase text-secondary font-weight-medium">Unlimited</div>
              <div class="display-5 fw-bold my-3">$139</div>
              <ul class="list-unstyled lh-lg">
                <li><strong>Unlimited</strong> Users</li>
                <li>Sharing Tools</li>
                <li>Design Tools</li>
                <li>Private Messages</li>
                <li>Dedicated Success Lead</li>
              </ul>
              <div class="mt-4">
                <a href="#" class="btn w-100">Choose plan</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.card.card-md` | Medium padded pricing shell used by Tabler plan cards |
| `.display-5` | Large price emphasis |
| `.list-unstyled.lh-lg` | Spacious feature list presentation |
| `.btn.w-100` | Full-width plan selection action |
| `.row-cards` | Consistent plan card spacing across breakpoints |

### When to use

- Subscription comparisons, tier selectors, SaaS upgrade screens, or package overviews.
- Pages where the plans should read as parallel options with equal priority.

### Composition notes

- See `../components/cards.md` for `card-md`; the page pattern comes from repeating equally weighted cards in one grid.

## Dashboard widgets

Dashboard widgets are compact statistic cards. The signature Tabler structure is a `.subheader`, a large `.h1` value, and a small color-coded change indicator.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="row row-cards">
        <div class="col-sm-6 col-lg-3">
          <div class="card">
            <div class="card-body">
              <div class="subheader">Total users</div>
              <div class="d-flex align-items-baseline">
                <div class="h1 mb-0 me-2">75,782</div>
                <div class="text-green">+2%</div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-lg-3">
          <div class="card">
            <div class="card-body">
              <div class="subheader">Active subscriptions</div>
              <div class="d-flex align-items-baseline">
                <div class="h1 mb-0 me-2">2,986</div>
                <div class="text-green">+4%</div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-lg-3">
          <div class="card">
            <div class="card-body">
              <div class="subheader">Revenue</div>
              <div class="d-flex align-items-baseline">
                <div class="h1 mb-0 me-2">$4,300</div>
                <div class="text-green">+8%</div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-lg-3">
          <div class="card">
            <div class="card-body">
              <div class="subheader">Growth rate</div>
              <div class="d-flex align-items-baseline">
                <div class="h1 mb-0 me-2">78.4%</div>
                <div class="text-red">-1%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.subheader` | Standard Tabler label above the main number |
| `.h1` | Metric emphasis without a custom widget component |
| `.text-green` | Positive change indicator |
| `.text-red` | Negative change indicator |
| `.row-cards` | Keeps multiple widgets aligned as a dashboard band |

### When to use

- KPI strips, overview dashboards, analytics summaries, or status boards.
- Screens where a user should scan key numbers before diving into charts or tables.

### Composition notes

- The cards themselves are simple; the distinctive piece is the `subheader + h1 + change indicator` stack repeated across a row.

## Invoice

The invoice page pattern uses a large card, a two-column header, a transparent content table, and totals aligned to the right for print-like readability.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="card card-lg">
        <div class="card-body">
          <div class="row">
            <div class="col-6">
              <p class="h3">Company</p>
              <address class="text-secondary">
                Tabler LLC<br>
                123 Market Street<br>
                Gdańsk, Poland<br>
                contact@example.com
              </address>
            </div>
            <div class="col-6 text-end">
              <p class="h3">Client</p>
              <address class="text-secondary">
                Acme Corp<br>
                45 River Road<br>
                Berlin, Germany<br>
                billing@example.com
              </address>
            </div>
            <div class="col-12 my-5">
              <h1>Invoice INV/001/15</h1>
            </div>
          </div>
          <table class="table table-transparent table-responsive">
            <thead>
              <tr>
                <th class="text-center" style="width: 1%"></th>
                <th>Product</th>
                <th class="text-center" style="width: 1%">Qnt</th>
                <th class="text-end" style="width: 1%">Unit</th>
                <th class="text-end" style="width: 1%">Amount</th>
              </tr>
            </thead>
            <tr>
              <td class="text-center">1</td>
              <td>
                <p class="strong mb-1">Logo Creation</p>
                <div class="text-secondary">Logo and business cards design</div>
              </td>
              <td class="text-center">1</td>
              <td class="text-end">$1,800.00</td>
              <td class="text-end">$1,800.00</td>
            </tr>
            <tr>
              <td class="text-center">2</td>
              <td>
                <p class="strong mb-1">Online Store Design</p>
                <div class="text-secondary">Responsive design for modern browsers</div>
              </td>
              <td class="text-center">1</td>
              <td class="text-end">$20,000.00</td>
              <td class="text-end">$20,000.00</td>
            </tr>
            <tr>
              <td colspan="4" class="strong text-end">Subtotal</td>
              <td class="text-end">$21,800.00</td>
            </tr>
            <tr>
              <td colspan="4" class="strong text-end">VAT</td>
              <td class="text-end">$4,360.00</td>
            </tr>
            <tr>
              <td colspan="4" class="font-weight-bold text-uppercase text-end">Total Due</td>
              <td class="font-weight-bold text-end">$26,160.00</td>
            </tr>
          </table>
          <p class="text-secondary text-center mt-5">
            Thank you for doing business with us.
          </p>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.card.card-lg` | Large padded print-style document shell |
| `.table.table-transparent.table-responsive` | Lightweight invoice table treatment from Tabler preview |
| `.text-end` | Repeated right alignment for money columns and totals |
| `.strong` | Tabler text emphasis used in line-item labels and totals |

### When to use

- Printable invoice screens, quotes, receipts, billing summaries, or formal transaction pages.
- Any screen that should feel document-like rather than dashboard-like.

### Composition notes

- This is another card-driven layout from `../components/cards.md`, but the defining page composition is the two-column header plus transparent table and right-weighted totals.

## Search results

The search results pattern turns results into a quiet vertical list. Each item relies on a title link, a muted URL line, and a neutral description block.

### Markup

```html
<div class="page-wrapper">
  <div class="page-body">
    <div class="container-xl">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Search results</h3>
        </div>
        <div class="list-group list-group-flush">
          <div class="list-group-item py-4">
            <a href="#" class="h3 d-block mb-1">Tabler pricing overview</a>
            <div class="text-secondary mb-2">https://example.com/pricing</div>
            <p class="text-reset mb-0">
              Compare subscription levels, feature limits, and upgrade paths.
            </p>
          </div>
          <div class="list-group-item py-4">
            <a href="#" class="h3 d-block mb-1">User management guide</a>
            <div class="text-secondary mb-2">https://example.com/users</div>
            <p class="text-reset mb-0">
              Review member actions, role badges, and account directory layouts.
            </p>
          </div>
          <div class="list-group-item py-4">
            <a href="#" class="h3 d-block mb-1">Invoice templates</a>
            <div class="text-secondary mb-2">https://example.com/invoices</div>
            <p class="text-reset mb-0">
              Browse invoice-ready pages with clear tables and right-aligned totals.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Tabler Class Inventory

| Class | Role in the pattern |
|-------|----------------------|
| `.list-group.list-group-flush` | Core Tabler result list container without extra card padding |
| `.list-group-item` | Individual result row shell |
| `.text-secondary` | Muted URL or metadata line |
| `.text-reset` | Neutral description text that avoids accidental link styling |

### When to use

- Knowledge-base search, internal admin search, site search, or filtered content indexes.
- Results pages that should emphasize scannability over thumbnails or card chrome.

### Composition notes

- This pattern borrows the list-in-card treatment documented in `../components/cards.md`, but the page composition depends on repeated structured rows rather than generic list items.
