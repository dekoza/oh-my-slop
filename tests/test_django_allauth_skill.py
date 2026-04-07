from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "django-allauth"


def _read_reference(name: str) -> str:
    return (SKILL_ROOT / "references" / name).read_text(encoding="utf-8")


def _heading_level(line: str) -> int:
    return len(line) - len(line.lstrip("#"))


def _section_body(markdown: str, heading: str) -> str:
    lines = markdown.splitlines()
    start = lines.index(heading)
    current_level = _heading_level(heading)
    body: list[str] = []

    for line in lines[start + 1 :]:
        if line.startswith("#") and _heading_level(line) <= current_level:
            break
        body.append(line)

    return "\n".join(body).strip()


def _bullet_lines(markdown: str) -> list[str]:
    return [line.strip() for line in markdown.splitlines() if line.startswith("- ")]


def _evals_by_id() -> dict[int, dict[str, object]]:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    assert payload["skill_name"] == "django-allauth"
    evals = payload["evals"]
    assert len(evals) == 8
    assert len({item["id"] for item in evals}) == len(evals)
    return {item["id"]: item for item in evals}


def test_django_allauth_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "django-allauth"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_django_allauth_skill_frontmatter_carries_version_basis() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "name: django-allauth" in skill_text
    assert "last_verified" in skill_text
    assert "source_basis" in skill_text
    assert (
        "docs/source snapshot" in skill_text
        or "official docs + source repository" in skill_text
    )


def test_django_allauth_skill_guardrails_cover_core_boundary_footguns() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "Verify installed allauth apps" in skill_text
    assert "socialaccount" in skill_text and "identity-provider" in skill_text
    assert "headless" in skill_text and "session" in skill_text
    assert (
        "extension point" in skill_text
        or "settings, adapters, forms, signals, templates" in skill_text
    )
    assert "provider-specific" in skill_text or "Do not guess provider" in skill_text
    assert "SocialApp" in skill_text
    assert "django.contrib.sites" in skill_text or "multi-site" in skill_text
    assert "version-notes.md" in skill_text
    assert "providers-index.md" in skill_text
    assert "settings, adapters, forms, signals, templates" in skill_text


def test_django_allauth_skill_routes_to_neighbor_skills_when_needed() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "`django`" in skill_text
    assert "`drf`" in skill_text
    assert "`http-status-codes`" in skill_text


def test_django_allauth_reference_index_covers_all_major_domains() -> None:
    index_text = (SKILL_ROOT / "references" / "REFERENCE.md").read_text(
        encoding="utf-8"
    )

    assert "installation-and-wiring.md" in index_text
    assert "account.md" in index_text
    assert "socialaccount-core.md" in index_text
    assert "providers-index.md" in index_text
    assert "providers-major.md" in index_text
    assert "mfa.md" in index_text
    assert "usersessions.md" in index_text
    assert "headless.md" in index_text
    assert "idp-openid-connect.md" in index_text
    assert "common-customization.md" in index_text
    assert "testing-and-troubleshooting.md" in index_text
    assert "version-notes.md" in index_text


