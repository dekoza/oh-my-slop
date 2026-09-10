"""Ticket planning must make unsafe concurrency unrepresentable in its graph."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/workflow/to-tickets/SKILL.md"


def test_shared_foundations_precede_even_executable_contract_tickets() -> None:
    text = SKILL.read_text()
    assert "## Critical rules" in text
    assert "one scaffolding ticket" in text
    assert "including executable contract tickets" in text
    assert "already-complete scaffolding" in text
    assert text.index("## Critical rules") < text.index("## Process")
