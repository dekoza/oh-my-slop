---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Controllers and Routing

PrestaShop 9 modules can use both legacy-style module controllers and modern Symfony controllers. Confusing the two is one of the fastest ways to ship a module that installs but does not work.

## Front controllers
Front-office module controllers are legacy-style and must follow the documented naming rules:
- file under `controllers/front/`
- class named `<ModuleClassName><FileName>ModuleFrontController`
- extends `ModuleFrontController`

Example:
- file: `controllers/front/cron.php`
- class: `MyModuleCronModuleFrontController`

If any of those do not match, routing will fail.

## When to use front controllers
Use them for:
- front-office pages
- AJAX endpoints tied to FO context
- lightweight token-protected cron URLs when CLI is not available

Do not use them as a lazy substitute for everything.

## Modern admin controllers
Modern BO pages belong in `src/Controller` and require:
- autoloading
- route definition
- usually service registration if using controller-as-service patterns

Benefits include access to:
- service container
- Twig
- debug toolbar
- Doctrine

If you are building a real settings page in PS 9, this is usually the right choice.

## `moduleRoutes`
When the task requires custom front routes mapped to module front controllers, use the `moduleRoutes` hook. This is an actual PrestaShop extension point; do not invent ad hoc route registries.

## Cron endpoints
If the task asks for a cron URL, there are two sane options:
1. token-protected front controller
2. Symfony console command

Use a front controller when the merchant needs a URL for an external scheduler.
Use a console command when the environment gives shell access and the task is operationally internal.

### Front-controller cron rules
- require a token
- compare securely
- reject missing/invalid tokens with explicit non-200 output
- keep response simple (plain text or JSON)
- do not expose stack traces or secrets
- do not assume customer/shop employee context exists unless you set it up deliberately

### Command rules
PrestaShop supports commands from modules, but docs warn that legacy classes like `ObjectModel` can be problematic in command context. Design accordingly.

## AJAX endpoints
For AJAX:
- define whether it is BO or FO
- choose the right controller type
- return stable output format
- validate permissions/token/context
- do not mix full HTML rendering and JSON in the same action unless there is a compelling reason

## Execution-order awareness
Front controllers have a documented lifecycle. If you depend on assets, init logic, POST handling, or template assignment, know where that code belongs. Guessing method order is how modules become flaky.

## Common failure modes
- wrong class name for a front controller
- modern controller created but no route defined
- route defined but controller not autoloadable
- cron endpoint exposed without token
- cron endpoint depends on browser session/admin login
- controller reads `$_GET`/`$_POST` directly everywhere instead of using the framework utilities appropriately
- one endpoint trying to serve config UI, AJAX, and cron at once

## Decision guide
- **Need BO page with forms and services?** → modern admin controller
- **Need FO URL or public tokenized endpoint?** → front controller
- **Need internal scheduled task and shell access exists?** → console command
- **Need custom SEO-friendly FO route?** → `moduleRoutes`

## References
- Front controllers: https://devdocs.prestashop-project.org/9/modules/concepts/controllers/front-controllers/
- Admin controllers: https://devdocs.prestashop-project.org/9/modules/concepts/controllers/admin-controllers/
- Controllers overview: https://devdocs.prestashop-project.org/9/modules/concepts/controllers/
- `moduleRoutes` hook: https://devdocs.prestashop-project.org/9/modules/concepts/hooks/list-of-hooks/moduleroutes/
- Module commands: https://devdocs.prestashop-project.org/9/modules/concepts/commands/
