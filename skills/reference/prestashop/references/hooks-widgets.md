---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Hooks and Widgets

Hooks are the default extension mechanism in PrestaShop. They are also one of the easiest places for an agent to hallucinate.

## First rule: verify the hook
Before writing hook code, confirm:
- hook name exists
- hook type (`display`, `action`, or special behavior)
- expected payload/params
- return behavior (`array_return` hooks are not normal display hooks)
- location (FO/BO/core origin)

Do not invent hook names that sound plausible.

## Register hooks explicitly
Register only the hooks you actually implement. Registering a pile of guessed hooks is not “future proofing”; it is noise.

Bad:
```php
$this->registerHook('actionAdminControllerSetMedia');
$this->registerHook('actionSomethingProbablyExists');
$this->registerHook('displayEverywhere');
```

Good:
- register the exact hooks the module uses
- keep registration in `install()`
- fail installation if critical hook registration fails

## Hook methods
Hook method names map directly to hook names, for example:
- hook name: `displayBackOfficeHeader`
- method: `hookDisplayBackOfficeHeader(array $params)`

Keep hook methods thin. If the hook performs real work, delegate to a service.

## Display vs action hooks
- **Display hooks** return rendered content.
- **Action hooks** perform side effects.

Do not return markup from an action hook and do not mutate state from a display hook unless the hook contract explicitly demands it.

## Widgets
Widgets exist to let modules display reusable content more flexibly than implementing a pile of display hooks. Use them when the module is effectively a renderable content provider across multiple placements.

If the module is not presenting reusable content, forcing widgets into the design is pointless.

## Custom routes via hook
For custom FO routes pointing to module front controllers, use `moduleRoutes`. This is not optional ceremony; it is the documented extension point.

## Hook selection discipline
Pick hooks based on the real event or render point.
- Need BO assets only on your admin page? scope them carefully.
- Need to react to entity creation/update? choose the action hook for that entity lifecycle.
- Need to inject content in a page region? use the specific display hook for that region.

Do not dump everything into broad hooks because they are easy to find.

## Performance rules
- do not perform expensive remote I/O in hot display hooks
- cache derived data where appropriate
- do not query huge datasets per hook call
- avoid global asset injection on every page if only one page needs it

## Common hook failures
- wrong hook name
- hook registered but corresponding method missing
- method implemented but hook never registered
- returning arrays/objects from display hooks
- rendering Smarty templates from hooks without assigning needed variables
- assuming hook params contain fields that were never documented

## Review checklist
- hook names verified against official list or core
- methods match exact names
- side effects only in action hooks
- rendering only in display hooks/widgets
- heavy logic delegated to services
- page-specific assets loaded only where needed

## References
- Hooks overview: https://devdocs.prestashop-project.org/9/modules/concepts/hooks/
- Hook list: https://devdocs.prestashop-project.org/9/modules/concepts/hooks/list-of-hooks/
- Widgets: https://devdocs.prestashop-project.org/9/modules/concepts/widgets/
- Use hooks on modern pages: https://devdocs.prestashop-project.org/9/modules/concepts/hooks/use-hooks-on-modern-pages/
