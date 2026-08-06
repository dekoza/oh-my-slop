---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Translations, Templates, and Assets

## Translation system
Use PrestaShop’s translation APIs properly. In PrestaShop 9, translation domains matter.

For module PHP code, use translated strings with a proper module domain, for example:
- `Modules.Mymodule.Admin`
- `Modules.Mymodule.Shop`

The module name portion follows strict conventions. Underscores and other unsupported characters are a known source of translation trouble. Design module names accordingly.

## Practical rule
Write source strings in English, wrap them consistently, and keep domains stable.

Bad:
- raw UI strings scattered everywhere
- inconsistent domains for the same screen
- translated admin labels in one place and hard-coded front-office strings in another

## Templates
Use:
- Smarty for legacy/front hook rendering where appropriate
- Twig for modern Symfony admin pages

Do not build HTML directly in PHP unless there is no reasonable alternative.

## Template placement
Place templates under `views/templates/...`:
- `admin/`
- `front/`
- `hook/`

If template placement is random, the module is wrong.

## Assets
Place static assets under `views/css`, `views/js`, `views/img`, etc.
Load assets only where needed. Spraying BO or FO assets globally is lazy and hurts performance.

## UI consistency
PrestaShop recommends module interfaces match the Back Office UI kit. Do not ship BO pages that look like a random unrelated admin panel unless the task explicitly demands a custom app-like interface.

## Copy/paste UX details
For admin pages with generated values like webhook URLs, cron URLs, or public keys:
- render them as readonly UI values
- provide copy affordance if the UI stack supports it
- do not require the merchant to inspect HTML or source code

## Common mistakes
- missing translations on validation messages
- using module names/domains that break translation discovery
- mixing Twig and Smarty without reason
- placing templates outside `views/`
- inline JS/CSS blobs in PHP-generated HTML

## References
- Module translation overview: https://devdocs.prestashop-project.org/9/modules/creation/module-translation/
- New translation system: https://devdocs.prestashop-project.org/9/modules/creation/module-translation/new-system/
- Translation tips: https://devdocs.prestashop-project.org/9/development/internationalization/translation/translation-tips/
- Module file structure / views folder: https://devdocs.prestashop-project.org/9/modules/creation/module-file-structure/
- Good practices for module UI: https://devdocs.prestashop-project.org/9/modules/creation/good-practices/
