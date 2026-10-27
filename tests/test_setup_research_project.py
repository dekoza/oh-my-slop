"""Packaging and instruction contracts; agent behavior is exercised by skill evals."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/meta/setup-research-project"


def test_research_setup_is_user_invoked_and_ships_its_workflow_template() -> None:
    text = (SKILL / "SKILL.md").read_text(encoding="utf-8")

    assert "name: setup-research-project\n" in text
    assert "disable-model-invocation: true" in text
    assert "[research-workflow.md](research-workflow.md)" in text
    assert (SKILL / "research-workflow.md").is_file()
