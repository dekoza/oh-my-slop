# Django-Allauth Headless

Use this file for `allauth.headless` installation, configuration, documented API surface, CORS, adapters, and token strategies.

## Owning Surface

- `allauth.headless` owns SPA, mobile, and API-first authentication guidance.
- Do not answer these questions with only server-rendered account-view advice.

## Installation And Wiring

- Install the extra with `pip install "django-allauth[headless]"`.
- Add `allauth.headless` to `INSTALLED_APPS`; keep `allauth`, `allauth.account`, and any optional `socialaccount`/`mfa`/`usersessions` apps aligned with the flows you actually expose.
- Include `path("accounts/", include("allauth.urls"))` for provider handshakes and `path("_allauth/", include("allauth.headless.urls"))` for the API endpoints.
- Configure `HEADLESS_FRONTEND_URLS` when confirmation, reset, signup, or provider-error links must land on your SPA/frontend instead of server-rendered `account` views.
- `HEADLESS_ONLY = True` disables the normal account views while keeping third-party provider callback endpoints available through `allauth.urls`.

## Primary Settings To Reach For First

- `HEADLESS_ADAPTER`
- `HEADLESS_CLIENTS`
- `HEADLESS_FRONTEND_URLS`
- `HEADLESS_ONLY`
- `HEADLESS_SERVE_SPECIFICATION`
- `HEADLESS_SPECIFICATION_TEMPLATE_NAME`
- `HEADLESS_TOKEN_STRATEGY`
- `HEADLESS_JWT_ALGORITHM`
- `HEADLESS_JWT_PRIVATE_KEY`
- `HEADLESS_JWT_ACCESS_TOKEN_EXPIRES_IN`
- `HEADLESS_JWT_REFRESH_TOKEN_EXPIRES_IN`
- `HEADLESS_JWT_AUTHORIZATION_HEADER_SCHEME`
- `HEADLESS_JWT_STATEFUL_VALIDATION_ENABLED`
- `HEADLESS_JWT_ROTATE_REFRESH_TOKEN`

## Token Strategies

### Session Tokens

- For non-browser contexts, allauth uses the `X-Session-Token` request header to track authentication state.
- The docs recommend reusing `X-Session-Token` for your own API as the simplest path if you do not need another strategy.
- Documented integrations exist for Django Ninja and Django REST framework.
- The default `HEADLESS_TOKEN_STRATEGY` is `allauth.headless.tokens.strategies.sessions.SessionTokenStrategy`.

### JWT Tokens

- The user still sends `X-Session-Token` until they become fully authenticated.
- Once fully authenticated, the response includes an access-token and refresh-token pair in `meta`.
- JWT handoff is configured via `HEADLESS_TOKEN_STRATEGY`, not by turning off session-token handling during the authentication handshake.
- Important settings include `HEADLESS_JWT_ALGORITHM`, `HEADLESS_JWT_PRIVATE_KEY`, `HEADLESS_JWT_ACCESS_TOKEN_EXPIRES_IN`, `HEADLESS_JWT_REFRESH_TOKEN_EXPIRES_IN`, `HEADLESS_JWT_AUTHORIZATION_HEADER_SCHEME`, `HEADLESS_JWT_STATEFUL_VALIDATION_ENABLED`, and `HEADLESS_JWT_ROTATE_REFRESH_TOKEN`.
- JWT is not truly stateless when you need logout to invalidate outstanding access tokens; the docs say state is still required in that case.

## CORS And API Boundaries

- Keep CORS explicit for SPA/mobile setups.
- `HEADLESS_ADAPTER` is the documented extension point when default headless behavior needs to change.
- Distinguish browser session auth from headless session-token auth.
- Distinguish session-token and JWT-token strategies explicitly.
- `HEADLESS_FRONTEND_URLS` only controls where allauth-generated frontend links point; it does not replace URL wiring or provider callback endpoints.
- `HEADLESS_ONLY` removes account views, but it does not remove the need for `path("accounts/", include("allauth.urls"))` when social login/provider callbacks are in play.
- Release notes matter here because `HEADLESS_CLIENTS`, spec serving, and JWT support changed recently.

## Routing

- Server-rendered signup/login/email flows -> `references/account.md`
- Provider callback or `SocialApp` handshake issues -> `references/socialaccount-core.md`
- DRF architecture outside documented allauth headless support -> pair `drf`
- Release-sensitive token strategy behavior -> `references/version-notes.md`
