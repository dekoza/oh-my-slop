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
