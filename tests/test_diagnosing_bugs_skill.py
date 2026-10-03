"""Public diagnosis guidance contracts; native behavior is evaluated separately."""
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "practice" / "diagnosing-bugs"


def section(start: str, end: str) -> str:
    markdown = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    return markdown.split(start, 1)[1].split(end, 1)[0].lower()


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("**The whole skill in one breath:**", "## Multi-Failure Triage"),
        ("### Step 3 — FIX WAVE", "### Step 4 — VERIFY WAVE"),
        ("## Phase 5 —", "### Before applying the fix"),
    ],
    ids=["summary", "multi-failure-offender", "single-bug-repair"],
)
def test_every_repair_entry_requires_observed_permanent_red_before_repair(
    start: str, end: str
) -> None:
    guidance = section(start, end)
    red = "permanent regression observed red"
    assert red in guidance, "An exploratory repro is not an observed permanent regression"
    assert guidance.index(red) < guidance.index("production repair")
    assert "bug's reason" in guidance
    assert "green" in guidance
    assert "original scenario" in guidance
