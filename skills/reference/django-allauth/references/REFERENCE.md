---
domain: reference-index
category: documentation
priority: high
scope: django-allauth
target_versions: "django-allauth latest docs/source snapshot verified on 2026-04-07"
last_verified: 2026-04-07
source_basis: official docs + source repository
---

# Django-Allauth Reference Index

Use this index to pick the smallest reference file that matches the task. Start with one file. Add a second only when neighboring subsystem boundaries, provider specifics, or release drift materially change the answer.

## Route Elsewhere

- Core Django framework behavior outside allauth extension points -> pair `django`
- Broad DRF API architecture unrelated to `allauth.headless` -> pair `drf`
- Pure status-code semantics -> pair `http-status-codes`

## Reference Guides

| Domain | File | Use For |
|---|---|---|
| Setup | `references/installation-and-wiring.md` | Context processor, auth backends, middleware, URLs, sites, enabled apps |
| Regular accounts | `references/account.md` | Signup/login/email/password/phone flows, account settings, account signals |
| Social login | `references/socialaccount-core.md` | `SocialApp`, settings-vs-database config, connect/disconnect, social signals |
| Provider catalog | `references/providers-index.md` | Provider-family routing, callback pattern, full documented catalog |
| Major providers | `references/providers-major.md` | Google, Apple, GitHub, Microsoft, OpenID Connect, SAML |
| MFA | `references/mfa.md` | `allauth.mfa`, forms, adapters, WebAuthn, upgrade notes |
| User sessions | `references/usersessions.md` | `allauth.usersessions`, tracking, signals, adapter boundaries |
| Headless | `references/headless.md` | API surface, CORS, `X-Session-Token`, JWT strategy |
| Identity provider | `references/idp-openid-connect.md` | `allauth.idp.oidc`, OIDC endpoints, client settings |
| Shared customization | `references/common-customization.md` | Templates, messages, admin, email sending, rate limits |
| Testing and troubleshooting | `references/testing-and-troubleshooting.md` | Tests, callback failures, site/provider diagnosis |
| Version notes | `references/version-notes.md` | Release-sensitive behavior and recent drift areas |

## Common Task Routing

1. Identify the owning allauth surface.
2. Open one primary file.
3. Add a second file only when provider details, `SocialApp` / `SITE_ID` boundaries, or recent release changes change the answer.

- Setup or first install -> `installation-and-wiring.md`
- Signup/login/email/password/phone -> `account.md`
- Social login architecture or provider config placement -> `socialaccount-core.md`
- Provider discovery or provider-family routing -> `providers-index.md`
- Google/Apple/GitHub/Microsoft/OIDC/SAML -> `providers-major.md`
- MFA/WebAuthn -> `mfa.md`
- Session tracking or revocation -> `usersessions.md`
- SPA/mobile/API auth -> `headless.md`
- OIDC provider mode -> `idp-openid-connect.md`
- Shared customization -> `common-customization.md`
- Failures and diagnosis -> `testing-and-troubleshooting.md`
- Release-sensitive questions -> `version-notes.md`
