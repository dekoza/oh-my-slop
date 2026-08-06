# Django-Allauth Regular Accounts

Use this file for signup, login, logout, password reset, email verification, email management, phone support, decorators, forms, signals, adapters, and account-specific settings.

## Primary Settings To Reach For First

- `ACCOUNT_ADAPTER`
- `ACCOUNT_FORMS`
- `ACCOUNT_SIGNUP_FORM_CLASS`
- `ACCOUNT_SIGNUP_FIELDS`
- `ACCOUNT_LOGIN_METHODS`
- `ACCOUNT_RATE_LIMITS`
- `ACCOUNT_PREVENT_ENUMERATION`
- `ACCOUNT_EMAIL_VERIFICATION`
- `ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED`
- `ACCOUNT_LOGIN_BY_CODE_ENABLED`
- `ACCOUNT_PASSWORD_RESET_BY_CODE_ENABLED`
- `ACCOUNT_REAUTHENTICATION_REQUIRED`
- `ACCOUNT_SIGNUP_REDIRECT_URL`
- `ACCOUNT_EMAIL_SUBJECT_PREFIX`

## Boundary Rules

- Prefer existing extension points before overriding built-in views.
- For extra signup fields, start with `ACCOUNT_SIGNUP_FORM_CLASS` and, if needed, `ACCOUNT_ADAPTER`.
- Keep email verification explicit. Signup customization is not separate from `ACCOUNT_EMAIL_VERIFICATION` or `ACCOUNT_EMAIL_VERIFICATION_BY_CODE_*` behavior.
- `ACCOUNT_LOGIN_METHODS` should align with `ACCOUNT_SIGNUP_FIELDS`; the docs call misalignment a configuration smell.
- Enumeration prevention is nuanced. With optional or disabled verification, `ACCOUNT_PREVENT_ENUMERATION = True` still leaks uniqueness; only `"strict"` allows duplicate unverified addresses to avoid that leak.

## High-Value Behaviors To Remember

- `ACCOUNT_SIGNUP_FIELDS` now drives which signup fields are present and required, including `phone`.
- Login-by-code has its own settings such as `ACCOUNT_LOGIN_BY_CODE_REQUIRED`, `ACCOUNT_LOGIN_BY_CODE_TIMEOUT`, and `ACCOUNT_LOGIN_BY_CODE_SUPPORTS_RESEND`.
- Password reset can be link-based or code-based via `ACCOUNT_PASSWORD_RESET_BY_CODE_ENABLED` and related `*_FORMAT`, `*_MAX_ATTEMPTS`, and `*_TIMEOUT` settings.
- Email verification can also be code-based via `ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED` and related timeout/resend/change settings.
- `ACCOUNT_EMAIL_VERIFICATION = "mandatory"` requires `email*` to be present in `ACCOUNT_SIGNUP_FIELDS`.
- Email delivery can be customized via templates or by overriding adapter `send_mail`; see `references/common-customization.md`.

## Account Signals

- `authentication_step_completed`
- `user_logged_in`
- `user_logged_out`
- `user_signed_up`
- `password_set`
- `password_changed`
- `password_reset`
- `email_confirmed`
- `email_confirmation_sent`
- `email_changed`
- `email_added`
- `email_removed`

## Routing

- Social provider login or account linking -> `references/socialaccount-core.md`
- Shared templates/messages/email delivery/rate limits -> `references/common-customization.md`
- Broken confirmation links or failing tests -> `references/testing-and-troubleshooting.md`
