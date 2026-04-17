from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DECK_PATH = REPO_ROOT / "agent-deliverables-policy-deck.html"


def test_agent_deliverables_policy_deck_exists_and_is_self_contained() -> None:
    assert DECK_PATH.exists()

    html = DECK_PATH.read_text(encoding="utf-8")

    assert "<title>Agent Deliverables Policy Feedback</title>" in html
    assert "Hybrid recommendation" in html
    assert "Research -> single-file HTML deck" in html
    assert "Web UI features -> navigable demo artifact" in html
    assert "More complex task categories" in html
    assert "AGENTS.md should define the policy" in html
    assert "skills should own the workflow" in html
    assert "aria-label=\"Previous slide\"" in html
    assert "aria-label=\"Next slide\"" in html
    assert "Arrow keys" in html
    assert "https://" not in html
    assert "http://" not in html


def test_agent_deliverables_policy_deck_covers_required_content() -> None:
    html = DECK_PATH.read_text(encoding="utf-8")

    assert "Use a short global rule plus dedicated skills" in html
    assert "tests prove correctness; demo artifacts prove reachability and usability" in html
    assert "video when possible, annotated screenshots or an HTML walkthrough when not" in html
    assert "bug fix" in html.lower()
    assert "performance" in html.lower()
    assert "data migration" in html.lower()
    assert "security" in html.lower()


def test_agent_deliverables_policy_deck_uses_tighter_horizontal_spacing() -> None:
    html = DECK_PATH.read_text(encoding="utf-8")

    assert "--slide-padding-x: clamp(24px, 3vw, 34px);" in html
    assert "padding: 42px var(--slide-padding-x) 38px;" in html


def test_agent_deliverables_policy_deck_removes_outer_left_margin() -> None:
    html = DECK_PATH.read_text(encoding="utf-8")

    assert "width: 100%;" in html
    assert "max-width: none;" in html
    assert "padding: 0;" in html
