---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# Data Persistence

A PrestaShop module usually needs more than one storage strategy. Stop trying to force all state into one bucket.

## Use the right persistence tool
### `Configuration`
Use for:
- scalar settings
- feature toggles
- API keys
- selected remote IDs
- lightweight configuration values

Do **not** use for:
- sync journals
- large payloads
- audit logs
- many-to-many mappings
- per-record operational state

### Custom tables
Use for:
- mappings between local and remote entities
- sync state / checkpoints
- queues
- domain data owned by the module
- logs that need querying/filtering

### Doctrine entities
PrestaShop supports Doctrine for modules. Use it when the module has real entity modeling needs and you are staying on the modern stack.

Do not force Doctrine into tiny modules that just need a settings form and one lookup query.

## Schema lifecycle
If you create tables, you own their lifecycle:
- create on install
- upgrade via scripts in `upgrade/`
- remove or intentionally preserve on uninstall, depending on the module contract

If uninstall preserves data, state it clearly.

## Upgrade scripts
Schema/data changes between versions must live in upgrade scripts. Do not hide migrations in arbitrary runtime code paths.

## Prefixing
Prefix everything:
- configuration keys
- SQL tables
- indexes/constraints where relevant
- option names

Do not create generic table names like `subscriptions` or config keys like `API_KEY`.

## Multistore awareness
Settings can be shop-scoped or group-scoped. If the task mentions multistore, decide explicitly:
- global config
- shop group config
- per-shop config

A module that silently behaves as global in a multistore shop is usually wrong.

## Remote integrations need local mapping
For external APIs, store enough state to perform safe updates/deletes later.

Examples of state worth storing:
- remote subscriber ID
- last sync timestamp
- last sync status/error
- hash/version of last exported payload

Do not rely on email alone unless the remote API explicitly guarantees email is the operative identifier for every update/delete path you need. Many APIs do not.

## DB access choices
For lightweight custom tables and reporting queries, DBAL/`Db` can be sufficient.
For rich entity modeling in modern modules, Doctrine is appropriate.
Pick one deliberately; do not mix three data access styles in one feature without reason.

## Anti-patterns
- serializing complex arrays into one `Configuration` value because migrations felt annoying
- no upgrade scripts despite versioned schema changes
- destructive uninstall without confirmation or contract
- storing remote IDs nowhere, then discovering delete/update cannot be implemented
- mixing Doctrine entities and raw SQL updates against the same tables casually

## Design prompt for persistence
Before writing storage code, answer these:
1. Is this a setting or operational data?
2. Does it need queryability?
3. Does it need per-shop scope?
4. Will uninstall remove it?
5. Do I need remote IDs for future sync actions?

If those answers are not explicit, the data model is not ready.

## References
- Doctrine in modules: https://devdocs.prestashop-project.org/9/modules/concepts/doctrine/
- Module file structure (`upgrade/`, `config/`, `src/`): https://devdocs.prestashop-project.org/9/modules/creation/module-file-structure/
- Configure with CLI / configuration table examples: https://devdocs.prestashop-project.org/9/modules/configure-with-cli/
