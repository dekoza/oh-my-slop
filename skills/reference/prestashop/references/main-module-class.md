---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Main Module Class

The main module class is the entrypoint, not the whole application.

## What belongs in the main class
Keep it limited to:
- constructor metadata
- install / uninstall / reset
- hook registration
- tab registration (if needed)
- configuration entrypoint (`getContent()`)
- tiny adapter methods that delegate to services

Do **not** put API clients, synchronization logic, SQL builders, HTML rendering, or giant validation routines here.

## Constructor essentials
The constructor should define the module metadata before `parent::__construct()`, then translated display strings after it.

Typical fields:
- `$this->name`
- `$this->tab`
- `$this->version`
- `$this->author`
- `$this->need_instance`
- `$this->ps_versions_compliancy`
- `$this->bootstrap`
- optional `$this->dependencies`

Important discipline:
- `$this->name` must match folder and root filename.
- `ps_versions_compliancy` must reflect tested versions, not wishful thinking.
- `bootstrap = true` is the sane default for module configuration rendering.

## Install pattern
A useful install method usually does three kinds of work:
1. call `parent::install()`
2. register hooks / tabs
3. create config defaults and database schema

Pattern:

```php
public function install(): bool
{
    return parent::install()
        && $this->registerHook('displayBackOfficeHeader')
        && $this->installDatabase()
        && $this->installConfiguration();
}
```

Do not bury errors. If installation has meaningful failure points, log or surface them.

## Uninstall pattern
Uninstall should remove what **your module** created:
- config values
- custom tables
- tabs
- scheduled artifacts owned by the module

Do not delete unrelated shop data. Do not pretend uninstall is harmless when it is destructive.

## `getContent()` in PrestaShop 9
For serious BO configuration in PrestaShop 9, `getContent()` should normally redirect to a **modern Symfony configuration route**, not build a form inline.

Bad:
- hundreds of lines of HTML concatenation in PHP
- inline SQL handling and external API calls in `getContent()`
- mixed validation/render/save logic in one method

Better pattern:
- define a Symfony admin controller + form
- expose a route for the configuration page
- `getContent()` redirects to that route

## Tabs
If the module adds BO navigation links, define `$tabs` in the module class. Keep route names, class names, and permissions explicit. Do not create tabs accidentally during random method calls.

## Dependencies
Use `$this->dependencies` when the module truly depends on other modules. This is for real runtime dependencies, not vague “nice to have” integrations.

## Warnings and confirmation messages
`$this->confirmUninstall` should describe actual consequences. Do not use fake comfort text if uninstall deletes mappings, logs, API identifiers, or custom entities.

## A safe main-class template
```php
class MyModule extends Module
{
    public function __construct()
    {
        $this->name = 'mymodule';
        $this->tab = 'administration';
        $this->version = '1.0.0';
        $this->author = 'Vendor';
        $this->need_instance = 0;
        $this->ps_versions_compliancy = [
            'min' => '9.0.0',
            'max' => '9.0.0',
        ];
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->trans('My module', [], 'Modules.Mymodule.Admin');
        $this->description = $this->trans('Short accurate description.', [], 'Modules.Mymodule.Admin');
    }

    public function install(): bool
    {
        return parent::install()
            && $this->installConfiguration();
    }

    public function uninstall(): bool
    {
        return $this->uninstallConfiguration()
            && parent::uninstall();
    }

    public function getContent(): void
    {
        Tools::redirectAdmin($this->context->link->getAdminLink('AdminMyModuleConfiguration'));
    }
}
```

Adjust route/controller wiring to your actual implementation.

## Smells that mean the module class is wrong
- more than ~200 lines of mixed concerns
- direct cURL / Guzzle / HTTP code in `getContent()` or hooks
- raw HTML strings assembled in PHP
- DB schema creation mixed with business sync logic
- exception swallowing during install/uninstall

## References
- Module class reference: https://devdocs.prestashop-project.org/9/modules/concepts/module-class/
- Creating a first module: https://devdocs.prestashop-project.org/9/modules/creation/tutorial/
- Adding module links / tabs: https://devdocs.prestashop-project.org/9/modules/concepts/controllers/admin-controllers/tabs/
