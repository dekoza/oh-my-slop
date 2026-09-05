"""Tracker references resolve predictably when a project has two forges."""

from pathlib import Path

from scripts.validate_refs import find_skill_dir


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"


def test_live_tracker_contract_routes_unqualified_numbers_to_gitea() -> None:
    tracker_doc = (REPO_ROOT / "docs" / "agents" / "issue-tracker.md").read_text(
        encoding="utf-8"
    )

    assert "## Reference routing" in tracker_doc
    assert "`#213` and `213` resolve to Gitea" in tracker_doc
    assert "`gh:213` and `github:213` resolve to GitHub" in tracker_doc


def test_triage_distinguishes_intake_discovery_from_explicit_reference_routing() -> None:
    triage_text = (find_skill_dir(SKILLS_ROOT, "triage") / "SKILL.md").read_text(
        encoding="utf-8"
    )

    assert "Discovery queries the intake tracker" in triage_text
    assert "Explicit issue references follow the tracker doc's reference routing" in triage_text
    assert "Do not probe one tracker and silently fall back to another" in triage_text


def test_project_setup_preserves_reference_routing_in_two_tracker_docs() -> None:
    setup_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "SKILL.md"
    ).read_text(encoding="utf-8")

    normalized_setup = " ".join(setup_text.split())

    assert "## Reference routing" in setup_text
    assert (
        "Route unqualified issue numbers (`#<number>` and `<number>`) to the agent "
        "work tracker"
    ) in normalized_setup
    assert "`gh:<number>` and `github:<number>`" in setup_text
