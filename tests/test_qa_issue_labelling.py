from pathlib import Path

from scripts.validate_refs import find_skill_dir


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
WORKFLOW_LABEL = "workflow:implement"


def test_qa_labels_the_issues_it_files_for_implementation_routing() -> None:
    """Forge-backed qa issues carry a category, the workflow marker, and a
    state, resolved through the project's triage label mapping — so the
    issues route to /implement instead of landing bare (Gitea #65)."""
    qa_text = (find_skill_dir(SKILLS_ROOT, "qa") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    label_template_text = (
        find_skill_dir(SKILLS_ROOT, "setup-project-skills") / "triage-labels.md"
    ).read_text(encoding="utf-8")

    for role in ("bug", "enhancement", "ready-for-agent", "ready-for-human"):
        assert f"`{role}`" in qa_text
        assert role in label_template_text

    assert f"`{WORKFLOW_LABEL}`" in qa_text
    assert WORKFLOW_LABEL in label_template_text
    assert "label mapping" in qa_text


def _qa_section(heading: str) -> str:
    qa_text = (find_skill_dir(SKILLS_ROOT, "qa") / "SKILL.md").read_text(
        encoding="utf-8"
    )
    return qa_text.split(f"{heading}\n", 1)[1].split("\n#### ", 1)[0]


def test_clear_reproduction_alone_does_not_make_an_issue_agent_ready() -> None:
    """Concrete steps and an unambiguous expectation establish clarity; agent
    readiness also needs a human grant covering the issue's scope (#254)."""
    labels = _qa_section("#### Labels (forge-backed trackers only)")
    normalized = " ".join(labels.split())

    assert (
        "Apply `ready-for-agent` when the reproduction steps are concrete"
        not in normalized
    )
    assert "**Clarity**" in normalized
    assert "**Authority**" in normalized
    assert "permission to publish, not implementation authority" in normalized
    assert "Apply `ready-for-agent` only when both hold" in normalized
