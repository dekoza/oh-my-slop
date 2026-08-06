---
name: http-status-codes
description: >
  Use when choosing, reviewing, or explaining HTTP response codes — in an API,
  OpenAPI spec, controller, middleware, or client retry logic. Triggers on: "which
  status code", "400 vs 422", "401 vs 403", "429 vs 503", "409 vs 412", "201 vs 202
  vs 204", "303 vs 307 vs 308", or when a handler's status code looks wrong.
---
# HTTP Status Codes Reference

Use this skill for standards-based HTTP status code selection in API and client design. It exists to stop the lazy pattern where every client mistake becomes `400` and every temporary outage becomes `500`. Read only the smallest reference file needed for the task.

## Critical Rules
1. **Prefer the most specific standard code** - `400` is a fallback, not the default for every client-side failure.
2. **Separate authentication from authorization** - `401` means missing or invalid credentials and should challenge the client; `403` means the client is known but not allowed.
3. **Separate malformed from semantically invalid** - `400` covers malformed syntax/framing; `422` covers well-formed content that fails validation or instructions.
4. **Use conflict and precondition codes intentionally** - `409`, `412`, and `428` are not interchangeable.
5. **Return the headers that make the code complete** - `401` needs `WWW-Authenticate`, `405` needs `Allow`, redirects need `Location`, and `Retry-After` is strongly recommended for `429` or `503` when you know the wait.
6. **Do not lie with `202`** - `202 Accepted` means the work is not finished yet.
7. **Do not hide media-type problems inside `400`** - unsupported request formats often belong in `415`.
8. **Treat `429` and `503` as different signals** - one tells a specific client to slow down; the other says the service is temporarily unavailable.
9. **Keep compatibility explicit** - if an existing public API intentionally keeps broader historical codes, call out the deviation instead of pretending it is ideal HTTP semantics.
10. **Do not design public APIs around vendor/private codes** - keep nginx, Cloudflare, IIS, Laravel, and similar private codes out of the core contract.

## Reference Map
| File | Domain | Use when you need |
|------|--------|-------------------|
| `decision-rules.md` | High-value choices | Fast answers for confused pairs/triples and a selection rubric |
| `success-redirects.md` | 2xx + 3xx | Creation, async processing, no-content responses, cache-aware responses, redirects, HEAD |
| `client-errors.md` | 4xx | Auth, permissions, validation, conflicts, media type, throttling, operational client errors |
| `server-errors.md` | 5xx | Internal failures, upstream failures, temporary outages, retry behavior, mid-stream failures |
| `rare-and-nonstandard.md` | Appendix | Rare standards, WebDAV-heavy codes, deprecated or unused codes, vendor/private warnings |
| `REFERENCE.md` | Index | Cross-file routing for mixed or unclear tasks |

## Task Routing
- **Choosing between two or three plausible codes** -> `references/decision-rules.md`
- **Designing POST, PUT, PATCH, or DELETE success responses** -> `references/success-redirects.md`
- **Reviewing auth, validation, or client-error handling** -> `references/client-errors.md`
- **Reviewing retry policies, gateway failures, or maintenance behavior** -> `references/server-errors.md`
- **Interpreting obscure codes from logs or third-party docs** -> `references/rare-and-nonstandard.md`
- **Unsure where to start** -> `references/REFERENCE.md`

## When Not To Use This Skill
- **Framework-specific exception wiring** - This skill decides what the response should mean; pair it with the relevant stack skill to implement that meaning in middleware or handlers.
- **Project-specific compatibility decisions** - Whether an existing API may break its historical contract is a project call, not an HTTP-semantics call (Rule 9 only requires naming the deviation).
