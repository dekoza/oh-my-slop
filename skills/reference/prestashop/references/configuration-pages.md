---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Configuration Pages

## Default position
In PrestaShop 9, a real Back Office settings page should usually be a **modern Symfony configuration page**.

This means:
- form type
- data provider
- form handler
- controller
- route
- services wiring
- `getContent()` redirecting to the route

If the task is trivial and legacy compatibility is a hard requirement, helper forms are still possible. But for a 9.0.0-targeted module, default to the modern stack.

## Recommended architecture
Break the page into these pieces:
- `src/Form/Type/...Type.php` — form fields and validation constraints
- `src/Form/DataProvider/...DataProvider.php` — reads config state into a plain array
- `src/Form/Handler/...Handler.php` — persists validated data
- `src/Controller/...Controller.php` — renders and submits the form
- `config/routes.yml` or the module’s route config — maps URL to controller
- `config/services.yml` — registers the above services

Do not collapse all of this into one controller method unless the page is truly tiny.

## Why this matters
The common AI failure is to treat PrestaShop BO configuration like generic PHP admin code:
- inline HTML
- `$_POST` reads everywhere
- hard-coded CSRF fantasies
- direct writes in the controller
- no separation between load/save/render

That is low-quality code. Use Symfony forms.

## Field design rules
- config key names must be prefixed with your module name
- validate types explicitly
- if a field depends on external API connectivity, fail loudly and keep invalid values from being silently accepted
- if one field’s options depend on another field (for example, API key -> remote dropdown options), model that dependency explicitly in the controller/provider flow

## External-option fields
A common case is:
1. merchant enters API key
2. module saves key
3. module fetches remote resources (groups, lists, warehouses, etc.)
4. second field becomes selectable

Implement this cleanly:
- save/validate the API key first
- on successful save, fetch remote options through a dedicated service
- handle remote failures with a clear admin error
- never keep a previously selected remote ID if it no longer exists

## `getContent()` redirect pattern
In a modern module, `getContent()` is often just the bridge from the legacy module manager to the modern page.

That is the right place for a redirect. It is the wrong place to implement the page itself.

## Routes and controller wiring
Modern admin controllers require proper routing and service/autoload setup. If the route is missing, the module will look “installed” but the configuration page will be dead. That is not a minor bug; it means the module is unfinished.

## UX rules
- do not hide write failures
- display success only after persistence actually succeeds
- keep labels/help text translated
- expose generated values like cron URL as readonly/copyable fields, not editable text inputs
- if a secret is stored, never echo it back unmasked unless there is a deliberate and justified reason

## Anti-patterns
- building BO form markup with string concatenation in the module class
- storing array-shaped settings as unvalidated serialized blobs in `Configuration`
- fetching remote dropdown options during every page render without caching or timeout handling
- silently dropping a selected value when options refresh
- placing controller code in `controllers/admin/` when the page is supposed to be modern Symfony

## Minimal flow for a dependent settings form
Example: API key + remote group dropdown + cron URL
- form data provider returns saved API key and selected group id
- controller renders form
- on submit, handler saves API key
- handler or post-save controller step refreshes remote groups via service
- selected group is validated against actual remote options
- controller computes cron URL from module route/front controller + security token and displays it readonly

## References
- Modern configuration page guide: https://devdocs.prestashop-project.org/9/modules/creation/adding-configuration-page-modern/
- Admin module controllers: https://devdocs.prestashop-project.org/9/modules/concepts/controllers/admin-controllers/
- Forms in PrestaShop architecture: https://devdocs.prestashop-project.org/9/development/architecture/migration-guide/forms/
