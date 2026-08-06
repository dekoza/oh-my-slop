---
name: prestashop
description: >
  Use when building, reviewing, or debugging a PrestaShop 9 module — its structure,
  hooks, controllers, configuration page, services, persistence, cron, or packaging.
  Triggers on: "PrestaShop", a module main class or `getContent()`, hook registration
  (`registerHook`, `hookDisplay*`/`hookAction*`), `config/services.yml` inside a module,
  a module ZIP that will not install, or a Back Office configuration page that 404s.
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---
# PrestaShop 9 Module Development Reference

Use this skill for **PrestaShop 9 modules**. In PrestaShop terminology, these are **modules**, not "plugins". If the task says plugin, translate it mentally to module and implement it as a module. Read only the reference files relevant to the task.

## Critical Rules
1. **Use real PrestaShop structure** — main module file in the module root, legacy controllers in `controllers/`, modern Symfony controllers in `src/Controller`, config in `config/`, assets/templates in `views/`.
2. **Build only from documented PrestaShop 9 conventions** — when a class, hook contract, service, or extension point is not in these references or the official docs, stop and say so instead of inventing it. Never ship your own `PrestaShopBundle`, `Symfony\Component\...`, or other classes inside host namespaces to patch missing knowledge.
3. **Keep the main module class thin** — constructor, metadata, install/uninstall, hook registration, and configuration entrypoint only. Put API clients, repositories, sync services, and form handlers into `src/` or `classes/`.
4. **Prefer modern BO configuration** — for a real configuration page in PrestaShop 9, use a Symfony form/controller/route. `getContent()` should normally redirect to the module’s modern config route, not render a giant PHP string.
5. **Respect controller boundaries** — front-office module controllers live in `controllers/front/` and must be named `<ModuleClassName><FileName>ModuleFrontController`. Modern admin controllers go in `src/Controller` and require routing + services/autoload.
6. **Do not guess hooks** — verify the hook exists and confirm whether it is display/action/array-return. If the hook contract is unclear, stop guessing and check the docs or core.
7. **Use `Configuration` only for settings** — scalar module settings belong in configuration. Operational data, sync state, mappings, logs, or queues do not.
8. **Model remote identifiers explicitly** — external integrations must store or resolve remote IDs correctly. Email is not a universal surrogate key.
9. **Secure cron/sync entrypoints** — if using a front controller as a cron endpoint, require a token and limit the surface area. Prefer a Symfony console command when CLI access is available.
10. **Composer must not shadow core dependencies** — set `"prepend-autoloader": false`, package `vendor/`, and do not rely on libraries removed from PrestaShop 9 core.
11. **Avoid overrides** — use hooks, services, modern extension points, or controller routes first. Overrides are risky and should be the last resort.
12. **Do not put HTML in PHP** — render through Smarty or Twig. The module class is not a view layer.
13. **Prefix everything you own** — config keys, service IDs, table names, CSS/JS handles, routes, tabs, cron tokens, and PHP namespaces.
14. **Set realistic compatibility** — declare only the versions you actually tested. Do not pretend a module is compatible with versions you never ran.
15. **A module is not done because it installs** — installation success proves almost nothing. You still need to validate routing, hooks, configuration save/load, external I/O, uninstall cleanup, and packaging.

## Reference Map
| File | Domain | Use when you need |
|------|--------|-------------------|
| `module-structure.md` | Layout & naming | Correct folder layout, naming, bootstrap, composer/autoload |
| `main-module-class.md` | Main class | Constructor, metadata, install/uninstall, `getContent()`, tabs |
| `configuration-pages.md` | Settings UI | Modern Symfony config page, forms, providers, handlers, redirect pattern |
| `controllers-routing.md` | Routing & controllers | Front controllers, admin controllers, routes, AJAX, cron endpoints |
| `hooks-widgets.md` | Extension points | Hook registration, display/action hooks, widgets, moduleRoutes |
| `services-dependency-injection.md` | Services | `config/services.yml`, DI, service design, commands |
| `data-persistence.md` | Data model | `Configuration`, DB tables, Doctrine, upgrade scripts, multistore considerations |
| `external-apis-cron.md` | Integrations | API clients, id mapping, sync architecture, retries, destructive actions |
| `translations-templates-assets.md` | UI output | Translation domains, Smarty/Twig, CSS/JS loading, mail/templates |
| `testing-release-checklist.md` | Validation | Lint, static analysis, install/uninstall, release packaging, debug flow |
| `prestashop-9-gotchas.md` | Version pitfalls | Removed dependencies, product page changes, common breakages |

## Task Routing
- **Create a new module skeleton or fix structure/autoload/naming** → `references/module-structure.md`
- **Write the main module file or review install/uninstall metadata** → `references/main-module-class.md`
- **Build a settings page in Back Office** → `references/configuration-pages.md`
- **Create FO/BO endpoints, AJAX, routes, or cron URL** → `references/controllers-routing.md`
- **Use hooks, widgets, or custom routes** → `references/hooks-widgets.md`
- **Move logic into services or define DI/commands** → `references/services-dependency-injection.md`
- **Persist settings, custom entities, mappings, or migrations** → `references/data-persistence.md`
- **Integrate an external API or sync data** → `references/external-apis-cron.md`
- **Handle translations, templates, assets, or UI text** → `references/translations-templates-assets.md`
- **Debug release failures or prepare a distributable ZIP** → `references/testing-release-checklist.md`
- **Target PrestaShop 9 specifically or review upgrade risks** → `references/prestashop-9-gotchas.md`

## When Not To Use This Skill
- **Framework-generic Symfony questions** — PrestaShop 9 embeds Symfony, but form/DI/routing questions outside a module's extension points belong to the Symfony docs.
- **Generic PHP or Composer tooling** — language-level or dependency questions that are not about module autoload/packaging rules.
- **Shop operation, theming, and core upgrades** — store configuration, theme development, and PrestaShop core work are not module development.
- **Containerized dev environments** — load the docker skills for the environment PrestaShop runs in.
