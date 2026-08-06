---
domain: Django Auth & Security
category: security
priority: critical
scope: django
target_versions: "Django 6.0, Python 3.12+"
last_verified: 2026-03-19
source_basis: official docs
---

# Django Auth & Security Reference

Generic Django 6.0 auth and security patterns. Keep these patterns framework-native, prefer built-in protections, and avoid stack-specific snippets.

### 1. HMAC Verification: Reconstruct Payload and Use Constant-Time Comparison

**Why**: If a signature lives inside the JSON body, hashing the raw body makes the signature verify itself. Comparing signatures with `==` also leaks timing information.

```python
import hashlib
import hmac
import json

def verify_signed_payload(request, secret):
    signature = request.headers.get("X-Signature")
    if not signature:
        return None
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return None
    unsigned_payload = payload.copy()
    unsigned_payload.pop("signature", None)
    serialized = json.dumps(unsigned_payload, sort_keys=True)
    computed = hmac.new(
        secret.encode("utf-8"),
        serialized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, computed):
        return None
    return payload
```

- Remove embedded signatures before hashing.
- Serialize deterministically.
- Always use `hmac.compare_digest()`.

**Warning**: Comparing signatures with `==` leaks timing information. `hmac.compare_digest()` performs constant-time comparison to prevent timing attacks.

### 2. Signed Cookies with Unsigned Fallback

**Why**: Migrating from unsigned to signed cookies can break active sessions. Fallback enables gradual user upgrades.

```python
from django.core.signing import BadSignature, Signer

def read_session_cookie(request, response):
    signer = Signer()
    raw_value = request.COOKIES.get("session_id")
    if not raw_value:
        return None
    try:
        return signer.unsign(raw_value)
    except BadSignature:
        response.set_cookie(
            "session_id",
            signer.sign(raw_value),
            httponly=True,
            secure=True,
            samesite="Lax",
        )
        return raw_value
```

- Verify signed first.
- Fall back only during migration.
- Re-sign immediately after fallback.

**Warning**: Fallback migration logic must be audited carefully. If the fallback path forgets to re-sign, users can skip signing permanently.

### 3. Cookie Security Flags

**Why**: Unprotected cookies expose sessions to XSS, insecure transport, and CSRF attacks.

```python
response.set_cookie(
    "session_id",
    session_id,
    httponly=True,
    secure=True,
    samesite="Lax",
    path="/",
    max_age=86400,
)
```

```python
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
```

- `HttpOnly` blocks JavaScript access (XSS protection).
- `Secure` requires HTTPS (encryption in transit).
- `SameSite` prevents cross-site request abuse.

**Warning**: Cookies without `HttpOnly` can be stolen via XSS; without `Secure` they are exposed on insecure transport. Both flags are mandatory.

### 4. CSRF Protection for State-Changing Requests

**Why**: State-changing requests (POST, PUT, PATCH, DELETE) need CSRF protection. Exemptions must be verified.

```html
<form method="post" action="/payments/confirm/">
  {% csrf_token %}
  <button type="submit">Confirm</button>
</form>
```

```python
from django.conf import settings
from django.http import HttpResponseForbidden, JsonResponse
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def webhook_receiver(request):
    payload = verify_signed_payload(request, settings.WEBHOOK_SECRET)
    if payload is None:
        return HttpResponseForbidden("Invalid signature")
    return JsonResponse({"status": "ok"})
```

```python
CSRF_TRUSTED_ORIGINS = ["https://trusted.example.com"]
```

- Use `{% csrf_token %}` in all state-changing forms.
- Prefer built-in `CsrfViewMiddleware` and `csrf_protect()`.
- If using `csrf_exempt`, add alternative verification (e.g., HMAC).

**Warning**: `csrf_exempt` without alternative verification leaves endpoints vulnerable. Webhooks must verify signatures.

### 5. Custom Authentication Backends

**Why**: Use backends for LDAP, SSO, tokens, or external identity instead of bypassing Django auth.

```python
from django.contrib.auth.backends import BaseBackend

class TokenBackend(BaseBackend):
    def authenticate(self, request, token=None):
        if token is None:
            return None
        return lookup_user_for_token(token)

    def get_user(self, user_id):
        return fetch_user_by_id(user_id)
```

```python
AUTHENTICATION_BACKENDS = [
    "myapp.auth.TokenBackend",
    "django.contrib.auth.backends.ModelBackend",
]
```

- Backend order matters (first match wins).
- `PermissionDenied` stops the chain (fast-fail).
- Django caches the successful backend in session.

**Warning**: `PermissionDenied` halts the chain. Use for immediate rejection when identity is invalid.

### 6. Choose the User Model Early

**Why**: Swapping `AUTH_USER_MODEL` after migrations is painful. Choose early.

```python
from django.contrib.auth.models import AbstractUser

class User(AbstractUser):
    pass
```

```python
AUTH_USER_MODEL = "accounts.User"
```

- `AbstractUser` for small extensions.
- `AbstractBaseUser` for custom identifier or auth shape.
- Set `AUTH_USER_MODEL` before first migration.

**Warning**: Swapping after migrations requires full data migration. Decide upfront.

### 7. Reference the Active User Model Correctly

**Why**: Hard-coding `User` breaks projects with a swapped user model.

```python
from django.conf import settings
from django.contrib.auth import get_user_model

User = get_user_model()

class AuditEntry(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
```

- `settings.AUTH_USER_MODEL` in model fields.
- `get_user_model()` in runtime code.
- One-to-one profile when default auth suffices.

**Warning**: Hard-coded `User` breaks swapped models. Always use dynamic reference.

### 8. Prefer Built-In Login Gates

**Why**: Manual auth checks scatter and break easily. Use decorators.

