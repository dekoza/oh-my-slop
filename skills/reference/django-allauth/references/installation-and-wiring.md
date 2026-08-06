# Django-Allauth Installation And Wiring

Start here when the task is about first install, app enablement, URL wiring, site configuration, or deciding which allauth subpackages are actually present.

## Core Wiring From Quickstart

- Add `django.template.context_processors.request` to template context processors.
- Include both auth backends: `django.contrib.auth.backends.ModelBackend` and `allauth.account.auth_backends.AuthenticationBackend`.
- Add `allauth.account.middleware.AccountMiddleware` to `MIDDLEWARE`.
- Include `path('accounts/', include('allauth.urls'))` in the project URLconf.
- Install `allauth.socialaccount` only if social login is needed, and install each provider app explicitly, such as `allauth.socialaccount.providers.google`.

## Installed-App Boundaries

- Base regular-account setup is `allauth` plus `allauth.account`.
- Social login requires `allauth.socialaccount` and one or more provider apps.
- MFA requires `allauth.mfa`.
- Session management requires `allauth.usersessions`.
- API/headless auth requires `allauth.headless`.
- OIDC identity-provider mode requires `allauth.idp.oidc` and `path("", include("allauth.idp.urls"))`.

## Site And Provider Configuration Boundaries

- Treat `django.contrib.sites` and `SITE_ID` as real configuration boundaries when provider callbacks, email links, or domain-aware behavior are involved.
- Provider credentials can live in settings under `SOCIALACCOUNT_PROVIDERS` or in database-backed `SocialApp` records.
- Do not configure the same provider both in settings and in `SocialApp`; the docs warn this can raise `MultipleObjectsReturned`.
- `SocialApp` supports `django.contrib.sites`, which matters for multi-site and multi-domain deployments.

## Safety Notes

- Verify which allauth apps are present before discussing `mfa`, `usersessions`, `headless`, or `idp` flows.
- django-allauth is not designed to work with `SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"` because secrets such as verification codes are stored in the session.

## Minimal Verification Checklist

1. Confirm `INSTALLED_APPS` contains the exact allauth surfaces the task depends on.
2. Confirm the request context processor, authentication backends, and `AccountMiddleware` are wired.
3. Confirm the project includes allauth URLs at `accounts/` or the documented IdP root include.
4. Confirm `SITE_ID` and site records when callbacks, email links, or domain-specific behavior are involved.
5. Confirm whether provider credentials live in settings or `SocialApp` records.
