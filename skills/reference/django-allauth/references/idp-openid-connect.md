# Django-Allauth Identity Provider (OpenID Connect)

Use this file when django-allauth is acting as the OpenID Connect provider.

## Installation And Wiring

- Install the extra: `django-allauth[idp-oidc]`.
- Add `allauth.idp.oidc` to `INSTALLED_APPS`.
- Configure `IDP_OIDC_PRIVATE_KEY`.
- Include `path("", include("allauth.idp.urls"))` in project URLs.

## Core Endpoints

- `/.well-known/openid-configuration`
- `/.well-known/jwks.json`
- `/identity/o/authorize`
- `/identity/o/api/revoke`
- `/identity/o/api/userinfo`
- `/identity/o/api/token`

## Client And Settings Surface

- Clients are configured in Django admin.
- Important client fields include name, ID, secret, scopes, default scopes, grant types, CORS origins, redirect URIs, wildcard URI allowance, response types, skip consent, and public/confidential type.
- Important settings include `IDP_OIDC_ACCESS_TOKEN_EXPIRES_IN`, `IDP_OIDC_ACCESS_TOKEN_FORMAT`, `IDP_OIDC_ADAPTER`, `IDP_OIDC_AUTHORIZATION_CODE_EXPIRES_IN`, `IDP_OIDC_DEVICE_CODE_EXPIRES_IN`, `IDP_OIDC_DEVICE_CODE_INTERVAL`, `IDP_OIDC_ID_TOKEN_EXPIRES_IN`, `IDP_OIDC_USER_CODE_FORMAT`, `IDP_OIDC_PRIVATE_KEY`, `IDP_OIDC_RATE_LIMITS`, `IDP_OIDC_ROTATE_REFRESH_TOKEN`, `IDP_OIDC_RP_INITIATED_LOGOUT_ASKS_FOR_OP_LOGOUT`, and `IDP_OIDC_USERINFO_ENDPOINT`.

## Hard Boundary

- This is identity-provider mode.
- It is not the same thing as using an external OpenID Connect provider via `socialaccount`.
- If the user wants enterprise SSO against Auth0, Keycloak, Okta, or another external provider, route back to `references/providers-major.md` instead of answering in IdP terms.

## Release Awareness

- IdP support was introduced in 65.9.0 and changed rapidly in later releases.
- Verify release notes before asserting device grant, JWT access-token format, custom userinfo endpoint, or logout behavior.
