from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "django-allauth"


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
    installation_text = (
        SKILL_ROOT / "references" / "installation-and-wiring.md"
    ).read_text(encoding="utf-8")
    account_text = (SKILL_ROOT / "references" / "account.md").read_text(
        encoding="utf-8"
    )
    social_text = (SKILL_ROOT / "references" / "socialaccount-core.md").read_text(
        encoding="utf-8"
    )
    provider_index_text = (SKILL_ROOT / "references" / "providers-index.md").read_text(
        encoding="utf-8"
    )
    provider_major_text = (SKILL_ROOT / "references" / "providers-major.md").read_text(
        encoding="utf-8"
    )
    mfa_text = (SKILL_ROOT / "references" / "mfa.md").read_text(encoding="utf-8")
    usersessions_text = (SKILL_ROOT / "references" / "usersessions.md").read_text(
        encoding="utf-8"
    )
    headless_text = (SKILL_ROOT / "references" / "headless.md").read_text(
        encoding="utf-8"
    )
    idp_text = (SKILL_ROOT / "references" / "idp-openid-connect.md").read_text(
        encoding="utf-8"
    )
    common_text = (SKILL_ROOT / "references" / "common-customization.md").read_text(
        encoding="utf-8"
    )
    testing_text = (
        SKILL_ROOT / "references" / "testing-and-troubleshooting.md"
    ).read_text(encoding="utf-8")
    version_text = (SKILL_ROOT / "references" / "version-notes.md").read_text(
        encoding="utf-8"
    )

    assert "INSTALLED_APPS" in installation_text
    assert "SITE_ID" in installation_text or "django.contrib.sites" in installation_text
    assert "headless" in installation_text and "mfa" in installation_text

    assert "signup" in account_text.lower()
    assert "email" in account_text.lower()
    assert "adapter" in account_text.lower()
    assert "signal" in account_text.lower()
    assert "phone" in account_text.lower()
    assert "enumeration" in account_text.lower() or "rate limit" in account_text.lower()

    assert "SocialApp" in social_text
    assert "provider" in social_text.lower()
    assert "connect" in social_text.lower() or "disconnect" in social_text.lower()
    assert "adapter" in social_text.lower()
    assert "signal" in social_text.lower()

    assert "OpenID Connect" in provider_index_text or "OIDC" in provider_index_text
    assert "SAML" in provider_index_text
    assert "Google" in provider_index_text
    assert "Apple" in provider_index_text

    assert "Google" in provider_major_text
    assert "Apple" in provider_major_text
    assert "GitHub" in provider_major_text
    assert "Microsoft" in provider_major_text
    assert "OpenID Connect" in provider_major_text or "OIDC" in provider_major_text
    assert "SAML" in provider_major_text
    assert "Auth0" in provider_major_text or "Keycloak" in provider_major_text

    assert "WebAuthn" in mfa_text
    assert "adapter" in mfa_text.lower()
    assert "form" in mfa_text.lower()

    assert "session" in usersessions_text.lower()
    assert "signal" in usersessions_text.lower()
    assert "adapter" in usersessions_text.lower()

    assert "CORS" in headless_text
    assert "JWT" in headless_text or "session token" in headless_text.lower()
    assert "token strategy" in headless_text.lower()
    assert "adapter" in headless_text.lower()

    assert "identity provider" in idp_text.lower() or "IdP" in idp_text
    assert "OpenID Connect" in idp_text or "OIDC" in idp_text
    assert "client" in idp_text.lower()
    assert "socialaccount" in idp_text

    assert "template" in common_text.lower()
    assert "message" in common_text.lower()
    assert "admin" in common_text.lower()
    assert "email" in common_text.lower()

    assert "callback" in testing_text.lower()
    assert "site" in testing_text.lower()
    assert (
        "email confirmation" in testing_text.lower()
        or "email verification" in testing_text.lower()
    )
    assert "headless" in testing_text.lower()

    assert "release" in version_text.lower()
    assert "headless" in version_text.lower()
    assert "mfa" in version_text.lower()
    assert "usersessions" in version_text.lower()


def test_django_allauth_skill_evals_cover_core_risk_areas() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "django-allauth"
    evals = payload["evals"]
    assert len(evals) >= 8
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = [item["prompt"] for item in evals]

    assert any(
        "adapter" in prompt.lower() and "signup" in prompt.lower() for prompt in prompts
    )
    assert any(
        "SocialApp" in prompt or "provider" in prompt.lower() for prompt in prompts
    )
    assert any("OpenID Connect" in prompt or "OIDC" in prompt for prompt in prompts)
    assert any("headless" in prompt.lower() or "SPA" in prompt for prompt in prompts)
    assert any("MFA" in prompt or "WebAuthn" in prompt for prompt in prompts)
    assert any(
        "usersessions" in prompt.lower() or "session" in prompt.lower()
        for prompt in prompts
    )
    assert any(
        "callback" in prompt.lower() or "SITE_ID" in prompt for prompt in prompts
    )
    assert all(item["expectations"] and item["expected_output"] for item in evals)


def test_django_allauth_evals_target_discriminating_failure_modes() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    evals = payload["evals"]

    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )

    assert (
        "settings, adapters, forms, signals, templates" in expectations
        or "existing extension point" in expectations
    )
    assert "SocialApp" in expectations
    assert "identity-provider" in expectations or "IdP" in expectations
    assert "headless" in expectations and (
        "session" in expectations.lower() or "JWT" in expectations
    )
    assert "release notes" in expectations.lower() or "version" in expectations.lower()
    assert (
        "provider-specific" in expectations.lower()
        or "do not guess" in expectations.lower()
    )
