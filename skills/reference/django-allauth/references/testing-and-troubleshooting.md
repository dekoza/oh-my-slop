# Django-Allauth Testing And Troubleshooting

Use this file when tests fail, callbacks misroute, email confirmations break, provider setup behaves differently by environment, or the owning allauth subsystem is unclear.

## Start With Configuration Boundaries

1. Identify the owning allauth surface: `account`, `socialaccount`, providers, `mfa`, `usersessions`, `headless`, or `idp`.
2. Verify enabled apps and URL wiring.
3. Verify `SITE_ID`, site records, callback host/domain, and whether the project uses `django.contrib.sites`.
4. Verify whether provider config lives in settings or in `SocialApp`, and ensure it is not duplicated in both places.
5. Verify email confirmation and password-reset link generation against the active site/domain.
6. For `headless`, verify CORS plus the selected token strategy, including `X-Session-Token` versus JWT expectations.
7. If sessions are configured as `signed_cookies`, stop and correct that first because allauth stores secrets in the session.

## Common Failure Patterns

- Callback mismatch after redirect: usually provider console registration, active site, or `SocialApp` site assignment.
- Links pointing at localhost in CI or production: usually `SITE_ID` / site-record drift.
- Provider working locally but not in production: often settings-vs-`SocialApp` drift or multi-site assignment.
- Email confirmation tests unexpectedly not sending a second message: rate limits can interfere with repeated flows.
- API auth confusion: browser session behavior and headless `X-Session-Token` / JWT behavior are different systems.

## Rules

- Start with documented configuration boundaries, not speculative code fixes.
- Do not make up provider behavior to explain a failure.
- When the failure sounds release-sensitive, route to `references/version-notes.md`.
