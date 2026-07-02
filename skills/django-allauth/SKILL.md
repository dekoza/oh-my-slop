---
name: django-allauth
description: >
  django-allauth setup, signup/login/logout, email verification, password reset, account
  adapters, social login, OAuth/OIDC/SAML provider configuration, MFA, user sessions,
  headless/API authentication, or django-allauth identity-provider mode. Triggers on:
  "django-allauth", "allauth", "signup", "login", "logout", "email verification",
  "password reset", "account adapter", "social login", "OAuth", "OIDC", "SAML",
  "MFA", "user sessions", "headless authentication", "API authentication", "identity
  provider", "allauth settings", "SocialApp", "provider callbacks", "adapter hooks",
  or when building/debugging/reviewing django-allauth integration.
scope: django-allauth
target_versions: "django-allauth latest docs/source snapshot verified on 2026-04-07"
last_verified: 2026-04-07
source_basis: official docs + source repository
---

# Django-Allauth Reference

Use this skill for `django-allauth` integration, customization, and debugging. Identify the owning allauth surface first, then read only the matching reference file or files.

## Quick Start

1. Decide whether the task is about installation, `account`, `socialaccount`, providers, `mfa`, `usersessions`, `headless`, `idp`, shared customization, or troubleshooting.
2. Open one primary reference file first.
3. Add a second reference only when provider-specific behavior, `SocialApp` or `django.contrib.sites` boundaries, or recent release changes materially affect the answer.

## When Not To Use This Skill

- Core Django behavior outside allauth extension points -> pair `django`
- Broad DRF API architecture unrelated to `allauth.headless` -> pair `drf`
- Pure response-code semantics -> pair `http-status-codes`
- Generic OAuth/OIDC/SAML theory with no allauth integration work -> use upstream protocol docs

## Critical Rules

1. **Verify installed allauth apps before giving guidance** - Do not assume `socialaccount`, `mfa`, `usersessions`, `headless`, or `allauth.idp.oidc` are enabled just because a project uses allauth.
2. **Do not confuse consumer social login with identity-provider mode** - `socialaccount` handles logging in with external providers; `idp` handles django-allauth acting as the identity-provider.
3. **Do not confuse session/browser auth with headless token auth** - load `references/headless.md` for SPA/mobile/API authentication, including `X-Session-Token` and JWT strategy boundaries.
4. **Prefer the existing extension point** - Before suggesting view overrides, verify whether the behavior belongs in settings, adapters, forms, signals, templates, or `SocialApp` configuration. Default to settings, adapters, forms, signals, templates before custom views.
5. **Do not guess provider-specific requirements** - Route through `references/providers-index.md` and provider references instead of inventing callbacks, scopes, claims behavior, or console setup.
6. **Treat multi-site/provider configuration carefully** - Verify whether behavior belongs in settings, database-backed `SocialApp`, or `django.contrib.sites` / `SITE_ID` setup.
7. **Use version-aware guidance** - When behavior may have changed recently, check `references/version-notes.md`, especially for headless, IdP, MFA, proxy-aware rate limits, and provider UID handling.

## Reference Map

| File | Domain | Use For |
|------|--------|---------|
| `references/REFERENCE.md` | Index | Cross-file routing and reading order |
| `references/installation-and-wiring.md` | Setup | App wiring, URLs, sites, provider enablement |
| `references/account.md` | Regular accounts | Signup, login, email, password, phone, adapters |
| `references/socialaccount-core.md` | Social login | `SocialApp`, linking, disconnecting, adapters |
| `references/providers-index.md` | Provider catalog | Provider-family routing and callback patterns |
| `references/providers-major.md` | Deep providers | Google, Apple, GitHub, Microsoft, OIDC, SAML |
| `references/mfa.md` | MFA | TOTP/WebAuthn, forms, adapters |
| `references/usersessions.md` | Sessions | Session tracking, listing, revocation |
| `references/headless.md` | API/headless | API flows, CORS, token strategies |
| `references/idp-openid-connect.md` | Identity provider | OIDC IdP mode |
| `references/common-customization.md` | Shared config | Templates, messages, admin, email, rate limits |
| `references/testing-and-troubleshooting.md` | Diagnosis | Testing flows and configuration failures |
| `references/version-notes.md` | Release sensitivity | Recent changes and verification warnings |

## Task Routing

- Setup, URLs, `INSTALLED_APPS`, sites, email prerequisites -> `references/installation-and-wiring.md`
- Signup/login/logout/password reset/email verification/email management/phone -> `references/account.md`
- Social login architecture, account linking, disconnecting, generic provider setup -> `references/socialaccount-core.md`
- Provider discovery, provider-family routing, or callback pattern questions -> `references/providers-index.md`
- Google, Apple, GitHub, Microsoft, OIDC, or SAML questions -> `references/providers-major.md`
- MFA, WebAuthn, or reauthentication -> `references/mfa.md`
- Session tracking or session revocation -> `references/usersessions.md`
- SPA/mobile/API auth, CORS, JWT/session token strategy -> `references/headless.md`
- Acting as an OpenID Connect provider -> `references/idp-openid-connect.md`
- Shared templates/messages/admin/email/rate limits -> `references/common-customization.md`
- Broken tests, callbacks, sites, confirmation flows, or runtime confusion -> `references/testing-and-troubleshooting.md`
- Release-sensitive behavior or recent changes -> `references/version-notes.md`
