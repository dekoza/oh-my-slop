# Reference Docs

Reference docs own exact interface and behavior facts. They are not tutorials and not design essays. Use them for the details that users, integrators, and maintainers need to look up quickly and trust completely.

## Typical Reference Surfaces

- API endpoints and request / response fields
- schemas and validation rules
- configuration settings and defaults
- environment variables
- CLI commands and flags
- feature flags
- background job contracts
- permissions, scopes, and capability matrices

## Core Rules

1. Write **facts**, not marketing and not implementation folklore.
2. Prefer tables, exact field lists, defaults, examples, and compatibility notes.
3. State deprecations and status markers explicitly.
4. If generated from code, verify the generated output still reflects the real contract.
5. If the code changes an interface, update the reference docs in the same task.
6. Do not hide breaking changes inside vague prose.

## What Good Reference Docs Usually Include

- object or surface name
- status and version / compatibility note
- field / option / flag descriptions
- default values
- allowed values or schemas
- authentication / authorization requirements if relevant
- error or failure conditions if relevant
- examples only when they clarify exact usage

## Minimal Template

```markdown
# [Surface name]
Status: Active | Deprecated | Superseded

## Purpose
[One sentence only]

## Contract
| Name | Type | Required | Default | Notes |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Compatibility
- Added in:
- Deprecated in:
- Breaking changes:

## Related surfaces
- Feature flags:
- Environment variables:
- Permissions / scopes:

## Examples
- ...
```

## Anti-Patterns

- Sneaking tutorials into reference docs.
- Omitting defaults or allowed values.
- Referring to “various settings” without naming them.
- Letting stale configuration docs survive after defaults change.
- Treating README snippets as the canonical reference for APIs, schemas, or configuration.
