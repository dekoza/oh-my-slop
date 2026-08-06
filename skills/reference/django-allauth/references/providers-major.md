# Django-Allauth Major Providers

Use this file for providers and protocols where configuration mistakes are common and expensive.

## Google

- Provider app: `allauth.socialaccount.providers.google`.
- Callback: `/accounts/google/login/callback/`.
- Supported settings include `SCOPE`, `AUTH_PARAMS`, `OAUTH_PKCE_ENABLED`, and `FETCH_USERINFO`.
- To receive a refresh token, set `AUTH_PARAMS['access_type'] = 'offline'`.
- If avatars or other profile data are missing, `FETCH_USERINFO` may be relevant because allauth otherwise relies mainly on the ID token payload.

## Apple

- Uses `SOCIALACCOUNT_PROVIDERS['apple']['APPS']`.
- `client_id` is the Apple service identifier.
- `secret` is the Apple key ID.
- `key` is the member ID / app ID prefix.
- Per-app `settings.certificate_key` holds the downloaded private key.
- If you support both Services ID and Bundle ID, add multiple app entries; the Bundle ID entry may need `"hidden": True` so it does not appear on the web.
- Apple login uses a cross-origin POST. Session/cookie issues can surface as `PermissionDenied` if middleware creates a new session on that POST.

## GitHub

- Callback: `/accounts/github/login/callback/`.
- Optional `SCOPE` is documented.
- Enterprise GitHub uses `GITHUB_URL`; do not assume github.com defaults apply.

## Microsoft

- The Microsoft provider documents app-level settings such as `tenant`, `login_url`, and `graph_url`.
- Single-tenant apps may need `tenant = "organizations"` to avoid `AADSTS50194`.
- If the deployment is really an enterprise OIDC integration with its own issuer metadata, route through OpenID Connect configuration rather than forcing generic Microsoft assumptions.

## OpenID Connect

- Consumer login surface under `socialaccount`, not IdP mode.
- Uses `SOCIALACCOUNT_PROVIDERS['openid_connect']['APPS']`.
- Each app can define `provider_id`, `name`, `client_id`, `secret`, and `settings.server_url`.
- Documented optional settings include `fetch_userinfo`, `oauth_pkce_enabled`, `token_auth_method`, and `uid_field`.
- Callback format is `/accounts/oidc/{provider_id}/login/callback/`.
- Release notes matter here: `fetch_userinfo=False` behavior and `uid_field` support changed in recent releases.

## SAML

- Requires installing `django-allauth[saml]`.
- allauth models SAML by organization/app, typically one app per organization.
- `client_id` is the organization slug used in endpoints such as `/accounts/saml/<organization_slug>/login/`.
- `provider_id` is the provider identifier used on `SocialAccount.provider`; the IdP entity ID is a suitable choice.
- `settings.attribute_mapping` controls `uid`, `email`, and related attribute extraction.
- Other documented settings include `use_nameid_for_email`, `idp`, `sp`, `advanced`, and `contact_person`.
- Core endpoints include `/accounts/saml/<organization_slug>/login/`, `/accounts/saml/<organization_slug>/acs/`, `/accounts/saml/<organization_slug>/sls/`, and `/accounts/saml/<organization_slug>/metadata/`.
- `reject_idp_initiated_sso` defaults to `True`; the docs frame IdP-initiated SSO as a security-sensitive override.
- HTTPS, reverse-proxy headers, secure cookies, and tools like SAML Tracer are part of the official troubleshooting guidance.

## Enterprise OIDC Boundary

- Auth0, Keycloak, Okta, and NetIQ often behave like enterprise OIDC setups.
- Treat them as consumer login under `socialaccount`, not as allauth IdP mode.
- Release notes matter: Okta and NetIQ switched from mutable `preferred_username` to `sub`, and `uid_field` was later added for controlled overrides.

## Escalation Rules

- If the real problem is callback registration, `SITE_ID`, or `SocialApp` placement, pair this file with `references/socialaccount-core.md` or `references/installation-and-wiring.md`.
- If django-allauth is acting as the provider, route to `references/idp-openid-connect.md`.
