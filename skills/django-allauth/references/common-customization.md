# Django-Allauth Common Customization

Use this file for shared allauth customization surfaces that cut across subsystems.

## Owns

- Common configuration
- Email sending behavior
- Templates and messages
- Admin surfaces
- Shared rate-limit and cross-cutting configuration topics

## Boundary Rules

- Keep subsystem-specific behavior in the subsystem files.
- Use this file when the question spans multiple allauth apps or is clearly about a shared customization surface.
