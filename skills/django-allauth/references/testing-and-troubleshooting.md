# Django-Allauth Testing And Troubleshooting

Use this file when tests fail, callbacks misroute, email confirmations break, provider setup behaves differently by environment, or the owning allauth subsystem is unclear.

## Troubleshooting Checklist

1. Verify the owning subsystem first (`account`, `socialaccount`, `headless`, `idp`, `mfa`, or `usersessions`).
2. Verify enabled apps and URLs.
3. Verify site configuration and callback host/domain assumptions.
4. Verify whether provider config lives in `SocialApp` or settings.
5. Verify email confirmation and password-reset link generation boundaries.
6. For headless flows, verify CORS and token-strategy assumptions.

## Rules

- Start with configuration boundaries, not speculative code fixes.
- Do not make up provider behavior to explain a failure.
- When the failure sounds release-sensitive, route to `references/version-notes.md`.