def test_django_allauth_reference_files_cover_core_topics() -> None:
    installation_text = _read_reference("installation-and-wiring.md")
    account_text = _read_reference("account.md")
    social_text = _read_reference("socialaccount-core.md")
    provider_index_text = _read_reference("providers-index.md")
    provider_major_text = _read_reference("providers-major.md")
    mfa_text = _read_reference("mfa.md")
    usersessions_text = _read_reference("usersessions.md")
    headless_text = _read_reference("headless.md")
    idp_text = _read_reference("idp-openid-connect.md")
    common_text = _read_reference("common-customization.md")
    testing_text = _read_reference("testing-and-troubleshooting.md")
    version_text = _read_reference("version-notes.md")

    assert "INSTALLED_APPS" in installation_text
    assert "SITE_ID" in installation_text or "django.contrib.sites" in installation_text
    assert "headless" in installation_text and "mfa" in installation_text
    assert "django.template.context_processors.request" in installation_text
    assert "allauth.account.auth_backends.AuthenticationBackend" in installation_text
    assert "allauth.account.middleware.AccountMiddleware" in installation_text
    assert "path('accounts/', include('allauth.urls'))" in installation_text
    assert "django.contrib.sessions.backends.signed_cookies" in installation_text

    assert "signup" in account_text.lower()
    assert "email" in account_text.lower()
    assert "adapter" in account_text.lower()
    assert "signal" in account_text.lower()
    assert "phone" in account_text.lower()
    assert "enumeration" in account_text.lower() or "rate limit" in account_text.lower()
    assert "ACCOUNT_SIGNUP_FORM_CLASS" in account_text
    assert "ACCOUNT_SIGNUP_FIELDS" in account_text
    assert "ACCOUNT_LOGIN_METHODS" in account_text
    assert "ACCOUNT_EMAIL_VERIFICATION" in account_text
    assert "ACCOUNT_PREVENT_ENUMERATION" in account_text
    assert "ACCOUNT_RATE_LIMITS" in account_text
    assert "authentication_step_completed" in account_text
    assert "email_confirmation_sent" in account_text
    assert "email_removed" in account_text

    assert "SocialApp" in social_text
    assert "provider" in social_text.lower()
    assert "connect" in social_text.lower() or "disconnect" in social_text.lower()
    assert "adapter" in social_text.lower()
    assert "signal" in social_text.lower()
    assert "SOCIALACCOUNT_ADAPTER" in social_text
    assert "SOCIALACCOUNT_PROVIDERS" in social_text
    assert "SOCIALACCOUNT_AUTO_SIGNUP" in social_text
    assert "SOCIALACCOUNT_EMAIL_AUTHENTICATION" in social_text
    assert "MultipleObjectsReturned" in social_text
    assert "pre_social_login" in social_text
    assert "social_account_removed" in social_text

    assert "OpenID Connect" in provider_index_text or "OIDC" in provider_index_text
    assert "SAML" in provider_index_text
    assert "Google" in provider_index_text
    assert "Apple" in provider_index_text
    assert "/accounts/<provider>/login/callback/" in provider_index_text
    assert "/accounts/oidc/{provider_id}/login/callback/" in provider_index_text
    assert "/accounts/saml/<organization_slug>/acs/" in provider_index_text
    assert "OAuth 2.0" in provider_index_text
    assert "OAuth 1.0a" in provider_index_text or "OAuth 1a" in provider_index_text
    assert "OpenID" in provider_index_text
    assert "Auth0" in provider_index_text
    assert "Keycloak" in provider_index_text
    assert "Okta" in provider_index_text
    assert "NetIQ" in provider_index_text or "Microfocus" in provider_index_text

    assert "Google" in provider_major_text
    assert "Apple" in provider_major_text
    assert "GitHub" in provider_major_text
    assert "Microsoft" in provider_major_text
    assert "OpenID Connect" in provider_major_text or "OIDC" in provider_major_text
    assert "SAML" in provider_major_text
    assert "Auth0" in provider_major_text or "Keycloak" in provider_major_text
    assert "OAUTH_PKCE_ENABLED" in provider_major_text
    assert "FETCH_USERINFO" in provider_major_text
    assert "access_type" in provider_major_text and "offline" in provider_major_text
    assert "certificate_key" in provider_major_text
    assert '"hidden": True' in provider_major_text or "hidden" in provider_major_text
    assert "GITHUB_URL" in provider_major_text
    assert "provider_id" in provider_major_text and "server_url" in provider_major_text
    assert "/accounts/oidc/{provider_id}/login/callback/" in provider_major_text
    assert "reject_idp_initiated_sso" in provider_major_text
    assert "attribute_mapping" in provider_major_text
    assert "/accounts/saml/<organization_slug>/acs/" in provider_major_text

    assert "WebAuthn" in mfa_text
    assert "adapter" in mfa_text.lower()
    assert "form" in mfa_text.lower()
    assert "allauth.mfa" in mfa_text
    assert "django-allauth-2fa" in mfa_text
    assert "get_totp_issuer" in mfa_text
    assert "generate_authenticator_name" in mfa_text

    assert "session" in usersessions_text.lower()
    assert "signal" in usersessions_text.lower()
    assert "adapter" in usersessions_text.lower()
    assert "django.contrib.humanize" in usersessions_text
    assert "allauth.usersessions" in usersessions_text
    assert "UserSessionsMiddleware" in usersessions_text
    assert "USERSESSIONS_TRACK_ACTIVITY" in usersessions_text
    assert "session_client_changed" in usersessions_text

    assert "CORS" in headless_text
    assert "JWT" in headless_text or "session token" in headless_text.lower()
    assert "token strategy" in headless_text.lower()
    assert "adapter" in headless_text.lower()
    assert "X-Session-Token" in headless_text
    assert "HEADLESS_ADAPTER" in headless_text
    assert "HEADLESS_FRONTEND_URLS" in headless_text
    assert "HEADLESS_ONLY" in headless_text
    assert "HEADLESS_TOKEN_STRATEGY" in headless_text
    assert "HEADLESS_JWT_ALGORITHM" in headless_text
    assert "HEADLESS_JWT_PRIVATE_KEY" in headless_text
    assert "HEADLESS_JWT_STATEFUL_VALIDATION_ENABLED" in headless_text
    assert "HEADLESS_JWT_ROTATE_REFRESH_TOKEN" in headless_text
    assert 'path("_allauth/", include("allauth.headless.urls"))' in headless_text
    assert (
        "not truly stateless" in headless_text.lower()
        or "stateless" in headless_text.lower()
    )

    assert "identity provider" in idp_text.lower() or "IdP" in idp_text
    assert "OpenID Connect" in idp_text or "OIDC" in idp_text
    assert "client" in idp_text.lower()
    assert "socialaccount" in idp_text
    assert "allauth.idp.oidc" in idp_text
    assert "IDP_OIDC_PRIVATE_KEY" in idp_text
    assert 'path("", include("allauth.idp.urls"))' in idp_text
    assert "/.well-known/openid-configuration" in idp_text
    assert "/identity/o/api/token" in idp_text
    assert "IDP_OIDC_ACCESS_TOKEN_EXPIRES_IN" in idp_text
    assert "IDP_OIDC_USERINFO_ENDPOINT" in idp_text

    assert "template" in common_text.lower()
    assert "message" in common_text.lower()
    assert "admin" in common_text.lower()
    assert "email" in common_text.lower()
    assert "allauth/layouts/base.html" in common_text
    assert "allauth/layouts/entrance.html" in common_text
    assert "allauth/layouts/manage.html" in common_text
    assert "send_mail" in common_text
    assert "429.html" in common_text
    assert "ALLAUTH_TRUSTED_PROXY_COUNT" in common_text
    assert "ALLAUTH_TRUSTED_CLIENT_IP_HEADER" in common_text
    assert "DummyCache" in common_text

    assert "callback" in testing_text.lower()
    assert "site" in testing_text.lower()
    assert (
        "email confirmation" in testing_text.lower()
        or "email verification" in testing_text.lower()
    )
    assert "headless" in testing_text.lower()
    assert "SocialApp" in testing_text
    assert "settings" in testing_text.lower()
    assert "SITE_ID" in testing_text or "django.contrib.sites" in testing_text
    assert "token strategy" in testing_text.lower()
    assert "signed_cookies" in testing_text

    assert "release" in version_text.lower()
    assert "headless" in version_text.lower()
    assert "mfa" in version_text.lower()
    assert "usersessions" in version_text.lower()
    assert "65.13.0" in version_text
    assert "65.14.0" in version_text
    assert "65.15.0" in version_text
    assert "IDP" in version_text or "identity provider" in version_text.lower()
    assert "rate limit" in version_text.lower()


