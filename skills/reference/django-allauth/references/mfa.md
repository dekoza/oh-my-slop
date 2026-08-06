# Django-Allauth MFA

Use this file for `allauth.mfa` installation, configuration, forms, adapters, WebAuthn-related features, and upgrade notes from older add-ons.

## Owning Surface

- `allauth.mfa` is the current first-party MFA surface.
- It includes configuration, forms, adapter hooks, WebAuthn, and upgrade guidance from `django-allauth-2fa`.

## Adapter Hooks

- `MFA_ADAPTER`
- `DefaultMFAAdapter.is_mfa_enabled()`
- `DefaultMFAAdapter.get_totp_issuer()`
- `DefaultMFAAdapter.get_totp_label()`
- `DefaultMFAAdapter.generate_authenticator_name()`
- `DefaultMFAAdapter.encrypt()` / `decrypt()` for secret storage customization

## Boundary Rules

- Do not assume MFA is enabled in a project that only installed `allauth.account`.
- Treat WebAuthn as part of documented allauth MFA, not as a separate unofficial plugin concern.
- Keep `django-allauth-2fa` in migration context only; it is not the primary implementation path anymore.

## Practical Routing

- Enabling MFA or WebAuthn -> stay here.
- Reauthentication questions may also need `references/account.md` when account-level reauth settings are involved.
- Release-sensitive MFA or WebAuthn changes -> `references/version-notes.md`.
