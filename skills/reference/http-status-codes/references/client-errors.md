# Client Error Responses For APIs

Use this file when the client must change credentials, request shape, request data, timing, or target before the request can succeed.

## Core 4xx Codes

### 400 Bad Request

Use `400 Bad Request` when the request is malformed at the HTTP or representation-syntax level.

Real-world examples:
- Broken JSON syntax.
- Invalid request framing.
- A truncated multipart upload that cannot be parsed.

Do not use `400` for:
- missing or expired credentials (`401`)
- insufficient permissions (`403`)
- unsupported content type (`415`)
- valid JSON that fails validation (`422`)
- per-client rate limiting (`429`)

### 401 Unauthorized

Use `401 Unauthorized` when credentials are missing or invalid.

Good pattern:

```http
GET /admin HTTP/1.1
Host: api.example.com
```

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
Content-Length: 0
```

Real-world examples:
- Missing bearer token.
- Expired access token.
- Invalid token signature.

Client guidance: refresh credentials, prompt the user to log in again, or resend with a valid token. Do not treat `401` as a permanent denial.

### 403 Forbidden

Use `403 Forbidden` when the client is authenticated but not allowed to perform this action.

Real-world examples:
- A support agent can view refunds but cannot create them.
- A token has `orders:read` but not `orders:write`.

Client guidance: do not blindly retry. This is usually a permissions or policy problem, not an authentication refresh problem.

### 404 Not Found

Use `404 Not Found` when the resource does not exist, or when you intentionally do not reveal whether it exists.

Real-world examples:
- `GET /orders/ord_999` for an unknown id.
- A private document is hidden from callers who should not even know it exists.

### 405 Method Not Allowed

Use `405 Method Not Allowed` when the server knows the method, but this resource does not allow it.

The response should include `Allow`.

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
Content-Length: 0
```

Real-world example: `DELETE /invoices/inv_123` on a finalized invoice resource that is read-only.

### 409 Conflict

Use `409 Conflict` when the request conflicts with the current state of the resource or system.

Real-world examples:
- A job runner refuses to start the same export twice concurrently.
- A slug or external identifier is already taken in an API that models uniqueness as a resource-state conflict.

Client guidance: refetch state, pick a different identifier, or otherwise resolve the conflict before retrying.

Note: some APIs place uniqueness violations under `422` validation instead. That can be defensible, but it should be a deliberate contract choice, not an accident.

### 410 Gone

Use `410 Gone` when the resource was intentionally removed and will not return.

Real-world example: an old promotional endpoint or retired short-lived coupon lookup has been deliberately removed after a campaign ended.

### 412 Precondition Failed

Use `412 Precondition Failed` when the client sent a conditional header such as `If-Match`, but the precondition evaluated false.

Real-world example: `PATCH /orders/123` with a stale ETag, after another user changed the order.

Client guidance: refetch state, merge intentionally, then retry with a fresh precondition.

### 415 Unsupported Media Type

Use `415 Unsupported Media Type` when the server refuses the request format or encoding.

Real-world examples:
- `Content-Type: text/csv` sent to a JSON-only endpoint.
- Missing required JSON media type for an endpoint that insists on explicit `Content-Type`.
- Unsupported `Content-Encoding`.

Some servers advertise the accepted request format with `Accept-Post`.

### 422 Unprocessable Content

Use `422 Unprocessable Content` when the content type and syntax are valid, but the contained instructions are invalid.

Real-world examples:
- Valid JSON, but `email` is not a valid email address.
- Valid payload, but `end_date` is before `start_date`.
- Valid checkout request, but one line item is out of stock.

Client guidance: fix the submitted data. Repeating the same request unchanged should fail again.

### 428 Precondition Required

Use `428 Precondition Required` when the server requires a conditional request and the client omitted the required precondition header.

Real-world example: `PUT /documents/doc_1` without the required `If-Match` header in an API that uses optimistic concurrency.

### 429 Too Many Requests

Use `429 Too Many Requests` when a specific caller exceeded a rate limit.

Real-world examples:
- One API key exceeded its per-minute quota.
- One IP is making too many unauthenticated login attempts.

Good pattern:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "error": "rate_limit_exceeded"
}
```

Client guidance: back off for that caller. `Retry-After` is strongly recommended when the wait is known.

## Advanced But Still Useful 4xx Codes

| Code | When it fits | Real-world example | Guidance |
|---|---|---|---|
| `402 Payment Required` | You control a billing-specific contract and document the meaning clearly. | A subscription API blocks write operations after an unpaid invoice. | Registered, but there is no widely shared standard convention. Use with caution. |
| `406 Not Acceptable` | The server cannot produce a representation matching the client's `Accept` constraints. | The client insists on XML, but the API only returns JSON. | Rare in JSON APIs because many APIs simply always return one format. |
| `408 Request Timeout` | The server timed out waiting for the request itself. | A large upload stalled mid-stream before the full request arrived. | More infrastructure-facing than domain-facing. |
| `421 Misdirected Request` | The request reached a server that cannot answer for that scheme and authority combination. | HTTP/2 or proxy connection reuse sent the request to the wrong backend. | Usually an edge or transport issue, not ordinary endpoint logic. |
| `425 Too Early` | The server refuses a replay-risk request too early in the transport flow. | A payment capture endpoint rejects replay-sensitive early data. | Advanced transport scenario; useful for replay-sensitive operations. |
| `431 Request Header Fields Too Large` | The request headers are too large. | Cookie bloat from a browser or an oversized custom header set. | Better than burying header-size failures under `400`. |
| `451 Unavailable For Legal Reasons` | Access is blocked because of a legal demand or restriction. | A region-specific takedown or court-ordered removal. | Use only when legal unavailability is part of the real reason. |

## Practical Notes
- `407 Proxy Authentication Required` is the proxy-auth equivalent of `401`. It matters mostly at proxy infrastructure boundaries rather than origin API design.
- If a request body is too large, the exact code may be `413 Content Too Large`; if the URI itself is too long, `414 URI Too Long` is more precise. Those size-focused protocol errors are standards-based and can be the right answer; they sit in the appendix only to keep the core CRUD guidance compact.