def test_account_reference_has_explicit_sections_and_boundary_rules() -> None:
    account_text = _read_reference("account.md")

    assert [line for line in account_text.splitlines() if line.startswith("## ")] == [
        "## Primary Settings To Reach For First",
        "## Boundary Rules",
        "## High-Value Behaviors To Remember",
        "## Account Signals",
        "## Routing",
    ]
    assert _bullet_lines(
        _section_body(account_text, "## Primary Settings To Reach For First")
    ) == [
        "- `ACCOUNT_ADAPTER`",
        "- `ACCOUNT_FORMS`",
        "- `ACCOUNT_SIGNUP_FORM_CLASS`",
        "- `ACCOUNT_SIGNUP_FIELDS`",
        "- `ACCOUNT_LOGIN_METHODS`",
        "- `ACCOUNT_RATE_LIMITS`",
        "- `ACCOUNT_PREVENT_ENUMERATION`",
        "- `ACCOUNT_EMAIL_VERIFICATION`",
        "- `ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED`",
        "- `ACCOUNT_LOGIN_BY_CODE_ENABLED`",
        "- `ACCOUNT_PASSWORD_RESET_BY_CODE_ENABLED`",
        "- `ACCOUNT_REAUTHENTICATION_REQUIRED`",
        "- `ACCOUNT_SIGNUP_REDIRECT_URL`",
        "- `ACCOUNT_EMAIL_SUBJECT_PREFIX`",
    ]
    assert _bullet_lines(_section_body(account_text, "## Boundary Rules")) == [
        "- Prefer existing extension points before overriding built-in views.",
        "- For extra signup fields, start with `ACCOUNT_SIGNUP_FORM_CLASS` and, if needed, `ACCOUNT_ADAPTER`.",
        "- Keep email verification explicit. Signup customization is not separate from `ACCOUNT_EMAIL_VERIFICATION` or `ACCOUNT_EMAIL_VERIFICATION_BY_CODE_*` behavior.",
        "- `ACCOUNT_LOGIN_METHODS` should align with `ACCOUNT_SIGNUP_FIELDS`; the docs call misalignment a configuration smell.",
        '- Enumeration prevention is nuanced. With optional or disabled verification, `ACCOUNT_PREVENT_ENUMERATION = True` still leaks uniqueness; only `"strict"` allows duplicate unverified addresses to avoid that leak.',
    ]
    assert _bullet_lines(_section_body(account_text, "## Routing")) == [
        "- Social provider login or account linking -> `references/socialaccount-core.md`",
        "- Shared templates/messages/email delivery/rate limits -> `references/common-customization.md`",
        "- Broken confirmation links or failing tests -> `references/testing-and-troubleshooting.md`",
    ]


