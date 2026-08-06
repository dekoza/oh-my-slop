---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: production experience
---

# PrestaShop 9 Gotchas

This file exists because many modules fail specifically on PrestaShop 9 while looking fine on paper.

## Removed core dependencies
PrestaShop 9 cleaned up a number of dependencies. If your module relied on them being present because older PrestaShop versions pulled them in, that assumption is now broken.

Examples explicitly called out in the docs include removed or replaced dependencies such as:
- `guzzlehttp/guzzle`
- `swiftmailer/swiftmailer`
- `symfony/uid`
- `symfony/workflow`
- others listed in the core update notes

If you need one of these, add it to your module’s own dependencies. Do not assume core still ships it.

## Mailer changed
Core mail handling moved from Swift Mailer to Symfony Mailer. If a module depends on old mailer assumptions, audit it.

## Product page changes
In PrestaShop 9, the new product page is the only one available. Modules extending product-page behavior must align with the new structures and extension points.

## Front-office presenter changes
Some front controllers now use presenter classes before templates receive data. Themes and modules that assumed older template structures can break.

## Composer discipline matters more now
Because core dependency shape changed, sloppy Composer setup is more dangerous. A module that shadows core libs or assumes core packages exist can fail in ways that are hard to diagnose.

## Legacy/modern boundary still matters
PrestaShop 9 did not magically erase legacy parts of the platform. Many module tasks still involve legacy hooks/front controllers while BO configuration increasingly belongs to the modern Symfony stack. Pretending everything is purely Symfony or purely legacy is inaccurate.

## Example-module baseline
The official example modules page indicates multiple maintained demo modules are optimized and compatible for `v9.0.0` and above. Use these patterns as sanity checks when your generation starts drifting into made-up architecture.

## Review questions for PS 9 work
- Am I relying on a core dependency that was removed?
- Am I using the new BO/product-page extension patterns instead of obsolete ones?
- Am I mixing legacy and Symfony code deliberately rather than randomly?
- Did I test on 9.0.0 specifically if I claim exact compatibility?

## References
- PrestaShop 9 core updates: https://devdocs.prestashop-project.org/9/modules/core-updates/9.0/
- PrestaShop 9 docs index: https://devdocs.prestashop-project.org/9/
- Sample/example modules: https://devdocs.prestashop-project.org/9/modules/sample-modules/
