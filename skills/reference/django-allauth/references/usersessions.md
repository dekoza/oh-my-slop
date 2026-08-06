# Django-Allauth User Sessions

Use this file for `allauth.usersessions` installation, configuration, signals, adapters, session tracking, and session revocation/listing behavior.

## Installation And Enablement

- Add `'django.contrib.humanize'` and `'allauth.usersessions'` to `INSTALLED_APPS`.
- Add `allauth.usersessions.middleware.UserSessionsMiddleware` only when `USERSESSIONS_TRACK_ACTIVITY = True`.

## Primary Settings And Hooks

- `USERSESSIONS_ADAPTER`
- `USERSESSIONS_TRACK_ACTIVITY`
- Signal: `session_client_changed`

## Boundary Rules

- Do not pretend session listing or revocation exists unless `allauth.usersessions` is installed.
- Treat session revocation as a `usersessions` surface first, not generic middleware theory.
- Activity tracking has an explicit middleware dependency; if the middleware is absent, IP/user-agent changes are not tracked.

## What The Signal Means

- `session_client_changed(request, from_session, to_session)` fires when IP address or user agent changes during a tracked session.
- It only fires when `USERSESSIONS_TRACK_ACTIVITY` is enabled.

## Routing

- Core login/logout behavior -> `references/account.md`
- SPA/mobile/API token auth -> `references/headless.md`
- Release-sensitive session behavior -> `references/version-notes.md`
