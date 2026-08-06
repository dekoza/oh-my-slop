---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Module Structure, Naming, and Autoload

## Non-negotiable structure
A real PrestaShop 9 module follows the documented module layout. The minimum useful skeleton looks like this:

```text
mymodule/
├── config/
│   ├── services.yml
│   ├── admin/
│   │   └── services.yml
│   └── front/
│       └── services.yml
├── controllers/
│   ├── admin/
│   └── front/
├── src/
│   ├── Controller/
│   ├── Command/
│   ├── Form/
│   ├── Service/
│   └── Repository/
├── translations/
├── upgrade/
├── views/
│   ├── css/
│   ├── js/
│   ├── img/
│   └── templates/
│       ├── admin/
│       ├── front/
│       └── hook/
├── vendor/
├── config.xml
├── logo.png
└── mymodule.php
```

The split matters:
- `controllers/` is for **legacy-style** module controllers.
- `src/Controller` is for **modern Symfony-based** controllers.
- `config/` is where routes/services live.
- `views/` is where templates and static assets live.

Do not invent extra framework directories because the model guessed them.

## Naming rules
- The **technical name** is the folder name and the main PHP filename.
- The module’s main class name is the PascalCase form of that technical name.
- Use lower-case alphanumeric names. Underscores are accepted historically, but they are a bad choice because they interfere with translation domain conventions.

Bad:
- `MailerLite-Bridge`
- `my_cool_module` (works often enough to fool people, still a bad default)
- mismatched folder/file/class names

Good:
- `mailerlitebridge`
- `smlppmailerlite`

If you must keep an underscore for business reasons or backward compatibility, treat translation behavior as a risk and validate it.

## Main file rules
The root file must start with the standard guard:

```php
<?php
if (!defined('_PS_VERSION_')) {
    exit;
}
```

No closing `?>` tag.

## Composer and autoload
Use Composer for PSR-4 autoloading and external dependencies.

Minimal example:

```json
{
  "name": "vendor/mymodule",
  "type": "prestashop-module",
  "autoload": {
    "psr-4": {
      "Vendor\\MyModule\\": "src/"
    }
  },
  "config": {
    "prepend-autoloader": false
  }
}
```

That `prepend-autoloader: false` is not optional fluff. PrestaShop docs explicitly warn that module autoloaders must not override core dependencies.

## Packaging rules
Before packaging:
1. run `composer dump-autoload -o --no-dev`
2. include `vendor/`
3. exclude dev-only libraries from release packages

A ZIP that depends on `composer install` on the merchant’s server is sloppy and often unusable.

## Hard bans
Do not do any of this:
- define classes under `PrestaShopBundle\...` inside the module
- define classes under `Symfony\Component\...` inside the module
- copy random core classes into the module because an import failed
- place modern controllers in `controllers/` or legacy front controllers in `src/Controller`
- put templates in random folders outside `views/`

If a generation does any of the above, it is wrong even if PHP can parse it.

## Minimal root checklist
- technical name is consistent across folder, root file, and `$this->name`
- root file guard is present
- Composer PSR-4 namespace maps to `src/`
- `prepend-autoloader` is disabled
- release artifact contains `vendor/`

## References
- PrestaShop 9 module file structure: https://devdocs.prestashop-project.org/9/modules/creation/module-file-structure/
- PrestaShop 9 getting started / naming: https://devdocs.prestashop-project.org/9/modules/creation/tutorial/
- Composer in modules: https://devdocs.prestashop-project.org/9/modules/concepts/composer/
