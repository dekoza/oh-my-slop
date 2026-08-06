# HTTP Status Codes Reference Index

Use this index to open the smallest file that answers the task.

## Package Guides

| Domain | File | Use For |
|---|---|---|
| Decision rules | `references/decision-rules.md` | Fast status-code selection, confused pairs and triples, companion headers, and anti-patterns |
| Success + redirects | `references/success-redirects.md` | `200`, `201`, `202`, `204`, `206`, `304`, and redirect behavior such as `303`, `307`, and `308` |
| Client errors | `references/client-errors.md` | Auth, permissions, validation, conflicts, media types, throttling, and practical 4xx client handling |
| Server errors | `references/server-errors.md` | `500`, `501`, `502`, `503`, `504`, retries, upstream failures, and outage semantics |
| Rare + nonstandard | `references/rare-and-nonstandard.md` | Obscure standard codes, WebDAV-heavy codes, deprecated or unused entries, and vendor/private warnings |

## Common Task Routing

- Picking the best code for a controller or endpoint: read `references/decision-rules.md`
- Choosing the right success code after create, delete, or async enqueue: read `references/success-redirects.md`
- Fixing an API that overuses `400 Bad Request`: read `references/decision-rules.md` and `references/client-errors.md`
- Explaining auth, permission, or validation failures to a client team: read `references/client-errors.md`
- Deciding whether clients should retry, back off, or stop: read `references/server-errors.md` and the relevant sections in `references/client-errors.md`
- Looking up an oddball code from logs or a CDN: read `references/rare-and-nonstandard.md`

## Suggested Reading Order

1. If you already know the task domain, open that domain file directly.
2. Start with this index only when you are unsure which domain file you need.
3. Open `references/decision-rules.md` whenever multiple plausible codes compete.
4. Open `references/rare-and-nonstandard.md` only if the task explicitly needs it.
