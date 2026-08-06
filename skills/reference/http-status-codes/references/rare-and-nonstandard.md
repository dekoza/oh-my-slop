# Less Common, Deprecated, And Nonstandard Status Codes

Use this file only when the task explicitly mentions obscure codes, WebDAV-heavy behavior, or vendor-specific responses from logs or third-party docs. Keep these out of ordinary public API guidance unless the exact condition really exists.

## Less Common But Registered Standard Codes

| Code | Where it matters | Real-world example | Why it is usually not your first choice |
|---|---|---|---|
| `100 Continue` | Large uploads with `Expect: 100-continue` | A client waits for header validation before streaming a huge request body | Most CRUD API work never touches it directly |
| `101 Switching Protocols` | Protocol upgrades | Switching from HTTP to WebSocket | Transport-level, not ordinary REST semantics |
| `103 Early Hints` | Performance preload hints before the final response | A web page hints static assets early | Useful for web performance, not normal API status selection |
| `203 Non-Authoritative Information` | Transforming proxies that changed the origin response | A proxy modifies metadata from the origin | Rare outside specialized proxy setups |
| `205 Reset Content` | User agents should reset the current document view | A browser-oriented form workflow wants the UI reset after success | Rare in API contracts |
| `300 Multiple Choices` | Agent-driven content negotiation | Multiple possible representations or targets | Most APIs choose one representation directly |
| `407 Proxy Authentication Required` | Proxy authentication challenge | Corporate proxy requires auth before forwarding traffic | Infrastructure-facing, not origin API auth |
| `411 Length Required` | The server insists on `Content-Length` | A server rejects a body without a declared length | Specific protocol edge case |
| `413 Content Too Large` | The request body exceeds the allowed size | Uploading a 4 GB file to an endpoint capped at 100 MB | Precise, but less common than the core CRUD errors |
| `414 URI Too Long` | The URI itself is too long | A huge filter blob is crammed into the query string | Usually a sign the request design should move to a body |
| `416 Range Not Satisfiable` | The requested byte range is invalid | A client asks past the end of a file | Only matters when range requests are in play |
| `417 Expectation Failed` | The server cannot satisfy the `Expect` header | `Expect: 100-continue` is not supported | Transport edge case |
| `207 Multi-Status` | WebDAV batch operations whose sub-operations can succeed or fail independently | A `PROPPATCH` or batch copy returns a `multistatus` XML body with one status per resource | WebDAV-specific; for plain JSON APIs a `200` with per-item results in the body is clearer than borrowing `207` |
| `423 Locked` / `424 Failed Dependency` | WebDAV-specific resource locking and dependent failures | Editing a locked document collection | Rare outside WebDAV-like systems |
| `426 Upgrade Required` | The client must switch protocols before retrying | A service refuses plain HTTP for an endpoint that requires a different protocol | Specialized protocol-management scenario |
| `507 Insufficient Storage` / `508 Loop Detected` | WebDAV-heavy storage and graph traversal failures | Storage system cannot persist representation or hits a loop | Rare in mainstream API design |
| `511 Network Authentication Required` | Network access auth like captive portals | Hotel Wi-Fi intercepts requests until sign-in | Not a normal origin API error |
| `104 Upload Resumption Supported` | Temporary IANA registration tied to the resumable upload draft | Draft-driven resumable upload support | Temporary and draft-specific; do not treat as a stable general-purpose choice |

## Deprecated, Historic, Or Avoid

- `102 Processing` - legacy WebDAV behavior; MDN marks it deprecated and it is rarely a good new design choice.
- `305 Use Proxy` - deprecated.
- `306` - unused.
- `418` - famous joke status, but the IANA registry marks it unused. Do not use it for serious public APIs.
- `510 Not Extended` - obsoleted and effectively historic.

## Vendor And Private Codes: Warning Appendix

These are useful for interpreting logs from a particular product, but they are not a good palette for public API design.

| Example code | Source | Meaning in practice | Guidance |
|---|---|---|---|
| `419` | Laravel | CSRF or session-expired style page failure | Framework-private, not portable HTTP semantics |
| `440`, `449` | IIS | Login timeout or retry-with style product codes | Product-specific |
| `499` | nginx | Client closed the request before the server answered | Good to know in logs, not a public contract code |
| `520`-`527`, `530` | Cloudflare | Various origin/CDN failure modes | CDN-specific diagnostics |
| `561` | AWS Elastic Load Balancing | Load balancer auth error | Infrastructure-specific |
| `598`, `599` | Proxy conventions | Network read/connect timeout behind a proxy | Nonstandard conventions |

Two practical warnings:
- Do not expose vendor/private codes as the main contract of a public API unless both sides are tightly controlled and thoroughly documented.
- Even a standard code can be used with private semantics. MDN notes that Google Drive uses `308 Resume Incomplete` in a non-standard product-specific way. Read the product docs before extrapolating from a private use of a familiar code.

## Default Rule

If the task does not explicitly require one of these rare or private codes, stay in the core set covered by the other reference files.
