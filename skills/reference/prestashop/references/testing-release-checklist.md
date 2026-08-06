---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: production experience
---

# Testing and Release Checklist

A PrestaShop module is not complete because it installs and shows up in the module list.

## Minimum validation before claiming success
### 1) Syntax
Run PHP lint across the module.

### 2) Install / enable
Confirm the module:
- installs cleanly
- enables cleanly
- registers hooks/tabs/routes as expected

### 3) Configuration flow
Confirm:
- config page opens
- fields load saved values
- invalid input is rejected
- success messages happen only after actual success
- dependent fields (remote dropdowns, generated URLs) behave correctly

### 4) Functional path
Test the actual feature:
- hook output appears where expected
- API integration can authenticate
- sync actually creates/updates/removes the intended remote state
- cron or command executes without requiring a human session

### 5) Uninstall / cleanup
Confirm:
- uninstall path runs cleanly
- owned config values/tabs/tables are removed or intentionally preserved
- reinstall works after uninstall

## Packaging validation
Before release ZIP creation:
- run `composer dump-autoload -o --no-dev`
- include `vendor/`
- exclude dev dependencies and test tools
- ensure no environment-specific secrets are packaged

## Static analysis and checks
PrestaShop docs provide basic and advanced checks guidance. Use them.
At minimum:
- lint PHP files
- run static analysis if the module has non-trivial code
- scan for undefined classes/methods/imports

## Release checklist
- technical name consistent everywhere
- compatibility range reflects tested versions
- hooks verified
- routes verified
- modern controller autoload verified
- translations present for admin-visible text
- cron/commands documented
- destructive actions documented honestly
- README install/configuration steps are accurate

## Debugging order when “it installs but doesn’t work”
1. route/controller naming mismatch
2. missing/incorrect autoload
3. service not registered
4. hook not registered or wrong hook name
5. configuration never saved or loaded correctly
6. external API contract misunderstood
7. cron token or context issue
8. packaging missing `vendor/`
9. relying on a dependency removed from PrestaShop 9 core

## Hard rule for AI-generated modules
Never treat “module installs” as proof of correctness. It proves only that one code path did not explode immediately.

## References
- Module testing overview: https://devdocs.prestashop-project.org/9/modules/testing/
- Basic checks: https://devdocs.prestashop-project.org/9/modules/testing/basic-checks/
- Advanced checks: https://devdocs.prestashop-project.org/9/modules/testing/advanced-checks/
- Composer packaging notes: https://devdocs.prestashop-project.org/9/modules/concepts/composer/
- Module CLI management: https://devdocs.prestashop-project.org/9/development/components/console/prestashop-module/
