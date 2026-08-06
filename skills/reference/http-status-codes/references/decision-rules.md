# HTTP Status Code Decision Rules

Use this file when the task is "which status code should this be?" or when an API is clearly overusing `400 Bad Request`.

## Fast Selection Checklist
1. **Did the request succeed right now?** Choose among `200`, `201`, `204`, or `206`.
2. **Was the work only accepted, not finished?** Use `202`.
3. **Should the client go to another URL?** Use a `3xx` code, not a success code with a URL hidden in the body.
4. **Is the client unauthenticated or unauthorized?** Usually `401`, `403`, or sometimes `404` to hide existence.
5. **Is the request malformed or using an unsupported format?** Usually `400` or `415`.
6. **Is the request well-formed but semantically invalid or conflicting with state?** Usually `409`, `412`, `422`, or `428`.
7. **Is the client over a limit?** Use `429`.
8. **Is the service or an upstream failing temporarily?** Use `500`, `502`, `503`, or `504`.

## Headers That Change The Meaning

| Code | Header | Why it matters |
|---|---|---|
| `401 Unauthorized` | `WWW-Authenticate` | The client needs a challenge that tells it how to authenticate. |
| `405 Method Not Allowed` | `Allow` | The response is incomplete unless the server tells the client which methods are allowed. |
| `201 Created` and redirects | `Location` | New resources and redirects are much easier to consume when the target URI is explicit. |
| `429 Too Many Requests`, `503 Service Unavailable` | `Retry-After` | Tells the client when retrying may succeed instead of guessing. |
| `412 Precondition Failed`, `428 Precondition Required` | `ETag` and `If-Match` workflow | These codes make sense when the API is using conditional requests intentionally. |
| `415 Unsupported Media Type` | `Accept-Post` or docs | Some servers advertise the accepted request format, which helps clients fix the request. |

## High-Value Boundaries

### 400 vs 415 vs 422

| Code | Use it when | Real-world example | What the client should do |
|---|---|---|---|
| `400 Bad Request` | The request is malformed at the HTTP or representation-syntax level. | `POST /users` with broken JSON like `{ "email": "a@example.com", }` | Fix the request structure before retrying. |
| `415 Unsupported Media Type` | The server refuses the request format or encoding. | Sending `Content-Type: text/csv` to a JSON-only endpoint, or omitting the required JSON media type entirely | Resend using a supported media type or encoding. |
| `422 Unprocessable Content` | The content type and syntax are understood, but the instructions are invalid. | Valid JSON with `email: "not-an-email"`, an invalid enum, or an out-of-stock checkout attempt | Change the submitted data; retrying unchanged will fail again. |

- Use `400` for broken syntax, invalid framing, or other cases where the request cannot be interpreted correctly.
- Use `415` when the format itself is not acceptable.
- Use `422` when the format is acceptable but the content fails validation or business rules.
- Some older public APIs still map validation failures to `400`. If compatibility forces that choice, say so explicitly instead of teaching it as the ideal rule.

### 401 vs 403 vs 404

| Code | Use it when | Real-world example | What the client should do |
|---|---|---|---|
| `401 Unauthorized` | Credentials are missing or invalid. | No bearer token, expired access token, invalid JWT signature | Re-authenticate, refresh credentials, or resend with valid credentials. |
| `403 Forbidden` | Credentials are valid, but the action is not allowed. | A logged-in analyst tries to call an admin-only refund endpoint without the right scope | Do not retry unchanged; request permission or use a different account. |
| `404 Not Found` | The resource does not exist, or the server intentionally hides whether it exists. | `/orders/ord_999` does not exist, or a private record is hidden from unauthorized users | Stop or let the user check the identifier. |

- `401` is about authentication, not permission denial.
- `401` should include `WWW-Authenticate`.
- `403` is for known identity plus denied action.
- `404` may be used instead of `403` when you do not want to reveal that a private resource exists.

### 404 vs 410

| Code | Use it when | Real-world example |
|---|---|---|
| `404 Not Found` | The server makes no permanence claim. | A customer asks for an order id that never existed. |
| `410 Gone` | The server knows the resource was intentionally removed and will not return. | A limited-time campaign URL or retired coupon lookup endpoint has been deliberately removed forever. |

Use `410` when the permanence is part of the contract. Otherwise `404` is safer.

### 405 vs 501

| Code | Use it when | Real-world example |
|---|---|---|
| `405 Method Not Allowed` | The server knows the method, but this resource does not allow it. | `DELETE /invoices/inv_123` on a read-only invoice resource | 
| `501 Not Implemented` | The server does not implement the method or capability at all. | A legacy gateway that does not support `PATCH` anywhere in the platform |