def test_provider_index_enforces_family_routing_and_boundary_contrasts() -> None:
    provider_index_text = _read_reference("providers-index.md")

    assert [
        line for line in provider_index_text.splitlines() if line.startswith("## ")
    ] == [
        "## Shared Callback Pattern",
        "## Provider Families",
        "## Real Catalog Anchors",
        "## Routing Rules",
        "## Boundary Reminders",
    ]
    assert [
        line for line in provider_index_text.splitlines() if line.startswith("### ")
    ] == [
        "### OAuth 2.0",
        "### OAuth 1.0a",
        "### OpenID Connect",
        "### SAML",
        "### OpenID",
    ]
    assert _bullet_lines(
        _section_body(provider_index_text, "## Shared Callback Pattern")
    ) == [
        "- Standard provider callback URLs follow `/accounts/<provider>/login/callback/`.",
        "- The provider docs explicitly use examples such as `/accounts/twitter/login/callback/` and `/accounts/soundcloud/login/callback/`.",
        "- That generic pattern does not cover OpenID Connect or SAML.",
        "- OpenID Connect uses `/accounts/oidc/{provider_id}/login/callback/`.",
        "- SAML uses organization-scoped endpoints such as `/accounts/saml/<organization_slug>/acs/`.",
        "- If login breaks after redirect, verify callback host, `SITE_ID`, and `SocialApp` site assignment before assuming a provider-specific bug.",
    ]
    assert _bullet_lines(
        _section_body(provider_index_text, "## Real Catalog Anchors")
    ) == [
        "- Google",
        "- Apple",
        "- GitHub",
        "- Microsoft",
        "- Auth0",
        "- Keycloak",
        "- Okta",
        "- NetIQ/Microfocus AccessManager",
        "- OpenID Connect",
        "- OpenID",
        "- SAML",
    ]
    assert _bullet_lines(_section_body(provider_index_text, "## Routing Rules")) == [
        "- Provider discovery or “is this documented by allauth?” -> stay here.",
        "- Mainstream OAuth provider setup -> `references/providers-major.md`.",
        "- Enterprise OIDC or multiple OIDC subproviders -> `references/providers-major.md`.",
        "- SAML organization or metadata questions -> `references/providers-major.md`.",
        "- If the task exceeds documented allauth integration points, say upstream provider docs are required instead of guessing.",
    ]
    assert _bullet_lines(
        _section_body(provider_index_text, "## Boundary Reminders")
    ) == [
        "- Many production failures are really `SocialApp`, settings-vs-database, `django.contrib.sites`, or callback URL alignment issues.",
        "- Do not confuse external-provider consumer login under `socialaccount` with django-allauth identity-provider mode under `allauth.idp`.",
    ]

    oauth2_body = _section_body(provider_index_text, "### OAuth 2.0")
    oidc_body = _section_body(provider_index_text, "### OpenID Connect")
    saml_body = _section_body(provider_index_text, "### SAML")
    openid_body = _section_body(provider_index_text, "### OpenID")

    assert "Google, Apple, GitHub, Microsoft, and many others" in oauth2_body
    assert "Auth0, Keycloak, Okta, NetIQ/Microfocus AccessManager" in oauth2_body
    assert (
        "Route Google, Apple, GitHub, Microsoft, OpenID Connect, and SAML to `references/providers-major.md`"
        in oauth2_body
    )
    assert "dedicated OpenID Connect provider" in oidc_body
    assert "not generic OAuth advice" in oidc_body
    assert "organization-scoped endpoints and metadata handling" in saml_body
    assert (
        "ACS, metadata, entity ID, attribute mapping, or HTTPS/reverse-proxy concerns"
        in saml_body
    )
    assert "Do not mix it with OpenID Connect." in openid_body


