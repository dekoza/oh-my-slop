---
name: django-allauth
description: >
  Use when integrating, customizing, or debugging django-allauth: signup/login
  flows, email verification, password reset, social login and provider setup,
  MFA, user sessions, headless/API auth, or allauth acting as identity provider.
  Triggers on: "allauth", "SocialApp", "social login", "OAuth provider", "email
  verification", "MFA", "headless auth", "account adapter".
scope: django-allauth
target_versions: "django-allauth latest docs/source snapshot verified on 2026-04-07"
last_verified: 2026-04-07
source_basis: official docs + source repository
---

# Django-Allauth Reference

Use this skill for `django-allauth` integration, customization, and debugging. Identify the owning allauth surface first, then read only the matching reference file or files. Allauth's central customization concept is the **adapter** — nearly every behavior override belongs in an adapter subclass, not a view override.

## Customization Decision Procedure

Work down this ladder and stop at the first level that can express the behavior:

1. **Verify installed allauth apps** — Check `INSTALLED_APPS` before giving guidance: `socialaccount`, `mfa`, `usersessions`, `headless`, and `allauth.idp.oidc` are optional and often absent.
2. **Settings** — Look for an `ACCOUNT_*` / `SOCIALACCOUNT_*` / `MFA_*` / `HEADLESS_*` setting first; most behavior toggles live there.
3. **Adapters** — Subclass `DefaultAccountAdapter` / `DefaultSocialAccountAdapter` (and their mfa/headless counterparts) and override the relevant hook. This is where custom logic belongs by default.
4. **Forms** — Replace forms via `ACCOUNT_FORMS` / `SOCIALACCOUNT_FORMS` when the change is about fields or validation.
5. **Signals and templates** — Use signals for side effects, template overrides for presentation.
6. **`SocialApp` / sites configuration** — Put provider credentials and multi-site behavior in database-backed `SocialApp` or `django.contrib.sites` / `SITE_ID` setup, deciding deliberately which one owns it.
7. **Custom views — last resort** — Only when none of settings, adapters, forms, signals, templates, or `SocialApp` configuration covers the behavior.

Along the way:

- **Distinguish the three auth surfaces** — browser/session auth (`account`), token/API auth (`headless`, incl. `X-Session-Token` and JWT strategy boundaries), and identity-provider mode (`idp`). `socialaccount` is consumer login *with* external providers; `idp` is allauth being the provider itself.
- **Route provider specifics through the references** — Use `references/providers-index.md` and provider files instead of inventing callbacks, scopes, claims behavior, or console setup.
- **Check version sensitivity** — For headless, IdP, MFA, proxy-aware rate limits, and provider UID handling, consult `references/version-notes.md`; behavior in these areas changes across releases.

## When Not To Use This Skill

- Core Django behavior outside allauth extension points -> load `django` alongside
- Broad DRF API architecture unrelated to `allauth.headless` -> load `drf` alongside
- Pure response-code semantics -> load `http-status-codes`
- Generic OAuth/OIDC/SAML theory with no allauth integration work -> use upstream protocol docs

## Routing

| Use for | File |
|---------|------|
| Cross-file routing and reading order | `references/REFERENCE.md` |
| Setup, URLs, `INSTALLED_APPS`, sites, email prerequisites | `references/installation-and-wiring.md` |
| Signup/login/logout, password reset, email verification/management, phone, account adapters | `references/account.md` |
| Social login architecture, `SocialApp`, account linking, disconnecting, social adapters | `references/socialaccount-core.md` |
| Provider discovery, provider-family routing, callback patterns | `references/providers-index.md` |
| Google, Apple, GitHub, Microsoft, OIDC, SAML specifics | `references/providers-major.md` |
| MFA, TOTP/WebAuthn, reauthentication | `references/mfa.md` |
| Session tracking, listing, revocation | `references/usersessions.md` |
| SPA/mobile/API auth, CORS, JWT/session token strategy | `references/headless.md` |
| Acting as an OpenID Connect provider | `references/idp-openid-connect.md` |
| Shared templates/messages/admin/email/rate limits | `references/common-customization.md` |
| Broken tests, callbacks, sites, confirmation flows, runtime confusion | `references/testing-and-troubleshooting.md` |
| Release-sensitive behavior and recent changes | `references/version-notes.md` |

**Compound tasks cross surfaces** — combine references: e.g. "Google login on a headless project" -> `socialaccount-core.md` + `providers-major.md` + `headless.md`. Open one primary file first; add a second only when provider-specific behavior, `SocialApp`/sites boundaries, or release changes materially affect the answer.
