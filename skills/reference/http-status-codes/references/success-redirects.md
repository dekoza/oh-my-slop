# Success And Redirect Responses

Use this file when the request succeeded, was accepted for later processing, or should move the client to another URL.

## 2xx Codes You Should Use Intentionally

### 200 OK

Use `200 OK` when the request succeeded and the response body carries the current representation or operation result.

Real-world examples:
- `GET /orders/ord_123` returns the order JSON.
- `POST /search` returns search results immediately in the response body.

Do not use `200` just because the operation worked somehow. If you created a resource, `201` is usually clearer. If there is no body, `204` may fit better.

### 201 Created

Use `201 Created` when the request created a new resource before the response is returned.

Good pattern:

```http
POST /customers HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "email": "ada@example.com",
  "name": "Ada Lovelace"
}
```

```http
HTTP/1.1 201 Created
Location: /customers/cst_923
Content-Type: application/json

{
  "id": "cst_923",
  "email": "ada@example.com",
  "name": "Ada Lovelace"
}
```

- The new resource should already exist when you send `201`.
- The new resource should be locatable either by the original request URI or by `Location`.
- Do not use `201` for work that has only been queued.

### 202 Accepted

Use `202 Accepted` when the server accepted the request but the work is not finished yet.

Real-world examples:
- `POST /exports` queues a CSV export job that will run asynchronously.
- `POST /videos/transcode` accepts a job that may take several minutes.

Good mental model: `202` says "I took responsibility for the request, not that the final business outcome already happened."

Do not use `202` for immediate creation, immediate payment capture, or any flow where the user would reasonably assume the result already exists.

### 204 No Content

Use `204 No Content` when the request succeeded and a response body would add no value.

Real-world examples:
- `DELETE /sessions/current` logs the user out.
- `POST /notifications/read-all` marks all notifications as read.
- `PATCH /preferences` updates a flag and the client already has the latest representation locally.

Do not send a JSON body with `204`.

### HEAD Requests

A `HEAD` request returns exactly the status code and headers the equivalent `GET` would return, with no body — do not invent a separate status scheme for it.

- `HEAD /reports/rep_1` returns `200` with `Content-Length` and caching headers if `GET` would return `200`, and `404` if `GET` would.
- Do not return `204` just because a `HEAD` response has no body; the empty body is inherent to `HEAD`, not a `204` signal.

### 206 Partial Content

Use `206 Partial Content` for range requests and resumable downloads.

Real-world examples:
- Resuming a multi-gigabyte backup download after a network interruption.
- Streaming only a byte range of a video file for seek support.

If the task is plain CRUD API design, `206` is usually not the code you need. It matters when the client asked for only part of a representation.

## Redirects And Cache-Aware Responses

### 301 vs 308: Permanent Moves

- Use `301 Moved Permanently` when the move is permanent and the traffic is effectively `GET` or `HEAD`, or when method rewriting is acceptable.
- Use `308 Permanent Redirect` when the move is permanent and the original method and body must stay unchanged.

Real-world examples:
- `301`: an old public docs URL permanently redirects to the new docs path.
- `308`: `PUT /v1/files/{id}` permanently moves to `/v2/files/{id}` and clients must keep the `PUT` body intact.

### 302 vs 307: Temporary Moves

- Use `302 Found` when the move is temporary and the traffic is effectively `GET` or `HEAD`, or when method rewriting is acceptable.
- Use `307 Temporary Redirect` when the move is temporary and the original method and body must stay unchanged.

Real-world examples:
- `302`: temporarily moving a browser-facing `GET /pricing` page.
- `307`: temporarily rerouting `POST /uploads` during maintenance of one upload cluster.

### 303 See Other

Use `303 See Other` when you want the client to make a `GET` request to a different resource after a non-`GET` action.

This is the cleanest code for POST-redirect-GET.

```http
POST /payments HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "invoice_id": "inv_123",
  "source": "tok_abc"
}
```

```http
HTTP/1.1 303 See Other
Location: /payments/pay_987
Content-Length: 0
```

Good uses:
- Return a confirmation resource after a successful form-style `POST`.
- Send the client to a job-status or receipt page.

### 304 Not Modified

Use `304 Not Modified` on conditional `GET` or `HEAD` requests when the client already has a fresh cached representation.

Real-world examples:
- A mobile app revalidates `GET /catalog` with `If-None-Match`.
- A browser revalidates a public JSON config file.

`304` means the client should keep using its cached body. The response does not resend the full representation.

### 300 Multiple Choices

`300 Multiple Choices` is registered, but it is rare in ordinary API design. Most APIs choose one representation directly instead of asking the client to arbitrate among multiple URLs.

## Common Patterns

### Creation vs enqueue
- Resource exists now -> `201`
- Work accepted, result later -> `202`

### Body vs no body
- Success plus useful response payload -> `200`
- Success with nothing worth returning -> `204`

### Redirect after POST
- Want the follow-up request to be `GET` -> `303`
- Want the follow-up request to preserve method/body -> `307` or `308`

### Redirect is the wrong tool
Do not use redirect codes when the system is down for maintenance or overloaded. That is usually `503 Service Unavailable`, not `302` to an error page.