def test_headless_reference_has_explicit_installation_configuration_and_routing() -> (
    None
):
    headless_text = _read_reference("headless.md")

    assert [line for line in headless_text.splitlines() if line.startswith("## ")] == [
        "## Owning Surface",
        "## Installation And Wiring",
        "## Primary Settings To Reach For First",
        "## Token Strategies",
        "## CORS And API Boundaries",
        "## Routing",
    ]
    assert _bullet_lines(
        _section_body(headless_text, "## Installation And Wiring")
    ) == [
        '- Install the extra with `pip install "django-allauth[headless]"`.',
        "- Add `allauth.headless` to `INSTALLED_APPS`; keep `allauth`, `allauth.account`, and any optional `socialaccount`/`mfa`/`usersessions` apps aligned with the flows you actually expose.",
        '- Include `path("accounts/", include("allauth.urls"))` for provider handshakes and `path("_allauth/", include("allauth.headless.urls"))` for the API endpoints.',
        "- Configure `HEADLESS_FRONTEND_URLS` when confirmation, reset, signup, or provider-error links must land on your SPA/frontend instead of server-rendered `account` views.",
        "- `HEADLESS_ONLY = True` disables the normal account views while keeping third-party provider callback endpoints available through `allauth.urls`.",
    ]
    assert _bullet_lines(
        _section_body(headless_text, "## Primary Settings To Reach For First")
    ) == [
        "- `HEADLESS_ADAPTER`",
        "- `HEADLESS_CLIENTS`",
        "- `HEADLESS_FRONTEND_URLS`",
        "- `HEADLESS_ONLY`",
        "- `HEADLESS_SERVE_SPECIFICATION`",
        "- `HEADLESS_SPECIFICATION_TEMPLATE_NAME`",
        "- `HEADLESS_TOKEN_STRATEGY`",
        "- `HEADLESS_JWT_ALGORITHM`",
        "- `HEADLESS_JWT_PRIVATE_KEY`",
        "- `HEADLESS_JWT_ACCESS_TOKEN_EXPIRES_IN`",
        "- `HEADLESS_JWT_REFRESH_TOKEN_EXPIRES_IN`",
        "- `HEADLESS_JWT_AUTHORIZATION_HEADER_SCHEME`",
        "- `HEADLESS_JWT_STATEFUL_VALIDATION_ENABLED`",
        "- `HEADLESS_JWT_ROTATE_REFRESH_TOKEN`",
    ]
    assert _bullet_lines(_section_body(headless_text, "## Routing")) == [
        "- Server-rendered signup/login/email flows -> `references/account.md`",
        "- Provider callback or `SocialApp` handshake issues -> `references/socialaccount-core.md`",
        "- DRF architecture outside documented allauth headless support -> pair `drf`",
        "- Release-sensitive token strategy behavior -> `references/version-notes.md`",
    ]