```python
from django.contrib.auth.decorators import login_required, permission_required

@login_required
@permission_required("billing.view_invoice", raise_exception=True)
def invoice_detail(request, invoice_id):
    invoice = Invoice.objects.get(pk=invoice_id)
    return render(request, "billing/invoice_detail.html", {"invoice": invoice})
```

```python
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.auth.middleware.LoginRequiredMiddleware",
]
```

- Use `@login_required`, `LoginRequiredMixin`, `@permission_required`.
- With `LoginRequiredMiddleware`, mark exceptions with `@login_not_required()`.
- Never protect the login view itself.

**Warning**: Protecting the login view with `@login_required` creates redirect loops. Keep `/accounts/login/` public.

### 9. Model, Group, and Custom Permissions

**Why**: Built-in model permissions + groups cover most use cases.

```python
class Task(models.Model):
    class Meta:
        permissions = [
            ("close_task", "Can close task"),
            ("change_task_status", "Can change task status"),
        ]
```

```python
user.has_perm("tasks.view_task")
user.has_perm("tasks.close_task")
```

- Auto-generated: `add`, `change`, `delete`, `view` permissions.
- Groups as roles (e.g., `Editors`, `Finance`).
- Assign via groups, not per-user.

**Warning**: `has_perm()` checks model-level only. Object-level control requires backend (pattern 10).

### 10. Object-Level Authorization Needs a Backend

**Why**: Django has object-permission hooks but no default implementation.

```python
from django.contrib.auth.backends import BaseBackend

class ProjectBackend(BaseBackend):
    def has_perm(self, user_obj, perm, obj=None):
        if perm == "projects.view_project" and obj is not None:
            return obj.members.filter(pk=user_obj.pk).exists()
        return False
```

- Implement a custom backend for instance rules.
- `ModelBackend` does not check object permissions.

**Warning**: `has_perm(..., obj=...)` requires custom backend. No default.

### 11. Password Validation Must Be Explicit

**Why**: Hashing alone doesn't prevent weak passwords. Validate explicitly.

```python
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]
```

- Use `validate_password()` in forms and APIs.
- Not auto-enforced by `create_user()`.
- Add custom validators for history, banned lists.

**Warning**: Defaults are weak. Configure `AUTH_PASSWORD_VALIDATORS` in settings.

### 12. Prefer Strong Hashers and Keep Legacy Hashers

**Why**: Keep old hashers to upgrade users from legacy hashes.

```python
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]
```

- First hasher: stores new passwords.
- Keep old hashers until migration complete.
- Use `set_password()`, never assign to `password` directly.

**Warning**: Removing old hashers locks out users with legacy hashes. Keep longer than expected.

### 13. SecurityMiddleware and HTTPS Settings

**Why**: Centralize transport security in settings and middleware.

```python
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
```

- `SecurityMiddleware` near top of `MIDDLEWARE`.
- Set `SECURE_PROXY_SSL_HEADER` behind proxies.
- Start HSTS with short value before increasing.

**Warning**: Unset `SECURE_PROXY_SSL_HEADER` with redirect causes infinite loops. Set correctly.

### 14. Clickjacking Protection

**Why**: Framing attacks trick users into hidden actions.

```python
MIDDLEWARE = [
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

X_FRAME_OPTIONS = "DENY"
```

- Default to `DENY` unless framing is required.
- Use `SAMEORIGIN` only for same-domain framing.
- Reinforce with CSP `frame-ancestors`.

**Warning**: `SAMEORIGIN` allows same-domain framing. Use `DENY` for maximum safety.

### 15. SQL Injection and XSS Prevention

**Why**: Django prevents both if you use safe APIs.

```python
Customer.objects.filter(email=email)

Customer.objects.raw(
    "SELECT * FROM customers WHERE email = %s",
    [email],
)
```

```python
from django.utils.safestring import mark_safe

message = mark_safe(user_supplied_html)  # dangerous
```

- Prefer ORM querysets over raw SQL.
- Pass raw SQL params separately.
- Keep template auto-escaping enabled.
- `mark_safe()` is an escape hatch, not default.

**Warning**: `mark_safe()` disables escaping. Never use on user data.

### 16. Django 6.0 CSP: Middleware, Overrides, and Nonces

**Why**: Django 6.0 adds first-party CSP. Restrict sources, test with report-only, use nonces.

```python
from django.utils.csp import CSP

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
]

SECURE_CSP = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF, CSP.NONCE],
    "style-src": [CSP.SELF],
    "img-src": [CSP.SELF, "data:"],
}

SECURE_CSP_REPORT_ONLY = {
    "default-src": [CSP.SELF],
    "report-uri": "/csp-reports/",
}
```

```python
from django.http import HttpResponse
from django.views.decorators.csp import csp_override, csp_report_only_override

@csp_override({"default-src": [CSP.SELF], "img-src": [CSP.SELF, "data:"]})
def dashboard(request):
    return HttpResponse("ok")

@csp_report_only_override(
    {"default-src": [CSP.SELF], "report-uri": "/csp-reports/"}
)
def report_preview(request):
    return HttpResponse("preview")
```

```python
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.csp",
            ],
        },
    }
]
```

```html
<script nonce="{{ csp_nonce }}">
  window.appBooted = true;
</script>
```

- `ContentSecurityPolicyMiddleware` new in 6.0.
- `SECURE_CSP` enforces; `SECURE_CSP_REPORT_ONLY` observes.
- Overrides replace base policy, not merge.
- `CSP.NONCE` only in `script-src`/`style-src`.
- Don't cache responses with nonces.

**Warning**: Nonce-based CSP needs fresh nonce per response. Cached nonces become stale.
