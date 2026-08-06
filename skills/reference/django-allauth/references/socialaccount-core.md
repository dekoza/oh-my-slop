# Django-Allauth Social Accounts Core

Use this file for third-party account architecture, `SocialApp`, provider configuration, linking/disconnecting flows, social forms, social signals, adapters, and advanced socialaccount usage.

## Primary Settings And Extension Points

- `SOCIALACCOUNT_ADAPTER`
- `SOCIALACCOUNT_AUTO_SIGNUP`
- `SOCIALACCOUNT_EMAIL_AUTHENTICATION`
- `SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT`
- `SOCIALACCOUNT_EMAIL_VERIFICATION`
- `SOCIALACCOUNT_FORMS`
- `SOCIALACCOUNT_LOGIN_ON_GET`
- `SOCIALACCOUNT_PROVIDERS`
- `SOCIALACCOUNT_STORE_TOKENS`
- `SOCIALACCOUNT_ONLY`
- `SOCIALACCOUNT_OPENID_CONNECT_URL_PREFIX`

## Provider Configuration Rules

- A provider app is configured either in settings or through a database-backed `SocialApp`.
- Do not configure the same provider both ways; the docs warn this can produce `MultipleObjectsReturned`.
- `SocialApp` supports `django.contrib.sites`, so multi-site failures are often really site-assignment failures.
- Callback URL alignment is a first-class failure boundary owned by allauth configuration, not generic OAuth folklore.

## Owning Surface Boundaries

- `socialaccount` is consumer mode: the user logs in with an external provider.
- This is not `allauth.idp`, where django-allauth acts as the identity-provider.
- Provider-specific scopes, claims, callback formats, or tenant rules belong in provider docs. Do not guess them from generic OAuth knowledge.

## Common Flows

- Login/signup via external provider
- Connect an additional provider account to an existing user
- Disconnect a provider account
- Auto-signup and email-authentication decisions after provider response

## Social Signals

- `pre_social_login`
- `social_account_added`
- `social_account_updated`
- `social_account_removed`

## Routing

- Full provider catalog -> `references/providers-index.md`
- Google, Apple, GitHub, Microsoft, OIDC, SAML -> `references/providers-major.md`
- OIDC provider mode -> `references/idp-openid-connect.md`