def test_provider_index_calls_out_oidc_and_saml_callback_exceptions() -> None:
    provider_index_text = _read_reference("providers-index.md")

    shared_callback_body = _section_body(
        provider_index_text, "## Shared Callback Pattern"
    )

    assert (
        "That generic pattern does not cover OpenID Connect or SAML."
        in shared_callback_body
    )
    assert "/accounts/oidc/{provider_id}/login/callback/" in shared_callback_body
    assert "/accounts/saml/<organization_slug>/acs/" in shared_callback_body


def test_django_allauth_skill_evals_define_specific_boundary_scenarios() -> None:
    evals = _evals_by_id()

    assert set(evals) == {1, 2, 3, 4, 5, 6, 7, 8}

    eval_1 = evals[1]
    assert "company name" in eval_1["prompt"]
    assert "override the signup view, the form, or an adapter" in eval_1["prompt"]
    assert eval_1["expected_output"] == (
        "The response identifies `account` as the owning allauth surface, prefers the documented signup extension points over a custom view override, and keeps email verification behavior explicit."
    )
    assert eval_1["expectations"] == [
        "It identifies `account` as the owning allauth surface rather than a generic Django auth question.",
        "It prefers existing extension points such as settings, adapters, forms, signals, templates over overriding the built-in view without cause.",
        "It mentions `ACCOUNT_SIGNUP_FORM_CLASS` and/or `ACCOUNT_ADAPTER` as the likely extension point.",
        "It keeps `ACCOUNT_EMAIL_VERIFICATION` or email verification behavior explicit instead of ignoring it.",
    ]

    eval_2 = evals[2]
    assert "Google login works locally" in eval_2["prompt"]
    assert "SocialApp in admin" in eval_2["prompt"]
    assert "SITE_ID problem" in eval_2["prompt"]
    assert eval_2["expected_output"] == (
        "The response treats this as a `socialaccount` plus provider-configuration boundary problem, checks `SITE_ID`, callback URL alignment, and `SocialApp` assignment first, and avoids invented Google behavior."
    )
    assert eval_2["expectations"] == [
        "It identifies `socialaccount` as the owning allauth surface.",
        "It mentions `SocialApp` and the settings-vs-database configuration boundary.",
        "It mentions `SITE_ID` or `django.contrib.sites` as a likely boundary.",
        "It mentions callback URL alignment before speculative code changes.",
        "It does not guess provider-specific behavior beyond documented Google/allauth guidance.",
        "It does not confuse provider consumer login with allauth IdP mode.",
    ]

    eval_3 = evals[3]
    assert "enterprise SSO" in eval_3["prompt"]
    assert "identity provider itself" in eval_3["prompt"]
    assert eval_3["expected_output"] == (
        "The response cleanly distinguishes `socialaccount` consumer OIDC from allauth IdP mode and routes each case to the correct subsystem."
    )
    assert eval_3["expectations"] == [
        "It distinguishes external-provider login under `socialaccount` from identity-provider mode under `allauth.idp.oidc`.",
        "It identifies the owning allauth surface for each half of the question.",
        "It routes enterprise consumer login through OpenID Connect/socialaccount guidance.",
        "It routes 'allauth as provider' through the IdP reference instead of mixing the two.",
        "It does not answer in vague protocol-only terms divorced from allauth surfaces.",
    ]

    eval_4 = evals[4]
    assert "React SPA" in eval_4["prompt"]
    assert "headless JWT" in eval_4["prompt"]
    assert "X-Session-Token" in eval_4["prompt"]
    assert eval_4["expected_output"] == (
        "The response identifies `headless` as the owning allauth surface, distinguishes `X-Session-Token` session-token flows from JWT flows, mentions CORS, and does not collapse the answer into browser-session guidance."
    )
    assert eval_4["expectations"] == [
        "It identifies `headless` as the owning allauth surface.",
        "It mentions `X-Session-Token` as part of the documented session-token strategy.",
        "It mentions JWT settings or JWT-token strategy boundaries.",
        "It mentions CORS and does not treat this as ordinary server-rendered browser auth.",
        "It does not claim JWT is fully stateless without qualification.",
    ]

    eval_5 = evals[5]
    assert "MFA with WebAuthn" in eval_5["prompt"]
    assert "django-allauth-2fa" in eval_5["prompt"]
    assert eval_5["expected_output"] == (
        "The response routes to `allauth.mfa`, mentions WebAuthn, and treats `django-allauth-2fa` as migration context rather than the primary path."
    )
    assert eval_5["expectations"] == [
        "It identifies `mfa` as the owning allauth surface.",
        "It mentions WebAuthn explicitly.",
        "It mentions forms and/or adapter hooks such as `MFA_ADAPTER`.",
        "It keeps legacy `django-allauth-2fa` notes in migration context only.",
    ]

    eval_6 = evals[6]
    assert "revoke their active sessions" in eval_6["prompt"]
    assert "usersessions" in eval_6["prompt"]
    assert eval_6["expected_output"] == (
        "The response identifies `usersessions` as the owning allauth surface, explains that it must be installed explicitly, and mentions its configuration and signals."
    )
    assert eval_6["expectations"] == [
        "It identifies `usersessions` as the owning allauth surface.",
        "It mentions installation/configuration instead of pretending this is automatically present.",
        "It mentions `USERSESSIONS_TRACK_ACTIVITY` and/or `UserSessionsMiddleware` if activity tracking is discussed.",
        "It mentions `session_client_changed` and/or the usersessions adapter surface.",
    ]

    eval_7 = evals[7]
    assert "email confirmation and password reset links" in eval_7["prompt"]
    assert "callback host is wrong" in eval_7["prompt"]
    assert "provider callbacks break only in CI" in eval_7["prompt"]
    assert eval_7["expected_output"] == (
        "The response gives a configuration-boundary checklist centered on owning surface selection, `SITE_ID`, callback URLs, `SocialApp` placement, and email-link generation."
    )
    assert eval_7["expectations"] == [
        "It starts with the owning allauth surface instead of generic Django debugging.",
        "It mentions `SITE_ID` or `django.contrib.sites`.",
        "It mentions callback URL boundaries.",
        "It mentions `SocialApp` or settings-vs-database config placement.",
        "It mentions email confirmation or password-reset link generation explicitly.",
        "It does not make up provider behavior to explain failures.",
    ]

    eval_8 = evals[8]
    assert "blog post from 2024" in eval_8["prompt"]
    assert "installed version is much newer" in eval_8["prompt"]
    assert "release notes or current docs" in eval_8["prompt"]
    assert eval_8["expected_output"] == (
        "The response treats this as version-sensitive, points to release-note verification, and names the high-drift subsystems that changed recently."
    )
    assert eval_8["expectations"] == [
        "It tells the reader to verify release notes or current docs before trusting older guidance.",
        "It mentions recent drift areas such as headless, MFA, usersessions, IdP, or rate-limit proxy handling.",
        "It mentions version-sensitive settings or recent releases instead of presenting stale behavior as authoritative.",
    ]
