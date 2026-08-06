---
scope: prestashop
target_versions: "PrestaShop 9.x, PHP 8.2+"
last_verified: 2026-03-19
source_basis: official docs
---

# External APIs and Scheduled Synchronization

This is where AI-written PrestaShop modules most often fail. The usual pattern is superficial success: the module installs, settings save, and the sync still does not work.

## First principle: model the remote contract, not your wishful abstraction
Before writing any integration, confirm:
- authentication scheme
- list/fetch endpoint semantics
- create/upsert semantics
- update identifier (email? id? slug? composite?)
- delete semantics (soft delete? unsubscribe? remove from group? hard delete?)
- pagination/rate limits/error model

If you do not know these precisely, you are not ready to implement the sync.

## Identifier discipline
Never assume email is the operative identifier for every action.
A common failure looks like this:
- create subscriber by email works
- update by email seems plausible
- delete actually requires remote `subscriber_id`
- module ships broken destructive sync

That is not bad luck. That is bad modeling.

## Recommended integration architecture
Split responsibilities:
- `ApiClient` — raw HTTP transport + authentication + response normalization
- `RemoteRepository` / `RemoteClient` — API-specific operations (`findSubscriberByEmail`, `upsertSubscriber`, `deleteSubscriber`, `assignToGroup`, etc.)
- `LocalRepository` — fetches local PrestaShop data to sync
- `SyncService` — business rules for deciding create/update/remove
- `Cron/Command Controller` — triggers the sync and formats result

## Sync policy must be explicit
Define exactly:
- source of truth
- one-way or two-way
- who wins on conflict
- what “unsubscribe” means on the remote side
- whether removals are global deletes or group removals
- whether guest newsletters are included or only customers

If the requirement says “remove from MailerLite”, you still need to know whether that means:
- delete the subscriber from the account
- mark as unsubscribed
- remove from one group only

Those are different actions with different blast radiuses.

## Cron design
When the merchant needs a URL for a scheduler:
- expose a dedicated front controller
- require a token
- return a machine-readable summary
- make the action idempotent when possible

When shell access is available:
- provide a Symfony command
- document usage
- keep it non-interactive and scriptable

## Runtime safety
- network timeouts must be explicit
- failed batches must report enough context to debug
- destructive operations must be logged or at least counted
- partial success must be reported as partial, not as success
- do not say “Synced successfully” when 20% of records failed

## Mapping local entities
For customer/newsletter-style syncs, decide what local dataset is authoritative:
- `customer.newsletter`
- guest newsletter subscriptions
- custom consent tables
- shop scope vs all shops

If the requirement says “newsletter users”, verify whether that includes guests. Do not silently sync only customers and call it done.

## Batch vs per-record strategy
Use batch operations if the remote API supports them safely and you can report failures meaningfully.
Use per-record operations when the remote API contract differs by action or when you need exact auditability.

Do not choose batches solely because they look efficient in generated code.

## Review checklist for any API module
- remote identifiers modeled correctly
- delete/unsubscribe semantics confirmed
- HTTP errors surfaced clearly
- rate limit / timeout behavior considered
- sync source dataset defined precisely
- cron/command secured
- logs or summaries usable for debugging
- settings page validates remote-dependent selections against live API data

## References
- Front controllers and cron usage: https://devdocs.prestashop-project.org/9/modules/concepts/controllers/front-controllers/
- Commands in modules: https://devdocs.prestashop-project.org/9/modules/concepts/commands/
- Services in modules: https://devdocs.prestashop-project.org/9/modules/concepts/services/
