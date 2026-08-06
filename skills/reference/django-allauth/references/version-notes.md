# Django-Allauth Version Notes

Use this file when the answer may depend on recent allauth releases or when older blog-post advice conflicts with current docs or source.

## Baseline

- Verified against the latest docs/source snapshot on 2026-04-07.
- Do not trust pre-2025 blog posts for `headless`, `idp`, modern login methods, or recent MFA/provider changes without checking current docs.

## Recent Drift Areas

- `65.4.0` / `65.4.1`: `ACCOUNT_LOGIN_METHODS` replaced the old authentication-method setting; headless spec serving and `HEADLESS_CLIENTS` were added.
- `65.5.0`: `ACCOUNT_SIGNUP_FIELDS`, password reset by code, phone auth, and several headless signup/provider behaviors changed.
- `65.6.0`: MFA gained “Trust this browser?”.
- `65.7.0`: headless exposed provider OpenID configuration and fixed multi-login-method issues.
- `65.8.0` / `65.8.1`: email verification resend/change support, fido2 compatibility, and login rate-limit fixes changed behavior.
- `65.9.0`: IdP support landed under `allauth.idp`.
- `65.10.0`: `authentication_step_completed` was added; MFA and headless dataclass hooks changed.
- `65.11.0` / `65.11.2`: OIDC changed around `fetch_userinfo=False`, key lookup, and stored payload shape.
- `65.12.0` / `65.12.1`: IdP wildcard redirect support landed, and email-change security fixes matter if `ACCOUNT_CHANGE_EMAIL = True`.
- `65.13.0` / `65.13.1`: headless JWT token strategy arrived, headless now requires its extra, IdP RP-initiated logout changed, and Okta/NetIQ UID handling moved to `sub`.
- `65.14.0` / `65.14.2`: headless JWT algorithm became configurable, IdP JWT access tokens and `IDP_OIDC_USERINFO_ENDPOINT` were added, OIDC `uid_field` was added, and proxy-aware rate-limit guidance changed materially.
- `65.15.0` / `65.15.1`: user-input code formats changed to dashed defaults, login-code resend was added, and MFA WebAuthn entrance fixes landed.

## Guardrail

- If the answer touches headless, IdP, OIDC UID selection, MFA/WebAuthn, usersessions, or rate limits, verify release notes before asserting behavior as stable.