- `405` is resource-specific and should include `Allow`.
- `501` is server-capability specific.

### 409 vs 412 vs 428

| Code | Use it when | Real-world example | What the client should do |
|---|---|---|---|
| `409 Conflict` | The request conflicts with the current state of the resource or system. | A duplicate job is already running, or a slug is already taken in a contract that models uniqueness as a state conflict | Fetch state, resolve the conflict, and retry intentionally if appropriate. |
| `412 Precondition Failed` | The client sent a precondition and it evaluated false. | `PATCH /orders/123` with a stale `If-Match` ETag | Refetch current state, merge, and retry with a fresh precondition. |
| `428 Precondition Required` | The server requires a conditional request but the client omitted the needed precondition. | `PUT /documents/abc` without the required `If-Match` header | Add the required precondition and retry. |

- `412` means the client did send the guard and lost.
- `428` means the client failed to send the guard at all.
- `409` is for the broader category of resolvable state conflicts.
- Uniqueness and duplicate-submission failures are an ecosystem-variant edge: many APIs use `409`, while others keep them under `422` validation. Pick one rule and apply it consistently; do not collapse it into `400`.

### 200 vs 201 vs 202 vs 204

| Code | Use it when | Real-world example |
|---|---|---|
| `200 OK` | The request succeeded and you are returning a representation or result payload. | `GET /accounts/acc_123` returns account JSON |
| `201 Created` | The request created a new resource before the response is sent. | `POST /customers` creates `cst_923` immediately and returns it |
| `202 Accepted` | The work was accepted, but the outcome is not finished yet. | `POST /exports` queues a CSV export job |
| `204 No Content` | The request succeeded and there is nothing useful to send back in the body. | `DELETE /sessions/current` or `POST /notifications/read-all` |

- Use `201` for completed creation, usually with `Location`.
- Use `202` for queued or asynchronous work, including async processing against an already-existing resource.
- Use `204` only when you truly want no response body.

### 301 vs 302 vs 303 vs 307 vs 308

| Code | Use it when | Real-world example |
|---|---|---|
| `301 Moved Permanently` | The move is permanent and method rewriting is acceptable or the traffic is effectively `GET`/`HEAD`. | Redirecting browser traffic from an old documentation URL to its permanent new path |
| `302 Found` | The move is temporary and method rewriting is acceptable or unimportant. | Temporarily moving a `GET /landing-page` during an A/B rollout |
| `303 See Other` | You want the client to follow up with `GET` at another resource. | `POST /payments` returns `303` to `/payments/pay_123` or a confirmation page |
| `307 Temporary Redirect` | The move is temporary and the method and body must stay unchanged. | A temporary reroute of `POST /uploads` to a maintenance shadow endpoint |
| `308 Permanent Redirect` | The move is permanent and the method and body must stay unchanged. | Permanently moving `PUT /v1/files/{id}` to `/v2/files/{id}` without rewriting to `GET` |

- If method preservation matters, prefer `307` or `308`.
- If you want POST-redirect-GET behavior, prefer `303`.
- `301` and `302` remain common, but older clients have historically rewritten non-`GET` methods.

### 429 vs 503

| Code | Use it when | Real-world example | What the client should do |
|---|---|---|---|
| `429 Too Many Requests` | A specific client, token, IP, or app exceeded a rate limit. | One API key sent 10,000 analytics requests in a minute | Back off for that caller; use `Retry-After` when available. |
| `503 Service Unavailable` | The service is temporarily not ready, overloaded, or in maintenance. | A deployment window or exhausted worker pool affects the whole API | Back off globally; `Retry-After` is helpful when known. |

Do not use `503` for a single noisy client you are throttling. That is `429`.

### 502 vs 504

| Code | Use it when | Real-world example |
|---|---|---|
| `502 Bad Gateway` | A gateway or proxy received an invalid upstream response. | An API gateway gets malformed HTTP from a tax provider |
| `504 Gateway Timeout` | A gateway or proxy waited too long for the upstream. | Checkout waits on fraud scoring and the upstream never responds in time |

## Red Flags
- Returning `200` with an error payload for a failed request.
- Returning `400` for expired tokens, unsupported media types, validation errors, stale ETags, or rate limits.
- Returning `500` when the better answer is really `502`, `503`, or `504`.
- Returning `202` when creation already finished and the resource exists.
- Returning redirect codes when the real issue is temporary unavailability.
