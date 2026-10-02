"""Source routing guards, not proof of semantic review quality or efficiency."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "skills/workflow/two-axis-review/references/compact-evidence.md"


def test_compact_transport_has_one_owned_reference() -> None:
    text = REFERENCE.read_text()
    assert "review_evidence" in text and "options.reviewEvidence" in text
    assert "top-level" in text and "Nested" in text
    assert "caller" in text and "before implementation dispatch" in text
    assert "no model/API probe" in text


def test_execution_owners_check_selected_route_before_building() -> None:
    for name, editing_step in (("implement", "## Delivery:"),
                               ("implement-spec", "## 2. Pin")):
        path = ROOT / "skills/workflow" / name / "SKILL.md"
        text = path.read_text()
        pointer = "../two-axis-review/references/compact-evidence.md"
        assert pointer in text
        assert (path.parent / pointer).resolve() == REFERENCE
        assert text.index(pointer) < text.index(editing_step)
        assert "selected compact" in text


def test_review_owner_requires_completed_independent_outcomes() -> None:
    text = (ROOT / "skills/workflow/two-axis-review/SKILL.md").read_text()
    assert "references/compact-evidence.md" in text
    assert "selected compact" in text
    reference = REFERENCE.read_text()
    for requirement in ("both independent axes", "raw", "coverage", "incomplete",
                        "human acceptance", "repair budget", "unchanged candidate"):
        assert requirement in reference
    assert "ordinary path" in reference
    assert "not a token ceiling" in reference
