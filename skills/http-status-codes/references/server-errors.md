# Server Error Responses And Retry Behavior

Use this file when the failure is on the server side, when an upstream dependency failed, or when the client needs guidance about retries and backoff.

## Core 5xx Codes

### 500 Internal Server Error

Use `500 Internal Server Error` for unexpected server failures that do not have a better `5xx` code.

Real-world examples:
- An unhandled exception in invoice rendering.
- A database bug that bubbles out of the request path without a better classification.

Do not use `500` when a more specific code fits, especially `502`, `503`, or `504`.

Client guidance: retrying may help for idempotent requests, but `500` often signals a genuine server bug. For non-idempotent operations, retries should rely on explicit idempotency or follow-up status checks.

### 501 Not Implemented

Use `501 Not Implemented` when the server does not support the method or capability at all.

Real-world example: a legacy gateway does not support `PATCH` anywhere in the platform.

Do not use `501` for resource-specific method denial. That is `405 Method Not Allowed`.

### 502 Bad Gateway

Use `502 Bad Gateway` when your server is acting as a gateway or proxy and the upstream returned an invalid response.

Real-world examples:
- An API gateway gets malformed HTTP from a tax-calculation service.
- A reverse proxy receives a broken upstream response body or headers.

Client guidance: usually treat as transient and retry with backoff when the operation is safe or idempotent.

### 503 Service Unavailable

Use `503 Service Unavailable` when the service is temporarily not ready to handle the request.

Real-world examples:
- Planned maintenance or deployment window.
- Worker pool exhaustion, connection pool exhaustion, or temporary overload.

`503` is for temporary conditions. `Retry-After` is strongly recommended when you know the recovery time.

Do not use `503` for a specific client that exceeded its quota. That is `429 Too Many Requests`.

`503` responses usually should not be cached as if they were stable representations.

### 504 Gateway Timeout

Use `504 Gateway Timeout` when your server is acting as a gateway or proxy and the upstream did not answer in time.

Real-world example: checkout depends on a fraud-scoring service, and the upstream never responds before the timeout.

Client guidance: usually retry with backoff when the operation is safe or protected by idempotency keys.

## Retry Matrix

| Code | Typical meaning | Safe automatic retry? | Notes |
|---|---|---|---|
| `500` | Generic unexpected server failure | Sometimes | Best for idempotent requests or explicit idempotency workflows |
| `501` | Capability not implemented | No | Retrying unchanged will not help |
| `502` | Invalid upstream response | Usually yes | Back off and retry if the operation is safe |
| `503` | Temporary overload or maintenance | Usually yes | Respect `Retry-After` when present |
| `504` | Upstream timeout | Usually yes | Safer when the request is idempotent or has an idempotency key |

## Common Design Boundaries

### 429 vs 503
- `429` means a specific caller is over the line.
- `503` means the service itself is temporarily unavailable.

### 500 vs 502 vs 504
- `500` means the failure is in your own request handling and you do not have a more precise code.
- `502` means an upstream answered badly.
- `504` means an upstream did not answer in time.

### 501 vs 405
- `501` means the method or capability is not implemented by the server.
- `405` means the server knows the method, but this resource does not allow it.

## Failures After The Status Line Is Sent

The status code is committed the moment the headers go out. If an SSE, chunked, or other streaming response fails mid-flight, the client still saw `200 OK` — you cannot retroactively change it to a `5xx`.

- Design the failure signal into the stream itself: a terminal error event for SSE, an error frame or trailer for other streaming formats, or an abrupt close the client treats as incomplete.
- Client guidance: treat an interrupted stream as a failed request regardless of the `200`, and retry or resume based on the protocol's own markers (e.g. SSE `Last-Event-ID`), not the status code.
- Only failures detected *before* the first byte of the response can use a real `5xx`; validate as much as possible before streaming begins.

## Less Common But Legitimate 5xx Codes

| Code | When it fits | Real-world example |
|---|---|---|
| `505 HTTP Version Not Supported` | The server does not support the HTTP version used by the request. | A backend only accepts modern HTTP versions and rejects an unsupported one. |
| `507 Insufficient Storage` | The server cannot store the representation needed to complete the request. | A storage-oriented system cannot persist an uploaded representation. |
| `511 Network Authentication Required` | The client needs network access authentication, such as a captive portal. | Airport or hotel Wi-Fi intercept page, not origin API auth. |

Codes such as `506`, `508`, and the historic `510` exist, but they belong in the appendix unless the task explicitly calls for them.
