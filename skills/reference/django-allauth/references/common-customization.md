# Django-Allauth Common Customization

Use this file for shared allauth customization surfaces that cut across subsystems.

## Templates

- allauth intentionally ships plain templates.
- The docs support either copying all templates or overriding the shared layout and element templates.
- Key layout templates are `allauth/layouts/base.html`, `allauth/layouts/entrance.html`, and `allauth/layouts/manage.html`.
- Common element templates include provider and provider-list templates, panel, button, form, and field elements.

## Email

- Override templates such as `account/email/email_confirmation_subject.txt` and `account/email/email_confirmation_message.txt`.
- HTML email templates are optional; if you provide them, both text and HTML are sent.
- Fully custom sending belongs in adapter override `send_mail`.

## Messages And Admin

- allauth uses Django messages when `django.contrib.messages` is installed.
- If you want silence instead of flash messages, blank template overrides are the documented escape hatch.
- Admin-related tasks that are really account/social config usually still need the owning subsystem file.

## Rate Limits

- Rate limits are backed by the Django cache and will not work correctly with `DummyCache`.
- Rate-limit failures render `429.html` unless you provide `handler429`.
- Client IP handling is deployment-sensitive; `X-Forwarded-For` is distrusted by default in recent docs.
- Relevant settings are `ALLAUTH_TRUSTED_PROXY_COUNT` and `ALLAUTH_TRUSTED_CLIENT_IP_HEADER`, or a custom adapter `get_client_ip()`.
- The docs call out race conditions and unit-test pitfalls for rate-limited flows.

## Boundary Rule

- Keep subsystem-specific behavior in subsystem files; use this file when the question spans multiple allauth apps or is clearly about a shared customization surface.
