---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Services and Dependency Injection

If your module contains real logic, put it in services.

## Why services exist here
The main module class and controllers are orchestration layers. The actual work should live in injectable services:
- API clients
- sync coordinators
- repositories
- option providers
- validators
- URL/token builders
- form handlers
- command handlers

If the code does serious work and cannot be unit-tested in isolation, the architecture is probably wrong.

## Service registration
Define services in `config/services.yml`.

Minimal pattern:

```yaml
services:
  _defaults:
    public: true

  vendor.mymodule.api_client:
    class: Vendor\MyModule\Service\ApiClient
    arguments:
      - '@logger'
```

You can also split or import PHP/XML service definitions if needed.

## Namespace discipline
Use your own vendor/module namespace. Do not define module code under `PrestaShop\...` or `Symfony\...` namespaces unless you are literally extending documented classes from those packages in the normal way.

## Service design rules
- one responsibility per service
- no hidden reads from globals when arguments/context can be injected
- keep remote HTTP behind a dedicated client/service boundary
- expose stable method contracts that model business actions, not raw transport details

Bad:
- `SyncService::runEverythingAndMaybeDeleteStuff(array $params)`

Better:
- `SubscriberSyncService::upsertSubscribedCustomer(CustomerData $customer): SyncResult`
- `SubscriberSyncService::removeUnsubscribedCustomer(RemoteSubscriberId $id): SyncResult`

## Controller-to-service boundary
Controllers should:
- validate request shape / permissions / token
- call services
- format response

Controllers should not:
- assemble SQL manually everywhere
- implement HTTP transport logic to external APIs
- duplicate business rules from install hooks or cron paths

## Service overrides and decoration
PrestaShop supports modifying container definitions from modules. Use service decoration/override only when hooks or documented extension points cannot solve the problem. This is safer than file overrides, but still deserves restraint.

## Commands as services
Module commands are part of the service layer. Use them for repeatable operational tasks, not for tasks that depend on browser session state.

Docs warn that legacy classes such as `ObjectModel` may cause issues in command context. That means command code must be written deliberately, not copied blindly from controller code.

## Common anti-patterns
- one gigantic `Helper` class that does API, SQL, validation, rendering, and token generation
- static service methods everywhere because DI felt hard
- direct `new ApiClient()` inside controllers/hooks
- services named after transport (`CurlService`) instead of responsibility (`MailerLiteSubscriberClient`)
- exposing half the module as public mutable state

## Healthy service layout example
```text
src/
├── Service/
│   ├── MailerLiteClient.php
│   ├── NewsletterSyncService.php
│   ├── CronTokenService.php
│   └── GroupOptionsProvider.php
├── Repository/
│   └── CustomerNewsletterRepository.php
├── Form/
│   ├── DataProvider/...
│   └── Handler/...
└── Command/
    └── SyncNewsletterCommand.php
```

## References
- Services in modules: https://devdocs.prestashop-project.org/9/modules/concepts/services/
- Commands in modules: https://devdocs.prestashop-project.org/9/modules/concepts/commands/
- Controller routing (modern stack context): https://devdocs.prestashop-project.org/9/development/architecture/modern/controller-routing/
