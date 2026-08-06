# Django-Allauth Provider Index

Use this file to route provider questions across the documented provider catalog by protocol family. This is a routing aid, not a place to invent undocumented provider behavior.

## Shared Callback Pattern

- Standard provider callback URLs follow `/accounts/<provider>/login/callback/`.
- The provider docs explicitly use examples such as `/accounts/twitter/login/callback/` and `/accounts/soundcloud/login/callback/`.
- That generic pattern does not cover OpenID Connect or SAML.
- OpenID Connect uses `/accounts/oidc/{provider_id}/login/callback/`.
- SAML uses organization-scoped endpoints such as `/accounts/saml/<organization_slug>/acs/`.
- If login breaks after redirect, verify callback host, `SITE_ID`, and `SocialApp` site assignment before assuming a provider-specific bug.

## Provider Families

### OAuth 2.0

- The largest family in the catalog.
- Includes mainstream providers such as Google, Apple, GitHub, Microsoft, and many others.
- Also includes enterprise-ish entries such as Auth0, Keycloak, Okta, NetIQ/Microfocus AccessManager, Authelia, Amazon Cognito, NextCloud, and Mailcow.
- Route Google, Apple, GitHub, Microsoft, OpenID Connect, and SAML to `references/providers-major.md` because they have higher-cost boundary mistakes.

### OAuth 1.0a

- The catalog includes OAuth 1.0a providers such as Discogs and X/Twitter (OAuth 1).
- Do not reuse OAuth 2.0 assumptions for callback flow or token handling.

### OpenID Connect

- allauth has a dedicated OpenID Connect provider that can host multiple subproviders.
- Enterprise setups that are effectively OIDC, such as Auth0, Keycloak, Okta, or NetIQ, should still be answered with provider-specific or OIDC-aware guidance, not generic OAuth advice.

### SAML

- SAML is its own provider family with organization-scoped endpoints and metadata handling.
- Route SAML questions to `references/providers-major.md` when ACS, metadata, entity ID, attribute mapping, or HTTPS/reverse-proxy concerns are involved.

### OpenID

- Legacy OpenID remains in the catalog as a separate documented provider.
- Do not mix it with OpenID Connect.

## Real Catalog Anchors

- Google
- Apple
- GitHub
- Microsoft
- Auth0
- Keycloak
- Okta
- NetIQ/Microfocus AccessManager
- OpenID Connect
- OpenID
- SAML

## Routing Rules

- Provider discovery or “is this documented by allauth?” -> stay here.
- Mainstream OAuth provider setup -> `references/providers-major.md`.
- Enterprise OIDC or multiple OIDC subproviders -> `references/providers-major.md`.
- SAML organization or metadata questions -> `references/providers-major.md`.
- If the task exceeds documented allauth integration points, say upstream provider docs are required instead of guessing.

## Boundary Reminders

- Many production failures are really `SocialApp`, settings-vs-database, `django.contrib.sites`, or callback URL alignment issues.
- Do not confuse external-provider consumer login under `socialaccount` with django-allauth identity-provider mode under `allauth.idp`.
