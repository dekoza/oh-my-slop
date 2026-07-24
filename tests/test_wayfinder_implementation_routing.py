from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
WORKFLOW_LABEL = "workflow:implement"


def test_to_tickets_marks_build_work_for_the_implement_workflow() -> None:
    to_tickets_text = (SKILLS_ROOT / "to-tickets" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    label_template_text = (
        SKILLS_ROOT / "setup-project-skills" / "triage-labels.md"
    ).read_text(encoding="utf-8")

    assert WORKFLOW_LABEL in to_tickets_text
    assert WORKFLOW_LABEL in label_template_text
    assert "ready-for-agent" in to_tickets_text
    assert "ready-for-human" in to_tickets_text


def test_wayfinder_hands_build_ready_work_to_implementation_tickets() -> None:
    wayfinder_text = (SKILLS_ROOT / "wayfinder" / "SKILL.md").read_text(
        encoding="utf-8"
    )

    assert "`to-tickets`" in wayfinder_text
    assert WORKFLOW_LABEL in wayfinder_text
    assert "`implement`" in wayfinder_text
    assert "never carry a `wayfinder:<type>` label" in wayfinder_text
