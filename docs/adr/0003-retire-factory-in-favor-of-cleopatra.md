# Retire Factory in favor of Cleopatra

**Status:** Accepted — 2026-09-29

## Context

The owner has designated Factory an unusable proof-of-concept that was never fully
utilized. Its source, specifications and passing component tests do not establish a
usable production orchestration capability. Cleopatra is a separate project taking
over its duties.

The skills survey initially treated Factory as an existing operational substitute
for upstream `implement-spec`. That premise is withdrawn.

## Options considered

1. Continue developing and shipping Factory in this package.
2. Keep executable Factory copies in a legacy directory.
3. Remove Factory from the package and repository implementation surfaces; retain
   its rationale and evidence only as explicitly historical records.

## Decision

Choose option 3. Remove the binary, extension, dedicated libraries, predecessor
Factory/pipeline implementations, repository policy, dedicated tests, proof-only
skill and live runners that depend on removed modules. Remove Factory generation
and requirements from project setup and active skills. Preserve shared tooling
that still serves this package independently.

Cleopatra owns the successor orchestration project. This decision does not assert
that any Cleopatra implementation, command, API, migration or scheduling policy has
been inspected or is operational. Do not invent an integration in this repository.

Keep short superseded notices at former specification paths so historical links
remain intelligible. The full proof-of-concept is recoverable from Git history at
`9c9176bbdea328d72f7c4800d1dd27b73de5e02a`, not maintained as another executable copy.
Historical surveys and captured evidence remain historical, not active contracts.

## Tradeoffs

- Removes unusable install surfaces, maintenance cost and accidental authority.
- Breaks the package's `factory` executable and `/factory` command deliberately;
  their successor is Cleopatra, not a renamed command supplied by this package.
- Removes component regression tests whose subject no longer ships, while adding
  retirement checks that prevent accidental reintroduction.
- Does not automatically translate old policy or runtime data to Cleopatra.

## Consequences and migration

- Package updates stop installing the Factory binary/extension and proof-only skill.
  Reload or restart pi after updating. Remove an explicitly configured old extension
  entry if it points at a removed path; preserve unrelated settings.
- Existing consumer policy files, operator inventories, databases, credentials,
  worktrees, branches, panes and user files are not deleted or rewritten by this
  retirement. Removal of code is not permission to destroy their only copy.
- Use Cleopatra's own project documentation for successor setup. No successor
  location or CLI is assumed here.
- Manual ticket implementation and shared skill/tooling surfaces remain available.
  A future supervised whole-spec skill is evaluated on its own merits, separately
  from unattended orchestration; Factory's former policies no longer constrain it.

## Related docs

- [Retired Factory specification](../specs/software-factory.md)
- [Reconsidered upstream-skills survey](../surveys/mattpocock-skills-sync-2026-09-29.md)
